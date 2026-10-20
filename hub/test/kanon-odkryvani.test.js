// Odkrývání textu karty (rozhodnutí 75, DM 21. 10. 2026): kterýkoli odstavec, odrážka nebo
// citace mimo Co ví družina a DM oddíly jde odkrýt značkou %%zná%%, bez přepisování.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Kanon } from '../server/kanon-modul.js';
import { Zapisovac } from '../server/zapis.js';
import { blokyTextu, prepnoutBlokTextu, textDruziny, oznacitBloky } from '../sdilene/odkryvani.js';
import { naHtml } from '../sdilene/markdown.js';
import { docasneRepo } from './pomoc.js';

const TELO = `# Leta

Půlčice, zlodějka. %%zná%%

## Příběh

### Před Thirilem

*Kurzíva* na začátku
a druhý řádek.

- odrážka
  - vnořená
- druhá %%zná%%

> citace
> pokračuje

| a | b |
|---|---|
| 1 | 2 |

\`\`\`
kód
\`\`\`

## Co ví družina

- z oddílu družiny %%zná%%

## DM — co Leta neví

Tajné. %%zná%%

## List postavy

- Initiative: +5
- druhá
`;

test('bloky textu: odstavce, odrážky a citace mimo Co ví družina, DM, tabulky a kód', () => {
  const b = blokyTextu(TELO);
  assert.deepEqual(b.map((x) => [x.druh, x.zna, x.prvni, x.poradi]), [
    ['odstavec', true, 'Půlčice, zlodějka.', 0],
    ['odstavec', false, '*Kurzíva* na začátku', 0],
    ['odrazka', false, '- odrážka', 0],
    ['odrazka', true, '- druhá', 0],
    ['citace', false, '> citace', 0],
    ['odrazka', false, '- Initiative: +5', 0],
    ['odrazka', false, '- druhá', 1],
  ]);
  assert.equal(b[2].do - b[2].od, 2, 'vnořená odrážka patří k nadřazené');
});

test('odkrytí změní jen první řádek bloku, blok se pozná podle textu a pořadí', () => {
  const t = prepnoutBlokTextu(TELO, { prvni: '- druhá', poradi: 1 }, true);
  assert.match(t, /^- druhá %%zná%%\n$/m);
  assert.equal(t.split('\n').filter((r, i) => r !== TELO.split('\n')[i]).length, 1);
  const skryto = prepnoutBlokTextu(TELO, { prvni: 'Půlčice, zlodějka. %%zná%%' }, false);
  assert.match(skryto, /^Půlčice, zlodějka\.$/m);
  assert.equal(prepnoutBlokTextu(TELO, { prvni: 'Tajné.' }, true), null, 'DM oddíl odkrýt nejde');
  assert.equal(prepnoutBlokTextu(TELO, { prvni: '- z oddílu družiny' }, true), null, 'Co ví družina má vlastní odrážky');
  assert.equal(prepnoutBlokTextu(TELO, { prvni: 'neexistuje' }, true), null);
});

test('text pro družinu: jen odkryté bloky a nadpisy nad nimi, bez komentářů', () => {
  assert.equal(textDruziny(TELO), 'Půlčice, zlodějka.\n\n## Příběh\n\n### Před Thirilem\n\n- druhá');
  assert.equal(textDruziny('# X\n\nNic.\n'), '');
  assert.doesNotMatch(textDruziny(TELO), /Tajné|z oddílu družiny|Kurzíva/);
});

test('vykreslení: data-blok u odstavce, položky a citace, kurzíva zůstane', () => {
  const html = naHtml(oznacitBloky(TELO), { vynechatNadpis: 'Leta', oznacitDm: true, dmDolu: true });
  assert.match(html, /<p data-blok="0">Půlčice, zlodějka\.<\/p>/);
  assert.match(html, /<p data-blok="1"><em>Kurzíva<\/em> na začátku<br>a druhý řádek\.<\/p>/);
  assert.match(html, /<li data-blok="3">druhá<\/li>/);
  assert.match(html, /<blockquote><p data-blok="4">citace/);
  assert.doesNotMatch(html, /\u0005/);
  // Bez značek se nic nemění.
  assert.doesNotMatch(naHtml(TELO), /data-blok/);
});

test('Kánon: odkrytí přes Hub a karta v pohledu družiny', async () => {
  const r = await docasneRepo();
  try {
    const soubor = path.join(r.c.kampan, 'postavy', 'leta', 'leta.md');
    await fs.mkdir(path.dirname(soubor), { recursive: true });
    await fs.writeFile(soubor, `---\nschema: 1\nid: leta\ntyp: postava\nnazev: Leta\nverejne: true\n---\n${TELO}`);
    const kanon = new Kanon({ cesty: r.c, zapisovac: new Zapisovac() });
    await kanon.nacist();
    await kanon.prepnoutText('leta', { prvni: '> citace', zna: true });
    const text = await fs.readFile(soubor, 'utf8');
    assert.match(text, /^> citace %%zná%%$/m);
    const k = kanon.karta('leta', 'druzina');
    assert.match(k.telo, /> citace\n> pokračuje/);
    assert.match(k.telo, /- druhá/);
    assert.doesNotMatch(k.telo, /Tajné|Initiative/);
    assert.equal(kanon.karta('leta', 'dm').odkrytoTextu, 3);
    assert.equal(kanon.seznam('druzina').entity.find((e) => e.id === 'leta').popis, 'z oddílu družiny');
    await assert.rejects(kanon.prepnoutText('leta', { prvni: 'Tajné.', zna: true }), (e) => e.status === 409);
    await assert.rejects(kanon.prepnoutText('leta', { prvni: '', zna: true }), /první řádek/);
    await assert.rejects(kanon.prepnoutText('leta', { prvni: '> citace', zna: 'ano' }), /zna/);
  } finally {
    await r.smazat();
  }
});
