// Modul Kánon (Blok 3, rozhodnutí 69–71, body 99–102).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { upravitKartu } from '../sdilene/hlavicka.js';
import { Kanon, teloDruziny, oddily, odkazObsidian, slugNastenky } from '../server/kanon-modul.js';
import { Zapisovac } from '../server/zapis.js';
import { Hub } from '../server/app.js';
import { Nastaveni } from '../server/nastaveni.js';
import { naHtml, radek } from '../sdilene/markdown.js';
import { rozlozit, hledat } from '../sdilene/sit.js';
import { docasneRepo, dokud, FalesnyObs } from './pomoc.js';

const TUSKER = `---
schema: 1
id: tusker
typ: postava
nazev: "Tusker Treestone"
verejne: true
ikona: 🪵
hrac: Martin
aliases: ["Tusker", "Treestone"]
vazby: ["[[dorn]]", "[[koudur]]", "[[tajny]]"] # komentář u vazeb
vztahy:
  - { s: "[[dorn]]", popis: "otec", postoj: 3, verejne: true }
  - { s: "[[koudur]]", popis: "kamarád z dětství" }
  - { s: "[[tajny]]", popis: "neví o něm", verejne: true }
tags: []
ilustrace:
  - { soubor: /Tusker.png, ucel: portret }
zdroj: https://example.invalid/karta
---
# Tusker Treestone

Úvod karty, který družina nezná.

## Příběh

Dlouhý příběh.

## DM — co Tusker neví

Tajemství.

## Co ví družina

Ork s kyjem a šedým stromem na batohu. %%zná%%

- Je adoptovaný.

### Na cestě

Chrání [[koudur|Koudura]].

#### DM poznámka

Jen pro DM uvnitř oddílu družiny. %%zná%%

## Poznámky

Konec.
`;

const DORN = `---
schema: 1
id: dorn
typ: npc
nazev: Dorn Treestone
verejne: true
aliases: [Dorn]
vazby: ["[[tusker]]"]
vztahy: [] # šablona
tags: [aktualni]
---
Otec.
`;

const KOUDUR = `---
schema: 1
id: koudur
typ: postava
nazev: Koudur Hardbeard
verejne: false
vazby: []
---
Bard.
`;

const TAJNY = `---
schema: 1
id: tajny
typ: npc
nazev: Tajný muž
verejne: false
---
Nikdo neví.
`;

const KANON = `---
schema: 1
id: s01-cesta
typ: kanon
nazev: Cesta na jih
verejne: true
vazby: ["[[tusker]]"]
---
## Co se stalo

Šli na jih.

## DM

Skrytá poznámka.
`;

/** Řádky, ve kterých se dva texty liší (porovnání po řádcích, stejný počet řádků se nečeká). */
function zmeneneRadky(a, b) {
  const ra = a.split('\n');
  const rb = b.split('\n');
  const pryc = ra.filter((r, i) => r !== rb[i]);
  return { pryc, pocetA: ra.length, pocetB: rb.length };
}

async function repoSKanonem() {
  const repo = await docasneRepo();
  const k = repo.c.kampan;
  const zapsat = async (rel, text) => {
    await fs.mkdir(path.dirname(path.join(k, rel)), { recursive: true });
    await fs.writeFile(path.join(k, rel), text);
  };
  await zapsat('postavy/tusker/tusker.md', TUSKER);
  await zapsat('postavy/koudur/koudur.md', KOUDUR);
  await zapsat('npc/dorn/dorn.md', DORN);
  await zapsat('npc/tajny/tajny.md', TAJNY);
  await zapsat('kanon/s01-cesta.md', KANON);
  await zapsat('sezeni/priprava.md', '---\nschema: 1\nid: priprava\ntyp: sezeni\nnazev: Poznámky\nverejne: false\n---\n');
  return repo;
}

/* ---------- Přesné úpravy hlavičky ---------- */

