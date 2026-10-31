// Kvalita kánonu (⚠ bod 154): pravidla „kánonu na 100 %“ nad malými kartami v paměti.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nacistEntitu } from '../sdilene/karta-kanonu.js';
import { zkontrolovatKvalitu, nacistTerminy, PRAVIDLA, MIN_POPIS } from '../sdilene/kvalita-kanonu.js';

const POPIS = 'Hlučná hospoda u brány, kde se scházejí formani. '.repeat(5).trim();

function karta(slozka, hlavicka, telo) {
  const id = hlavicka.id;
  const radky = ['---', 'schema: 1', ...Object.entries(hlavicka).map(([k, v]) => `${k}: ${JSON.stringify(v)}`), '---', telo].join('\n');
  return nacistEntitu(radky, { slozka, soubor: `kampan/${slozka}/${id}/${id}.md`, slozkaEntity: true });
}

const misto = (id, telo, hlavicka = {}) => karta('mista', { id, typ: 'misto', nazev: hlavicka.nazev ?? id, verejne: true, zdroj: 'test', ...hlavicka }, telo);
const dobreMisto = (id, nazev = id) => misto(id, `# ${nazev}\n\n${POPIS}\n\n## Co ví družina\n\n- Je tam teplo. %%zná%%\n\n## Co tu najdou\n\nPivo.\n\n## DM\n\nNic.\n`, { nazev });
const problemy = (k, id, pravidlo) => (k.karty.find((x) => x.id === id)?.problemy ?? []).filter((p) => !pravidlo || p.pravidlo === pravidlo);

const KLIC = [
  '# Překladový klíč', '', '## Dovednosti', '', '| Anglicky | Česky | Vlastnost |', '| --- | --- | --- |',
  '| Perception | Vnímání | Moudrost |', '| Sleight of Hand | Čachry | Obratnost |', '', '## Akce', '', '| Anglicky | Česky |', '| --- | --- |',
  '| Dash | Sprint |', '| Hit | Zásah |', '', '## Zbraně', '', '| Anglicky | Česky |', '| --- | --- |', '| Longsword | Dlouhý meč |', '',
].join('\n');

test('úplná karta místa nemá žádný problém a kánon je na 100 %', () => {
  const k = zkontrolovatKvalitu([dobreMisto('hospoda', 'Hospoda')]);
  assert.equal(k.procento, 100);
  assert.equal(k.bezChyb, 1);
  assert.deepEqual(k.karty, []);
});

test('poznámky z převodu se hlásí, věta ve světě ne', () => {
  const e = misto('brod', `# Brod\n\n${POPIS}\n\nLeží jižně *(Neplatí: severně, R8.)*.\n\n> Za odřezky se neplatí.\n\n## Co ví družina\n\n- Brod. %%zná%%\n\n## Co tu najdou\n\nX\n\n## DM (doplněno 26. 8.)\n\nVarianta B: nic.\n`);
  const p = problemy(zkontrolovatKvalitu([e]), 'brod', 'poznamky');
  assert.equal(p.length, 3);
  assert.match(p[0].zprava, /rozpor/);
  assert.ok(p.every((x) => !x.zprava.includes('odřezky')));
});

test('rozhodnutí smí mluvit o variantách', () => {
  const e = karta('rozhodnuti', { id: 'otazka', typ: 'rozhodnuti', nazev: 'Otázka', stav: 'otevrene', zdroj: 'x' }, '## Kontext\n\nVarianta A, nebo B? R3.\n\n## Dopad\n\nNic.\n');
  assert.deepEqual(problemy(zkontrolovatKvalitu([e]), 'otazka', 'poznamky'), []);
});

test('anglické termíny z klíče: celé slovo, bez krátkých a bez jmen karet', () => {
  const terminy = nacistTerminy(KLIC);
  assert.deepEqual(terminy.map((t) => t.en).sort(), ['Dash', 'Perception', 'Sleight of Hand']);
  const e = misto('ulice', `# Ulice\n\n${POPIS} Hodil Perception 21 a sleight of hand. Hit. Dashboard.\n\n## Co ví družina\n\n- U. %%zná%%\n\n## Co tu najdou\n\nX\n\n## DM\n\nY\n`);
  const p = problemy(zkontrolovatKvalitu([e], { terminy }), 'ulice', 'terminy');
  assert.equal(p.length, 1);
  assert.equal(p[0].zprava, 'Perception → Vnímání, Sleight of Hand → Čachry');
});

