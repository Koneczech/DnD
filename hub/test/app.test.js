import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { Hub } from '../server/app.js';
import { rozebrat } from '../server/frontmatter.js';
import { docasneRepo, dokud, FalesnyObs } from './pomoc.js';

const HESLO = 'spravne';

async function spustitHub({ sObs = true } = {}) {
  const repo = await docasneRepo();
  if (sObs) {
    await fs.writeFile(repo.c.env, `OBS_URL="ws://127.0.0.1:4455"\nOBS_HESLO="${HESLO}"\n`);
  }
  const obs = new FalesnyObs({ heslo: HESLO });
  const hub = new Hub({ cesty: repo.c, obsKlient: obs, gitSit: false, port: 0 });
  await hub.spustit();
  const zastavit = async () => {
    await hub.zastavit();
    await repo.smazat();
  };
  return { hub, obs, repo, zastavit };
}

async function pozadavek(hub, cesta, { metoda = 'GET', telo, hlavicky = {} } = {}) {
  const odpoved = await fetch(hub.adresa + cesta, {
    method: metoda,
    headers: { ...(telo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...hlavicky },
    body: telo !== undefined ? JSON.stringify(telo) : undefined,
  });
  return { status: odpoved.status, data: await odpoved.json().catch(() => null) };
}

/** Odběr událostí SSE; vrací funkci, která čeká na událost splňující podmínku. */
function odebirat(hub) {
  const udalosti = [];
  const cekajici = [];
  const req = http.get(hub.adresa + '/api/udalosti', (res) => {
    let buffer = '';
    res.setEncoding('utf8');
    res.on('data', (kus) => {
      buffer += kus;
      let i;
      while ((i = buffer.indexOf('\n\n')) !== -1) {
        const blok = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        const typ = blok.match(/^event: (.+)$/m)?.[1];
        const data = blok.match(/^data: (.+)$/m)?.[1];
        if (!typ || !data) continue;
        const u = { typ, data: JSON.parse(data), cas: Date.now() };
        udalosti.push(u);
        for (const c of [...cekajici]) if (c.podminka(u)) c.resolve(u);
      }
    });
  });
  return {
    cekat: (podminka, limitMs = 2000) =>
      new Promise((resolve, reject) => {
        const hotova = udalosti.find(podminka);
        if (hotova) return resolve(hotova);
        const c = { podminka, resolve };
        cekajici.push(c);
        setTimeout(() => reject(new Error('Událost nepřišla včas')), limitMs).unref();
      }),
    zavrit: () => req.destroy(),
  };
}

test('API: přehled nikdy neobsahuje heslo OBS a Hub se k OBS připojí', async () => {
  const { hub, zastavit } = await spustitHub();
  try {
    await dokud(() => hub.obs.pripojeno, 2000);
    const { status, data } = await pozadavek(hub, '/api/prehled');
    assert.equal(status, 200);
    assert.ok(!JSON.stringify(data).includes(HESLO));
    assert.equal(data.nastaveni.obsHesloNastaveno, true);
    assert.deepEqual(data.obs.sceny, ['Mirabar', 'Souboj', 'Tábor']);
    assert.deepEqual(data.obs.varovaniZdroju, [{ zdroj: 'Kalendář', nastaveni: ['Shutdown source when not visible'] }]);
  } finally {
    await zastavit();
  }
});

test('API: změna stavu z panelu se do 1 s zapíše do souboru a dorazí do výstupů', async () => {
  const { hub, repo, zastavit } = await spustitHub();
  const sse = odebirat(hub);
  try {
    await sse.cekat((u) => u.typ === 'stav');
    const zacatek = Date.now();
    const { status, data } = await pozadavek(hub, '/api/stav', { metoda: 'PUT', telo: { misto: 'Longsaddle' } });
    assert.equal(status, 200);
    assert.equal(data.vysledek, 'zapsano');
    const u = await sse.cekat((x) => x.typ === 'stav' && x.data.stav?.misto === 'Longsaddle');
    assert.ok(u.cas - zacatek < 1000);
    const naDisku = rozebrat(await fs.readFile(repo.c.stav, 'utf8'));
    assert.equal(naDisku.data.misto, 'Longsaddle');
    assert.match(naDisku.telo, /Tělo souboru/);
    assert.equal((await pozadavek(hub, '/api/stav', { metoda: 'PUT', telo: { sezeni: 'x' } })).status, 400);
  } finally {
    sse.zavrit();
    await zastavit();
  }
});

test('API: úprava stav.md zvenku (Obsidian) dorazí do výstupů do 1 s', async () => {
  const { hub, repo, zastavit } = await spustitHub();
  const sse = odebirat(hub);
  try {
    await sse.cekat((u) => u.typ === 'stav');
    await new Promise((r) => setTimeout(r, 200));
    const zacatek = Date.now();
    await fs.writeFile(repo.c.stav, (await fs.readFile(repo.c.stav, 'utf8')).replace('Mirabar', 'Yartar'));
    const u = await sse.cekat((x) => x.typ === 'stav' && x.data.stav?.misto === 'Yartar', 3000);
    assert.ok(u.cas - zacatek < 1000, `trvalo ${u.cas - zacatek} ms`);
  } finally {
    sse.zavrit();
    await zastavit();
  }
});

test('API: přepnutí scény OBS do 500 ms, neexistující scéna = 404', async () => {
  const { hub, obs, zastavit } = await spustitHub();
  try {
    await dokud(() => hub.obs.pripojeno, 2000);
    const zacatek = Date.now();
    const { status } = await pozadavek(hub, '/api/obs/scena', { metoda: 'POST', telo: { nazev: 'Souboj' } });
    assert.equal(status, 200);
    assert.ok(Date.now() - zacatek < 500);
    assert.equal(obs.scena, 'Souboj');
    assert.equal((await pozadavek(hub, '/api/obs/scena', { metoda: 'POST', telo: { nazev: 'Neexistuje' } })).status, 404);
  } finally {
    await zastavit();
  }
});

test('Bez .env: Nastavení hlásí existuje=false; po uložení hesla se Hub připojí', async () => {
  const { hub, repo, zastavit } = await spustitHub({ sObs: false });
  try {
    let { data } = await pozadavek(hub, '/api/nastaveni');
    assert.equal(data.existuje, false);
    assert.equal(hub.obs.pripojeno, false);
    ({ data } = await pozadavek(hub, '/api/nastaveni', { metoda: 'PUT', telo: { obsUrl: 'ws://127.0.0.1:4455', obsHeslo: HESLO } }));
    assert.equal(data.nastaveni.existuje, true);
    assert.ok(!JSON.stringify(data).includes(HESLO));
    await dokud(() => hub.obs.pripojeno, 2000);
    assert.match(await fs.readFile(repo.c.env, 'utf8'), /OBS_HESLO/);
  } finally {
    await zastavit();
  }
});

test('Ochrana: cizí Host, formulář místo JSON a únik ze složky se odmítnou', async () => {
  const { hub, zastavit } = await spustitHub();
  try {
    const cizi = await new Promise((resolve) => {
      const req = http.get(hub.adresa + '/api/prehled', { headers: { Host: 'utocnik.example' } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.end();
    });
    assert.equal(cizi, 403);
    const formular = await fetch(hub.adresa + '/api/stav', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'misto=hack',
    });
    assert.equal(formular.status, 415);
    assert.equal((await fetch(hub.adresa + '/panel/..%2F..%2Fpackage.json')).status, 404);
    assert.equal((await fetch(hub.adresa + '/')).status, 200);
    assert.equal((await fetch(hub.adresa + '/vystupy/test.html')).status, 200);
  } finally {
    await zastavit();
  }
});
