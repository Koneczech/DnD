import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cilPolozky, idNotionu, nacistMapu, overitMapu, reportPrevodu } from '../server/kanon.js';
import { docasneRepo } from './pomoc.js';
import { overVztahy } from '../server/data.js';

const KOREN_REPA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const N1 = 'https://app.notion.com/p/3c49ed22673681139ec6d006048ae511';
const N2 = 'https://app.notion.com/p/3c79ed22673681b7a4ede5a64cedd138';
const N3 = 'https://app.notion.com/p/3c69ed22673681dabd51e322ab619412';

const mapa = () => ({
  schema: 1,
  skupiny: [
    { id: 'npc', nazev: 'NPC', poradi: 2 },
    { id: 'mista', nazev: 'Místa', poradi: 1 },
    { id: 'rozhodnuti', nazev: 'Rozhodnutí', poradi: 3 },
  ],
  polozky: [
    { id: 'grimsdal', typ: 'npc', nazev: 'Grimsdal', skupina: 'npc', akce: 'prevest', zdroj: N1, vazby: ['mirabar'] },
    { id: 'corvain', typ: 'npc', nazev: 'Corvain', skupina: 'npc', akce: 'prevest', zdroj: N2 },
    { id: 'vzor', typ: 'vzor', nazev: 'Vzor', skupina: 'npc', akce: 'vynechat', zdroj: 'x', proc: 'Vzorová data.' },
    { id: 'malk', typ: 'npc', nazev: 'Malk', skupina: 'npc', akce: 'doplnit', zdroj: 'chat' },
    { id: 'mirabar', typ: 'misto', nazev: 'Mirabar', skupina: 'mista', akce: 'sloucit', do: 'kampan/mista/mirabar/mirabar.md', zdroj: N3 },
    { id: 'cesta', typ: 'misto', nazev: 'Cesta', skupina: 'mista', akce: 'ponechat', zdroj: 'Blok 2' },
    { id: 'jmeno-radniho', typ: 'rozhodnuti', nazev: 'Jméno radního', skupina: 'rozhodnuti', akce: 'prevest', zdroj: 'https://app.notion.com/p/3c69ed22673681e5a790d37b3d332974' },
  ],
});

const entita = (typ, id, zdroj, telo = '') => `---\nschema: 1\nid: ${id}\ntyp: ${typ}\nnazev: ${id}\nverejne: false\n${zdroj ? `zdroj: ${zdroj}\n` : ''}---\n${telo}\n`;

async function zapis(koren, rel, text) {
  const cesta = path.join(koren, ...rel.split('/'));
  await fs.mkdir(path.dirname(cesta), { recursive: true });
  await fs.writeFile(cesta, text);
}

test('cíl položky: entita do složky, záznam do souboru, sloučení a vlastní cíl', () => {
  assert.equal(cilPolozky({ id: 'torva', typ: 'npc' }), 'kampan/npc/torva/torva.md');
  assert.equal(cilPolozky({ id: 'tema', typ: 'rozhodnuti' }), 'kampan/rozhodnuti/tema.md');
  assert.equal(cilPolozky({ id: 's01', typ: 'sezeni' }), 'kampan/sezeni/s01/s01.md');
  assert.equal(cilPolozky({ id: 'x', typ: 'misto', do: 'kampan/mista/a/a.md' }), 'kampan/mista/a/a.md');
  assert.equal(cilPolozky({ id: 'p', typ: 'sablona', cil: 'sablony/p.md' }), 'sablony/p.md');
  assert.equal(cilPolozky({ id: 'f', typ: 'odkaz' }), null);
});

test('id Notionu z odkazu i s pomlčkami', () => {
  assert.equal(idNotionu(N1), '3c49ed22673681139ec6d006048ae511');
  assert.equal(idNotionu('https://www.notion.so/Torva-3c89ed22-6736-817f-8a77-fc1a9dc59199?pvs=4'), '3c89ed226736817f8a77fc1a9dc59199');
  assert.equal(idNotionu('chat'), null);
});

test('ověření mapy najde duplicitní id, neznámou skupinu, vynechání bez důvodu a dvakrát použitou kartu', () => {
  const m = mapa();
  m.polozky.push({ id: 'grimsdal', typ: 'npc', nazev: 'x', skupina: 'npc', akce: 'prevest' });
  m.polozky.push({ id: 'jiny', typ: 'npc', nazev: 'x', skupina: 'nic', akce: 'prevest', zdroj: N2 });
  m.polozky.push({ id: 'bez-duvodu', typ: 'npc', nazev: 'x', skupina: 'npc', akce: 'vynechat' });
  m.polozky.push({ id: 'Spatne Id', typ: 'npc', nazev: 'x', skupina: 'npc', akce: 'nevim' });
  const { chyby, varovani } = overitMapu(m);
  assert.ok(chyby.some((c) => c.includes('Duplicitní id „grimsdal“')));
  assert.ok(chyby.some((c) => c.includes('neznámá skupina „nic“')));
  assert.ok(chyby.some((c) => c.includes('bez-duvodu') && c.includes('proc')));
  assert.ok(chyby.some((c) => c.includes('Spatne Id') && c.includes('slug')));
  assert.ok(chyby.some((c) => c.includes('neznámá akce „nevim“')));
  assert.ok(chyby.some((c) => c.includes('je v mapě dvakrát')));
  assert.deepEqual(varovani, []);
});