test('prázdná karta: počítá se jen text mimo DM a Co ví družina', () => {
  const e = misto('mirabar', `# Mirabar\n\nMěsto.\n\n## Co ví družina\n\n- ${POPIS} %%zná%%\n\n## Co tu najdou\n\nX\n\n## DM\n\n${POPIS}\n`, { nazev: 'Mirabar' });
  const p = problemy(zkontrolovatKvalitu([e]), 'mirabar', 'popis');
  assert.equal(p.length, 1);
  assert.match(p[0].zprava, new RegExp(`nejméně ${MIN_POPIS}`));
});

test('družina: postava hráče a karta z hráčského kánonu musí být vidět', () => {
  const leta = karta('postavy', { id: 'leta', typ: 'postava', nazev: 'Leta', verejne: true, zdroj: 'x' }, `# Leta\n\n${POPIS}\n\n## Co ví družina\n\n- Zlodějka.\n`);
  const skryte = misto('triboar', `# Triboar\n\n${POPIS}\n`, { verejne: false, nazev: 'Triboar' });
  const zapis = karta('kanon', { id: 's01-cesta', typ: 'kanon', nazev: 'Cesta', verejne: true, sezeni: 's01', vazby: ['[[triboar]]'] }, '## Co se stalo\n\n[[leta|Leta]] šla.\n\n## Důsledek\n\nNic.\n');
  const k = zkontrolovatKvalitu([leta, skryte, zapis]);
  assert.match(problemy(k, 'leta', 'druzina')[0].zprava, /Postava hráče.*žádná odrážka/);
  assert.match(problemy(k, 'triboar', 'druzina')[0].zprava, /hráčský kánon \(„Cesta“\).*verejne: false/);
});

test('sezení: datum, shrnutí, záznam a zapomenuté ukončení', () => {
  const s1 = karta('sezeni', { id: 's01', typ: 'sezeni', nazev: 'Sezení 1', cislo: 1 }, '# Sezení 1\n\n## Scény\n\nBoj.\n');
  const s2 = karta('sezeni', { id: 's02', typ: 'sezeni', nazev: 'Sezení 2', cislo: 2, datum_realne: '2026-09-11', zacatek: '2026-09-11T12:00', konec: '2026-09-15T18:00' }, '# Sezení 2\n\n## Shrnutí\n\nŠli na jih.\n');
  const s3 = karta('sezeni', { id: 's03', typ: 'sezeni', nazev: 'Sezení 3', cislo: 3, datum_realne: '2026-10-24' }, '# Sezení 3\n');
  const z2 = karta('kanon', { id: 's02-jih', typ: 'kanon', nazev: 'Jih', verejne: true, sezeni: 's02' }, '## Co se stalo\n\nX\n\n## Důsledek\n\nY\n');
  const k = zkontrolovatKvalitu([s1, s2, s3, z2]);
  // s01 má scény, ale ani shrnutí, ani kánon: čeká na zápis z přepisu, chybí jen datum (⚠ bod 158).
  assert.deepEqual(problemy(k, 's01').map((p) => p.zprava), ['Chybí datum sezení (datum_realne).']);
  assert.deepEqual(problemy(k, 's02').map((p) => p.zprava), ['Konec je 4 dní po začátku. Nezůstalo sezení omylem běžet?']);
  // Poslední sezení bez konce ještě běží nebo se chystá: shrnutí ani záznamy se nevyžadují.
  assert.deepEqual(problemy(k, 's03'), []);
});

