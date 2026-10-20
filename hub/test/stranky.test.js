// Čtecí verze kánonu pro GitHub Pages: data pro oba pohledy, obrázky, stránka bez úprav.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { sestavitStranky, prepsatAdresy, vyriznout, zasifrovat, rozsifrovat } from '../server/stranky.js';
import { docasneRepo } from './pomoc.js';

async function zapsat(koren, relativni, obsah) {
  const cil = path.join(koren, ...relativni.split('/'));
  await fs.mkdir(path.dirname(cil), { recursive: true });
  await fs.writeFile(cil, obsah);
}

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

test('prepsatAdresy: obrázky z repa přepíše, odkaz do Obsidianu zmizí', () => {
  const obrazky = new Set();
  const v = prepsatAdresy({ obrazek: '/kampan/mista/tabor/celek-den.png', obsidian: 'obsidian://open?x', text: '/neni-obrazek', s: [{ url: '/Alba.png' }] }, (a) => {
    obrazky.add(a);
    return a.slice(1);
  });
  assert.deepEqual(v, { obrazek: 'kampan/mista/tabor/celek-den.png', obsidian: null, text: '/neni-obrazek', s: [{ url: 'Alba.png' }] });
  assert.deepEqual([...obrazky].sort(), ['/Alba.png', '/kampan/mista/tabor/celek-den.png']);
});

test('zasifrovat: jen se správným heslem, data se vrátí beze změny', () => {
  const heslo = `zkusebni-${Math.random().toString(36).slice(2)}`;
  const soubor = zasifrovat({ a: 'Tajný Ž', b: [1, 2] }, heslo);
  assert.deepEqual(rozsifrovat(soubor, heslo), { a: 'Tajný Ž', b: [1, 2] });
  assert.throws(() => rozsifrovat(soubor, `${heslo}x`));
  assert.ok(!Buffer.from(soubor.data, 'base64').toString('latin1').includes('Tajn'), 'text není čitelný');
});

test('vyriznout: prvek podle id až po stejně odsazený konec', () => {
  const html = '<main>\n  <section id="a">\n    <section id="b">\n    </section>\n  </section>\n  <section id="c"></section>\n</main>';
  assert.equal(vyriznout(html, 'section', 'a'), '  <section id="a">\n    <section id="b">\n    </section>\n  </section>');
  assert.throws(() => vyriznout(html, 'dialog', 'x'), /chybí/);
});

test('sestavitStranky: družina otevřeně, DM jen zašifrovaně, obrázky jen pro DM z repa', async () => {
  const repo = await docasneRepo();
  const cil = path.join(repo.koren, '_site');
  try {
    await zapsat(repo.koren, 'kampan/postavy/tusker/tusker.md', [
      '---', 'schema: 1', 'id: tusker', 'typ: postava', 'nazev: Tusker', 'verejne: true',
      'ilustrace:', '  - soubor: /Tusker.png', '    ucel: portret', '---',
      '## Co ví družina', '', '- Ork, barbar. %%zná%%', '- Tajemství rodu.', '',
    ].join('\n'));
    await zapsat(repo.koren, 'kampan/npc/tajny/tajny.md', ['---', 'schema: 1', 'id: tajny', 'typ: npc', 'nazev: Tajný', 'verejne: false', 'ilustrace:', '  - soubor: portret.png', '    ucel: portret', '---', 'Jen pro DM.', ''].join('\n'));
    await zapsat(repo.koren, 'kampan/npc/tajny/portret.png', PNG);
    await zapsat(repo.koren, 'kampan/mista/tabor/tabor.md', [
      '---', 'schema: 1', 'id: tabor', 'typ: misto', 'nazev: Tábor', 'verejne: true',
      'ilustrace:', '  - soubor: celek-den.png', '    ucel: scena', '---', '',
    ].join('\n'));
    await zapsat(repo.koren, 'kampan/mista/tabor/celek-den.png', PNG);
    await zapsat(repo.koren, 'Tusker.png', PNG);

    const heslo = `zkusebni-${Math.random().toString(36).slice(2)}`;
    const v = await sestavitStranky({ cesty: repo.c, cil, cas: new Date('2026-10-20T08:00:00Z'), heslo, repo: 'Ukazka/Repo', vetev: 'main' });
    assert.equal(v.entity, 3);
    assert.equal(v.druzina, 2);
    assert.equal(v.dm, true);
    assert.deepEqual(v.chybiObrazky, []);

    const cist = async (rel) => JSON.parse(await fs.readFile(path.join(cil, ...rel.split('/')), 'utf8'));
    assert.deepEqual(await cist('data/stranky.json'), { dm: true });
    const druzina = await cist('data/kanon-druzina.json');
    assert.deepEqual(druzina.entity.map((e) => e.id).sort(), ['tabor', 'tusker']);
    await assert.rejects(fs.access(path.join(cil, 'data', 'entita', 'druzina', 'tajny.json')), 'karta jen pro DM v pohledu družiny není');
    await assert.rejects(fs.access(path.join(cil, 'data', 'kanon-dm.json')), 'pohled DM není otevřeně');
    await assert.rejects(fs.access(path.join(cil, 'data', 'entita', 'dm')), 'karty DM nejsou otevřeně');

    const tuskerDruzina = await cist('data/entita/druzina/tusker.json');
    assert.deepEqual(tuskerDruzina.druzina.map((b) => b.text), ['Ork, barbar.'], 'družina vidí jen odkrytou odrážku');

    const sifrovane = await cist('data/dm.json');
    const dm = rozsifrovat(sifrovane, heslo);
    assert.deepEqual(dm.seznam.entity.map((e) => e.id).sort(), ['tabor', 'tajny', 'tusker']);
    assert.equal(dm.karty.tusker.obsidian, null);
    assert.equal(dm.karty.tusker.obrazek, 'Tusker.png', 'obrázek, který zná družina, je na webu');
    assert.equal(dm.karty.tajny.obrazek, 'https://raw.githubusercontent.com/Ukazka/Repo/main/kampan/npc/tajny/portret.png', 'obrázek jen pro DM z repa');
    assert.equal(dm.karty.tusker.druzina.length, 2, 'DM vidí i skrytou odrážku');
    const vsechno = (await fs.readFile(path.join(cil, 'data', 'kanon-druzina.json'), 'utf8')) + JSON.stringify(sifrovane);
    assert.ok(!vsechno.includes('Tajný') && !vsechno.includes('Tajemství rodu'), 'nic jen pro DM není čitelné');

    await assert.rejects(fs.access(path.join(cil, 'kampan', 'npc', 'tajny', 'portret.png')), 'obrázek jen pro DM se nekopíruje');
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

test('sestavitStranky bez hesla: jen pohled družiny', async () => {
  const repo = await docasneRepo();
  const cil = path.join(repo.koren, '_site');
  try {
    await zapsat(repo.koren, 'kampan/npc/tajny/tajny.md', ['---', 'schema: 1', 'id: tajny', 'typ: npc', 'nazev: Tajný', 'verejne: false', '---', 'Jen pro DM.', ''].join('\n'));
    const v = await sestavitStranky({ cesty: repo.c, cil });
    assert.equal(v.dm, false);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(cil, 'data', 'stranky.json'), 'utf8')), { dm: false });
    await assert.rejects(fs.access(path.join(cil, 'data', 'dm.json')));
    await fs.access(path.join(cil, 'data', 'kanon-druzina.json'));
  } finally {
    await repo.smazat();
  }
});