test('report: nezačato, rozpracováno a hotovo podle souborů v kampan/', async () => {
  const { koren, smazat } = await docasneRepo();
  try {
    await zapis(koren, 'kampan/mista/mirabar/mirabar.md', entita('misto', 'mirabar', null, '# Mirabar\n\nPopis místa doplní DM.'));
    await zapis(koren, 'kampan/mista/cesta/cesta.md', entita('misto', 'cesta'));

    let r = await reportPrevodu({ koren, mapa: mapa() });
    assert.deepEqual(r.skupiny.map((s) => s.id), ['mista', 'npc', 'rozhodnuti'], 'skupiny podle pořadí');
    const npc = r.skupiny.find((s) => s.id === 'npc');
    assert.equal(npc.stav, 'nezačato');
    assert.equal(npc.zdroj.celkem, 4);
    assert.equal(npc.zdroj.prevest, 2);
    assert.deepEqual(npc.zdroj.vynechat.map((x) => x.id), ['vzor']);
    assert.deepEqual(npc.zdroj.doplnit.map((x) => x.id), ['malk']);
    const mista = r.skupiny.find((s) => s.id === 'mista');
    assert.equal(mista.chybi.length, 1, 'sloučení bez odkazu na kartu není hotové');
    assert.equal(mista.chybi[0].sloucit, true);

    // Jeden převedený soubor se zdrojem, druhý bez něj a s vazbou na neexistující id.
    await zapis(koren, 'kampan/npc/grimsdal/grimsdal.md', entita('npc', 'grimsdal', N1, 'Viz [[mirabar]].'));
    await zapis(koren, 'kampan/npc/corvain/corvain.md', entita('npc', 'corvain', null, 'Viz [[neexistuje]].'));
    await zapis(koren, 'kampan/npc/navic/navic.md', entita('npc', 'navic', null));
    r = await reportPrevodu({ koren, mapa: mapa() });
    const npc2 = r.skupiny.find((s) => s.id === 'npc');
    assert.equal(npc2.stav, 'rozpracováno');
    assert.deepEqual(npc2.hotovo.map((x) => x.id).sort(), ['corvain', 'grimsdal']);
    assert.deepEqual(npc2.bezZdroje.map((x) => x.id), ['corvain']);
    assert.ok(npc2.problemy.some((p) => p.id === 'corvain' && p.zprava.includes('[[neexistuje]]')));
    assert.deepEqual(npc2.navic, ['kampan/npc/navic/navic.md']);

    // Oprava: zdroj doplněn, odkaz opraven, soubor navíc pryč → hotovo.
    await zapis(koren, 'kampan/npc/corvain/corvain.md', entita('npc', 'corvain', N2.replace('https://app.notion.com/p/', 'https://www.notion.so/Corvain-'), 'Viz [[grimsdal]].'));
    await fs.rm(path.join(koren, 'kampan', 'npc', 'navic'), { recursive: true });
    await zapis(koren, 'kampan/mista/mirabar/mirabar.md', entita('misto', 'mirabar', N3, '# Mirabar'));
    r = await reportPrevodu({ koren, mapa: mapa() });
    assert.equal(r.skupiny.find((s) => s.id === 'npc').stav, 'hotovo');
    assert.equal(r.skupiny.find((s) => s.id === 'mista').stav, 'hotovo');

    // Špatný typ v souboru se ohlásí.
    await zapis(koren, 'kampan/rozhodnuti/jmeno-radniho.md', entita('kanon', 'jmeno-radniho', 'https://app.notion.com/p/3c69ed22673681e5a790d37b3d332974'));
    r = await reportPrevodu({ koren, mapa: mapa() });
    const roz = r.skupiny.find((s) => s.id === 'rozhodnuti');
    assert.ok(roz.nesedi.some((x) => x.zprava.includes('typ v souboru je „kanon“')));
    assert.equal(roz.stav, 'rozpracováno');
  } finally {
    await smazat();
  }
});

