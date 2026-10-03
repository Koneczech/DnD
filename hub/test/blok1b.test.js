// Blok 1b: kalendář (import, události, posun data), Další den, obchody a přepnutí scény po odpočtu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { Hub } from '../server/app.js';
import { Zapisovac } from '../server/zapis.js';
import { DataKampane } from '../server/data.js';
import { Kalendar, rozebratKalendarData } from '../server/kalendar.js';
import { vybratPripominky } from '../server/dalsiden.js';
import { Obchody, overSortiment, slug } from '../server/obchody.js';
import { rozebrat } from '../server/frontmatter.js';
import { docasneRepo, dokud, FalesnyObs } from './pomoc.js';

const HESLO = 'spravne';
const d = (den, mesic, rok = 1491) => ({ rok, mesic, den });

// Zjevně vymyšlená testovací data, ne obsah kampaně.
const KALENDAR_DATA = `// testovací data = vymyšlená
window.KALENDAR = {
  "dnes": { "rok": 1491, "mesic": "Eleint", "den": 19 },
  "zacatek": { "rok": 1491, "mesic": "Eleint", "den": 12 },
  "udalosti": [
    { "id": "t1", "datum": { "rok": 1491, "mesic": "Eleint", "den": 12 }, "text": "Testovací začátek", "verejna": true },
    { "id": "t2", "datum": { "rok": 1491, "mesic": "Eleint", "den": 14 }, "konec": { "rok": 1491, "mesic": "Eleint", "den": 18 }, "text": "Testovací cesta", "verejna": true },
    { "id": "t3", "datum": { "rok": 1491, "mesic": "Eleint", "den": 20 }, "text": "Testovací tajemství", "verejna": false },
    { "id": "t4", "datum": { "rok": 1491, "svatek": "Highharvestide" }, "text": "Testovací svátek", "verejna": true, "odpocet": 20 }
  ]
};
`;

const PRIPOMINKY = `schema: 1
pripominky:
  - { kdy: dukladny, kdo: Všichni, text: test po odpočinku }
  - { kdy: bez, kdo: Všichni, text: test bez odpočinku }
  - { kdy: vzdy, kdo: DM, text: test vždy }
`;

const SORTIMENT = {
  verze: 1,
  obchod: { nazev: 'Testovací Krám', typ: 'kolonial', lokalita: 'urban', mesto: 'Testov', podtitul: null },
  meta: { vygenerovano: '2026-01-01T00:00:00.000Z', seed: 42, generator: 'test' },
  polozky: [
    { nazev: 'Testovací lano', cena_md: 100, mnozstvi: null, jadro: true },
    { nazev: 'Testovací svíčka', cena_md: 1, mnozstvi: 3, jadro: false },
  ],
};

async function pripravitRepo() {
  const repo = await docasneRepo();
  await fs.mkdir(path.join(repo.koren, 'Apps', 'Calendar'), { recursive: true });
  await fs.writeFile(path.join(repo.koren, 'Apps', 'Calendar', 'kalendar-data.js'), KALENDAR_DATA);
  await fs.writeFile(path.join(repo.c.kampan, 'pripominky.yaml'), PRIPOMINKY);
  await fs.mkdir(path.join(repo.c.kampan, 'obchody'), { recursive: true });
  await fs.writeFile(
    path.join(repo.c.kampan, 'obchody', 'polozky.json'),
    JSON.stringify({ polozky: [{ nazev_cs: 'Testovací </script> lano', nazev_en: 'Rope', cena_md: 100, typy: ['kolonial'], lokality: ['urban'], bezne: true, kategorie: 'x', podkategorie: 'nepotřebná' }] }),
  );
  return repo;
}

async function spustitHub({ env = '' } = {}) {
  const repo = await pripravitRepo();
  await fs.writeFile(repo.c.env, `OBS_URL="ws://127.0.0.1:4455"\nOBS_HESLO="${HESLO}"\n${env}`);
  const obs = new FalesnyObs({ heslo: HESLO });
  const hub = new Hub({ cesty: repo.c, obsKlient: obs, gitSit: false, port: 0 });
  return {
    hub,
    obs,
    repo,
    spustit: () => hub.spustit(),
    zastavit: async () => {
      await hub.zastavit();
      await repo.smazat();
    },
  };
}

async function pozadavek(hub, cesta, { metoda = 'GET', telo } = {}) {
  const odpoved = await fetch(hub.adresa + cesta, {
    method: metoda,
    headers: telo !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: telo !== undefined ? JSON.stringify(telo) : undefined,
  });
  const text = await odpoved.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: odpoved.status, data, typ: odpoved.headers.get('content-type') };
}

