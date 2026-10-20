// Kánon jako wiki (rozhodnutí DM 20. 10. 2026): Co ví družina po odrážkách, plný editor,
// zakládání karet, portrét, události kalendáře s vazbami na karty.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { blokyDruziny, prepnoutBlok, pridatBlok, teloDruziny, teloBezDruziny, kratkyPopis, Kanon, hashTela } from '../server/kanon-modul.js';
import { upravitKartu, nahraditTelo, teloKarty } from '../server/hlavicka.js';
import { Zapisovac } from '../server/zapis.js';
import { Kalendar, slozitUdalosti } from '../server/kalendar.js';
import { kontrolaDat } from '../server/data.js';
import { normalizujUdalost } from '../sdilene/harptos.js';
import { naHtml } from '../sdilene/markdown.js';
import { Hub } from '../server/app.js';
import { docasneRepo, dokud, FalesnyObs } from './pomoc.js';

const TELO = `# Dorn

> Trpaslík, **otec**.

## Co ví družina

- Trpaslík, [[tusker|Tuskerův]] otec. %%zná%%
- Dluží Bruně.
  - pokračování odrážky

Odstavec, který
družina zatím nezná.

### Na cestě

- Pomohl jim %%zná%%

#### DM poznámka

- tajné %%zná%%

## Příběh

Text.
`;

test('Co ví družina: bloky po odrážkách a odstavcích, odkrytí značkou %%zná%%', () => {
  const b = blokyDruziny(TELO);
  assert.deepEqual(b.map((x) => [x.index, x.druh, x.zna, x.dm]), [
    [0, 'odrazka', true, false],
    [1, 'odrazka', false, false],
    [2, 'odstavec', false, false],
    [-1, 'nadpis', false, false],
    [3, 'odrazka', true, false],
    [-1, 'nadpis', false, true],
    [-1, 'odrazka', false, true],
  ]);
  assert.equal(b[0].text, 'Trpaslík, [[tusker|Tuskerův]] otec.');
  assert.equal(b[1].text, 'Dluží Bruně.\n  - pokračování odrážky');
  assert.deepEqual(blokyDruziny('# Bez oddílu\n\nText.'), []);
});