test('zmínka bez odkazu: skloňované jméno, odkaz kdekoli v textu stačí', () => {
  const koudur = karta('postavy', { id: 'koudur', typ: 'postava', nazev: 'Koudur', verejne: true, zdroj: 'x' }, `# Koudur\n\n${POPIS}\n`);
  const a = dobreMisto('hospoda', 'Hospoda');
  a.telo += '\nKoudurovi tu nalili.\n';
  const b = dobreMisto('trh', 'Trh');
  b.telo += '\n[[koudur|Koudur]] tu hrál. Koudur pak odešel.\n';
  b.odkazyVTextu = ['koudur'];
  const k = zkontrolovatKvalitu([koudur, a, b]);
  assert.equal(problemy(k, 'hospoda', 'odkazy')[0].zprava, 'Koudur');
  assert.deepEqual(problemy(k, 'trh', 'odkazy'), []);
});

test('doporučení se do procenta nepočítají, chyby ano', () => {
  const bezZdroje = misto('les', `# Les\n\n${POPIS}\n\n## Co ví družina\n\n- Les. %%zná%%\n`, { zdroj: '' });
  const k = zkontrolovatKvalitu([bezZdroje, misto('pole', '# Pole\n\nPole.\n')]);
  assert.deepEqual(problemy(k, 'les').map((p) => p.pravidlo).sort(), ['oddily', 'zdroj']);
  assert.ok(problemy(k, 'les').every((p) => PRAVIDLA[p.pravidlo].uroven === 'doporuceni'));
  assert.equal(k.procento, 50);
  assert.equal(k.karty[0].id, 'pole', 'karty s chybou jsou první');
  assert.equal(k.pravidla.find((p) => p.id === 'zdroj').karet, 1);
});

test('sezení: nezapsané čeká, s finálním návrhem je chyba, napůl zapsané chybu má hned (⚠ bod 158)', () => {
  const s1 = karta('sezeni', { id: 's01', typ: 'sezeni', nazev: 'Sezení 1', cislo: 1, datum_realne: '2026-08-29' }, '# Sezení 1\n\n## Shrnutí\n\nŠli.\n');
  const s2 = karta('sezeni', { id: 's02', typ: 'sezeni', nazev: 'Sezení 2', cislo: 2, datum_realne: '2026-09-11', konec: '2026-09-11T22:00' }, '# Sezení 2\n\n## Poznámky ze stolu\n\n- 20:00 (13. Eleint) — Konec sezení (doplněno podle záznamu Hubu)\n');
  const s3 = karta('sezeni', { id: 's03', typ: 'sezeni', nazev: 'Sezení 3', cislo: 3, datum_realne: '2026-10-24', konec: '2026-10-24T16:45' }, '# Sezení 3\n');
  const s4 = karta('sezeni', { id: 's04', typ: 'sezeni', nazev: 'Sezení 4', cislo: 4, datum_realne: '2026-11-07' }, '# Sezení 4\n');
  const bez = zkontrolovatKvalitu([s1, s2, s3, s4]);
  assert.deepEqual(problemy(bez, 's01').map((p) => p.zprava), ['Sezení nemá žádný záznam hráčského kánonu.'], 'shrnutí bez kánonu je napůl zapsané');
  assert.deepEqual(problemy(bez, 's02'), [], 'čeká na zápis; „doplněno“ v Poznámkách ze stolu nevadí');
  assert.deepEqual(problemy(bez, 's03'), []);
  const sFinalnim = zkontrolovatKvalitu([s1, s2, s3, s4], { finalniNavrhy: new Set(['s03']) });
  assert.deepEqual(problemy(sFinalnim, 's03').map((p) => p.zprava), ['Chybí shrnutí (oddíl Shrnutí).', 'Sezení nemá žádný záznam hráčského kánonu.', 'Návrh po sezení je finální, sezení ale ještě není zapsané.']);
});

test('sezení: „doplněno“ mimo Poznámky ze stolu je dál poznámka z přípravy', () => {
  const s1 = karta('sezeni', { id: 's01', typ: 'sezeni', nazev: 'Sezení 1', cislo: 1, datum_realne: '2026-08-29' }, '# Sezení 1\n\n## Shrnutí\n\nŠli (doplněno později).\n\n## Poznámky ze stolu\n\n- 12:00 — doplněno\n');
  assert.equal(problemy(zkontrolovatKvalitu([s1]), 's01', 'poznamky').length, 1);
});