test('hlavička: přidání vazby změní jediný řádek, komentář i tělo zůstanou', () => {
  const novy = upravitKartu(TUSKER, { vazby: ['dorn', 'koudur', 'tajny', 'bruna'] });
  const z = zmeneneRadky(TUSKER, novy);
  assert.equal(z.pocetA, z.pocetB);
  assert.deepEqual(z.pryc, ['vazby: ["[[dorn]]", "[[koudur]]", "[[tajny]]"] # komentář u vazeb']);
  assert.match(novy, /^vazby: \["\[\[dorn\]\]", "\[\[koudur\]\]", "\[\[tajny\]\]", "\[\[bruna\]\]"\] # komentář u vazeb$/m);
  assert.ok(novy.endsWith(TUSKER.slice(TUSKER.indexOf('# Tusker Treestone'))));
});

test('hlavička: přepínače verejne a aktualni mění jen svůj řádek', () => {
  const a = upravitKartu(TUSKER, { verejne: false });
  assert.deepEqual(zmeneneRadky(TUSKER, a).pryc, ['verejne: true']);
  const b = upravitKartu(TUSKER, { tags: ['aktualni'] });
  assert.deepEqual(zmeneneRadky(TUSKER, b).pryc, ['tags: []']);
  assert.match(b, /^tags: \[aktualni\]$/m);
  const c = upravitKartu(TUSKER, { aliases: ['Tusker', 'Treestone', 'Zelený obr'] });
  assert.match(c, /^aliases: \["Tusker", "Treestone", "Zelený obr"\]$/m);
  assert.equal(zmeneneRadky(TUSKER, c).pryc.length, 1);
});

test('hlavička: úprava jednoho vztahu nechá ostatní řádky beze změny', () => {
  const vztahy = [
    { s: 'dorn', popis: 'otec', postoj: 3, verejne: true },
    { s: 'koudur', popis: 'kamarád z dětství', postoj: 2, verejne: false },
    { s: 'tajny', popis: 'neví o něm', postoj: null, verejne: true },
  ];
  const novy = upravitKartu(TUSKER, { vztahy });
  const z = zmeneneRadky(TUSKER, novy);
  assert.deepEqual(z.pryc, ['  - { s: "[[koudur]]", popis: "kamarád z dětství" }']);
  assert.match(novy, /^ {2}- \{ s: "\[\[koudur\]\]", popis: "kamarád z dětství", postoj: 2 \}$/m);
});

test('hlavička: první vztah do prázdného „vztahy: []“ je blokový seznam, poslední odebraný vrátí []', () => {
  const s = upravitKartu(DORN, { vztahy: [{ s: 'tusker', popis: 'adoptivní syn', postoj: 3, verejne: false }] });
  assert.match(s, /^vztahy: # šablona\n {2}- \{ s: "\[\[tusker\]\]", popis: "adoptivní syn", postoj: 3 \}\ntags: \[aktualni\]$/m);
  const zpet = upravitKartu(s, { vztahy: [] });
  assert.match(zpet, /^vztahy: \[\] # šablona$/m);
  // Chybějící klíč se vloží na rozumné místo (za vazby).
  const bez = upravitKartu(KOUDUR, { vztahy: [{ s: 'tusker', popis: 'nejlepší kamarád' }], tags: ['aktualni'] });
  assert.match(bez, /vazby: \[\]\nvztahy:\n {2}- \{ s: "\[\[tusker\]\]", popis: "nejlepší kamarád" \}\ntags: \[aktualni\]\n---/);
});

test('hlavička: rozbitý YAML se neupraví', () => {
  assert.throws(() => upravitKartu('---\nid: [\n---\n', { verejne: true }), /YAML/);
  assert.throws(() => upravitKartu('bez hlavičky', { verejne: true }), /hlavičku/);
});

/* ---------- Pohled družiny ---------- */

test('pohled družiny: z oddílu Co ví družina jen odkryté odrážky, nikdy oddíly DM', () => {
  const t = teloDruziny(TUSKER.split('---\n').slice(2).join('---\n'), 'postava');
  assert.match(t, /^## Co ví družina/);
  assert.match(t, /Ork s kyjem a šedým stromem na batohu\.$/m);
  assert.doesNotMatch(t, /%%/);
  // Pododdíl bez odkrytého obsahu se neukáže ani nadpisem.
  assert.doesNotMatch(t, /Na cestě|Chrání|adoptovaný/);
  assert.doesNotMatch(t, /Úvod karty|Dlouhý příběh|Tajemství|Jen pro DM|Konec/);
  // Hráčský kánon je záznam toho, co družina zažila: celý kromě oddílu DM.
  const k = teloDruziny('## Co se stalo\n\nŠli.\n\n## DM\n\nSkryté.\n', 'kanon');
  assert.match(k, /Šli/);
  assert.doesNotMatch(k, /Skryté/);
  assert.equal(teloDruziny('Jen úvod.\n\n## Příběh\n\nText.', 'npc'), '');
  assert.equal(oddily('```\n## není nadpis\n```').length, 1);
});

test('Kánon: pohled družiny neukáže neveřejné entity, vztahy ani přezdívky', async () => {
  const repo = await repoSKanonem();
  try {
    const k = new Kanon({ cesty: repo.c, zapisovac: new Zapisovac() });
    await k.nacist();
    const dm = k.seznam('dm');
    assert.deepEqual(dm.entity.map((e) => e.id).sort(), ['dorn', 'koudur', 's01-cesta', 'tajny', 'tusker']);
    const d = k.seznam('druzina');
    assert.deepEqual(d.entity.map((e) => e.id).sort(), ['dorn', 's01-cesta', 'tusker']);
    const tusker = d.entity.find((e) => e.id === 'tusker');
    // Vztah na koudura není veřejný, vztah na tajného je veřejný, ale tajný není veřejná entita.
    assert.deepEqual(tusker.vztahy.map((v) => v.s), ['dorn']);
    assert.deepEqual(tusker.vazby, ['dorn']);
    assert.deepEqual(tusker.aliases, []);
    assert.deepEqual(tusker.udaje, {});
    assert.equal(tusker.soubor, null);
    for (const e of d.entity) for (const v of e.vztahy) assert.equal(v.verejne, true);
    const karta = k.karta('tusker', 'druzina');
    assert.doesNotMatch(karta.telo, /Tajemství|Dlouhý příběh/);
    assert.equal(karta.obsidian, null);
    assert.throws(() => k.karta('koudur', 'druzina'), /neexistuje/);
    assert.match(k.karta('s01-cesta', 'druzina').telo, /Šli na jih/);
    assert.doesNotMatch(k.karta('s01-cesta', 'druzina').telo, /Skrytá/);
    // Karta v pohledu DM: celý text, odkaz do Obsidianu a kdo na entitu odkazuje.
    const plna = k.karta('tusker', 'dm');
    assert.match(plna.telo, /Tajemství/);
    assert.equal(plna.obsidian, `obsidian://open?vault=${encodeURIComponent(path.basename(repo.koren))}&file=kampan%2Fpostavy%2Ftusker%2Ftusker.md`);
    assert.deepEqual(k.karta('dorn', 'dm').odkazujici.map((o) => o.id), ['tusker']);
    assert.equal(plna.obrazek, '/Tusker.png');
  } finally {
    await repo.smazat();
  }
});

/* ---------- Malé úpravy ---------- */

test('Kánon: úpravy z panelu mění jen své řádky a vztah zapíše i vazbu', async () => {
  const repo = await repoSKanonem();
  try {
    const k = new Kanon({ cesty: repo.c, zapisovac: new Zapisovac() });
    await k.nacist();
    const soubor = path.join(repo.c.kampan, 'postavy', 'koudur', 'koudur.md');
    const puvodni = await fs.readFile(soubor, 'utf8');

    await k.nastavit('koudur', { verejne: true });
    let text = await fs.readFile(soubor, 'utf8');
    assert.deepEqual(zmeneneRadky(puvodni, text).pryc, ['verejne: false']);

    await k.nastavit('koudur', { aktualni: true, aliases: ['Koudur', ' Koudur ', 'Bard'] });
    text = await fs.readFile(soubor, 'utf8');
    assert.match(text, /^tags: \[aktualni\]$/m);
    assert.match(text, /^aliases: \["Koudur", "Bard"\]$/m);
    assert.equal(k.entity.get('koudur').aktualni, true);

    const r = await k.nastavitVztah('koudur', 'tusker', { popis: '  nejlepší   kamarád ', postoj: 3, verejne: true });
    assert.equal(r.vysledek, 'zapsano');
    text = await fs.readFile(soubor, 'utf8');
    assert.match(text, /^vazby: \["\[\[tusker\]\]"\]$/m);
    assert.match(text, /^ {2}- \{ s: "\[\[tusker\]\]", popis: "nejlepší kamarád", postoj: 3, verejne: true \}$/m);
    assert.ok(text.endsWith('---\nBard.\n'));

    // Druhá úprava stejného vztahu změní jen jeho řádek; výchozí verejne se převezme.
    const pred = text;
    await k.nastavitVztah('koudur', 'tusker', { popis: 'nejlepší kamarád', postoj: 2 });
    text = await fs.readFile(soubor, 'utf8');
    assert.deepEqual(zmeneneRadky(pred, text).pryc, ['  - { s: "[[tusker]]", popis: "nejlepší kamarád", postoj: 3, verejne: true }']);

    await k.odebratVztah('koudur', 'tusker');
    text = await fs.readFile(soubor, 'utf8');
    assert.doesNotMatch(text, /nejlepší/);
    assert.match(text, /\[\[tusker\]\]/);

    await k.nastavitVztah('koudur', 'dorn', { popis: 'soused' });
    await k.odebratVazbu('koudur', 'dorn');
    text = await fs.readFile(soubor, 'utf8');
    assert.doesNotMatch(text, /dorn|soused/);

    await k.pridatVazbu('tusker', 'koudur'); // už ji má: nic se nezmění
    await assert.rejects(k.nastavitVztah('koudur', 'koudur', { popis: 'já' }), /sama na sebe/);
    await assert.rejects(k.nastavitVztah('koudur', 'nikdo', { popis: 'x' }), /neexistuje/);
    await assert.rejects(k.nastavitVztah('koudur', 'tusker', { popis: '' }), /popis/);
    await assert.rejects(k.nastavitVztah('koudur', 'tusker', { popis: 'x', postoj: 5 }), /−3/);
    await assert.rejects(k.nastavit('koudur', { verejne: 'ano' }), /true nebo false/);
    await assert.rejects(k.nastavit('nikdo', { verejne: true }), /neexistuje/);
  } finally {
    await repo.smazat();
  }
});

test('Kánon: nástěnky se uloží, načtou a smažou; nová nepřepíše existující', async () => {
  const repo = await repoSKanonem();
  try {
    const k = new Kanon({ cesty: repo.c, zapisovac: new Zapisovac() });
    await k.nacist();
    const { nastenka } = await k.ulozitNastenku(null, { nazev: 'Mirabarská politika', pohled: 'dm', jen_tyto: true, entity: [{ id: 'tusker', x: 10.4, y: -5 }, { id: 'neexistuje', x: 0, y: 0 }, { id: 'dorn', x: 'x', y: 1 }] });
    assert.equal(nastenka.id, 'mirabarska-politika');
    assert.deepEqual(nastenka.entity, [{ id: 'tusker', x: 10, y: -5 }]);
    const text = await fs.readFile(path.join(repo.c.kampan, 'nastenky', 'mirabarska-politika.yaml'), 'utf8');
    assert.match(text, /^nazev: Mirabarská politika$/m);
    assert.match(text, /^ {2}- \{ id: tusker, x: 10, y: -5 \}$/m);
    const druha = await k.ulozitNastenku(null, { nazev: 'Mirabarská politika', entity: [{ id: 'dorn', x: 1, y: 2 }] });
    assert.equal(druha.nastenka.id, 'mirabarska-politika-2');
    const k2 = new Kanon({ cesty: repo.c, zapisovac: new Zapisovac() });
    await k2.nacist();
    assert.deepEqual(k2.nastenka('mirabarska-politika'), { id: 'mirabarska-politika', nazev: 'Mirabarská politika', pohled: 'dm', jen_tyto: true, entity: [{ id: 'tusker', x: 10, y: -5 }] });
    await k2.smazatNastenku('mirabarska-politika');
    await assert.rejects(fs.access(path.join(repo.c.kampan, 'nastenky', 'mirabarska-politika.yaml')));
    await assert.rejects(k2.ulozitNastenku(null, { nazev: '', entity: [] }), /název/);
    await assert.rejects(k2.ulozitNastenku(null, { nazev: 'Prázdná', entity: [] }), /žádná entita/);
    assert.equal(slugNastenky('Žluťoučký kůň'), 'zlutoucky-kun');
  } finally {
    await repo.smazat();
  }
});

test('Kánon: změna karty z Obsidianu se načte znovu', async () => {
  const repo = await repoSKanonem();
  try {
    const k = new Kanon({ cesty: repo.c, zapisovac: new Zapisovac() });
    await k.nacist();
    let zmen = 0;
    k.on('zmena', () => zmen++);
    const soubor = path.join(repo.c.kampan, 'npc', 'dorn', 'dorn.md');
    await fs.writeFile(soubor, DORN.replace('nazev: Dorn Treestone', 'nazev: Dorn Starší'));
    assert.equal(k.souborZmenen(soubor), true);
    assert.equal(k.souborZmenen(path.join(repo.c.kampan, 'stav.md')), false);
    await dokud(() => k.entity.get('dorn')?.nazev === 'Dorn Starší');
    assert.ok(zmen >= 1);
  } finally {
    await repo.smazat();
  }
});

/* ---------- API přes Hub ---------- */

test('API Kánonu: seznam, karta, úprava vztahu a živá událost', async () => {
  const repo = await repoSKanonem();
  const hub = new Hub({ cesty: repo.c, obsKlient: new FalesnyObs(), gitSit: false, port: 0 });
  await hub.spustit();
  const poslat = async (cesta, metoda = 'GET', telo) => {
    const o = await fetch(hub.adresa + cesta, { method: metoda, headers: telo ? { 'Content-Type': 'application/json' } : {}, body: telo ? JSON.stringify(telo) : undefined });
    return { status: o.status, data: await o.json() };
  };
  try {
    const seznam = await poslat('/api/kanon');
    assert.equal(seznam.status, 200);
    assert.equal(seznam.data.entity.length, 5);
    const druzina = await poslat('/api/kanon?pohled=druzina');
    assert.equal(druzina.data.entity.length, 3);
    const karta = await poslat('/api/kanon/entita/tusker?pohled=druzina');
    assert.doesNotMatch(karta.data.telo, /Tajemství/);
    const zmen = [];
    hub.kanon.on('zmena', (z) => zmen.push(z));
    const r = await poslat('/api/kanon/entita/dorn/vztahy/tusker', 'PUT', { popis: 'adoptivní syn', postoj: 3, verejne: true });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.karta.vztahy, [{ s: 'tusker', popis: 'adoptivní syn', postoj: 3, verejne: true }]);
    assert.ok(zmen.length >= 1);
    const spatne = await poslat('/api/kanon/entita/dorn/vztahy/tusker', 'PUT', { popis: 'x', postoj: 9 });
    assert.equal(spatne.status, 400);
    const vazba = await poslat('/api/kanon/entita/koudur/vazby', 'POST', { cil: 'dorn' });
    assert.deepEqual(vazba.data.karta.vazby, ['dorn']);
    const pryc = await poslat('/api/kanon/entita/koudur/vazby/dorn', 'DELETE');
    assert.deepEqual(pryc.data.karta.vazby, []);
    const prepinac = await poslat('/api/kanon/entita/koudur', 'PUT', { verejne: true });
    assert.equal(prepinac.data.karta.verejne, true);
    const n = await poslat('/api/kanon/nastenky', 'POST', { nazev: 'Rodina', entity: [{ id: 'tusker', x: 0, y: 0 }] });
    assert.equal(n.data.nastenka.id, 'rodina');
    assert.equal((await poslat('/api/kanon/nastenky/rodina')).data.entity.length, 1);
    assert.equal((await poslat('/api/kanon/nastenky/rodina', 'DELETE')).status, 200);
    assert.equal((await poslat('/api/kanon/entita/nikdo')).status, 404);
    // Kontrola dat po úpravě: vztah má vazbu, nic se nehlásí.
    await dokud(async () => !(await poslat('/api/kontrola')).data.problemy.some((p) => p.soubor.includes('dorn.md')));
  } finally {
    await hub.zastavit();
    await repo.smazat();
  }
});

test('Nastavení: jméno trezoru Obsidianu (bod 101)', async () => {
  const repo = await docasneRepo();
  try {
    const n = new Nastaveni(repo.c.env);
    await n.nacist();
    assert.equal(n.verejne().obsidianTrezor, '');
    await n.ulozit({ obsidianTrezor: '  DnD repo ' });
    assert.equal(n.verejne().obsidianTrezor, 'DnD repo');
    await assert.rejects(n.ulozit({ obsidianTrezor: 'a\nb' }), /neplatné/);
    const k = new Kanon({ cesty: repo.c, zapisovac: new Zapisovac(), nastaveni: () => n.hodnoty });
    assert.equal(k.trezor(), 'DnD repo');
    assert.equal(odkazObsidian('DnD repo', 'kampan/npc/a/a.md'), 'obsidian://open?vault=DnD%20repo&file=kampan%2Fnpc%2Fa%2Fa.md');
  } finally {
    await repo.smazat();
  }
});

/* ---------- Markdown karty a síť ---------- */

test('markdown karty: escapuje HTML, odkazy [[id]], oddíly DM, úkoly a tabulky', () => {
  const html = naHtml('# Tusker\n\nText <script>alert(1)</script> s **tučným** a *kurzívou*.\n\n## DM — tajné\n\n- [x] hotovo\n- [[dorn|Dorn]] a [[nikdo]]\n\n## Co ví družina\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n> citace', {
    existuje: (id) => id === 'dorn',
    vynechatNadpis: 'Tusker',
    oznacitDm: true,
  });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<h3>Tusker<\/h3>/);
  assert.match(html, /<strong>tučným<\/strong>/);
  assert.match(html, /<em>kurzívou<\/em>/);
  assert.match(html, /<section class="oddil-dm">[\s\S]*DM — tajné[\s\S]*<\/section>\n<h4>Co ví družina<\/h4>/);
  assert.match(html, /<a href="#kanon\/dorn" class="odkaz-entity" data-id="dorn">Dorn<\/a>/);
  assert.match(html, /<span class="odkaz-chybi"[^>]*>nikdo<\/span>/);
  assert.match(html, /<input type="checkbox" disabled checked>/);
  assert.match(html, /<table>.*<td>1<\/td>/s);
  assert.match(html, /<blockquote>/);
  assert.equal(radek('[odkaz](javascript:alert(1))'), '[odkaz](javascript:alert(1))');
  assert.match(radek('[web](https://example.invalid/a)'), /href="https:\/\/example.invalid\/a"/);
});

test('síť: rozložení je stejné pro stejná data, pevné uzly se nehnou, 200 uzlů do 1 s', () => {
  const uzly = Array.from({ length: 200 }, (_, i) => ({ id: `e${i}`, typ: ['npc', 'misto', 'postava', 'rozhodnuti'][i % 4] }));
  const hrany = uzly.slice(1).map((u, i) => [u.id, uzly[Math.floor(i / 3)].id]);
  const zacatek = performance.now();
  const a = rozlozit(uzly, hrany);
  assert.ok(performance.now() - zacatek < 1000);
  const b = rozlozit(uzly, hrany);
  assert.deepEqual([...a], [...b]);
  for (const p of a.values()) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  const pevne = new Map([['e0', { x: 500, y: 500 }]]);
  const c = rozlozit(uzly, hrany, { pevne, start: a });
  assert.deepEqual(c.get('e0'), { x: 500, y: 500 });
});

test('hledání: bez diakritiky, podle přezdívek, začátky slov napřed', () => {
  const entity = [
    { id: 'krkavci-prapor', nazev: 'Krkavčí prapor', aliases: ['Ravenmark Company'], stupen: 5 },
    { id: 'halvar-grimsdal', nazev: 'Halvar Grimsdal', aliases: ['Grimsdal'], stupen: 9 },
    { id: 'osric', nazev: 'Osric Redgrave', aliases: [], stupen: 1 },
  ];
  assert.deepEqual(hledat(entity, 'krkavci').map((e) => e.id), ['krkavci-prapor']);
  assert.deepEqual(hledat(entity, 'raven').map((e) => e.id), ['krkavci-prapor']);
  assert.deepEqual(hledat(entity, 'grim').map((e) => e.id), ['halvar-grimsdal']);
  assert.deepEqual(hledat(entity, 'r').map((e) => e.id), ['krkavci-prapor', 'osric', 'halvar-grimsdal']);
  assert.deepEqual(hledat(entity, '  '), []);
});