test('Co ví družina: odkrytí a skrytí změní jen první řádek bloku, nová odrážka jde před pododdíly', () => {
  const odkryto = prepnoutBlok(TELO, 1, true);
  assert.match(odkryto, /^- Dluží Bruně\. %%zná%%\n {2}- pokračování odrážky$/m);
  assert.equal(odkryto.split('\n').filter((r, i) => r !== TELO.split('\n')[i]).length, 1);
  const skryto = prepnoutBlok(TELO, 0, false);
  assert.match(skryto, /^- Trpaslík, \[\[tusker\|Tuskerův\]\] otec\.$/m);
  assert.throws(() => prepnoutBlok(TELO, 9, true), /neexistuje/);
  const pridano = pridatBlok(TELO, '  Nový   fakt ', true);
  assert.match(pridano, /družina zatím nezná\.\n\n- Nový fakt %%zná%%\n\n### Na cestě/);
  assert.match(pridatBlok('# X\n\nText.\n', 'A', false), /Text\.\n\n## Co ví družina\n\n- A\n$/);
  assert.throws(() => pridatBlok(TELO, '   ', true), /Napiš/);
});

test('Co ví družina: družina vidí jen odkryté bloky a nadpisy nad nimi, DM tělo bez oddílu', () => {
  const t = teloDruziny(TELO, 'npc');
  assert.equal(t, '## Co ví družina\n\n- Trpaslík, [[tusker|Tuskerův]] otec.\n\n### Na cestě\n- Pomohl jim');
  assert.doesNotMatch(teloBezDruziny(TELO), /Co ví družina|Dluží/);
  assert.match(teloBezDruziny(TELO), /## Příběh/);
  assert.equal(kratkyPopis(TELO), 'Trpaslík, otec.');
  assert.equal(kratkyPopis('# A\n\n[[x|Bé]] a [odkaz](https://example.invalid) **tučně** %%skryté%%'), 'Bé a odkaz tučně');
  assert.doesNotMatch(naHtml('Text %%zná%% dál'), /%%/);
});

test('hlavička: textová pole, portrét do ilustrace a nové tělo mění jen své řádky', () => {
  const karta = '---\nschema: 1\nid: x\ntyp: postava\nnazev: "Stará" # komentář\nverejne: false\nhrac: Martin\nilustrace: [] # obrázky\n---\n# Tělo\n';
  const a = upravitKartu(karta, { nazev: 'Nová "jména"', hrac: 'Anna Nová', druh: 'ork', ilustrace: { soubor: 'portret.png', ucel: 'portret' } });
  assert.match(a, /^nazev: "Nová \\"jména\\"" # komentář$/m);
  assert.match(a, /^hrac: Anna Nová$/m);
  assert.match(a, /^druh: ork$/m);
  assert.match(a, /^ilustrace: # obrázky\n {2}- \{ soubor: portret\.png, ucel: portret \}\n---/m);
  assert.equal(upravitKartu(karta, { hrac: 'true' }).match(/^hrac: .*$/m)[0], 'hrac: "true"');
  const b = nahraditTelo(a, 'Nové\r\ntělo');
  assert.ok(b.startsWith(a.slice(0, a.indexOf('# Tělo'))));
  assert.equal(teloKarty(b), 'Nové\ntělo');
});

async function repo() {
  const r = await docasneRepo();
  const k = r.c.kampan;
  const zapsat = async (rel, text) => {
    await fs.mkdir(path.dirname(path.join(r.koren, rel)), { recursive: true });
    await fs.writeFile(path.join(r.koren, rel), text);
  };
  await zapsat('kampan/npc/dorn/dorn.md', `---\nschema: 1\nid: dorn\ntyp: npc\nnazev: Dorn\nverejne: true\nvazby: []\n---\n${TELO}`);
  await zapsat('kampan/postavy/tusker/tusker.md', '---\nschema: 1\nid: tusker\ntyp: postava\nnazev: Tusker\nverejne: false\nhrac: Martin\n---\nTělo.\n');
  await zapsat('kampan/kanon/s01-odchod.md', '---\nschema: 1\nid: s01-odchod\ntyp: kanon\nnazev: Odchod\nverejne: true\n---\n## Co se stalo\n\nOdešli.\n');
  await zapsat('sablony/npc.md', '---\nschema: 1\nid: # slug\ntyp: npc\nnazev: "{{title}}" # jméno\nverejne: false # karta obsahuje DM\naliases: []\nvazby: []\ntags: []\nilustrace: []\nzaznamenano: "{{date:YYYY-MM-DD}}"\n---\n# {{title}}\n\n## Co ví družina\n');
  await zapsat('kampan/kalendar/udalosti.yaml', `schema: 1\nudalosti:\n  - id: u1\n    datum: { rok: 1491, mesic: Eleint, den: 12 }\n    text: Opuštění Mirabaru\n    verejna: true\n    vazby: ["[[dorn]]", "[[tusker]]", "[[s01-odchod]]"]\n  - id: u2\n    datum: { rok: 1491, mesic: Eleint, den: 13 }\n    text: Tajná schůzka\n    verejna: false\n    vazby: ["[[dorn]]"]\n`);
  void k;
  return r;
}

function kanonSKalendarem(r) {
  const zapisovac = new Zapisovac();
  const data = { stav: { datum: null }, zacatek: () => null };
  const kalendar = new Kalendar({ cesty: r.c, data, zapisovac });
  const kanon = new Kanon({ cesty: r.c, zapisovac, kalendar });
  return { kanon, kalendar };
}

test('editor: uložení textu s kontrolou souběžné úpravy v Obsidianu', async () => {
  const r = await repo();
  try {
    const { kanon } = kanonSKalendarem(r);
    await kanon.nacist();
    const soubor = path.join(r.c.kampan, 'npc', 'dorn', 'dorn.md');
    const z = await kanon.zdroj('dorn');
    assert.equal(z.telo, TELO);
    assert.equal(z.hash, hashTela(TELO));
    const v = await kanon.ulozitZdroj('dorn', { telo: `${TELO}\nDoplněno.\n`, zaklad: z.hash, pole: { nazev: 'Dorn Treestone', ikona: '🪵' } });
    assert.equal(v.vysledek, 'zapsano');
    const text = await fs.readFile(soubor, 'utf8');
    assert.match(text, /^nazev: "Dorn Treestone"$/m);
    assert.match(text, /^ikona: 🪵$/m);
    assert.ok(text.endsWith('Doplněno.\n'));
    // Obsidian mezitím uloží: editor se starým základem nic nepřepíše.
    await fs.writeFile(soubor, text.replace('Doplněno.', 'Z Obsidianu.'));
    await assert.rejects(kanon.ulozitZdroj('dorn', { telo: 'Přepis.', zaklad: v.hash }), (e) => e.status === 409 && e.kod === 'konflikt');
    assert.match(await fs.readFile(soubor, 'utf8'), /Z Obsidianu\./);
    await kanon.ulozitZdroj('dorn', { telo: 'Přepis.\n', zaklad: v.hash, prepsat: true });
    assert.ok((await fs.readFile(soubor, 'utf8')).endsWith('---\nPřepis.\n'));
    await assert.rejects(kanon.ulozitZdroj('dorn', { pole: { nazev: '' } }), /název/);
    await assert.rejects(kanon.nastavit('tusker', { stav: 'cokoli', ikona: '🪵🪵🪵🪵🪵' }), /emoji/);
  } finally {
    await r.smazat();
  }
});

test('Co ví družina přes Kánon: odkrytí, přidání a karta pro DM i družinu', async () => {
  const r = await repo();
  try {
    const { kanon } = kanonSKalendarem(r);
    await kanon.nacist();
    let k = kanon.karta('dorn', 'druzina');
    assert.deepEqual(k.druzina.map((b) => b.text), ['Trpaslík, [[tusker|Tuskerův]] otec.', 'Na cestě', 'Pomohl jim']);
    assert.equal(k.telo, '');
    await kanon.prepnoutDruzinu('dorn', 1, true);
    await kanon.pridatDruzinu('dorn', 'Nosí šedý plášť.', false);
    k = kanon.karta('dorn', 'druzina');
    assert.ok(k.druzina.some((b) => b.text.startsWith('Dluží Bruně')));
    assert.ok(!k.druzina.some((b) => b.text.includes('šedý plášť')));
    const dm = kanon.karta('dorn', 'dm');
    assert.equal(dm.druzina.filter((b) => b.index >= 0).length, 5);
    assert.doesNotMatch(dm.telo, /Co ví družina/);
    assert.equal(dm.maOddilDruziny, true);
    await assert.rejects(kanon.prepnoutDruzinu('dorn', 99, true), /neexistuje/);
    // Hráčský kánon vidí družina celý.
    assert.match(kanon.karta('s01-odchod', 'druzina').telo, /Odešli/);
  } finally {
    await r.smazat();
  }
});

test('nová karta ze šablony a portrét do složky karty', async () => {
  const r = await repo();
  try {
    const { kanon } = kanonSKalendarem(r);
    await kanon.nacist();
    const { karta } = await kanon.zalozit({ typ: 'npc', nazev: 'Halvar Grimsdal' });
    assert.equal(karta.id, 'halvar-grimsdal');
    const text = await fs.readFile(path.join(r.c.kampan, 'npc', 'halvar-grimsdal', 'halvar-grimsdal.md'), 'utf8');
    assert.match(text, /^id: halvar-grimsdal$/m);
    assert.match(text, /^nazev: "Halvar Grimsdal" # jméno$/m);
    assert.match(text, /^# Halvar Grimsdal$/m);
    assert.match(text, /^zaznamenano: "\d{4}-\d{2}-\d{2}"$/m);
    await assert.rejects(kanon.zalozit({ typ: 'npc', nazev: 'Halvar Grimsdal' }), /existuje/);
    await assert.rejects(kanon.zalozit({ typ: 'sezeni', nazev: 'X' }), /nejde/);
    await assert.rejects(kanon.zalozit({ typ: 'npc', nazev: '' }), /název/);
    const zaznam = await kanon.zalozit({ typ: 'kanon', nazev: 'Družina utekla' });
    assert.equal(zaznam.karta.soubor, 'kampan/kanon/druzina-utekla.md');

    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
    const p = await kanon.ulozitPortret('halvar-grimsdal', { data: png.toString('base64') });
    assert.equal(p.soubor, 'portret.png');
    assert.equal(p.karta.obrazek, '/kampan/npc/halvar-grimsdal/portret.png');
    await fs.access(path.join(r.c.kampan, 'npc', 'halvar-grimsdal', 'portret.png'));
    // Druhé nahrání soubor vymění, záznam v ilustracích se nezdvojí.
    await kanon.ulozitPortret('halvar-grimsdal', { data: png.toString('base64') });
    const po = await fs.readFile(path.join(r.c.kampan, 'npc', 'halvar-grimsdal', 'halvar-grimsdal.md'), 'utf8');
    assert.equal(po.match(/portret\.png/g).length, 1);
    await assert.rejects(kanon.ulozitPortret('halvar-grimsdal', { data: Buffer.from('GIF89a-není-obrázek').toString('base64') }), /PNG, JPEG nebo WebP/);
    await assert.rejects(kanon.ulozitPortret('druzina-utekla', { data: png.toString('base64') }), /složku/);
  } finally {
    await r.smazat();
  }
});

test('události: vazby na karty v kalendáři, v kartě a v pohledu družiny', async () => {
  assert.deepEqual(normalizujUdalost({ id: 'a', datum: { rok: 1491, mesic: 'Eleint', den: 1 }, text: 'X', vazby: ['[[dorn]]', 'dorn', 'Špatně!', '[[s01|popisek]]'] }).vazby, ['dorn', 's01']);
  assert.equal(normalizujUdalost({ id: 'a', datum: { rok: 1491, mesic: 'Eleint', den: 1 }, text: 'X', vazby: [] }).vazby, undefined);
  assert.match(slozitUdalosti([{ id: 'a', datum: { rok: 1491, mesic: 'Eleint', den: 1 }, text: 'X', verejna: true, vazby: ['dorn'] }]), /vazby: \[ "\[\[dorn\]\]" \]/);
  const r = await repo();
  try {
    const { kanon, kalendar } = kanonSKalendarem(r);
    await kalendar.nacist();
    await kanon.nacist();
    assert.deepEqual(kanon.karta('dorn', 'dm').udalosti.map((u) => u.text), ['Opuštění Mirabaru', 'Tajná schůzka']);
    const druzina = kanon.karta('dorn', 'druzina');
    assert.deepEqual(druzina.udalosti.map((u) => u.text), ['Opuštění Mirabaru']);
    // Neveřejný Tusker se v pohledu družiny u události neukáže.
    assert.deepEqual(druzina.udalosti[0].vazby, ['dorn', 's01-odchod']);
    assert.equal(kanon.seznam('druzina').udalosti.length, 1);
    assert.equal(kanon.seznam('dm').udalosti[0].datumText, '12. Eleint 1491 DR');
    // Výstupy pro OBS vazby nedostanou.
    assert.equal(kalendar.verejne().udalosti[0].vazby, undefined);

    await kanon.vazbaUdalosti('u2', 's01-odchod', true);
    let yaml = YAML.parse(await fs.readFile(path.join(r.c.kampan, 'kalendar', 'udalosti.yaml'), 'utf8'));
    assert.deepEqual(yaml.udalosti[1].vazby, ['[[dorn]]', '[[s01-odchod]]']);
    await kanon.vazbaUdalosti('u1', 'tusker', false);
    yaml = YAML.parse(await fs.readFile(path.join(r.c.kampan, 'kalendar', 'udalosti.yaml'), 'utf8'));
    assert.deepEqual(yaml.udalosti[0].vazby, ['[[dorn]]', '[[s01-odchod]]']);
    // Úprava události v Kalendáři vazby nesmaže.
    await kalendar.upravit('u1', { text: 'Odchod z Mirabaru' });
    yaml = YAML.parse(await fs.readFile(path.join(r.c.kampan, 'kalendar', 'udalosti.yaml'), 'utf8'));
    assert.deepEqual(yaml.udalosti[0].vazby, ['[[dorn]]', '[[s01-odchod]]']);
    await assert.rejects(kanon.vazbaUdalosti('u1', 'nikdo', true), /neexistuje/);
    await assert.rejects(kanon.vazbaUdalosti('neni', 'dorn', true), /Událost neexistuje/);

    // Kontrola dat: vazba události na neexistující kartu je varování.
    await fs.writeFile(path.join(r.c.kampan, 'kalendar', 'udalosti.yaml'), 'schema: 1\nudalosti:\n  - { id: x, datum: { rok: 1491, mesic: Eleint, den: 1 }, text: Y, vazby: ["[[nikdo]]"] }\n');
    const kontrola = await kontrolaDat(r.c);
    assert.ok(kontrola.problemy.some((p) => p.uroven === 'varovani' && /nikdo/.test(p.zprava) && p.soubor.endsWith('udalosti.yaml')));
  } finally {
    await r.smazat();
  }
});

test('API wiki: založení, editor, odrážky a navázání události', async () => {
  const r = await repo();
  const hub = new Hub({ cesty: r.c, obsKlient: new FalesnyObs(), gitSit: false, port: 0 });
  await hub.spustit();
  const poslat = async (cesta, metoda = 'GET', telo) => {
    const o = await fetch(hub.adresa + cesta, { method: metoda, headers: telo ? { 'Content-Type': 'application/json' } : {}, body: telo ? JSON.stringify(telo) : undefined });
    return { status: o.status, data: await o.json() };
  };
  try {
    const nova = await poslat('/api/kanon/entity', 'POST', { typ: 'npc', nazev: 'Ilma Dunwarová' });
    assert.equal(nova.status, 200);
    assert.equal(nova.data.karta.id, 'ilma-dunwarova');
    const z = await poslat('/api/kanon/entita/ilma-dunwarova/zdroj');
    const ulozeno = await poslat('/api/kanon/entita/ilma-dunwarova/zdroj', 'PUT', { telo: `${z.data.telo}- Hostinská U Zlomeného sedla.\n`, zaklad: z.data.hash });
    assert.equal(ulozeno.status, 200);
    const konflikt = await poslat('/api/kanon/entita/ilma-dunwarova/zdroj', 'PUT', { telo: 'x', zaklad: z.data.hash });
    assert.equal(konflikt.status, 409);
    assert.equal(konflikt.data.kod, 'konflikt');
    const odkryto = await poslat('/api/kanon/entita/ilma-dunwarova/druzina/0', 'PUT', { zna: true });
    assert.equal(odkryto.data.karta.druzina[0].zna, true);
    const pridano = await poslat('/api/kanon/entita/ilma-dunwarova/druzina', 'POST', { text: 'Má ráda zpěv.' });
    assert.equal(pridano.data.karta.druzina.at(-1).zna, true);
    const seznam = await poslat('/api/kanon');
    assert.ok(seznam.data.typyNove.includes('npc'));
    assert.equal(seznam.data.udalosti.length, 2);
    const vazba = await poslat('/api/kanon/udalosti/u2/vazby', 'POST', { cil: 'ilma-dunwarova' });
    assert.deepEqual(vazba.data.udalost.vazby, ['dorn', 'ilma-dunwarova']);
    const karta = await poslat('/api/kanon/entita/ilma-dunwarova');
    assert.deepEqual(karta.data.udalosti.map((u) => u.id), ['u2']);
    const pryc = await poslat('/api/kanon/udalosti/u2/vazby/ilma-dunwarova', 'DELETE');
    assert.deepEqual(pryc.data.udalost.vazby, ['dorn']);
    assert.equal((await poslat('/api/kanon/entity', 'POST', { typ: 'npc', nazev: 'Ilma Dunwarová' })).status, 409);
    await dokud(async () => (await poslat('/api/kanon')).data.entity.some((e) => e.id === 'ilma-dunwarova'));
  } finally {
    await hub.zastavit();
    await r.smazat();
  }
});
