// Návrh po sezení, druhá část (⚠ bod 157, rozhodnutí 77 a 80): vyřazení do oddílu Neplatné, smazání
// chyby zápisu, rozpory a registr R, schéma 2 a brána předběžný/finální.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import {
  najitText, vyraditTelo, smazatTelo, radekNeplatne, normalizujNavrh, overitNavrh, overitDukaz, upravitExistujici,
} from '../sdilene/navrh-sezeni.js';
import { nacistEntitu, teloDruziny, vPohledu, jeOddilDm } from '../sdilene/karta-kanonu.js';
import { blokyTextu, textDruziny } from '../sdilene/odkryvani.js';
import { vlozitOddil, chybejiciOddily } from '../sdilene/typy-karet.js';
import { zkontrolovatKvalitu } from '../sdilene/kvalita-kanonu.js';
import { dalsiR, normalizujRegistr, potrebujeR, zaznamRegistru, zkratitCitat } from '../sdilene/rozpory.js';
import { Kanon } from '../server/kanon-modul.js';
import { NavrhSezeni, normalizujDukazy, upravitRegistr } from '../server/navrh-sezeni.js';
import { kontrolaDat } from '../server/data.js';
import { Zapisovac } from '../server/zapis.js';
import { docasneRepo } from './pomoc.js';

const POPIS = 'Vězení leží ve sklepení radnice v Longsaddle. Vede do něj úzké schodiště za kanceláří rychtáře a cely jsou čtyři, '
  + 'každá s vlastní mříží a lavicí u zdi. Stráž se střídá po šesti hodinách a klíče nosí vždy služebně starší strážný.';

const VEZENI = `---
schema: 1
id: vezeni
typ: misto
nazev: Vězení pod radnicí
verejne: true
zdroj: "Notion"
vazby: []
---
# Vězení pod radnicí

${POPIS}

## Co ví družina

- Leta tu navštívila Thirila. %%zná%%

## Poslední rozhovor

Pár minut přes mříže, čtvrtá cela. %%zná%%

Thiril jí řekl, ať odejde z města.

## DM

Strážný je podplacený.
`;

const LETA = `---
schema: 1
id: leta
typ: postava
nazev: Leta
verejne: true
zdroj: "hráčka"
vazby: []
---
# Leta

${POPIS}

## Co ví družina

- Leta je bardka. %%zná%%
`;

const STARA = `---
schema: 1
id: stara-krcma
typ: misto
nazev: Stará krčma
verejne: true
zdroj: "Notion"
vazby: []
---
# Stará krčma

${POPIS}

## Co ví družina

- Krčma u brány. %%zná%%
`;

const S03 = `---
schema: 1
id: s03
typ: sezeni
nazev: Sezení 3
verejne: false
cislo: 3
datum_realne: 2026-10-24
---

# Sezení 3

## Poznámky ze stolu

- 12:20 (19. Eleint) — Začátek sezení
`;

const REGISTR = `# Můj komentář k registru
- id: R17
  kdy: 2026-10-20
  sezeni: s02
  druh: stul_vs_karta
  karta: leta
  karta_tvrzeni: "a"
  prepis_tvrzeni: "b"
  stav: rozhodnuto
  rozhodnuti: "Platí stůl."
`;

const telo = (text) => text.split('---\n').slice(2).join('---\n');
const UM_VEZENI = { slozka: 'mista', soubor: 'kampan/mista/vezeni/vezeni.md', slozkaEntity: true };

// ---------------------------------------------------------------------------
// Text karty
// ---------------------------------------------------------------------------

test('najitText: přesně jednou v oddílu, s volnými mezerami, mimo Neplatné', () => {
  const t = telo(VEZENI);
  const r = najitText(t, 'Poslední rozhovor', 'Pár minut přes mříže, čtvrtá cela.');
  assert.equal(t.slice(r.od, r.do), 'Pár minut přes mříže, čtvrtá cela.');
  // Návrh píše text na jeden řádek, karta ho může mít zalomený.
  const zalomeny = t.replace('Pár minut přes', 'Pár minut\npřes');
  assert.ok(najitText(zalomeny, 'Poslední rozhovor', 'Pár minut přes mříže'));
  assert.throws(() => najitText(t, 'Poslední rozhovor', 'Leta tu navštívila'), /není/);
  assert.throws(() => najitText(t, 'Neexistuje', 'x'), /nemá oddíl/);
  assert.throws(() => najitText(t, 'Neplatné', 'x'), /Neplatné/);
  const dvakrat = `${t}\n## Příběh\n\nThiril jí řekl, ať odejde z města.\n`;
  assert.throws(() => najitText(dvakrat, null, 'Thiril jí řekl'), /2×/);
  // Text v oddílu Neplatné se nepočítá.
  const sNeplatnym = `${t}\n## Neplatné\n\n- (1. 1. 2026): „Thiril jí řekl, ať odejde z města.“\n`;
  assert.ok(najitText(sNeplatnym, null, 'Thiril jí řekl, ať odejde z města.'));
});

