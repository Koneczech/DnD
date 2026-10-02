import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { rozebrat, upravitHlavicku, odkazy } from '../server/frontmatter.js';
import { kontrolaDat, DataKampane, slug } from '../server/data.js';
import { Zapisovac } from '../server/zapis.js';
import { docasneRepo, STAV_MD } from './pomoc.js';

test('hlavička se rozebere, chyba v YAML se vrátí jako text', () => {
  const r = rozebrat(STAV_MD);
  assert.equal(r.chyba, null);
  assert.equal(r.data.misto, 'Mirabar');
  assert.match(r.telo, /Tělo souboru/);
  assert.match(rozebrat('---\nid: [rozbite\n---\n').chyba, /YAML/);
  assert.match(rozebrat('---\nid: x\n').chyba, /ukončovací/);
  assert.equal(rozebrat('jen text').maHlavicku, false);
});

test('úprava hlavičky zachová komentáře, ostatní klíče i tělo', () => {
  const novy = upravitHlavicku(STAV_MD, { misto: 'Longsaddle' });
  assert.match(novy, /misto: Longsaddle/);
  assert.match(novy, /# komentář, který musí přežít/);
  assert.match(novy, /Tělo souboru, které Hub nesmí přepsat/);
  assert.equal(rozebrat(novy).data.sezeni, 1);
});

test('odkazy [[id]] i s popiskem a nadpisem', () => {
  assert.deepEqual(odkazy('viz [[torva]], [[lurkwood|Lurkwood]] a [[mirabar#trh]]'), ['torva', 'lurkwood', 'mirabar']);
});

test('slug bez diakritiky', () => {
  assert.equal(slug('Krkavčí prapor'), 'krkavci-prapor');
});

test('Kontrola dat najde chyby a rozbitý soubor nezastaví zbytek', async () => {
  const { koren, c, smazat } = await docasneRepo();
  try {
    const k = (rel, text) => fs.mkdir(path.dirname(path.join(c.kampan, rel)), { recursive: true }).then(() => fs.writeFile(path.join(c.kampan, rel), text));
    await k('npc/torva/torva.md', '---\nschema: 1\nid: torva\ntyp: npc\nnazev: Torva\nverejne: true\nvazby: ["[[lurkwood]]"]\nilustrace:\n  - soubor: /monsters/torva.png\n---\nViz [[neexistuje]].\n');
    await k('mista/lurkwood/lurkwood.md', '---\nschema: 1\nid: lurkwood\ntyp: misto\nnazev: Lurkwood\nverejne: true\n---\n');
    await k('npc/rozbity/rozbity.md', '---\nid: [rozbite\n---\n');
    await k('npc/dvojnik.md', '---\nschema: 1\nid: torva\ntyp: misto\nnazev: X\nverejne: ano\n---\n');
    await k('npc/torva/poznamky.md', 'vedlejší soubor bez hlavičky se nekontroluje');

    const { problemy, entity } = await kontrolaDat(c);
    const text = (soubor) => problemy.filter((p) => p.soubor === `kampan/${soubor}`).map((p) => p.zprava).join(' | ');
    assert.equal(entity, 3);
    assert.match(text('npc/rozbity/rozbity.md'), /YAML/);
    assert.match(text('npc/dvojnik.md'), /neodpovídá jménu/);
    assert.match(text('npc/dvojnik.md'), /nepatří do složky npc/);
    assert.match(text('npc/dvojnik.md'), /verejne/);
    assert.match(text('npc/torva/torva.md'), /Duplicitní id/);
    assert.match(text('npc/torva/torva.md'), /\[\[neexistuje\]\]/);
    assert.match(text('npc/torva/torva.md'), /monsters\/torva\.png neexistuje/);
    assert.doesNotMatch(text('npc/torva/torva.md'), /lurkwood/);
    assert.equal(text('npc/torva/poznamky.md'), '');
    assert.equal(text('stav.md'), '');
    assert.ok(koren);
  } finally {
    await smazat();
  }
});

test('Kontrola dat hlásí chybný stav.md a chybějící kampan.yaml', async () => {
  const { c, smazat } = await docasneRepo();
  try {
    await fs.writeFile(c.stav, '---\nschema: 1\ndatum: 5\nmisto: x\nsezeni: -1\n---\n');
    await fs.rm(c.kampanYaml);
    const { problemy } = await kontrolaDat(c);
    const zpravy = problemy.map((p) => `${p.soubor}: ${p.zprava}`).join('\n');
    assert.match(zpravy, /stav\.md: datum musí být text/);
    assert.match(zpravy, /stav\.md: sezeni musí být/);
    assert.match(zpravy, /kampan\.yaml: Soubor chybí/);
  } finally {
    await smazat();
  }
});

test('DataKampane: změna z panelu se zapíše, rozbitý soubor zvenku nechá poslední platný stav', async () => {
  const { c, smazat } = await docasneRepo();
  const data = new DataKampane({ cesty: c, zapisovac: new Zapisovac() });
  try {
    await data.nacist();
    assert.equal(data.stav.misto, 'Mirabar');
    const { vysledek } = await data.zmenitStav({ misto: 'Longsaddle', sezeni: 2 });
    assert.equal(vysledek, 'zapsano');
    const naDisku = rozebrat(await fs.readFile(c.stav, 'utf8')).data;
    assert.equal(naDisku.misto, 'Longsaddle');
    assert.equal(naDisku.sezeni, 2);

    // Ozvěna vlastního zápisu se ignoruje
    let udalosti = 0;
    data.on('stav', () => udalosti++);
    await data.souborZmenen(c.stav);
    assert.equal(udalosti, 0);

    // Rozbitý soubor zvenku: chyba se ohlásí, poslední platný stav zůstane
    await fs.writeFile(c.stav, '---\nmisto: [\n---\n');
    await data.souborZmenen(c.stav);
    assert.ok(data.chybaStavu);
    assert.equal(data.stav.misto, 'Longsaddle');

    await assert.rejects(data.zmenitStav({ sezeni: -3 }), /sezeni/);
  } finally {
    await smazat();
  }
});
