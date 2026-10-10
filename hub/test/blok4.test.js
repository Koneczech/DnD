// Blok 4: světla. Skládání vrstev, ovladače proti falešnému Hue bridgi (HTTPS) a falešné WiZ lampě
// (UDP), přepínač Řídit světla, souboj se zásobníkem, Zachytit světla, výpadek zařízení a blesky.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import dgram from 'node:dgram';
import crypto from 'node:crypto';
import { generate } from 'selfsigned';
import { Hub } from '../server/app.js';
import { slozitSvetla, pojistky, PODLAHA_JASU, STROP_SYTOSTI, MAX_ZABLESKU_ZA_S, VYCHOZI_SVETLA, rozebratZarizeni } from '../server/svetla.js';
import { sytost } from '../server/zarizeni/barvy.js';
import { Wiz } from '../server/zarizeni/wiz.js';
import { Hue } from '../server/zarizeni/hue.js';
import { normalizujSvetlaMista } from '../server/mista.js';
import { docasneRepo, dokud, cekej, FalesnyObs } from './pomoc.js';

const HESLO = 'spravne';

const VRSTVY = {
  pocasi: {
    dest: { svetla: { vsechny: { jas_nasobek: 0.8, teplota_posun: -800 } } },
    mlha: { svetla: { vsechny: { jas_nasobek: 0.5 } } },
    bourka: { svetla: { vsechny: { jas_nasobek: 0.7 } } },
  },
  rezim: { souboj: { svetla: { hlavni: { barva: [255, 0, 0], jas: 45 }, lampa: { wiz_scena: 'fireplace', rychlost: 80 } } } },
};
const MISTO_SVETLA = {
  den: { hlavni: { barva: [255, 214, 170], jas: 60 }, pozadi: { barva: [120, 160, 90], jas: 40 }, lampa: { barva: [255, 170, 80], jas: 50 } },
};
const scena = (z = {}) => ({ varianta: 'den', pocasi: [], intenzita: 0, rezim: 'pruzkum', ...z });

test('skládání: místo pro den, noc z poloviny dne, jinak výchozí stav', () => {
  const den = slozitSvetla({ misto: { svetla: MISTO_SVETLA }, scena: scena(), vrstvy: VRSTVY, vychozi: VYCHOZI_SVETLA });
  assert.equal(den.pozadi.jas, 40);
  assert.deepEqual(den.lampa.rgb, [255, 170, 80]);
  const noc = slozitSvetla({ misto: { svetla: MISTO_SVETLA }, scena: scena({ varianta: 'noc' }), vrstvy: VRSTVY, vychozi: VYCHOZI_SVETLA });
  assert.equal(noc.pozadi.jas, 20);
  assert.equal(noc.hlavni.jas, 30);
  const bez = slozitSvetla({ misto: null, scena: scena(), vrstvy: VRSTVY, vychozi: { ...VYCHOZI_SVETLA, lampa: { barva: [1, 2, 3], jas: 33 } } });
  assert.equal(bez.lampa.jas, 33);
  assert.equal(bez.pozadi.zap, false);
});

test('skládání: počasí se násobí, intenzita tlumí, souboj přepíše role', () => {
  const v = slozitSvetla({ misto: { svetla: MISTO_SVETLA }, scena: scena({ pocasi: ['dest', 'mlha'], intenzita: 2 }), vrstvy: VRSTVY, vychozi: VYCHOZI_SVETLA });
  assert.equal(v.pozadi.jas, Math.round(40 * 0.8 * 0.5 * 0.7));
  assert.ok(v.pozadi.rgb[2] > 90, 'déšť posune barvu do chladna');
  const s = slozitSvetla({ misto: { svetla: MISTO_SVETLA }, scena: scena({ rezim: 'souboj' }), vrstvy: VRSTVY, vychozi: VYCHOZI_SVETLA });
  assert.equal(s.lampa.scena, 'fireplace');
  assert.equal(s.pozadi.jas, 40, 'role, kterou souboj neuvádí, zůstane');
});