test('vyradit: text se nahradí, starý jde do Neplatné na konec karty s R, datem, sezením a důvodem', () => {
  const novy = vyraditTelo(telo(VEZENI), {
    oddil: 'Poslední rozhovor', najdi: 'Pár minut přes mříže, čtvrtá cela.', nahradit: 'Seděli spolu v cele. *(R18)*',
    duvod: 'U stolu seděli spolu v cele', r: 'R18', kdy: '2026-10-28',
  }, { datum: '2026-10-31', sezeni: 's03' });
  assert.match(novy, /## Poslední rozhovor\n\nSeděli spolu v cele\. \*\(R18\)\* %%zná%%\n\nThiril/);
  assert.match(novy, /## DM\n\nStrážný je podplacený\.\n\n## Neplatné\n\n- \*\*R18\*\* \(28\. 10\. 2026, sezení 3, z oddílu Poslední rozhovor\): „Pár minut přes mříže, čtvrtá cela\.“ — U stolu seděli spolu v cele\.\n$/);
  // Druhé vyřazení přibude do téhož oddílu.
  const dalsi = vyraditTelo(novy, { oddil: 'Poslední rozhovor', najdi: 'Thiril jí řekl, ať odejde z města.' }, { datum: '2026-10-31', sezeni: 's03' });
  assert.match(dalsi, /— U stolu seděli spolu v cele\.\n- \(31\. 10\. 2026, sezení 3, z oddílu Poslední rozhovor\): „Thiril jí řekl, ať odejde z města\.“\n$/);
  assert.doesNotMatch(dalsi, /## Poslední rozhovor\n\nSeděli spolu v cele\. \*\(R18\)\* %%zná%%\n\n\n/);
});

test('vyradit: vyjmutá celá odrážka nezanechá prázdný řádek ani značku', () => {
  const t = '# X\n\n## Co ví družina\n\n- První. %%zná%%\n- Druhá. %%zná%%\n- Třetí.\n';
  const novy = vyraditTelo(t, { oddil: 'Co ví družina', najdi: 'Druhá.', duvod: 'neplatí' }, { datum: '2026-10-31', sezeni: null });
  assert.match(novy, /- První\. %%zná%%\n- Třetí\.\n\n## Neplatné\n\n- \(31\. 10\. 2026, z oddílu Co ví družina\): „Druhá\.“ — neplatí\.\n$/);
});

test('smazat: text zmizí bez stopy v kartě', () => {
  const novy = smazatTelo(telo(VEZENI), { oddil: 'Poslední rozhovor', najdi: 'Thiril jí řekl, ať odejde z města.' });
  assert.doesNotMatch(novy, /Thiril jí řekl/);
  assert.doesNotMatch(novy, /Neplatné/);
  assert.match(novy, /čtvrtá cela\. %%zná%%\n\n## DM/);
});

test('radekNeplatne: bez R, celá karta a revize bez sezení', () => {
  assert.equal(radekNeplatne({ datum: '2026-11-02', celaKarta: true, duvod: 'Postava nikdy neexistovala.' }), '- (2. 11. 2026): celá karta — Postava nikdy neexistovala.');
  assert.equal(radekNeplatne({ r: 'R20', datum: '2026-11-02', sezeni: 's04', oddil: 'Příběh', stary: 'a %%zná%%\nb' }), '- **R20** (2. 11. 2026, sezení 4, z oddílu Příběh): „a b“');
});

test('vyřazení celé karty: platnost a číslo R v hlavičce, záznam v Neplatné, karta zmizí družině', () => {
  const text = upravitExistujici(STARA, [{ op: 'vyradit', cela_karta: true, r: 'R19', duvod: 'Krčma u brány není', kdy: '2026-10-28' }],
    { slozka: 'mista', soubor: 'kampan/mista/stara-krcma/stara-krcma.md', slozkaEntity: true }, () => undefined, { datum: '2026-10-31', sezeni: 's03' });
  assert.match(text, /^platnost: vyrazeno$/m);
  assert.match(text, /^vyrazeno: R19$/m);
  assert.match(text, /## Neplatné\n\n- \*\*R19\*\* \(28\. 10\. 2026, sezení 3\): celá karta — Krčma u brány není\.\n$/);
  const e = nacistEntitu(text, { slozka: 'mista', soubor: 'kampan/mista/stara-krcma/stara-krcma.md', slozkaEntity: true });
  assert.equal(e.vyrazeno, 'R19');
  assert.equal(vPohledu(e, 'druzina', () => e), null);
  assert.equal(vPohledu(e, 'dm', () => e).vyrazeno, 'R19');
  assert.throws(() => upravitExistujici(text, [{ op: 'vyradit', cela_karta: true }], { slozka: 'mista', soubor: 'x', slozkaEntity: true }, () => undefined), /už je vyřazená/);
});

test('pole verejne: návrh odkryje kartu družině, odkazové pole se porovná podle id', () => {
  const um = { slozka: 'mista', soubor: 'kampan/mista/stara-krcma/stara-krcma.md', slozkaEntity: true };
  const skryta = STARA.replace('verejne: true', 'verejne: false');
  const novy = upravitExistujici(skryta, [{ op: 'pole', pole: 'verejne', puvodni: false, nove: true }], um, () => undefined);
  assert.match(novy, /^verejne: true$/m);
  assert.throws(() => upravitExistujici(skryta, [{ op: 'pole', pole: 'verejne', puvodni: true, nove: false }], um, () => undefined), /návrh počítal/);
  const e = { id: 'x', typ: 'npc', nazev: 'X', verejne: false, pole: { kde: 'tabor' }, vztahy: [], vazby: [] };
  const r = overitNavrh(normalizujNavrh({ schema: 2, stav: 'finalni', operace: [
    { id: 'o1', op: 'pole', karta_id: 'x', pole: 'kde', puvodni: '[[tabor]]', nove: '[[tabor]]', dukaz: [{ dm: '2026-10-31' }], jistota: 'jista' },
    { id: 'o2', op: 'pole', karta_id: 'x', pole: 'verejne', puvodni: false, nove: 'ano', dukaz: [{ dm: '2026-10-31' }], jistota: 'jista' },
  ] }), { cislo: 's03', najit: (id) => ({ x: e, tabor: { id: 'tabor', typ: 'misto', nazev: 'Tábor' } })[id] });
  assert.doesNotMatch(r[0].problemy.join(), /návrh počítal/);
  assert.match(r[1].problemy.join(), /verejne je true nebo false/);
});

test('oddíl Neplatné je jako oddíl DM: družina ho nevidí, nejde odkrýt a zůstává na konci karty', () => {
  assert.equal(jeOddilDm('Neplatné'), true);
  assert.equal(jeOddilDm('Neplatne'), true);
  assert.equal(jeOddilDm('Neplatné rozhodnutí'), false);
  const t = '# X\n\n## Co ví družina\n\n- Ví. %%zná%%\n\n## Neplatné\n\n- (1. 1. 2026): „Starý odkrytý text“ %%zná%%\n';
  assert.doesNotMatch(teloDruziny(t, 'npc'), /Starý/);
  assert.doesNotMatch(teloDruziny(t, 'kanon'), /Starý/);
  assert.doesNotMatch(textDruziny(t), /Starý/);
  assert.equal(blokyTextu(t).length, 0);
  const s = vlozitOddil('npc', t, 'Příběh');
  assert.match(s, /## Příběh\n\n## Neplatné/);
  assert.match(vlozitOddil('npc', t, 'DM'), /## DM\n\n## Neplatné/);
  assert.ok(chybejiciOddily('npc', t).includes('DM'), 'Neplatné nenahrazuje oddíl DM');
});

test('Kvalita kánonu: oddíl Neplatné a značky R z registru nejsou chyba, vyřazená karta se nepočítá', () => {
  const um = { slozka: 'mista', soubor: 'kampan/mista/vezeni/vezeni.md', slozkaEntity: true };
  const zNeplatnym = nacistEntitu(VEZENI.replace('Strážný je podplacený.\n', 'Strážný je podplacený.\n\n## Neplatné\n\n- **R18** (28. 10. 2026): „Notion doplnit TODO“\n')
    .replace('Thiril jí řekl', 'Seděli v cele. *(R18)* Thiril jí řekl'), um);
  const bez = zkontrolovatKvalitu([zNeplatnym], { rozhodnutiR: new Set(['R18']) });
  assert.equal(bez.karty.find((k) => k.id === 'vezeni')?.problemy.filter((p) => p.pravidlo === 'poznamky').length ?? 0, 0);
  const neregistrovane = zkontrolovatKvalitu([zNeplatnym], { rozhodnutiR: new Set() });
  assert.match(neregistrovane.karty[0].problemy.find((p) => p.pravidlo === 'poznamky').zprava, /R18/);
  const vyrazena = nacistEntitu(STARA.replace('verejne: true', 'verejne: true\nplatnost: vyrazeno'), { slozka: 'mista', soubor: 'x', slozkaEntity: true });
  assert.equal(zkontrolovatKvalitu([vyrazena]).karet, 0);
});

// ---------------------------------------------------------------------------
// Návrh: schéma 2 a kontrola
// ---------------------------------------------------------------------------

test('schéma 2: stav předběžný/finální, schéma 1 je jen předběžné, neznámé schéma je chyba', () => {
  assert.equal(normalizujNavrh({ schema: 2, stav: 'finalni', scenar_verze: 47, operace: [] }).stav, 'finalni');
  assert.equal(normalizujNavrh({ schema: 2, operace: [] }).stav, 'predbezny');
  const stare = normalizujNavrh({ schema: 1, stav: 'finalni', operace: [] });
  assert.equal(stare.stav, 'predbezny');
  assert.match(stare.varovani[0], /schema: 1/);
  assert.throws(() => normalizujNavrh({ schema: 3, operace: [] }), /schema: 2/);
  assert.throws(() => normalizujNavrh({ schema: 2, stav: 'hotovo', operace: [] }), /predbezny/);
});

test('důkaz: místo v nahrávce s blokem, rozhodnutí DM, dlouhá citace jen varuje', () => {
  assert.deepEqual(overitDukaz({ cas: 'd2 0:11:39', blok: '46cf14239e', citat: 'pár slov' }), { problemy: [], varovani: [] });
  assert.deepEqual(overitDukaz({ dm: '2026-10-28', citat: 'rozhodnutí' }).problemy, []);
  assert.match(overitDukaz({ dm: '28. 10.' }).problemy[0], /RRRR-MM-DD/);
  assert.match(overitDukaz({ cas: '0:11' }).problemy[0], /d1 0:42:02/);
  assert.match(overitDukaz({ cas: 'd1 0:00:01', blok: 'x y' }).problemy[0], /blok/);
  assert.match(overitDukaz({ cas: 'd1 0:00:01', citat: 'jedna dva tři čtyři pět šest sedm osm devět deset jedenáct dvanáct třináct' }).varovani[0], /13 slov/);
  assert.equal(zkratitCitat('a b c d e f g h i j k l m n'), 'a b c d e f g h i j k l…');
});

test('kontrola návrhu: z_rozporu, číslo R proti registru, vyradit a revize', () => {
  const vezeni = nacistEntitu(VEZENI, UM_VEZENI);
  const karty = { vezeni, leta: { id: 'leta', typ: 'postava', nazev: 'Leta', pole: {}, telo: '' } };
  const dukaz = [{ cas: 'd2 0:11:39', blok: '46cf14239e', citat: 'pár slov' }];
  const navrh = normalizujNavrh({
    schema: 2, stav: 'finalni', sezeni: 's03', operace: [
      { id: 'o1', op: 'rozpor', druh: 'stul_vs_karta', karta_id: 'vezeni', karta_tvrzeni: 'přes mříže', prepis_tvrzeni: 'v cele', r: 'R17', dukaz },
      { id: 'o2', op: 'vyradit', z_rozporu: 'o1', karta_id: 'vezeni', oddil: 'Poslední rozhovor', najdi: 'Pár minut přes mříže, čtvrtá cela.', nahradit: 'V cele. *(R?)*', duvod: 'stůl', dukaz, jistota: 'jista' },
      { id: 'o3', op: 'vyradit', z_rozporu: 'o9', karta_id: 'vezeni', oddil: 'Poslední rozhovor', najdi: 'Tohle tam není.', dukaz, jistota: 'jista' },
      { id: 'o4', op: 'smazat', karta_id: 'vezeni', najdi: 'Thiril jí řekl', nahradit: 'x', dukaz: [{ dm: '2026-10-31' }], jistota: 'jista' },
      { id: 'o5', op: 'rozpor', druh: 'neznamy', karta_tvrzeni: 'a', prepis_tvrzeni: 'b', r: 'R3', dukaz },
    ],
  });
  const registr = new Map([['R17', { id: 'R17', sezeni: 's02', karta: 'leta' }]]);
  const r = overitNavrh(navrh, { cislo: 's03', najit: (id) => karty[id], rozpory: registr });
  assert.match(r[0].problemy.join(), /R17 už je v registru rozporů pro jiný rozpor/);
  assert.deepEqual(r[1].problemy, []);
  assert.match(r[2].problemy.join(), /není rozpor „o9“/);
  assert.match(r[2].problemy.join(), /Tohle tam není/);
  assert.match(r[3].problemy.join(), /smazat nemá nahradit/);
  assert.match(r[3].varovani.join(), /chybu zápisu/);
  assert.match(r[4].problemy.join(), /druh rozporu/);
  assert.match(r[4].problemy.join(), /R1–R16/);

  const revize = overitNavrh(normalizujNavrh({ schema: 2, stav: 'finalni', operace: [
    { id: 'o1', op: 'kanon', karta_id: 'x', nazev: 'x', kdo: ['parta'], co_se_stalo: 'x', dukaz: [{ dm: '2026-11-02' }], jistota: 'jista' },
  ] }), { cislo: 'revize-2026-11-02', revize: true, najit: (id) => karty[id] });
  assert.match(revize[0].problemy.join(), /revize kánonu mimo sezení umí jen/);
});

test('registr rozporů: tvar, další číslo, kdy R potřeba a zápis se zachováním komentářů', () => {
  assert.equal(dalsiR([]), 'R17');
  assert.equal(dalsiR(['R17', 'R20', 'R3']), 'R21');
  assert.equal(potrebujeR('prereknuti', 'karta'), false);
  assert.equal(potrebujeR('prereknuti', 'stul'), true);
  assert.equal(potrebujeR('stul_vs_karta', 'karta'), true);
  const { problemy } = normalizujRegistr([{ id: 'R5', stav: 'rozhodnuto' }, { id: 'R17', stav: 'jine' }, { id: 'R17', stav: 'otevrene' }]);
  assert.match(problemy.join('|'), /R5: R1–R16/);
  assert.match(problemy.join('|'), /R5: rozhodnutý rozpor potřebuje text/);
  assert.match(problemy.join('|'), /R17 je v registru dvakrát/);
  const z = zaznamRegistru({ druh: 'stul_vs_karta', karta_id: 'vezeni', karta_tvrzeni: 'a', prepis_tvrzeni: 'b',
    dukaz: [{ cas: 'd2 0:11:39', blok: 'abcd1234', citat: 'jedna dva tři čtyři pět šest sedm osm devět deset jedenáct dvanáct třináct' }] },
  { volba: 'jinak', text: 'Seděli v cele, ale u mříže.', kdy: '2026-10-31' }, { id: 'R18', sezeni: 's03' });
  assert.equal(z.rozhodnuti, 'Seděli v cele, ale u mříže.');
  assert.equal(z.dukaz[0].citat.split(' ').length, 12);
  const text = upravitRegistr(REGISTR, [z]);
  assert.match(text, /^# Můj komentář k registru\n- id: R17/);
  assert.match(text, /- id: R18\n {2}kdy: 2026-10-31\n {2}sezeni: s03/);
  assert.match(text, /dukaz:\n {4}- \{ cas: d2 0:11:39, blok: abcd1234, citat: jedna dva/);
  // Odložený rozpor, o kterém DM rozhodne později, se přepíše na místě.
  const znovu = upravitRegistr(text, [{ ...z, rozhodnuti: 'Platí stůl.' }]);
  assert.equal(YAML.parse(znovu).length, 2);
  assert.equal(YAML.parse(znovu)[1].rozhodnuti, 'Platí stůl.');
  assert.match(upravitRegistr('', [z]), /^# Registr rozhodnutí o rozporech/);
});

// ---------------------------------------------------------------------------
// Server: rozhodování a zápis
// ---------------------------------------------------------------------------

async function zapsatSoubor(koren, rel, text) {
  const cesta = path.join(koren, ...rel.split('/'));
  await fs.mkdir(path.dirname(cesta), { recursive: true });
  await fs.writeFile(cesta, text);
}

const NAVRH = (stav = 'finalni') => `schema: 2
sezeni: s03
stav: ${stav}
scenar_verze: 561
zdroj: "sezení 3 (24. 10. 2026), přepis nahrávky"
operace:
  - id: o1
    op: rozpor
    druh: stul_vs_karta
    karta_id: vezeni
    karta_tvrzeni: "Pár minut přes mříže, čtvrtá cela."
    prepis_tvrzeni: "Strážný ji pustil přímo k němu do cely."
    otazka: "Přes mříže, nebo v cele?"
    rozhodnuti: "Platí stůl (DM 28. 10. 2026)."
    dukaz: [{ cas: "d2 0:11:39", blok: "46cf14239e", citat: "Sedni si. Je tam taková stolička. Tady nic nespěchá, řekl jí a ukázal ke zdi." }]
  - id: o2
    op: vyradit
    z_rozporu: o1
    karta_id: vezeni
    oddil: Poslední rozhovor
    najdi: "Pár minut přes mříže, čtvrtá cela."
    nahradit: "Strážný ji pustil přímo k němu, seděli spolu v cele. *(R?)*"
    duvod: "V sezení 3 seděli spolu v cele"
    dukaz: [{ cas: "d2 0:11:39", blok: "46cf14239e", citat: "Sedni si" }]
    jistota: jista
  - id: o3
    op: rozpor
    druh: prereknuti
    karta_id: leta
    karta_tvrzeni: "Leta je bardka."
    prepis_tvrzeni: "Leta je kouzelnice."
    dukaz: [{ cas: "d2 0:20:00", citat: "kouzelnice" }]
  - id: o4
    op: vyradit
    karta_id: stara-krcma
    cela_karta: true
    duvod: "Krčma u brány ve hře není"
    dukaz: [{ dm: 2026-10-31, citat: "krčmu škrtám" }]
    jistota: jista
  - id: o5
    op: rozpor
    druh: novy_fakt
    karta_id: leta
    karta_tvrzeni: "Leta u zatčení nebyla."
    prepis_tvrzeni: "Letu krátce zavřeli a propustili."
    dukaz: [{ cas: "d2 0:06:44", citat: "propustili z vězení" }]
  - id: o6
    op: doplnit
    z_rozporu: o5
    karta_id: leta
    oddil: Co ví družina
    typ_bloku: odrazka
    text: "Letu krátce zavřeli a bez vysvětlení propustili. *(R?)*"
    zna: true
    dukaz: [{ cas: "d2 0:06:44", citat: "propustili" }]
    jistota: jista
`;

async function pripravit({ registr = REGISTR, navrh = NAVRH() } = {}) {
  const repo = await docasneRepo();
  await zapsatSoubor(repo.koren, 'kampan/mista/vezeni/vezeni.md', VEZENI);
  await zapsatSoubor(repo.koren, 'kampan/mista/stara-krcma/stara-krcma.md', STARA);
  await zapsatSoubor(repo.koren, 'kampan/postavy/leta/leta.md', LETA);
  await zapsatSoubor(repo.koren, 'kampan/sezeni/s03/s03.md', S03);
  if (registr !== null) await zapsatSoubor(repo.koren, 'kampan/rozpory.yaml', registr);
  await zapsatSoubor(repo.koren, 'hub/.stav/navrhy/s03.yaml', navrh);
  const zapisovac = new Zapisovac();
  const kanon = new Kanon({ cesty: repo.c, zapisovac });
  await kanon.nacist();
  const n = new NavrhSezeni({ cesty: repo.c, kanon, kalendar: null, zapisovac });
  const cist = (rel) => fs.readFile(path.join(repo.koren, ...rel.split('/')), 'utf8');
  return { repo, kanon, n, cist };
}

test('Návrh po sezení: rozpory, navazující operace, čísla R, Neplatné a registr', async () => {
  const { repo, kanon, n, cist } = await pripravit();
  try {
    let d = await n.nacist('s03');
    assert.equal(d.brana, null);
    assert.ok(d.operace.every((o) => !o.problemy.length), JSON.stringify(d.operace.map((o) => [o.id, o.problemy])));
    const o1 = d.operace.find((o) => o.id === 'o1');
    assert.equal(o1.rozpor.vychozi, 'stul');
    assert.match(o1.rozpor.navrh, /Platí stůl/);
    assert.deepEqual(o1.rozpor.navazujici, ['o2']);
    assert.match(d.operace.find((o) => o.id === 'o2').blokuje, /Nejdřív rozhodni rozpor o1/);
    assert.match(d.operace.find((o) => o.id === 'o2').ukazka.neplatne, /„Pár minut přes mříže, čtvrtá cela\.“/);
    assert.equal(d.operace.find((o) => o.id === 'o3').rozpor.vychozi, 'karta');
    assert.equal(d.operace.find((o) => o.id === 'o5').rozpor.vychozi, null);

    // Navazující operaci nejde schválit, dokud rozpor není rozhodnutý; rozpor se neschvaluje.
    await assert.rejects(n.rozhodnout('s03', 'o2', { stav: 'schvaleno' }), /Nejdřív rozhodni rozpor o1/);
    await assert.rejects(n.rozhodnout('s03', 'o1', { stav: 'schvaleno' }), /Platí stůl/);
    await assert.rejects(n.rozhodnout('s03', 'o1', { reseni: { volba: 'jinak', text: '  ' } }), /napiš/);

    // Platí karta: navazující operaci Hub zamítne sám; po změně na Platí stůl ji vrátí mezi čekající.
    d = await n.rozhodnout('s03', 'o5', { reseni: { volba: 'karta' } });
    assert.equal(d.operace.find((o) => o.id === 'o6').stav, 'zamitnuto');
    assert.equal(d.operace.find((o) => o.id === 'o6').automaticky, true);
    d = await n.rozhodnout('s03', 'o5', { reseni: { volba: 'jinak', text: 'Letu zavřeli na jednu noc a propustili.' } });
    assert.equal(d.operace.find((o) => o.id === 'o6').stav, 'nerozhodnuto');

    await n.rozhodnout('s03', 'o1', { reseni: { volba: 'stul' } });
    await n.rozhodnout('s03', 'o3', { reseni: { volba: 'karta' } });
    for (const id of ['o2', 'o4', 'o6']) await n.rozhodnout('s03', id, { stav: 'schvaleno' });

    const k = await n.kontrolaZapisu('s03');
    assert.equal(k.ok, true, JSON.stringify(k));
    assert.deepEqual(k.cislaR, ['R18', 'R19']);

    const v = await n.zapsat('s03');
    assert.deepEqual(v.cislaR, ['R18', 'R19']);

    const vezeni = await cist('kampan/mista/vezeni/vezeni.md');
    assert.match(vezeni, /Strážný ji pustil přímo k němu, seděli spolu v cele\. \*\(R18\)\* %%zná%%/);
    assert.match(vezeni, /## Neplatné\n\n- \*\*R18\*\* \(\d+\. \d+\. \d{4}, sezení 3, z oddílu Poslední rozhovor\): „Pár minut přes mříže, čtvrtá cela\.“ — V sezení 3 seděli spolu v cele\.\n$/);
    const leta = await cist('kampan/postavy/leta/leta.md');
    assert.match(leta, /- Letu krátce zavřeli a bez vysvětlení propustili\. \*\(R19\)\* %%zná%%/);
    const krcma = await cist('kampan/mista/stara-krcma/stara-krcma.md');
    assert.match(krcma, /^platnost: vyrazeno$/m);
    assert.doesNotMatch(krcma, /^vyrazeno:/m, 'bez čísla R se do hlavičky žádné nepíše');
    // Přeřeknutí, platí karta: bez R, řádek do zápisu sezení.
    const s03 = await cist('kampan/sezeni/s03/s03.md');
    assert.match(s03, /## Co fungovalo a co opravit\n\n- Přeřeknutí DM \(\[\[leta\]\]\): u stolu zaznělo „Leta je kouzelnice\.“, platí karta\./);

    const registr = YAML.parse(await cist('kampan/rozpory.yaml'));
    assert.deepEqual(registr.map((z) => z.id), ['R17', 'R18', 'R19']);
    assert.equal(registr[1].rozhodnuti, 'Platí stůl.');
    assert.equal(registr[1].karta, 'vezeni');
    assert.equal(registr[1].sezeni, 's03');
    assert.equal(registr[1].dukaz[0].citat.split(' ').length, 12, 'citace v registru je zkrácená');
    assert.equal(registr[2].rozhodnuti, 'Letu zavřeli na jednu noc a propustili.');
    assert.match(await cist('kampan/rozpory.yaml'), /^# Můj komentář k registru/);

    const zapsano = JSON.parse(await cist('hub/.stav/navrhy/s03.zapsano.json'));
    assert.deepEqual(zapsano.zapsane.sort(), ['o1', 'o2', 'o3', 'o4', 'o5', 'o6']);
    assert.deepEqual(zapsano.rozpory, ['R18', 'R19']);
    assert.equal(zapsano.commit, null);

    // Kánon: vyřazená karta zmizí z pohledu družiny, Kvalita ji nepočítá a značky R nejsou chyba.
    assert.equal(kanon.entity.get('stara-krcma').vyrazeno, true);
    assert.ok(!kanon.seznam('druzina').entity.some((e) => e.id === 'stara-krcma'));
    assert.ok(kanon.seznam('dm').entity.some((e) => e.id === 'stara-krcma'));
    assert.ok(!kanon.kvalita().karty.some((x) => x.problemy.some((p) => p.pravidlo === 'poznamky')), JSON.stringify(kanon.kvalita().karty));
    assert.doesNotMatch(kanon.karta('vezeni', 'druzina').druzinaText ?? JSON.stringify(kanon.karta('vezeni', 'druzina')), /Pár minut přes mříže/);

    // Podruhé už není co zapsat; zapsaný rozpor nejde změnit.
    await assert.rejects(n.zapsat('s03'), /Není schválená žádná operace ani rozhodnutý rozpor/);
    await assert.rejects(n.rozhodnout('s03', 'o1', { reseni: { volba: 'karta' } }), /už je zapsaná/);
  } finally {
    await repo.smazat();
  }
});

test('Návrh po sezení: předběžný návrh jde procházet a rozhodovat, ale ne zapsat', async () => {
  const { repo, n, cist } = await pripravit({ navrh: NAVRH('predbezny') });
  try {
    const d = await n.nacist('s03');
    assert.match(d.brana, /Předběžný návrh/);
    await n.rozhodnout('s03', 'o4', { stav: 'schvaleno' });
    await assert.rejects(n.zapsat('s03'), /Předběžný návrh/);
    assert.equal(await cist('kampan/mista/stara-krcma/stara-krcma.md'), STARA);
    // Schéma 1 (starý předběžný s03.yaml) se načte jako předběžné.
    await zapsatSoubor(repo.koren, 'hub/.stav/navrhy/s03.yaml', NAVRH().replace('schema: 2', 'schema: 1'));
    const stare = await n.nacist('s03');
    assert.match(stare.varovani[0], /schema: 1/);
    assert.ok(stare.brana);
  } finally {
    await repo.smazat();
  }
});

test('Návrh po sezení: rozhodnutí k operaci, která se v novém návrhu změnila, neplatí', async () => {
  const { repo, n } = await pripravit();
  try {
    await n.rozhodnout('s03', 'o4', { stav: 'schvaleno' });
    assert.equal((await n.nacist('s03')).operace.find((o) => o.id === 'o4').stav, 'schvaleno');
    await zapsatSoubor(repo.koren, 'hub/.stav/navrhy/s03.yaml', NAVRH().replace('Krčma u brány ve hře není', 'Jiný důvod'));
    const o4 = (await n.nacist('s03')).operace.find((o) => o.id === 'o4');
    assert.equal(o4.stav, 'nerozhodnuto');
    assert.match(o4.varovani[0], /změnila/);
  } finally {
    await repo.smazat();
  }
});

test('Návrh po sezení: zápis, který by přidal chybu Kvality kánonu, se zastaví celý', async () => {
  const navrh = `schema: 2
sezeni: s03
stav: finalni
operace:
  - { id: o1, op: doplnit, karta_id: leta, oddil: Příběh, typ_bloku: odstavec, text: "Leta má sestru, doplnit jméno.", dukaz: [{ cas: "d1 0:00:01" }], jistota: jista }
  - { id: o2, op: smazat, karta_id: vezeni, oddil: DM, najdi: "Strážný je podplacený.", dukaz: [{ dm: 2026-10-31 }], jistota: jista }
`;
  const { repo, n, cist } = await pripravit({ navrh, registr: null });
  try {
    await n.rozhodnout('s03', 'o1', { stav: 'schvaleno' });
    await n.rozhodnout('s03', 'o2', { stav: 'schvaleno' });
    const k = await n.kontrolaZapisu('s03');
    assert.equal(k.ok, false);
    assert.equal(k.kvalita.nove[0].id, 'leta');
    assert.equal(k.kvalita.nove[0].pravidlo, 'poznamky');
    await assert.rejects(n.zapsat('s03'), /přidal chybu Kvality kánonu.*Leta/);
    assert.equal(await cist('kampan/postavy/leta/leta.md'), LETA);
    assert.equal(await cist('kampan/mista/vezeni/vezeni.md'), VEZENI);
    // Bez vadné operace projde a registr nevznikne (žádný rozpor).
    await n.rozhodnout('s03', 'o1', { stav: 'zamitnuto' });
    await n.zapsat('s03');
    assert.doesNotMatch(await cist('kampan/mista/vezeni/vezeni.md'), /podplacený/);
    await assert.rejects(fs.access(path.join(repo.koren, 'kampan', 'rozpory.yaml')));
  } finally {
    await repo.smazat();
  }
});

test('revize kánonu mimo sezení: revize-RRRR-MM-DD.yaml, bez sezení v Neplatné', async () => {
  const { repo, n, cist } = await pripravit();
  try {
    await zapsatSoubor(repo.koren, 'hub/.stav/navrhy/revize-2026-11-02.yaml', `schema: 2
stav: finalni
operace:
  - { id: o1, op: vyradit, karta_id: vezeni, oddil: Poslední rozhovor, najdi: "Thiril jí řekl, ať odejde z města.", duvod: "Nikdy nezaznělo", dukaz: [{ dm: 2026-11-02 }], jistota: jista }
`);
    const seznam = await n.seznam();
    assert.deepEqual(seznam.navrhy.map((x) => x.cislo), ['s03', 'revize-2026-11-02']);
    await n.rozhodnout('revize-2026-11-02', 'o1', { stav: 'schvaleno' });
    await n.zapsat('revize-2026-11-02');
    assert.match(await cist('kampan/mista/vezeni/vezeni.md'), /## Neplatné\n\n- \(\d+\. \d+\. \d{4}, z oddílu Poslední rozhovor\): „Thiril jí řekl, ať odejde z města\.“ — Nikdy nezaznělo\.\n$/);
    assert.ok(await cist('hub/.stav/navrhy/revize-2026-11-02.zapsano.json'));
  } finally {
    await repo.smazat();
  }
});

test('Kontrola dat: registr rozporů, odložený rozpor a neexistující karta', async () => {
  const repo = await docasneRepo();
  try {
    await zapsatSoubor(repo.koren, 'kampan/rozpory.yaml', `- { id: R17, stav: otevrene, karta: neni, otazka: "Kolik jich bylo?" }
- { id: R2, stav: rozhodnuto, rozhodnuti: "x" }
`);
    const { problemy } = await kontrolaDat(repo.c);
    const zpravy = problemy.filter((p) => p.soubor.endsWith('rozpory.yaml')).map((p) => `${p.uroven}: ${p.zprava}`);
    assert.ok(zpravy.some((z) => /^chyba: R2: R1–R16/.test(z)), zpravy.join('\n'));
    assert.ok(zpravy.some((z) => /^varovani: R17 je odložený rozpor u \[\[neni\]\]: Kolik jich bylo\?/.test(z)));
    assert.ok(zpravy.some((z) => /^varovani: R17: karta \[\[neni\]\] neexistuje/.test(z)));
  } finally {
    await repo.smazat();
  }
});

test('kontrola důkazů z nástroje: objekty se závažností, upozornění i u ok: true, důkazy dm, starší tvar', () => {
  const k = normalizujDukazy({
    ok: true,
    problemy: [{ text: 'jméno „Leta“ je z karty, u stolu doslova nezaznělo', zavaznost: 'upozorneni' }],
    dm: [{ dm: '2026-10-28', citat: 'Platí stůl' }, { citat: 'bez data' }],
  });
  assert.equal(k.ok, true);
  assert.equal(k.upozorneni, 1);
  assert.equal(k.chyb, 0);
  assert.deepEqual(k.dm, [{ dm: '2026-10-28', citat: 'Platí stůl' }]);
  const spatne = normalizujDukazy({ ok: false, problemy: [{ text: 'citace nezazněla', zavaznost: 'chyba' }, 'starý tvar'] });
  assert.deepEqual(spatne.problemy, [{ text: 'citace nezazněla', zavaznost: 'chyba' }, { text: 'starý tvar', zavaznost: 'upozorneni' }]);
  assert.equal(spatne.chyb, 1);
  assert.equal(normalizujDukazy(null), null);
});

test('Návrh po sezení: detail nese kontrolu důkazů z sNN.dukazy.json', async () => {
  const { repo, n } = await pripravit();
  try {
    await zapsatSoubor(repo.koren, 'hub/.stav/navrhy/s03.dukazy.json', JSON.stringify({
      sezeni: 's03', cas: 1793447360, operace: {
        o2: { ok: true, problemy: [{ text: 'jméno „Thiril“ je v kánonu, ale v okolí důkazu nezaznělo', zavaznost: 'upozorneni' }] },
        o4: { ok: true, problemy: [], dm: [{ dm: '2026-10-31', citat: 'krčmu škrtám' }] },
      },
    }));
    const d = await n.nacist('s03');
    const o2 = d.operace.find((o) => o.id === 'o2');
    assert.equal(o2.dukazy.ok, true);
    assert.equal(o2.dukazy.upozorneni, 1);
    assert.match(o2.dukazy.problemy[0].text, /Thiril/);
    assert.deepEqual(d.operace.find((o) => o.id === 'o4').dukazy.dm, [{ dm: '2026-10-31', citat: 'krčmu škrtám' }]);
    assert.equal(d.operace.find((o) => o.id === 'o1').dukazy, null);
  } finally {
    await repo.smazat();
  }
});
