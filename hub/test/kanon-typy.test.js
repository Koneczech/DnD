// Typové stránky wiki (rozhodnutí 74, DM 21. 10. 2026): pole hlavičky podle typu, co Hub
// dopočítá z polí jiných karet, doporučené oddíly a DM oddíly na konci stránky.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Kanon } from '../server/kanon-modul.js';
import { upravitKartu } from '../server/hlavicka.js';
import { Zapisovac } from '../server/zapis.js';
import { kontrolaDat } from '../server/data.js';
import { naHtml, dmOddilyDolu } from '../sdilene/markdown.js';
import { chybejiciOddily, vlozitOddil, nadpisZpetnehoPole, popisekPole, POLE_TYPU, ODDILY_TYPU } from '../sdilene/typy-karet.js';
import { docasneRepo } from './pomoc.js';

const KOREN_REPA = path.resolve(import.meta.dirname, '..', '..');

async function repo() {
  const r = await docasneRepo();
  const zapsat = async (rel, text) => {
    await fs.mkdir(path.dirname(path.join(r.koren, rel)), { recursive: true });
    await fs.writeFile(path.join(r.koren, rel), text);
  };
  const karta = (slozka, id, typ, hlava = '', telo = 'Text.\n') => zapsat(`kampan/${slozka}/${id}/${id}.md`, `---\nschema: 1\nid: ${id}\ntyp: ${typ}\nnazev: ${id}\nverejne: true\n${hlava}---\n${telo}`);
  await karta('mista', 'mirabar', 'misto', 'druh: město\n');
  await karta('mista', 'na-zvonici', 'misto', 'lezi_v: "[[mirabar]]"\n');
  await karta('frakce', 'krkavci', 'frakce', 'sidlo: "[[mirabar]]"\n');
  await karta('npc', 'dorn', 'npc', 'druh: trpaslík\nrole: kovář\nosud: mrtvy\nkde: "[[na-zvonici]]"\nfrakce: "[[krkavci]]"\n');
  await karta('npc', 'vendla', 'npc', 'kde: "[[mirabar]]"\n');
  await karta('predmety', 'prsten', 'predmet', 'u_koho: "[[dorn]]"\n');
  return r;
}

const kanonZ = (r) => new Kanon({ cesty: r.c, zapisovac: new Zapisovac() });

test('typy karet: pole, popisky a doporučené oddíly', () => {
  assert.deepEqual(POLE_TYPU.npc, ['druh', 'role', 'frakce', 'osud', 'kde']);
  assert.equal(popisekPole('druh', 'misto'), 'Druh místa');
  assert.equal(popisekPole('kde', 'npc'), 'Kde ho najít');
  assert.equal(nadpisZpetnehoPole('kde', 'misto'), 'Kdo tu je');
  assert.equal(nadpisZpetnehoPole('u_koho', 'misto'), 'Předměty tady');
  assert.equal(nadpisZpetnehoPole('u_koho', 'npc'), 'Má u sebe');
  // DM oddíl s vlastním názvem se počítá, vlastní nadpisy nevadí, na diakritice nezáleží.
  const telo = '# Dorn\n\nÚvod.\n\n## Klíčová věta\n\n## DM — co Dorn ví\n\n## Pribeh\n';
  assert.deepEqual(chybejiciOddily('npc', telo), ['Co ví družina', 'Jak ho hrát']);
  assert.deepEqual(chybejiciOddily('rozhodnuti', '## Kontext\n'), ['Dopad']);
  assert.deepEqual(chybejiciOddily('neznamy', 'x'), []);
  for (const typ of Object.keys(ODDILY_TYPU)) assert.ok(Array.isArray(ODDILY_TYPU[typ]));
});

