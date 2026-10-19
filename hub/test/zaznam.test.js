// Záznam událostí (bod 84).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Hub } from '../server/app.js';
import { Zaznam, ocistit } from '../server/zaznam.js';
import { docasneRepo, dokud, FalesnyObs } from './pomoc.js';

test('záznam: úrovně, výpis od čísla, jen problémy a text pro stažení', () => {
  let t = Date.parse('2026-10-12T18:00:00Z');
  const z = new Zaznam({ hodiny: () => new Date((t += 1000)) });
  z.info('scena', 'Tábor lupičů · den');
  z.varovani('obs', 'OBS nepřipojené');
  z.chyba('stranka', 'Soubor nehraje');
  z.zapsat('x', 'nesmysl', 'neznámá úroveň');
  assert.equal(z.vypis().length, 4);
  assert.equal(z.vypis().at(-1).uroven, 'info');
  assert.deepEqual(z.vypis({ jenProblemy: true }).map((p) => p.zdroj), ['obs', 'stranka']);
  assert.deepEqual(z.vypis({ od: 2 }).map((p) => p.cislo), [3, 4]);
  assert.deepEqual(z.vypis({ n: 1 }).map((p) => p.cislo), [4]);
  const text = z.text();
  assert.equal(text.split('\n').length, 4);
  assert.match(text, /VAROVANI\s+obs\s+OBS nepřipojené/);
});

test('záznam: opakovaný stav se zapíše jen při změně, paměť má strop', () => {
  const z = new Zaznam();
  assert.ok(z.zmena('obs', 'obs', 'info', 'připojené'));
  assert.equal(z.zmena('obs', 'obs', 'info', 'připojené'), null);
  assert.ok(z.zmena('obs', 'obs', 'varovani', 'odpojené'));
  assert.equal(z.vypis().length, 2);
  for (let i = 0; i < 2100; i++) z.info('test', `zpráva ${i}`);
  assert.equal(z.polozky.length, 2000);
  assert.equal(z.polozky.at(-1).zprava, 'zpráva 2099');
});

test('záznam: tajná pole se nezapíšou, dlouhé hodnoty se zkrátí', () => {
  const falesne = `x${Math.random().toString(36).slice(2)}`;
  const d = ocistit({ heslo: falesne, apiKey: falesne, vnoreno: { token: falesne, jmeno: 'Alba' }, dlouhe: 'a'.repeat(1000) });
  assert.ok(!JSON.stringify(d).includes(falesne));
  assert.equal(d.vnoreno.jmeno, 'Alba');
  assert.ok(d.dlouhe.length < 400);
});

test('záznam: denní soubor a úklid starých souborů', async () => {
  const slozka = await fs.mkdtemp(path.join(os.tmpdir(), 'zaznam-'));
  try {
    const stary = path.join(slozka, 'hub-2026-01-01.log');
    await fs.writeFile(stary, 'starý\n');
    const z = new Zaznam({ slozka, hodiny: () => new Date('2026-10-12T18:00:00Z') });
    z.info('hub', 'první');
    z.chyba('hub', 'druhá');
    await z.fronta;
    const obsah = await fs.readFile(path.join(slozka, 'hub-2026-10-12.log'), 'utf8');
    assert.equal(obsah.trim().split('\n').length, 2);
    await z.uklidit();
    await assert.rejects(fs.stat(stary));
  } finally {
    await fs.rm(slozka, { recursive: true, force: true });
  }
});

test('záznam v Hubu: start, souboj, chyba stránky, výpis a stažení', async () => {
  const repo = await docasneRepo();
  await fs.writeFile(repo.c.env, 'OBS_URL="ws://127.0.0.1:4455"\nOBS_HESLO="spravne"\nOBS_SCENA_SOUBOJ="Souboj"\n');
  const hub = new Hub({ cesty: repo.c, obsKlient: new FalesnyObs({ heslo: 'spravne' }), gitSit: false, port: 0 });
  await hub.spustit();
  try {
    const volat = async (cesta, { metoda = 'GET', telo } = {}) => {
      const r = await fetch(hub.adresa + cesta, { method: metoda, headers: telo ? { 'Content-Type': 'application/json' } : {}, body: telo ? JSON.stringify(telo) : undefined });
      return { status: r.status, data: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text(), hlavicky: r.headers };
    };
    await volat('/api/souboj', { metoda: 'POST', telo: { zapnout: true } });
    await volat('/api/souboj', { metoda: 'POST', telo: { zapnout: false } });
    const r = await volat('/api/zaznam', { metoda: 'POST', telo: { zdroj: 'zvuk-u-stolu', zprava: 'Zkušební chyba' } });
    assert.equal(r.status, 200);
    await dokud(() => hub.zaznam.vypis().some((p) => p.zprava.startsWith('Konec souboje')));
    const vse = (await volat('/api/zaznam')).data.polozky;
    assert.equal(vse[0].zprava, 'Hub se spouští');
    assert.ok(vse.some((p) => p.zdroj === 'souboj' && p.zprava.startsWith('Souboj začal')));
    const problemy = (await volat('/api/zaznam?problemy=1')).data.polozky;
    assert.ok(problemy.every((p) => p.uroven !== 'info'));
    assert.ok(problemy.some((p) => p.zdroj === 'stranka' && p.zprava === 'zvuk-u-stolu: Zkušební chyba'));
    const posledni = vse.at(-1).cislo;
    assert.deepEqual((await volat(`/api/zaznam?od=${posledni}`)).data.polozky.filter((p) => p.cislo <= posledni), []);
    const text = await volat('/api/zaznam/text');
    assert.equal(text.status, 200);
    assert.match(text.hlavicky.get('content-disposition'), /attachment; filename="dm-hub-zaznam-/);
    assert.match(text.data, /Hub se spouští/);
  } finally {
    await hub.zastavit();
    await repo.smazat();
  }
});
