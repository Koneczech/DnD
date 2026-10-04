// Blok 2: místa, scéna místa v OBS, ilustrační dílna a obrázek obchodu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Hub } from '../server/app.js';
import { jmenoIlustrace, normalizujIlustraci } from '../server/mista.js';
import { viditelne } from '../server/scena.js';
import { sestavPrompt, mezi } from '../server/dilna.js';
import { docasneRepo, dokud, FalesnyObs } from './pomoc.js';

const HESLO = 'spravne';
// Nejmenší platné PNG (1×1), stačí na zápis a kontrolu hlavičky souboru.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

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
  - soubor: celek-noc.png
    ucel: scena
    varianta: noc
    skryta: false
  - soubor: stopa.png
    ucel: scena
    skryta: true
  - soubor: po.png
    ucel: scena
    stav: po-pozaru
    skryta: false
---
Tělo, které Hub nesmí přepsat. [[nikam]]
`;

async function spustitHub({ env = '' } = {}) {
  const repo = await docasneRepo();
  const slozka = path.join(repo.c.kampan, 'mista', 'testov');
  await fs.mkdir(slozka, { recursive: true });
  await fs.writeFile(path.join(slozka, 'testov.md'), MISTO);
  for (const f of ['celek.png', 'celek-noc.png', 'stopa.png', 'po.png']) await fs.writeFile(path.join(slozka, f), PNG);
  await fs.mkdir(path.join(repo.c.kampan, 'obs'), { recursive: true });
  await fs.writeFile(path.join(repo.c.kampan, 'obs', 'obchod.png'), PNG);
  await fs.writeFile(repo.c.env, `OBS_URL="ws://127.0.0.1:4455"\nOBS_HESLO="${HESLO}"\n${env}`);
  const obs = new FalesnyObs({ heslo: HESLO });
  const hub = new Hub({ cesty: repo.c, obsKlient: obs, gitSit: false, port: 0 });
  await hub.spustit();
  return {
    hub,
    obs,
    repo,
    slozka,
    zastavit: async () => {
      await hub.zastavit();
      await repo.smazat();
    },
  };
}

async function pozadavek(hub, cesta, { metoda = 'GET', telo } = {}) {
  const r = await fetch(hub.adresa + cesta, {
    method: metoda,
    headers: telo !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: telo !== undefined ? JSON.stringify(telo) : undefined,
  });
  const typ = r.headers.get('content-type') || '';
  return { status: r.status, typ, data: typ.includes('json') ? await r.json() : await r.arrayBuffer(), etag: r.headers.get('etag') };
}

test('jméno ilustrace podle konvence a normalizace hlavičky', () => {
  assert.equal(jmenoIlustrace({ zaber: 'celek', varianta: 'den' }), 'celek-den.png');
  assert.equal(jmenoIlustrace({ zaber: 'celek', varianta: 'noc', stav: 'po-pozaru' }), 'celek-noc-po-pozaru.png');
  assert.equal(jmenoIlustrace({ zaber: 'detail', stav: 'vychozi' }), 'detail.png');
  assert.equal(jmenoIlustrace({ zaber: 'celek', varianta: 'den' }, ['celek-den.png', 'celek-den-2.png']), 'celek-den-3.png');
  assert.deepEqual(normalizujIlustraci({ soubor: 'a.png', varianta: 'svitani', stav: 'vychozi' }), {
    soubor: 'a.png', ucel: 'scena', varianta: null, stav: null, skryta: false, prompt: null,
  });
  assert.equal(normalizujIlustraci({}), null);
});

test('do OBS jdou jen odkryté scény pro denní dobu a stav', () => {
  const misto = {
    ilustrace: [
      { soubor: 'a', ucel: 'scena', varianta: null, stav: null, skryta: false },
      { soubor: 'b', ucel: 'scena', varianta: 'noc', stav: null, skryta: false },
      { soubor: 'c', ucel: 'scena', varianta: null, stav: null, skryta: true },
      { soubor: 'd', ucel: 'portret', varianta: null, stav: null, skryta: false },
      { soubor: 'e', ucel: 'scena', varianta: null, stav: 'po', skryta: false },
    ],
  };
  assert.deepEqual(viditelne(misto, { varianta: 'den', stav: null }).map((x) => x.soubor), ['a']);
  assert.deepEqual(viditelne(misto, { varianta: 'noc', stav: null }).map((x) => x.soubor), ['a', 'b']);
  assert.deepEqual(viditelne(misto, { varianta: 'den', stav: 'po' }).map((x) => x.soubor), ['a', 'e']);
});

test('prompt dílny: popis místa, varianta, počasí, styl; předloha zachová kompozici', () => {
  const styl = { styl: 'STYLOVA-KOSTRA', technika: 'TECHNIKA' };
  const p = sestavPrompt({ misto: { nazev: 'X', popisObrazu: 'a test clearing' }, zaber: 'detail', varianta: 'noc', pocasi: 'mlha', styl });
  assert.match(p, /^A close-up detail view within a test clearing, at night/);
  assert.match(p, /fog/);
  assert.match(p, /STYLOVA-KOSTRA\n\nTECHNIKA$/);
  assert.match(sestavPrompt({ misto: { nazev: 'X' }, predloha: true, varianta: 'noc', styl }), /^Use the attached image as the exact reference/);
  assert.equal(mezi('a <!-- S-START --> obsah <!-- S-KONEC --> b', 'S'), 'obsah');
});

test('API: scéna místa, skryté ilustrace se do OBS nedostanou, odkrytí se uloží do souboru', async () => {
  const h = await spustitHub({ env: 'OBS_SCENA_MISTO="Tábor"\n' });
  const { hub } = h;
  try {
    let r = await pozadavek(hub, '/api/mista');
    assert.equal(r.data.mista.length, 1);
    assert.equal(r.data.mista[0].ilustrace.length, 4);

    await dokud(() => h.obs.pripojeno, 2000);
    r = await pozadavek(hub, '/api/scena/zobrazit', { metoda: 'POST', telo: { misto: 'testov', prepnout: true } });
    assert.equal(r.status, 200);
    assert.equal(r.data.ilustrace.soubor, 'celek.png');
    assert.equal(r.data.pocet, 1, 've dne a ve výchozím stavu jen celek.png');
    assert.equal(r.data.scenaObs, 'Tábor');
    assert.equal(h.obs.scena, 'Tábor');

    r = await pozadavek(hub, '/api/scena/zobrazit', { metoda: 'POST', telo: { ilustrace: 'stopa.png' } });
    assert.equal(r.status, 409, 'skrytou nejde ukázat');
    assert.doesNotMatch(JSON.stringify((await pozadavek(hub, '/api/scena')).data), /stopa/);

    r = await pozadavek(hub, '/api/scena', { metoda: 'PUT', telo: { varianta: 'noc', pocasi: 'dest', intenzita: 3 } });
    assert.equal(r.data.pocet, 2);
    assert.equal(r.data.pocasi, 'dest');
    r = await pozadavek(hub, '/api/scena/dalsi', { metoda: 'POST', telo: { smer: 1 } });
    assert.equal(r.data.ilustrace.soubor, 'celek-noc.png');
    r = await pozadavek(hub, '/api/scena', { metoda: 'PUT', telo: { pocasi: 'kroupy' } });
    assert.equal(r.status, 400);
    r = await pozadavek(hub, '/api/scena', { metoda: 'PUT', telo: { stav: 'po-pozaru' } });
    assert.deepEqual(r.data.stavy, ['po-pozaru']);
    assert.equal(r.data.pocet, 3);

    // Odkrytí z panelu: zapíše se do souboru místa, komentáře a tělo zůstanou.
    r = await pozadavek(hub, '/api/mista/testov/ilustrace/stopa.png', { metoda: 'PUT', telo: { skryta: false, varianta: 'noc' } });
    assert.equal(r.status, 200);
    const text = await fs.readFile(path.join(h.slozka, 'testov.md'), 'utf8');
    assert.match(text, /- soubor: stopa.png\n {4}ucel: scena\n {4}skryta: false\n {4}varianta: noc/);
    assert.match(text, /# komentář, který musí přežít/);
    assert.match(text, /Tělo, které Hub nesmí přepsat\. \[\[nikam\]\]/);
    r = await pozadavek(hub, '/api/scena');
    assert.equal(r.data.pocet, 4);

    // Obrázek ze složky kampaně se servíruje (s ETag), jiné soubory ne.
    r = await pozadavek(hub, '/kampan/mista/testov/celek.png');
    assert.equal(r.status, 200);
    assert.equal(r.typ, 'image/png');
    const znovu = await fetch(hub.adresa + '/kampan/mista/testov/celek.png', { headers: { 'If-None-Match': r.etag } });
    assert.equal(znovu.status, 304);
    assert.equal((await pozadavek(hub, '/kampan/mista/testov/testov.md')).status, 404);
    assert.equal((await pozadavek(hub, '/kampan/stav.md')).status, 404);
    assert.equal((await pozadavek(hub, '/kampan/..%2F..%2Fhub%2F.env')).status, 404);

    // Ruční úprava v Obsidianu se načte do 1 s.
    await fs.writeFile(path.join(h.slozka, 'testov.md'), text.replace('nazev: Testov', 'nazev: Testov upravený'));
    await dokud(async () => (await pozadavek(hub, '/api/mista')).data.mista[0].nazev === 'Testov upravený', 1500);

    // Stav scény přežije restart (hub/.stav/scena.json). Ukládá se na pozadí, proto počkat na zápis.
    await h.hub.scena.ukladani;
    const ulozeny = JSON.parse(await fs.readFile(path.join(h.repo.c.lokalniStav, 'scena.json'), 'utf8'));
    assert.equal(ulozeny.misto, 'testov');
    assert.equal(ulozeny.intenzita, 3);
  } finally {
    await h.zastavit();
  }
});

test('API dílna: prompt z místa, import uloží skrytou ilustraci s promptem; obrázek obchodu', async () => {
  const h = await spustitHub();
  const { hub } = h;
  try {
    let r = await pozadavek(hub, '/api/mista/testov/popis', { metoda: 'PUT', telo: { popis: 'a quiet test village' } });
    assert.equal(r.status, 200);
    r = await pozadavek(hub, '/api/dilna/prompt?misto=testov&zaber=celek&varianta=den');
    assert.match(r.data.prompt, /^A wide establishing view of a quiet test village, in daylight/);

    r = await pozadavek(hub, '/api/dilna/ilustrace', {
      metoda: 'POST',
      telo: { cil: { typ: 'misto', id: 'testov' }, png: PNG.toString('base64'), zaber: 'celek', varianta: 'den', prompt: 'testovací prompt' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.soubor, 'celek-den.png');
    const text = await fs.readFile(path.join(h.slozka, 'testov.md'), 'utf8');
    assert.match(text, /- soubor: celek-den.png\n {4}ucel: scena\n {4}varianta: den\n {4}skryta: true\n {4}prompt: testovací prompt/);
    assert.deepEqual(await fs.readFile(path.join(h.slozka, 'celek-den.png')), PNG);
    r = await pozadavek(hub, '/api/scena/zobrazit', { metoda: 'POST', telo: { misto: 'testov', ilustrace: 'celek-den.png' } });
    assert.equal(r.status, 409, 'nová ilustrace je skrytá');

    r = await pozadavek(hub, '/api/dilna/ilustrace', {
      metoda: 'POST',
      telo: { cil: { typ: 'misto', id: 'testov' }, png: Buffer.from('není png').toString('base64'), zaber: 'celek' },
    });
    assert.equal(r.status, 400);
    r = await pozadavek(hub, '/api/dilna/ilustrace', { metoda: 'POST', telo: { cil: { typ: 'misto', id: 'neni' }, png: PNG.toString('base64'), zaber: 'celek' } });
    assert.equal(r.status, 404);

    // Zahození smaže řádek i soubor.
    r = await pozadavek(hub, '/api/mista/testov/ilustrace/celek-den.png', { metoda: 'DELETE' });
    assert.equal(r.status, 200);
    await assert.rejects(fs.access(path.join(h.slozka, 'celek-den.png')));

    // Obrázek obchodu: uloží se k sortimentu a ceník ho pošle do OBS.
    const sortiment = {
      verze: 1,
      obchod: { nazev: 'Testovací krám', typ: 'kolonial', lokalita: 'urban', mesto: null, podtitul: null },
      meta: {},
      polozky: [{ nazev: 'Testovací lano', cena_md: 100, mnozstvi: null, jadro: true }],
    };
    r = await pozadavek(hub, '/api/obchody/sortimenty', { metoda: 'POST', telo: { sortiment } });
    const id = r.data.id;
    r = await pozadavek(hub, '/api/obchody/aktivni', { metoda: 'PUT', telo: { id } });
    r = await pozadavek(hub, '/api/obchody/ceniky');
    assert.equal(r.data.obrazek, '/kampan/obs/obchod.png', 'bez vlastního obrázku výchozí pozadí');
    r = await pozadavek(hub, '/api/dilna/ilustrace', { metoda: 'POST', telo: { cil: { typ: 'obchod', id }, png: PNG.toString('base64') } });
    assert.equal(r.status, 200);
    r = await pozadavek(hub, '/api/obchody/ceniky');
    assert.equal(r.data.obrazek, `/kampan/obchody/sortimenty/${id}.png`);
  } finally {
    await h.zastavit();
  }
});

test('výstup místa: obraz má vlastní kontext skládání a tónování nepoužívá CSS filtr', async () => {
  const html = await fs.readFile(new URL('../vystupy/misto.html', import.meta.url), 'utf8');
  // Bez izolace by z-index prolínaných vrstev obrazu přebil počasí, mlhu i ztmavení (Blok 2, oprava).
  assert.match(html, /#obraz\s*\{[^}]*isolation:\s*isolate/);
  assert.doesNotMatch(html, /style\.filter|filtr:/);
});

test('výstup obchodu: ceník leží nad obrázkem (obraz má vlastní kontext skládání)', async () => {
  const html = await fs.readFile(new URL('../vystupy/obchod.html', import.meta.url), 'utf8');
  // Prolínač dává vrstvám z-index 1 a 2; bez izolace obrazu by ceník zůstal pod obrázkem.
  assert.match(html, /#obraz\s*\{[^}]*isolation:\s*isolate/);
  assert.match(html, /iframe\s*\{[^}]*z-index:\s*1/);
});