test('mapa převodu v repu je platná a pokrývá Notion bez duplicit', async () => {
  const m = await nacistMapu(path.join(KOREN_REPA, 'reference', 'kanon-mapa.yaml'));
  const { chyby, varovani } = overitMapu(m);
  assert.deepEqual(chyby, []);
  // Vazby smí vést jen na položky mapy (včetně míst, která už v repu jsou).
  assert.deepEqual(varovani, []);
  // Každá položka ve skupině převodu má cíl a každé vynechání vysvětlení (akceptace Bloku 3).
  for (const p of m.polozky) {
    if (['prevest', 'sloucit', 'ponechat'].includes(p.akce)) assert.ok(cilPolozky(p), `${p.id} nemá cíl`);
  }
});

test('Kontrola dat hlídá stav rozhodnutí', async () => {
  const { koren, c, smazat } = await docasneRepo();
  try {
    const { kontrolaDat } = await import('../server/data.js');
    await zapis(koren, 'kampan/rozhodnuti/tema.md', `---\nschema: 1\nid: tema\ntyp: rozhodnuti\nnazev: Téma\nverejne: false\nstav: rozhodnuto\n---\n`);
    await zapis(koren, 'kampan/rozhodnuti/spatne.md', `---\nschema: 1\nid: spatne\ntyp: rozhodnuti\nnazev: Špatně\nverejne: false\nstav: Rozhodnuto\n---\n`);
    const k = await kontrolaDat(c);
    const zpravy = k.problemy.filter((p) => p.soubor.startsWith('kampan/rozhodnuti/'));
    assert.equal(zpravy.length, 1);
    assert.equal(zpravy[0].soubor, 'kampan/rozhodnuti/spatne.md');
    assert.match(zpravy[0].zprava, /otevrene, rozhodnuto, zavrzeno/);
  } finally {
    await smazat();
  }
});

test('vztahy: formát, postoj −3 až 3 a cíl ve vazby', () => {
  const ok = overVztahy({ vazby: ['[[dorn-treestone]]'], vztahy: [{ s: '[[dorn-treestone]]', popis: 'adoptivní otec', postoj: 3, verejne: true }] });
  assert.deepEqual(ok, { problemy: [], cile: ['dorn-treestone'] });
  assert.deepEqual(overVztahy({}).problemy, []);
  assert.deepEqual(overVztahy({ vztahy: [] }).problemy, []);

  const zpravy = (data) => overVztahy(data).problemy.map((p) => `${p.uroven}: ${p.zprava}`);
  assert.deepEqual(zpravy({ vztahy: 'dorn' }), ['chyba: vztahy musí být seznam']);
  // Odkaz bez uvozovek YAML přečte jako vnořený seznam.
  assert.match(zpravy({ vztahy: [{ s: [['dorn']], popis: 'x' }] })[0], /odkaz v uvozovkách/);
  const z = zpravy({ vazby: [], vztahy: [{ s: '[[bruna|Bruna]]', postoj: 5, verejne: 'ano' }, 'text'] });
  assert.ok(z.some((x) => x.startsWith('chyba') && x.includes('chybí popis')));
  assert.ok(z.some((x) => x.includes('postoj musí být celé číslo')));
  assert.ok(z.some((x) => x.includes('verejne musí být')));
  assert.ok(z.some((x) => x.startsWith('varovani') && x.includes('[[bruna]] chybí ve vazby')));
  assert.ok(z.some((x) => x.startsWith('chyba: Vztah 2')));
  assert.ok(zpravy({ vztahy: [{ s: '[[a]]', popis: 'x', postoj: 1.5 }] }).some((x) => x.includes('postoj')));
});

test('Kontrola dat hlásí vztah na neexistující id', async () => {
  const { c, smazat } = await docasneRepo();
  try {
    const { kontrolaDat } = await import('../server/data.js');
    const hlavicka = (id, navic) => `---\nschema: 1\nid: ${id}\ntyp: npc\nnazev: ${id}\nverejne: false\n${navic}---\n`;
    await zapis(c.koren, 'kampan/npc/dorn/dorn.md', hlavicka('dorn', ''));
    await zapis(c.koren, 'kampan/npc/vendla/vendla.md', hlavicka('vendla', 'vazby: ["[[dorn]]", "[[nikdo]]"]\nvztahy:\n  - { s: "[[dorn]]", popis: manžel, postoj: 2 }\n  - { s: "[[nikdo]]", popis: soused }\n'));
    const k = await kontrolaDat(c);
    const zpravy = k.problemy.filter((p) => p.soubor === 'kampan/npc/vendla/vendla.md').map((p) => p.zprava);
    assert.deepEqual(zpravy, ['Vazba [[nikdo]] vede na neexistující id']);
  } finally {
    await smazat();
  }
});