test('kalendar-data.js: data se přečtou i s komentářem a rovnítkem v něm', () => {
  const data = rozebratKalendarData(KALENDAR_DATA);
  assert.equal(data.udalosti.length, 4);
  assert.throws(() => rozebratKalendarData('// nic'), /neobsahuje data/);
});

test('import: počet i obsah událostí se shodují, datum do stav.md, začátek do kampan.yaml', async () => {
  const repo = await pripravitRepo();
  try {
    const zapisovac = new Zapisovac({ zurnal: path.join(repo.c.lokalniStav, 'odlozene-zapisy') });
    const data = new DataKampane({ cesty: repo.c, zapisovac });
    await data.nacist();
    const k = new Kalendar({ cesty: repo.c, data, zapisovac });
    await k.nacist();
    assert.equal(k.existuje, false);

    const nahled = await k.lzeImportovat();
    assert.equal(nahled.pocet, 4);
    await assert.rejects(k.pridat({ datum: d(1, 'Eleint'), text: 'x' }), /Nejdřív importuj/);

    const r = await k.importovat();
    assert.equal(r.pocetZdroj, 4);
    assert.equal(r.pocetCil, 4);
    assert.equal(r.vadne, 0);
    assert.deepEqual(r.zdroj.map((u) => u.id).sort(), r.cil.map((u) => u.id).sort());

    const yaml = await fs.readFile(path.join(repo.c.kampan, 'kalendar', 'udalosti.yaml'), 'utf8');
    assert.match(yaml, /datum: \{ rok: 1491, mesic: Eleint, den: 14 \}/, 'data na jednom řádku');
    assert.match(yaml, /lhuta: 20/, 'odpocet se převede na lhuta');
    assert.doesNotMatch(yaml, /odpocet/);
    const zpet = YAML.parse(yaml).udalosti;
    assert.equal(zpet.length, 4);
    assert.equal(zpet.find((u) => u.id === 't3').verejna, false);

    const stav = rozebrat(await fs.readFile(repo.c.stav, 'utf8'));
    assert.deepEqual(stav.data.datum, d(19, 'Eleint'));
    assert.match(await fs.readFile(repo.c.stav, 'utf8'), /datum: \{ rok: 1491, mesic: Eleint, den: 19 \} +# komentář, který musí přežít/);
    assert.match(await fs.readFile(repo.c.kampanYaml, 'utf8'), /startovni_datum: \{ rok: 1491, mesic: Eleint, den: 12 \}/);
    assert.deepEqual(data.zacatek(), d(12, 'Eleint'));

    await assert.rejects(k.importovat(), /přepsal/);
    await k.importovat({ prepsat: true });

    // Veřejný pohled pro OBS skryté události vůbec neobsahuje.
    assert.deepEqual(k.verejne().udalosti.map((u) => u.id), ['t1', 't2', 't4']);
    assert.equal(k.stavDm().udalosti.length, 4);
    await zapisovac.dokoncit();
  } finally {
    await repo.smazat();
  }
});

test('události: přidat, upravit (vyprázdnit konec a lhůtu), smazat; neplatná data se odmítnou', async () => {
  const repo = await pripravitRepo();
  try {
    const zapisovac = new Zapisovac({ zurnal: path.join(repo.c.lokalniStav, 'odlozene-zapisy') });
    const data = new DataKampane({ cesty: repo.c, zapisovac });
    await data.nacist();
    const k = new Kalendar({ cesty: repo.c, data, zapisovac });
    await k.nacist();
    await k.importovat();

    const { udalost } = await k.pridat({ datum: d(25, 'Eleint'), konec: d(27, 'Eleint'), text: 'Testovací trh', verejna: true, lhuta: 3 });
    assert.equal(udalost.lhuta, 3);
    const upr = await k.upravit(udalost.id, { konec: null, lhuta: '', verejna: false });
    assert.equal(upr.udalost.konec, undefined);
    assert.equal(upr.udalost.lhuta, undefined);
    assert.equal(upr.udalost.verejna, false);
    assert.equal(upr.udalost.text, 'Testovací trh');

    await assert.rejects(k.pridat({ datum: d(31, 'Eleint'), text: 'x' }), /platné datum/);
    await assert.rejects(k.pridat({ datum: d(5, 'Eleint'), text: '' }), /text/);
    await assert.rejects(k.pridat({ datum: d(5, 'Eleint'), konec: d(4, 'Eleint'), text: 'x' }), /Konec/);
    await assert.rejects(k.pridat({ datum: d(5, 'Eleint'), text: 'x', lhuta: 0 }), /Lhůta/);
    await assert.rejects(k.upravit('neni', { text: 'x' }), /neexistuje/);

    await k.smazat(udalost.id);
    assert.equal(k.udalosti.length, 4);

    const posun = await k.posunout(12);
    assert.deepEqual(posun.dnes, { rok: 1491, svatek: 'Highharvestide' });
    await k.nastavitDnes({ rok: 1491, mesic: 'Marpenoth', den: 1 });
    assert.deepEqual(k.dnes(), d(1, 'Marpenoth'));
    await assert.rejects(k.nastavitDnes({ rok: 1491, svatek: 'Shieldmeet' }), /Neplatné/);
    await zapisovac.dokoncit();
  } finally {
    await repo.smazat();
  }
});

test('připomínky pro obě odpovědi na důkladný odpočinek', () => {
  const p = YAML.parse(PRIPOMINKY).pripominky;
  assert.deepEqual(vybratPripominky(p, true).map((x) => x.text), ['test po odpočinku', 'test vždy']);
  assert.deepEqual(vybratPripominky(p, false).map((x) => x.text), ['test bez odpočinku', 'test vždy']);
});

test('sortiment: ověření jako nacti_sortiment.py a slug bez diakritiky', () => {
  assert.equal(slug('U Kovadliny — Mirabar'), 'u-kovadliny-mirabar');
  assert.equal(slug('Žluťoučký kůň'), 'zlutoucky-kun');
  assert.equal(slug('!!!'), 'obchod');
  assert.equal(overSortiment(SORTIMENT).polozky.length, 2);
  assert.throws(() => overSortiment({ ...SORTIMENT, verze: 2 }), /verze/);
  assert.throws(() => overSortiment({ ...SORTIMENT, obchod: { ...SORTIMENT.obchod, lokalita: 'mesto' } }), /lokalita/);
  assert.throws(() => overSortiment({ ...SORTIMENT, polozky: [SORTIMENT.polozky[0], SORTIMENT.polozky[0]] }), /dvakrát/);
  assert.throws(() => overSortiment({ ...SORTIMENT, polozky: [{ nazev: 'x', cena_md: 1.5 }] }), /cena_md/);
  assert.throws(() => overSortiment({ ...SORTIMENT, polozky: [] }), /prázdné/);
});

test('obchody: uložení, přepis podle id, sloty přežijí restart, smazání uvolní slot', async () => {
  const repo = await pripravitRepo();
  try {
    const zapisovac = new Zapisovac({ zurnal: path.join(repo.c.lokalniStav, 'odlozene-zapisy') });
    const o = new Obchody({ cesty: repo.c, zapisovac });
    await o.nacist();
    const prvni = await o.ulozit({ sortiment: SORTIMENT, slot: 2 });
    assert.equal(prvni.id, 'testovaci-kram-testov');
    const druhy = await o.ulozit({ sortiment: SORTIMENT });
    assert.equal(druhy.id, 'testovaci-kram-testov-2', 'stejné jméno nepřepíše cizí sortiment');
    await o.ulozit({ sortiment: { ...SORTIMENT, polozky: [SORTIMENT.polozky[0]] }, id: prvni.id });
    assert.equal(o.ceniky().sloty['2'].polozky.length, 1);
    assert.equal(o.ceniky().sloty['1'], null);

    const yaml = await fs.readFile(path.join(repo.c.kampan, 'obchody', 'sortimenty', `${prvni.id}.yaml`), 'utf8');
    assert.equal(YAML.parse(yaml).obchod.nazev, 'Testovací Krám');

    const znovu = new Obchody({ cesty: repo.c, zapisovac });
    await znovu.nacist();
    assert.equal(znovu.seznam().sloty['2'], prvni.id);
    assert.equal(znovu.seznam().sortimenty.length, 2);

    await assert.rejects(znovu.nastavitSlot('4', prvni.id), /Slot/);
    await assert.rejects(znovu.nastavitSlot('1', 'neni'), /neexistuje/);
    await znovu.smazat(prvni.id);
    assert.equal(znovu.seznam().sloty['2'], null);
    await zapisovac.dokoncit();
  } finally {
    await repo.smazat();
  }
});

test('API Blok 1b: import, změna data a události dorazí do výstupů do 1 s; Další den projde kroky 1–4', async () => {
  const h = await spustitHub();
  await h.spustit();
  const { hub } = h;
  try {
    const verejne = [];
    const puvodni = hub.vysilac.vyslat.bind(hub.vysilac);
    hub.vysilac.vyslat = (typ, data) => {
      if (typ === 'kalendar') verejne.push({ data, cas: Date.now() });
      return puvodni(typ, data);
    };

    let r = await pozadavek(hub, '/api/kalendar');
    assert.equal(r.data.existuje, false);
    assert.equal(r.data.import.pocet, 4);
    r = await pozadavek(hub, '/api/kalendar/import', { metoda: 'POST', telo: {} });
    assert.equal(r.status, 200);
    assert.equal(r.data.pocetCil, 4);

    r = await pozadavek(hub, '/api/kalendar/verejne');
    assert.deepEqual(r.data.dnes, d(19, 'Eleint'));
    assert.ok(r.data.udalosti.every((u) => u.verejna), 'skryté události do OBS nejdou');

    let zacatek = Date.now();
    await pozadavek(hub, '/api/kalendar/dnes', { metoda: 'PUT', telo: { posun: 1 } });
    await dokud(() => verejne.some((v) => v.cas >= zacatek && v.data.dnes.den === 20), 1000);

    zacatek = Date.now();
    r = await pozadavek(hub, '/api/kalendar/udalosti', { metoda: 'POST', telo: { datum: d(22, 'Eleint'), text: 'Testovací událost', verejna: true } });
    assert.equal(r.status, 200);
    await dokud(() => verejne.some((v) => v.cas >= zacatek && v.data.udalosti.some((u) => u.text === 'Testovací událost')), 1000);

    // Ruční úprava udalosti.yaml (Obsidian) se načte a dorazí do výstupů do 1 s.
    const soubor = path.join(h.repo.c.kampan, 'kalendar', 'udalosti.yaml');
    zacatek = Date.now();
    await fs.writeFile(soubor, (await fs.readFile(soubor, 'utf8')).replace('Testovací událost', 'Ručně upravená'));
    await dokud(() => verejne.some((v) => v.cas >= zacatek && v.data.udalosti.some((u) => u.text === 'Ručně upravená')), 1500);

    r = await pozadavek(hub, '/api/kalendar/dnes', { metoda: 'PUT', telo: { datum: { rok: 1491, mesic: 'Eleint', den: 99 } } });
    assert.equal(r.status, 400);

    // Další den bez sezení: zápis jde do priprava.md
    r = await pozadavek(hub, '/api/den/dalsi', { metoda: 'POST', telo: {} });
    assert.equal(r.status, 400, 'bez odpovědi na důkladný odpočinek nic neudělá');
    await pozadavek(hub, '/api/sezeni/zahajit', { metoda: 'POST', telo: {} });
    r = await pozadavek(hub, '/api/den/nahled');
    assert.deepEqual(r.data.zitra, d(21, 'Eleint'));
    assert.equal(r.data.den.dnesText, '21. Eleint 1491 DR');
    r = await pozadavek(hub, '/api/den/dalsi', { metoda: 'POST', telo: { dukladny: true } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.dnes, d(21, 'Eleint'));
    assert.deepEqual(r.data.pripominky.map((p) => p.text), ['test po odpočinku', 'test vždy']);
    r = await pozadavek(hub, '/api/den/dalsi', { metoda: 'POST', telo: { dukladny: false } });
    assert.deepEqual(r.data.dnes, d(22, 'Eleint'));
    assert.deepEqual(r.data.udalosti.map((u) => u.text), ['Ručně upravená']);
    assert.deepEqual(r.data.pripominky.map((p) => p.text), ['test bez odpočinku', 'test vždy']);
    assert.deepEqual(r.data.lhuty.map((l) => l.zbyva), [9]);
    const sezeni = await fs.readFile(path.join(h.repo.c.kampan, 'sezeni', 's02', 's02.md'), 'utf8');
    assert.match(sezeni, /\(21\. Eleint\) — Nový den: 21\. Eleint 1491 DR \(po důkladném odpočinku\)/);
    assert.match(sezeni, /\(22\. Eleint\) — Nový den: 22\. Eleint 1491 DR \(bez důkladného odpočinku\)/);
  } finally {
    await h.zastavit();
  }
});

test('API obchody: generátor v Hubu, uložení se slotem a ceník pro OBS', async () => {
  const h = await spustitHub();
  await h.spustit();
  const { hub } = h;
  try {
    let r = await pozadavek(hub, '/nastroje/generator.html');
    assert.equal(r.status, 200);
    assert.match(r.typ, /text\/html/);
    assert.match(r.data, /window\.DMHUB = \{ verze: 1 \}/);
    assert.doesNotMatch(r.data, /%%DATA%%/);
    assert.match(r.data, /Testovací <\\\/script> lano/, '</script> v datech se zneškodní');
    assert.doesNotMatch(r.data, /podkategorie/, 'do generátoru jdou jen potřebná pole');

    r = await pozadavek(hub, '/api/obchody/ceniky');
    assert.deepEqual(r.data, { sloty: { 1: null, 2: null, 3: null } });
    r = await pozadavek(hub, '/api/obchody/sortimenty', { metoda: 'POST', telo: { sortiment: SORTIMENT, slot: 1 } });
    assert.equal(r.status, 200);
    const id = r.data.id;
    r = await pozadavek(hub, '/api/obchody/ceniky');
    assert.equal(r.data.sloty['1'].obchod.nazev, 'Testovací Krám');
    r = await pozadavek(hub, '/api/obchody/sloty/3', { metoda: 'PUT', telo: { id } });
    assert.equal(r.data.sloty['3'], id);
    r = await pozadavek(hub, '/api/obchody/sloty/1', { metoda: 'PUT', telo: { id: null } });
    assert.equal(r.data.sloty['1'], null);
    r = await pozadavek(hub, '/api/obchody/sortimenty', { metoda: 'POST', telo: { sortiment: { ...SORTIMENT, polozky: [] } } });
    assert.equal(r.status, 400);
    r = await pozadavek(hub, `/api/obchody/sortimenty/${id}`, { metoda: 'DELETE' });
    assert.equal(r.status, 200);
    r = await pozadavek(hub, '/api/obchody');
    assert.equal(r.data.sortimenty.length, 0);

    // Sdílené moduly pro výstupy
    r = await pozadavek(hub, '/sdilene/harptos.js');
    assert.equal(r.status, 200);
    assert.match(r.typ, /javascript/);
    r = await pozadavek(hub, '/sdilene/..%2Fserver%2Fapp.js');
    assert.equal(r.status, 404);
  } finally {
    await h.zastavit();
  }
});

async function odpocetKonci(h, konecZaMs) {
  await fs.mkdir(h.repo.c.lokalniStav, { recursive: true });
  await fs.writeFile(
    path.join(h.repo.c.lokalniStav, 'odpocet.json'),
    JSON.stringify({ stav: 'bezi', konec: new Date(Date.now() + konecZaMs).toISOString(), zbyvaMs: null, celkemMs: 60000, cilovyCas: null }),
  );
}

test('bod 21: po doběhnutí odpočtu se scéna přepne jednou; po restartu jen do 10 minut od konce', async () => {
  // Doběhne za běhu Hubu
  let h = await spustitHub({ env: 'OBS_SCENA_PO_ODPOCTU="Tábor"\n' });
  await odpocetKonci(h, 400);
  await h.spustit();
  try {
    await dokud(() => h.obs.pripojeno, 2000);
    assert.equal(h.obs.scena, 'Mirabar');
    await dokud(() => h.hub.odpocet.stav.prepnuti, 2000);
    assert.equal(h.obs.scena, 'Tábor');
    assert.equal(h.hub.odpocet.stav.prepnuti.ok, true);
    const volani = h.obs.volani.filter(([p]) => p === 'SetCurrentProgramScene').length;
    h.hub.hlidatOdpocet();
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(h.obs.volani.filter(([p]) => p === 'SetCurrentProgramScene').length, volani, 'jen jednou');
  } finally {
    await h.zastavit();
  }

  // Hub naběhl 5 minut po konci: přepne
  h = await spustitHub({ env: 'OBS_SCENA_PO_ODPOCTU="Tábor"\n' });
  await odpocetKonci(h, -5 * 60 * 1000);
  await h.spustit();
  try {
    await dokud(() => h.hub.odpocet.stav.prepnuti, 3000);
    assert.equal(h.hub.odpocet.stav.prepnuti.ok, true);
    assert.equal(h.obs.scena, 'Tábor');
  } finally {
    await h.zastavit();
  }

  // Hub naběhl 20 minut po konci: nepřepne, jen zaznamená proč
  h = await spustitHub({ env: 'OBS_SCENA_PO_ODPOCTU="Tábor"\n' });
  await odpocetKonci(h, -20 * 60 * 1000);
  await h.spustit();
  try {
    await dokud(() => h.hub.odpocet.stav.prepnuti, 2000);
    assert.equal(h.hub.odpocet.stav.prepnuti.ok, false);
    assert.match(h.hub.odpocet.stav.prepnuti.duvod, /dávno/);
    assert.equal(h.obs.scena, 'Mirabar');
  } finally {
    await h.zastavit();
  }
});
