// Čtecí verze kánonu pro GitHub Pages: data pro oba pohledy, obrázky, stránka bez úprav.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { sestavitStranky, prepsatAdresy, vyriznout } from '../server/stranky.js';
import { docasneRepo } from './pomoc.js';

async function zapsat(koren, relativni, obsah) {
  const cil = path.join(koren, ...relativni.split('/'));
  await fs.mkdir(path.dirname(cil), { recursive: true });
  await fs.writeFile(cil, obsah);
}

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

test('prepsatAdresy: obrázky z repa jsou relativní a posbírané, odkaz do Obsidianu zmizí', () => {
  const obrazky = new Set();
  const v = prepsatAdresy({ obrazek: '/kampan/mista/tabor/celek-den.png', obsidian: 'obsidian://open?x', text: '/neni-obrazek', s: [{ url: '/Alba.png' }] }, obrazky);
  assert.deepEqual(v, { obrazek: 'kampan/mista/tabor/celek-den.png', obsidian: null, text: '/neni-obrazek', s: [{ url: 'Alba.png' }] });
  assert.deepEqual([...obrazky].sort(), ['/Alba.png', '/kampan/mista/tabor/celek-den.png']);
});

test('vyriznout: prvek podle id až po stejně odsazený konec', () => {
  const html = '<main>\n  <section id="a">\n    <section id="b">\n    </section>\n  </section>\n  <section id="c"></section>\n</main>';
  assert.equal(vyriznout(html, 'section', 'a'), '  <section id="a">\n    <section id="b">\n    </section>\n  </section>');
  assert.throws(() => vyriznout(html, 'dialog', 'x'), /chybí/);
});

test('sestavitStranky: obě pohledy, karta jen pro DM se družině neukáže, obrázky a stránka', async () => {
  const repo = await docasneRepo();
  const cil = path.join(repo.koren, '_site');
  try {
    await zapsat(repo.koren, 'kampan/postavy/tusker/tusker.md', [
      '---', 'schema: 1', 'id: tusker', 'typ: postava', 'nazev: Tusker', 'verejne: true',
      'ilustrace:', '  - soubor: /Tusker.png', '    ucel: portret', '---',
      '## Co ví družina', '', '- Ork, barbar. %%zná%%', '- Tajemství rodu.', '',
    ].join('\n'));
    await zapsat(repo.koren, 'kampan/npc/tajny/tajny.md', ['---', 'schema: 1', 'id: tajny', 'typ: npc', 'nazev: Tajný', 'verejne: false', '---', 'Jen pro DM.', ''].join('\n'));
    await zapsat(repo.koren, 'kampan/mista/tabor/tabor.md', [
      '---', 'schema: 1', 'id: tabor', 'typ: misto', 'nazev: Tábor', 'verejne: true',
      'ilustrace:', '  - soubor: celek-den.png', '    ucel: scena', '---', '',
    ].join('\n'));
    await zapsat(repo.koren, 'kampan/mista/tabor/celek-den.png', PNG);
    await zapsat(repo.koren, 'Tusker.png', PNG);

    const v = await sestavitStranky({ cesty: repo.c, cil, cas: new Date('2026-10-20T08:00:00Z') });
    assert.equal(v.entity, 3);
    assert.equal(v.druzina, 2);
    assert.deepEqual(v.chybiObrazky, []);

    const cist = async (rel) => JSON.parse(await fs.readFile(path.join(cil, ...rel.split('/')), 'utf8'));
    const dm = await cist('data/kanon-dm.json');
    const druzina = await cist('data/kanon-druzina.json');
    assert.deepEqual(dm.entity.map((e) => e.id).sort(), ['tabor', 'tajny', 'tusker']);
    assert.deepEqual(druzina.entity.map((e) => e.id).sort(), ['tabor', 'tusker']);
    await assert.rejects(fs.access(path.join(cil, 'data', 'entita', 'druzina', 'tajny.json')), 'karta jen pro DM v pohledu družiny není');

    const tuskerDruzina = await cist('data/entita/druzina/tusker.json');
    assert.deepEqual(tuskerDruzina.druzina.map((b) => b.text), ['Ork, barbar.'], 'družina vidí jen odkrytou odrážku');
    const tuskerDm = await cist('data/entita/dm/tusker.json');
    assert.equal(tuskerDm.obsidian, null);
    assert.equal(tuskerDm.obrazek, 'Tusker.png');

    await fs.access(path.join(cil, 'Tusker.png'));
    await fs.access(path.join(cil, 'kampan', 'mista', 'tabor', 'celek-den.png'));
    await fs.access(path.join(cil, 'panel', 'kanon.js'));
    await fs.access(path.join(cil, 'sdilene', 'sit.js'));
    await fs.access(path.join(cil, 'app.js'));
    await fs.access(path.join(cil, '.nojekyll'));

    const html = await fs.readFile(path.join(cil, 'index.html'), 'utf8');
    assert.match(html, /<section id="obrazovka-kanon"/);
    assert.match(html, /<dialog id="dialog-nastenka"/);
    assert.match(html, /stav k 20\. 10\. 2026/);
    assert.match(html, /"\/panel\/": "\.\/panel\/"/, 'import map pro moduly panelu');
    assert.doesNotMatch(html, /\{\{|<!-- KANON -->/);
  } finally {
    await repo.smazat();
  }
});