test('typy karet: nový oddíl jde na místo podle šablony, ne na konec', () => {
  const telo = '# Dorn\n\nÚvod.\n\n## Příběh\n\nText.\n\n## DM\n\nTajné.\n';
  const s = vlozitOddil('npc', telo, 'Jak ho hrát');
  assert.ok(s.indexOf('## Jak ho hrát') < s.indexOf('## Příběh'));
  const cvd = vlozitOddil('npc', telo, 'Co ví družina');
  assert.ok(cvd.indexOf('## Co ví družina') < cvd.indexOf('## Příběh'));
  // Vlastní nadpis mimo šablonu: nový oddíl jde před DM.
  const vlastni = vlozitOddil('npc', '# X\n\n## Rozloučení\n\n## DM — tajné\n', 'Jak ho hrát');
  assert.ok(vlastni.indexOf('## Rozloučení') < vlastni.indexOf('## Jak ho hrát'));
  assert.ok(vlastni.indexOf('## Jak ho hrát') < vlastni.indexOf('## DM — tajné'));
  assert.match(vlozitOddil('npc', '# X\n\nÚvod.', 'DM'), /Úvod\.\n\n## DM\n\n$/);
});

test('šablony v repu mají doporučené oddíly a pole svého typu', async () => {
  for (const [typ, pole] of Object.entries(POLE_TYPU)) {
    const text = await fs.readFile(path.join(KOREN_REPA, 'sablony', `${typ}.md`), 'utf8');
    for (const p of pole) assert.match(text, new RegExp(`^${p}:`, 'm'), `šablona ${typ} nemá pole ${p}`);
    const telo = text.split(/^---$/m).slice(2).join('---');
    assert.deepEqual(chybejiciOddily(typ, telo), [], `šablona ${typ} nemá všechny doporučené oddíly`);
  }
});

test('DM oddíly na konec stránky, na jejich místě odkaz', () => {
  const md = '# Dorn\n\nÚvod.\n\n## Klíčová věta\n\ntext\n\n## DM — co Dorn ví\n\ntajné\n\n### pod\n\nx\n\n## Rozloučení\n\nruka\n\n## DM\n\nkonec\n';
  const d = dmOddilyDolu(md);
  assert.deepEqual(d.oddily.map((o) => [o.nadpis, o.odkaz]), [['DM — co Dorn ví', true], ['DM', false]]);
  const html = naHtml(md, { vynechatNadpis: 'Dorn', oznacitDm: true, dmDolu: true });
  assert.ok(html.indexOf('Rozloučení') < html.indexOf('tajné'), 'DM oddíl je až za textem pro stůl');
  assert.match(html, /<a href="#oddil-dm-0" class="odkaz-na-dm" data-dm="0">↓ DM — co Dorn ví<\/a>/);
  assert.match(html, /<section class="oddil-dm" id="oddil-dm-0">/);
  assert.match(html, /<h5>pod<\/h5>/, 'podnadpis zůstane v oddílu');
  assert.equal((html.match(/odkaz-na-dm/g) ?? []).length, 1, 'oddíl, který už je na konci, odkaz nemá');
  // Bez volby dmDolu zůstává pořadí souboru (náhled v editoru).
  assert.ok(naHtml(md, { oznacitDm: true }).indexOf('tajné') < naHtml(md, { oznacitDm: true }).indexOf('ruka'));
  // Kód v bloku se za nadpis nepovažuje.
  assert.deepEqual(dmOddilyDolu('```\n## DM\n```\n').oddily, []);
});

test('Kánon: údaje, odkazová pole a co Hub dopočítá u cílové karty', async () => {
  const r = await repo();
  try {
    const kanon = kanonZ(r);
    await kanon.nacist();
    const dorn = kanon.karta('dorn', 'dm');
    assert.deepEqual(dorn.udaje, { druh: 'trpaslík', role: 'kovář', osud: 'mrtvy' });
    assert.deepEqual(dorn.odkazyPole, { kde: 'na-zvonici', frakce: 'krkavci' });
    // Místo vidí NPC i z míst uvnitř, frakci se sídlem a předmět u NPC.
    const mirabar = kanon.karta('mirabar', 'dm');
    assert.deepEqual(mirabar.odkazujePolem.map((o) => [o.id, o.pole, o.pres]), [['dorn', 'kde', 'na-zvonici'], ['krkavci', 'sidlo', null], ['vendla', 'kde', null]]);
    assert.deepEqual(kanon.karta('krkavci', 'dm').odkazujePolem.map((o) => [o.id, o.pole]), [['dorn', 'frakce']]);
    assert.deepEqual(kanon.karta('dorn', 'dm').odkazujePolem.map((o) => [o.id, o.pole]), [['prsten', 'u_koho']]);
    // Živý je výchozí a v údajích není; pohled družiny údaje ani dopočítané nevidí.
    assert.equal(kanon.karta('vendla', 'dm').udaje.osud, undefined);
    assert.deepEqual(kanon.karta('mirabar', 'druzina').odkazujePolem, []);
    assert.deepEqual(kanon.karta('dorn', 'druzina').udaje, {});
  } finally {
    await r.smazat();
  }
});

test('Kánon: editor zapíše a odebere pole typových stránek a hlídá cíl', async () => {
  const r = await repo();
  try {
    const kanon = kanonZ(r);
    await kanon.nacist();
    const soubor = path.join(r.c.kampan, 'npc', 'vendla', 'vendla.md');
    await kanon.ulozitZdroj('vendla', { pole: { role: 'vdova', osud: 'nezvestny', frakce: 'krkavci', kde: '[[na-zvonici]]' } });
    let text = await fs.readFile(soubor, 'utf8');
    assert.match(text, /^role: vdova$/m);
    assert.match(text, /^osud: nezvestny$/m);
    assert.match(text, /^frakce: "\[\[krkavci\]\]"$/m);
    assert.match(text, /^kde: "\[\[na-zvonici\]\]"$/m);
    assert.ok(text.indexOf('role:') < text.indexOf('kde:'), 'pole jdou v pořadí šablony');
    await kanon.ulozitZdroj('vendla', { pole: { osud: '', kde: '' } });
    text = await fs.readFile(soubor, 'utf8');
    assert.doesNotMatch(text, /^osud:/m);
    assert.doesNotMatch(text, /^kde:/m);
    await assert.rejects(kanon.ulozitZdroj('vendla', { pole: { osud: 'umira' } }), /Osud je/);
    await assert.rejects(kanon.ulozitZdroj('vendla', { pole: { kde: 'krkavci' } }), /sem nepatří/);
    await assert.rejects(kanon.ulozitZdroj('vendla', { pole: { kde: 'nikde' } }), /neexistuje/);
    await assert.rejects(kanon.ulozitZdroj('mirabar', { pole: { kde: 'na-zvonici' } }), /nemá/);
  } finally {
    await r.smazat();
  }
});

test('hlavička: odkazové pole mění jen svůj řádek', () => {
  const puvodni = '---\nschema: 1\nid: x\ntyp: npc\nnazev: X\nverejne: false\nkde: "[[a]]" # kde ho najít\naliases: []\n---\nTělo.\n';
  const novy = upravitKartu(puvodni, { kde: 'b' });
  assert.equal(novy, puvodni.replace('[[a]]', '[[b]]'));
});

test('Kontrola dat: osud a odkazová pole', async () => {
  const r = await repo();
  try {
    const zapsat = (rel, text) => fs.writeFile(path.join(r.koren, rel), text);
    await fs.mkdir(path.join(r.c.kampan, 'npc', 'zly'), { recursive: true });
    await zapsat('kampan/npc/zly/zly.md', '---\nschema: 1\nid: zly\ntyp: npc\nnazev: Zlý\nverejne: false\nosud: umira\nkde: "[[krkavci]]"\nfrakce: mirabar\nsidlo: "[[mirabar]]"\nu_koho: "[[nikdo]]"\n---\n');
    const k = await kontrolaDat(r.c);
    const zpravy = k.problemy.filter((p) => p.soubor.includes('zly')).map((p) => `${p.uroven}: ${p.zprava}`);
    assert.ok(zpravy.some((z) => /^varovani: osud musí být/.test(z)));
    assert.ok(zpravy.some((z) => /^chyba: kde \[\[krkavci\]\] musí vést na: misto/.test(z)));
    assert.ok(zpravy.some((z) => /^chyba: frakce musí být odkaz/.test(z)));
    assert.ok(zpravy.some((z) => /^varovani: sidlo karta typu npc nepoužívá/.test(z)));
    assert.ok(zpravy.some((z) => /^varovani: u_koho karta typu npc nepoužívá/.test(z)));
    assert.equal(k.problemy.filter((p) => !p.soubor.includes('zly')).length, 0, 'ostatní karty jsou v pořádku');
  } finally {
    await r.smazat();
  }
});