test('pojistky: hlavní světlo nikdy pod podlahu jasu a nad strop sytosti, ani v noci se soubojem a bouřkou', () => {
  const tma = { den: { hlavni: { vypnuto: true } }, noc: { hlavni: { barva: [0, 0, 255], jas: 5 } } };
  const v = slozitSvetla({ misto: { svetla: tma }, scena: scena({ varianta: 'noc', pocasi: ['bourka', 'mlha', 'dest'], intenzita: 3, rezim: 'souboj' }), vrstvy: VRSTVY, vychozi: VYCHOZI_SVETLA });
  assert.ok(v.hlavni.zap);
  assert.ok(v.hlavni.jas >= PODLAHA_JASU);
  assert.ok(sytost(v.hlavni.rgb) <= STROP_SYTOSTI + 0.01);
  const vyp = slozitSvetla({ misto: { svetla: tma }, scena: scena(), vrstvy: VRSTVY, vychozi: VYCHOZI_SVETLA });
  assert.equal(vyp.hlavni.jas, PODLAHA_JASU, 'ani vypnuté hlavní světlo místa nezhasne');
  assert.equal(pojistky({ hlavni: { zap: true, jas: 3, rgb: [255, 0, 0] } }).hlavni.jas, PODLAHA_JASU);
});

test('zařízení rolí a světla místa se čtou jen v platném tvaru', () => {
  assert.deepEqual(rozebratZarizeni('hue:0a1b2c3d-1111-2222-3333-444455556666, wiz:192.168.1.40 nesmysl wiz:999.1'), ['hue:0a1b2c3d-1111-2222-3333-444455556666', 'wiz:192.168.1.40']);
  assert.deepEqual(normalizujSvetlaMista({ den: { hlavni: { jas: 3 }, spatne: 4 }, poledne: {} }), { den: { hlavni: { jas: 3 } } });
  assert.equal(normalizujSvetlaMista('nic'), null);
});

/* ---------- Falešná WiZ lampa (UDP) ---------- */

async function falesnaWiz({ zahoditPrvnich = 0 } = {}) {
  const sock = dgram.createSocket('udp4');
  const prijato = [];
  let stav = { state: true, sceneId: 0, r: 10, g: 20, b: 30, dimming: 55 };
  let zahodit = zahoditPrvnich;
  sock.on('message', (data, kdo) => {
    const z = JSON.parse(String(data));
    prijato.push(z);
    if (zahodit-- > 0) return;
    if (z.method === 'setPilot') {
      stav = { ...stav, ...z.params };
      sock.send(JSON.stringify({ method: 'setPilot', result: { success: true } }), kdo.port, kdo.address);
    } else if (z.method === 'getPilot') {
      sock.send(JSON.stringify({ method: 'getPilot', result: stav }), kdo.port, kdo.address);
    }
  });
  await new Promise((r) => sock.bind(0, '127.0.0.1', r));
  return { port: sock.address().port, prijato, stav: () => stav, zavrit: () => new Promise((r) => sock.close(r)) };
}

test('WiZ: setPilot s barvou a jasem, scéna, čtení stavu; ztracený paket se zopakuje', async () => {
  const lampa = await falesnaWiz({ zahoditPrvnich: 1 });
  try {
    const w = new Wiz({ adresa: '127.0.0.1', port: lampa.port, limitMs: 150 });
    await w.nastavit({ zap: true, rgb: [200, 100, 50], jas: 4 });
    assert.equal(lampa.prijato.length, 2, 'první paket se ztratil, druhý prošel');
    assert.deepEqual(lampa.stav(), { ...lampa.stav(), r: 200, g: 100, b: 50, dimming: 10 });
    await w.nastavit({ zap: true, scena: 'candlelight', rychlost: 40, jas: 35 });
    assert.equal(lampa.stav().sceneId, 29);
    const s = await w.stav();
    assert.equal(s.scena, 'candlelight');
    assert.equal(s.jas, 35);
    await w.nastavit({ zap: false, jas: 0 });
    assert.equal(lampa.stav().state, false);
  } finally {
    await lampa.zavrit();
  }
});

test('WiZ: lampa, která neodpovídá, vrátí srozumitelnou chybu', async () => {
  const lampa = await falesnaWiz({ zahoditPrvnich: 99 });
  try {
    const w = new Wiz({ adresa: '127.0.0.1', port: lampa.port, limitMs: 80, pokusu: 2 });
    await assert.rejects(() => w.nastavit({ zap: true, rgb: [1, 2, 3], jas: 50 }), /neodpovídá/);
  } finally {
    await lampa.zavrit();
  }
});

/* ---------- Falešný Hue bridge (HTTPS s certifikátem vytvořeným za běhu) ---------- */

async function falesnyBridge() {
  const pem = await generate([{ name: 'commonName', value: 'falesny-bridge' }], { days: 1, keySize: 2048 });
  const klic = crypto.randomBytes(20).toString('hex'); // zjevně falešný, vzniká za běhu
  const id = crypto.randomUUID();
  let tlacitko = false;
  const pozadavky = [];
  const svetlo = { id, metadata: { name: 'Herna' }, on: { on: true }, dimming: { brightness: 50 }, color: { xy: { x: 0.45, y: 0.41 } } };
  const server = https.createServer({ key: pem.private, cert: pem.cert }, (req, res) => {
    const casti = [];
    req.on('data', (c) => casti.push(c));
    req.on('end', () => {
      const telo = casti.length ? JSON.parse(Buffer.concat(casti).toString()) : null;
      pozadavky.push({ metoda: req.method, cesta: req.url, klic: req.headers['hue-application-key'], telo });
      const json = (status, d) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(d));
      };
      if (req.method === 'POST' && req.url === '/api') {
        return json(200, tlacitko ? [{ success: { username: klic, clientkey: 'x' } }] : [{ error: { type: 101, description: 'link button not pressed' } }]);
      }
      if (req.headers['hue-application-key'] !== klic) return json(403, { errors: [{ description: 'unauthorized user' }] });
      if (req.method === 'GET' && req.url === '/clip/v2/resource/light') return json(200, { errors: [], data: [svetlo] });
      if (req.url === `/clip/v2/resource/light/${id}`) {
        if (req.method === 'GET') return json(200, { errors: [], data: [svetlo] });
        if (req.method === 'PUT') {
          if (telo.on) svetlo.on = telo.on;
          if (telo.dimming) svetlo.dimming = telo.dimming;
          if (telo.color) svetlo.color = telo.color;
          return json(200, { errors: [], data: [{ rid: id, rtype: 'light' }] });
        }
      }
      return json(404, { errors: [{ description: 'not found' }] });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: server.address().port,
    id,
    klic,
    svetlo,
    pozadavky,
    stisknout: () => (tlacitko = true),
    zavrit: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}

test('Hue: spárování až po stisku tlačítka, ovládání světla s klíčem a ověřeným certifikátem', async () => {
  const b = await falesnyBridge();
  try {
    await assert.rejects(() => Hue.sparovat({ bridge: '127.0.0.1', port: b.port }), (e) => e.status === 409 && /tlačítko/.test(e.message));
    b.stisknout();
    const { klic, otisk } = await Hue.sparovat({ bridge: '127.0.0.1', port: b.port });
    assert.equal(klic, b.klic);
    assert.match(otisk, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    const hue = new Hue({ bridge: '127.0.0.1', port: b.port, klic, otisk });
    const svetla = await hue.svetla();
    assert.deepEqual(svetla.map((s) => [s.id, s.nazev, s.barevne]), [[b.id, 'Herna', true]]);
    await hue.nastavit(b.id, { zap: true, jas: 33, rgb: [255, 0, 0] }, 500);
    const put = b.pozadavky.at(-1);
    assert.equal(put.metoda, 'PUT');
    assert.equal(put.telo.dimming.brightness, 33);
    assert.equal(put.telo.dynamics.duration, 500);
    assert.ok(put.telo.color.xy.x > 0.6, 'červená je v xy vpravo');
    const stav = await hue.stav(b.id);
    assert.equal(stav.jas, 33);
    assert.ok(stav.rgb[0] > stav.rgb[2]);
    await hue.nastavit(b.id, { zap: false, jas: 0 });
    assert.equal(b.svetlo.on.on, false);
  } finally {
    await b.zavrit();
  }
});

test('Hue: cizí certifikát (podvržený bridge) klíč nedostane, špatný klíč je srozumitelná chyba', async () => {
  const b = await falesnyBridge();
  try {
    const cizi = 'AA:' + 'BB:'.repeat(30) + 'CC';
    const hue = new Hue({ bridge: '127.0.0.1', port: b.port, klic: b.klic, otisk: cizi });
    const pred = b.pozadavky.length;
    await assert.rejects(() => hue.svetla(), /Certifikát Hue bridge nesedí/);
    await cekej(50);
    assert.equal(b.pozadavky.length, pred, 's cizím certifikátem neodejde ani požadavek, ani klíč');
    const spatny = new Hue({ bridge: '127.0.0.1', port: b.port, klic: 'falesny-klic' });
    await assert.rejects(() => spatny.svetla(), /klíč nepřijal/);
  } finally {
    await b.zavrit();
  }
});

/* ---------- Hub se světly (falešné ovladače) ---------- */

const MISTO = `---
schema: 1
id: testov
typ: misto
nazev: Testov
verejne: true
popis_obrazu: "" # komentář, který musí přežít
ilustrace:
  - soubor: celek.png
    ucel: scena
    skryta: false
svetla:
  den:
    hlavni: { barva: [255, 214, 170], jas: 60 }
    pozadi: { barva: [120, 160, 90], jas: 40 }
---
Tělo, které Hub nesmí přepsat.
`;

class FalesneSvetlo {
  constructor(nazev, log) {
    this.nazev = nazev;
    this.log = log;
    this.stavy = new Map();
    this.rozbite = false;
  }
  zaznam(id, cil) {
    if (this.rozbite) throw Object.assign(new Error('neodpovídá'), { status: 503 });
    this.stavy.set(id, cil);
    this.log.push({ zarizeni: `${this.nazev}:${id}`, cil, cas: Date.now() });
  }
}

async function spustitHub({ env = '', repo: puvodni } = {}) {
  const repo = puvodni ?? (await docasneRepo());
  const hueId = 'aaaaaaaa-1111-2222-3333-444455556666';
  if (!puvodni) {
    const slozka = path.join(repo.c.kampan, 'mista', 'testov');
    await fs.mkdir(slozka, { recursive: true });
    await fs.writeFile(path.join(slozka, 'testov.md'), MISTO);
    await fs.mkdir(path.join(repo.c.kampan, 'sceny', 'rezim'), { recursive: true });
    await fs.writeFile(path.join(repo.c.kampan, 'sceny', 'rezim', 'souboj.yaml'), 'svetla:\n  hlavni: { barva: [255, 90, 60], jas: 45 }\n  lampa: { wiz_scena: fireplace, rychlost: 80 }\n');
    const klic = crypto.randomBytes(16).toString('hex');
    await fs.writeFile(
      repo.c.env,
      `OBS_URL="ws://127.0.0.1:4455"\nOBS_HESLO="${HESLO}"\nOBS_SCENA_SOUBOJ="Souboj"\nHUE_BRIDGE="127.0.0.1"\nHUE_KLIC="${klic}"\nSVETLA_HLAVNI="hue:${hueId}"\nSVETLA_POZADI="hue:bbbbbbbb-1111-2222-3333-444455556666"\nSVETLA_LAMPA="wiz:127.0.0.9"\n${env}`,
    );
  }
  const log = [];
  const hue = new FalesneSvetlo('hue', log);
  const wiz = new FalesneSvetlo('wiz', log);
  const zachyceno = { hue: { zap: true, jas: 22, rgb: [10, 20, 200] }, wiz: { zap: true, jas: 35, scena: 'candlelight', rychlost: 40 } };
  const ovladaceSvetel = {
    hue: () => ({
      nastavit: async (id, cil) => hue.zaznam(id, cil),
      stav: async () => zachyceno.hue,
    }),
    wiz: ({ adresa }) => ({
      nastavit: async (cil) => wiz.zaznam(adresa, cil),
      stav: async () => zachyceno.wiz,
    }),
  };
  const obs = new FalesnyObs({ heslo: HESLO });
  const hub = new Hub({ cesty: repo.c, obsKlient: obs, gitSit: false, port: 0, ovladaceSvetel, sparovatHue: async () => ({ klic: crypto.randomBytes(16).toString('hex'), otisk: 'AB:CD' }) });
  await hub.spustit();
  await dokud(() => hub.obs.pripojeno);
  const volat = async (cesta, { metoda = 'GET', telo } = {}) => {
    const r = await fetch(hub.adresa + cesta, { method: metoda, headers: telo ? { 'Content-Type': 'application/json' } : {}, body: telo ? JSON.stringify(telo) : undefined });
    return { status: r.status, data: await r.json() };
  };
  return {
    hub, obs, repo, log, hue, wiz, hueId, volat,
    zastavit: async ({ smazat = true } = {}) => {
      await hub.zastavit();
      if (smazat) await repo.smazat();
    },
  };
}

test('Řídit světla vypnuto: Hub na světla nesahá; zapnutí je pošle, vypnutí vrátí výchozí stav', async () => {
  const t = await spustitHub();
  try {
    assert.equal(t.hub.svetla.verejny().ridit, false);
    await t.volat('/api/scena/zobrazit', { metoda: 'POST', telo: { misto: 'testov' } });
    await t.volat('/api/scena', { metoda: 'PUT', telo: { pocasi: ['bourka'], intenzita: 3 } });
    const b = await t.volat('/api/svetla/blesk', { metoda: 'POST', telo: {} });
    assert.equal(b.data.blesk, true, 'obraz v OBS blikne i bez řízení světel');
    await cekej(100);
    assert.equal(t.log.length, 0, 'žádná změna scény, počasí ani blesk světla nezmění');

    const zap = await t.volat('/api/svetla/ridit', { metoda: 'PUT', telo: { ridit: true } });
    assert.equal(zap.data.ridit, true);
    // Testovací repo má jen vrstvu souboje, bouřka tu světla neupraví; intenzita 3 ztlumí na 55 %.
    assert.equal(t.hue.stavy.get('bbbbbbbb-1111-2222-3333-444455556666').jas, Math.round(40 * 0.55));
    const pocet = t.log.length;
    assert.equal(pocet, 3, 'tři zařízení, každé jeden příkaz');

    await t.volat('/api/svetla/ridit', { metoda: 'PUT', telo: { ridit: false } });
    assert.equal(t.wiz.stavy.get('127.0.0.9').jas, VYCHOZI_SVETLA.lampa.jas, 'vypnutí vrátí výchozí stav');
    const poVypnuti = t.log.length;
    await t.volat('/api/scena', { metoda: 'PUT', telo: { varianta: 'noc' } });
    await cekej(100);
    assert.equal(t.log.length, poVypnuti);
    const ulozeno = JSON.parse(await fs.readFile(path.join(t.repo.c.lokalniStav, 'svetla.json'), 'utf8'));
    assert.equal(ulozeno.ridit, false);
  } finally {
    await t.zastavit();
  }
});

test('přepnutí místa nebo doby změní světla do 1 s; posílají se jen změny', async () => {
  const t = await spustitHub();
  try {
    await t.volat('/api/svetla/ridit', { metoda: 'PUT', telo: { ridit: true } });
    const pred = t.log.length;
    const zacatek = Date.now();
    await t.volat('/api/scena/zobrazit', { metoda: 'POST', telo: { misto: 'testov' } });
    await dokud(() => t.hue.stavy.get(t.hueId)?.jas === 60, 1000);
    assert.ok(Date.now() - zacatek < 1000);
    assert.equal(t.log.length - pred, 2, 'lampa místo nemá, zůstává výchozí a nic nedostane');
    const pred2 = t.log.length;
    await t.volat('/api/scena', { metoda: 'PUT', telo: { varianta: 'noc' } });
    await dokud(() => t.hue.stavy.get(t.hueId)?.jas === 30, 1000);
    assert.equal(t.log.length - pred2, 2, 'noc mění hlavní a pozadí, lampa se nemění');
  } finally {
    await t.zastavit();
  }
});

test('souboj: OBS a světla se vrátí přesně do stavu před soubojem, i po restartu Hubu', async () => {
  const t = await spustitHub();
  let t2;
  try {
    await t.volat('/api/svetla/ridit', { metoda: 'PUT', telo: { ridit: true } });
    await t.volat('/api/scena/zobrazit', { metoda: 'POST', telo: { misto: 'testov' } });
    await t.hub.obs.prepnoutScenu('Tábor');
    await dokud(() => t.hue.stavy.get(t.hueId)?.jas === 60);
    const predSoubojem = JSON.stringify([...t.hue.stavy, ...t.wiz.stavy]);

    const s = await t.volat('/api/souboj', { metoda: 'POST', telo: { zapnout: true } });
    assert.equal(s.data.rezim, 'souboj');
    assert.equal(t.obs.scena, 'Souboj');
    await dokud(() => t.wiz.stavy.get('127.0.0.9')?.scena === 'fireplace');
    assert.equal(t.hub.scena.verejny().rezim, 'souboj');
    // Druhé zahájení zásobník nepřepíše.
    await t.volat('/api/souboj', { metoda: 'POST', telo: { zapnout: true } });

    await t.hub.scena.ulozit();
    await t.zastavit({ smazat: false });
    t2 = await spustitHub({ repo: t.repo });
    assert.equal(t2.hub.scena.stav.rezim, 'souboj');
    t2.obs.scena = 'Souboj';
    const k = await t2.volat('/api/souboj', { metoda: 'POST', telo: { zapnout: false } });
    assert.equal(k.data.rezim, 'pruzkum');
    assert.equal(t2.obs.scena, 'Tábor', 'OBS zpět na scénu před soubojem');
    await dokud(() => t2.wiz.stavy.get('127.0.0.9')?.scena === undefined && t2.hue.stavy.get(t.hueId)?.jas === 60);
    assert.equal(JSON.stringify([...t2.hue.stavy, ...t2.wiz.stavy]), predSoubojem);
  } finally {
    if (t2) await t2.zastavit();
    else await t.zastavit();
  }
});

test('Zachytit světla uloží role do hlavičky místa bez ztráty komentářů; výchozí stav do hub/.stav', async () => {
  const t = await spustitHub();
  try {
    const r = await t.volat('/api/svetla/zachytit', { metoda: 'POST', telo: { misto: 'testov', varianta: 'noc' } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const text = await fs.readFile(path.join(t.repo.c.kampan, 'mista', 'testov', 'testov.md'), 'utf8');
    assert.match(text, /# komentář, který musí přežít/);
    assert.match(text, /Tělo, které Hub nesmí přepsat\./);
    assert.match(text, /noc:\n\s+hlavni: \{ barva: \[ ?10, 20, 200 ?\], jas: 22 \}/);
    assert.match(text, /lampa: \{ wiz_scena: candlelight, rychlost: 40, jas: 35 \}/);
    assert.match(text, /den:\n\s+hlavni: \{ barva: \[ ?255, 214, 170 ?\], jas: 60 \}/, 'den zůstal');
    // Po přepnutí jinam a zpět se stav obnoví.
    await t.volat('/api/svetla/ridit', { metoda: 'PUT', telo: { ridit: true } });
    await t.volat('/api/scena', { metoda: 'PUT', telo: { varianta: 'noc' } });
    await t.volat('/api/scena/zobrazit', { metoda: 'POST', telo: { misto: 'testov' } });
    await dokud(() => t.wiz.stavy.get('127.0.0.9')?.scena === 'candlelight');
    assert.equal(t.hue.stavy.get(t.hueId).jas, 22);

    const v = await t.volat('/api/svetla/zachytit', { metoda: 'POST', telo: { cil: 'vychozi' } });
    assert.equal(v.data.vychozi.lampa.wiz_scena, 'candlelight');
    const ulozeno = JSON.parse(await fs.readFile(path.join(t.repo.c.lokalniStav, 'svetla.json'), 'utf8'));
    assert.equal(ulozeno.vychozi.hlavni.jas, 22);
  } finally {
    await t.zastavit();
  }
});

test('nedostupné světlo: zbytek se přepne, kontrolka to ukáže, po návratu dostane aktuální stav', async () => {
  const t = await spustitHub();
  try {
    t.wiz.rozbite = true;
    await t.volat('/api/svetla/ridit', { metoda: 'PUT', telo: { ridit: true } });
    await t.volat('/api/scena/zobrazit', { metoda: 'POST', telo: { misto: 'testov' } });
    await dokud(() => t.hue.stavy.get(t.hueId)?.jas === 60, 1000);
    const lampa = t.hub.svetla.verejny().zarizeni.find((z) => z.typ === 'wiz');
    assert.equal(lampa.ok, false);
    assert.match(lampa.chyba, /neodpovídá/);
    t.wiz.rozbite = false;
    await t.hub.svetla.opakovat();
    assert.ok(t.wiz.stavy.get('127.0.0.9'));
    assert.equal(t.hub.svetla.verejny().zarizeni.every((z) => z.ok), true);
  } finally {
    await t.zastavit();
  }
});

test('blesky: nejvýš 3 za sekundu, s vypnutými Blesky neblikne nic', async () => {
  const t = await spustitHub();
  try {
    await t.volat('/api/svetla/ridit', { metoda: 'PUT', telo: { ridit: true } });
    const vysledky = [];
    for (let i = 0; i < 6; i++) vysledky.push((await t.volat('/api/svetla/blesk', { metoda: 'POST', telo: { vzdalenost: 'nad-nami' } })).data.blesk);
    assert.equal(vysledky.filter(Boolean).length, MAX_ZABLESKU_ZA_S);
    await t.volat('/api/nastaveni', { metoda: 'PUT', telo: { blesky: false } });
    await cekej(1100);
    const pred = t.log.length;
    const b = await t.volat('/api/svetla/blesk', { metoda: 'POST', telo: {} });
    assert.equal(b.data.blesk, false);
    assert.equal(t.log.length, pred);
    assert.equal(t.hub.svetla.casovacBlesku, null);
  } finally {
    await t.zastavit();
  }
});

test('nastavení světel: kontrola zařízení, klíč Hue jen ze spárování a nikdy do panelu', async () => {
  const t = await spustitHub();
  try {
    const spatne = await t.volat('/api/nastaveni', { metoda: 'PUT', telo: { svetlaLampa: 'wiz:999.1.1.1' } });
    assert.equal(spatne.status, 400);
    const ok = await t.volat('/api/nastaveni', { metoda: 'PUT', telo: { svetlaLampa: 'WIZ:192.168.1.40, wiz:192.168.1.41', hueSparovani: { klic: 'podvrh', otisk: '' } } });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.nastaveni.svetlaLampa, 'wiz:192.168.1.40,wiz:192.168.1.41');
    assert.notEqual(t.hub.nastaveni.hodnoty.HUE_KLIC, 'podvrh');
    assert.equal(t.hub.svetla.verejny().zarizeni.filter((z) => z.role === 'lampa').length, 2);

    const s = await t.volat('/api/svetla/hue/sparovat', { metoda: 'POST', telo: { bridge: '192.168.1.20' } });
    assert.equal(s.status, 200);
    assert.equal(s.data.nastaveni.hueSparovano, true);
    const klic = t.hub.nastaveni.hodnoty.HUE_KLIC;
    const env = await fs.readFile(t.repo.c.env, 'utf8');
    assert.ok(env.includes(klic));
    const prehled = await t.volat('/api/prehled');
    assert.equal(JSON.stringify(prehled.data).includes(klic), false, 'klíč neopustí server');
    assert.ok(t.hub.nastaveni.tajneHodnoty().includes(klic), 'hook ho hlídá');
  } finally {
    await t.zastavit();
  }
});
