// Rozložení mapy kánonu podle os (⚠ návrhy 134–141): výpočty bez prohlížeče.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROZLOZENI, POCITANA, ucastNaUdalostech, kdyAKde, kdoAKdy, vzdalenosti, kruhyBlizkosti, postojKDruzine, osaPostoje, urovenZnalosti, znalost, jeOtevrene, vlakna, prostrednost } from '../sdilene/rozlozeni.js';

const E = (id, typ, x = {}) => ({ id, typ, nazev: x.nazev ?? id, vazby: [], vztahy: [], kdo: [], verejne: true, odkryto: { zna: 0, celkem: 0 }, udaje: {}, ...x });
const entity = [
  E('alba', 'postava'),
  E('koudur', 'postava', { vztahy: [{ s: 'torva', postoj: -3 }] }),
  E('mirabar', 'misto'),
  E('lurkwood', 'misto'),
  E('tabor', 'misto', { leziV: 'lurkwood' }),
  E('torva', 'npc', { vztahy: [{ s: 'alba', postoj: -1 }] }),
  E('malk', 'npc', { vztahy: [{ s: 'koudur', postoj: 2 }], verejne: false }),
  E('k-kradez', 'kanon', { vazby: ['mirabar', 'koudur'], kdo: ['koudur'] }),
  E('k-boj', 'kanon', { vazby: ['tabor', 'torva'], kdo: ['parta'], udaje: { doresit: 'ano' } }),
  E('k-nic', 'kanon'),
  E('r-otevrene', 'rozhodnuti', { udaje: { stav: 'otevrene' } }),
];
const podleId = new Map(entity.map((e) => [e.id, e]));
const najit = (id) => podleId.get(id);
// Tábor je sbalený do Lurkwoodu.
const zast = (id) => (id === 'tabor' ? 'lurkwood' : id);
const udalosti = [
  { id: 'u1', text: 'Opuštění Mirabaru', vazby: ['k-kradez'] },
  { id: 'u2', text: 'Setkání s Torvou', vazby: ['k-boj', 'alba'] },
  { id: 'u3', text: 'Longsaddle', vazby: [] },
];
const viditelne = new Set(entity.filter((e) => e.id !== 'tabor').map((e) => e.id));

test('seznam rozložení: síť první, Co družina ví jen DM, počítaná mají výpočet', () => {
  assert.equal(ROZLOZENI[0].id, 'sit');
  assert.equal(ROZLOZENI.find((r) => r.id === 'znalost').jenDm, true);
  for (const id of POCITANA) assert.ok(ROZLOZENI.some((r) => r.id === id));
});

test('účast na událostech: přímo i přes hráčský kánon, přes zástupce sbaleného místa', () => {
  const u = ucastNaUdalostech(udalosti, najit, zast);
  assert.deepEqual(u.get('mirabar'), [0]);
  assert.deepEqual(u.get('lurkwood'), [1]);
  assert.deepEqual(u.get('koudur'), [0]);
  assert.deepEqual(u.get('alba'), [1]);
  assert.equal(u.has('tabor'), false);
  assert.equal(u.has('k-nic'), false);
});

test('Kdy a kde: místa podle první návštěvy, kánon v buňce svého místa, trasa', () => {
  const v = kdyAKde({ udalosti, viditelne, najit, zast });
  const kradez = v.pozice.get('k-kradez');
  const boj = v.pozice.get('k-boj');
  assert.equal(kradez.x, 0);
  assert.equal(boj.x, 210);
  // Řádek Mirabar je nad Lurkwoodem, kánon stojí ve výšce svého místa.
  assert.ok(v.pozice.get('mirabar').y < v.pozice.get('lurkwood').y);
  assert.equal(kradez.y, v.pozice.get('mirabar').y);
  assert.equal(boj.y, v.pozice.get('lurkwood').y);
  assert.equal(v.pozice.has('torva'), false);
  assert.equal(v.udalosti.size, 3);
  assert.ok(v.dekorace.some((d) => d.druh === 'cesta' && d.body.length === 2));
  assert.equal(v.bezHran, true);
});

test('Kdo a kdy: kánon jedné postavy v jejím řádku, „parta“ v Celá družina, značky účasti', () => {
  const v = kdoAKdy({ udalosti, viditelne, najit });
  assert.equal(v.pozice.get('k-kradez').y, v.pozice.get('koudur').y);
  const druzina = v.dekorace.find((d) => d.text === 'Celá družina');
  assert.ok(druzina);
  assert.ok(v.pozice.get('k-boj').y < v.pozice.get('alba').y);
  // Koudur byl u obou událostí (krádež, boj partou): značky a čára účasti.
  assert.ok(v.dekorace.some((d) => d.trida === 'cara-ucasti' && d.y1 === v.pozice.get('koudur').y));
});

test('blízkost: vzdálenost po vazbách od postav, kruhy, nedosažitelné mimo', () => {
  const dvojice = [['alba', 'k-boj'], ['k-boj', 'torva'], ['koudur', 'k-kradez'], ['k-kradez', 'mirabar']];
  const { d } = vzdalenosti([...viditelne], dvojice, ['alba', 'koudur']);
  assert.equal(d.get('torva'), 2);
  assert.equal(d.get('mirabar'), 2);
  assert.equal(d.has('malk'), false);
  const v = kruhyBlizkosti({ viditelne, dvojice, najit });
  const r = (id) => Math.round(Math.hypot(v.pozice.get(id).x, v.pozice.get(id).y));
  assert.ok(r('alba') < r('k-boj'));
  assert.ok(r('k-boj') < r('torva'));
  assert.equal(r('torva'), r('mirabar'));
  assert.ok(v.tlumene.has('malk'));
  assert.ok(r('malk') > r('torva'));
});

test('postoj k družině: průměr obou směrů, osa −3 až +3, bez postoje dole', () => {
  assert.equal(postojKDruzine(najit('torva'), ['alba', 'koudur'], najit), -2);
  assert.equal(postojKDruzine(najit('malk'), ['alba', 'koudur'], najit), 2);
  assert.equal(postojKDruzine(najit('mirabar'), ['alba', 'koudur'], najit), null);
  const v = osaPostoje({ viditelne, najit, poradiTypu: ['postava', 'npc', 'misto', 'kanon', 'rozhodnuti'] });
  assert.ok(v.pozice.get('torva').x < 0 && v.pozice.get('malk').x > 0);
  assert.ok(v.tlumene.has('mirabar'));
  assert.ok(v.pozice.get('mirabar').y > v.pozice.get('torva').y);
  assert.ok(v.pozice.get('alba').y < v.pozice.get('torva').y);
});

test('co družina ví: úrovně podle odkrytých odrážek, nahoře vše', () => {
  assert.equal(urovenZnalosti(E('a', 'npc', { verejne: false })), 0);
  assert.equal(urovenZnalosti(E('a', 'npc')), 1);
  assert.equal(urovenZnalosti(E('a', 'npc', { odkryto: { zna: 1, celkem: 4 } })), 2);
  assert.equal(urovenZnalosti(E('a', 'npc', { odkryto: { zna: 2, celkem: 4 } })), 3);
  assert.equal(urovenZnalosti(E('a', 'npc', { odkryto: { zna: 3, celkem: 4 } })), 4);
  assert.equal(urovenZnalosti(E('a', 'npc', { odkryto: { zna: 4, celkem: 4 } })), 5);
  const vse = new Map([...podleId, ['zname', E('zname', 'npc', { odkryto: { zna: 2, celkem: 2 } })]]);
  const v = znalost({ viditelne: new Set(['malk', 'torva', 'zname']), najit: (id) => vse.get(id), poradiTypu: ['npc'], nazvyTypu: { npc: 'NPC' } });
  assert.ok(v.pozice.get('zname').y < v.pozice.get('torva').y);
  assert.ok(v.pozice.get('torva').y < v.pozice.get('malk').y);
  assert.ok(v.tlumene.has('malk'));
});

test('zapomenutá vlákna: sloupec podle poslední události, Nikdy vlevo, otevřená zvýrazněná', () => {
  assert.equal(jeOtevrene(najit('r-otevrene')), true);
  assert.equal(jeOtevrene(najit('k-boj')), true);
  assert.equal(jeOtevrene(najit('k-kradez')), false);
  const v = vlakna({ udalosti, viditelne, najit, zast, poradiTypu: ['postava', 'npc', 'misto', 'kanon', 'rozhodnuti'] });
  assert.ok(v.pozice.get('malk').x < v.pozice.get('mirabar').x);
  assert.ok(v.pozice.get('mirabar').x < v.pozice.get('lurkwood').x);
  assert.ok(v.zvyraznene.has('r-otevrene') && v.zvyraznene.has('k-boj'));
});

test('mosty: prostřednost je největší u uzlu, přes který vede jediná cesta', () => {
  // a — b — c — d, b a c jsou mosty, krajní ne.
  const p = prostrednost(['a', 'b', 'c', 'd'], [['a', 'b'], ['b', 'c'], ['c', 'd']]);
  assert.equal(p.get('a'), 0);
  assert.equal(p.get('b'), 1);
  assert.equal(p.get('c'), 1);
  // Hvězda: střed je jediný most.
  const h = prostrednost(['s', 'x', 'y', 'z'], [['s', 'x'], ['s', 'y'], ['s', 'z']]);
  assert.equal(h.get('s'), 1);
  assert.equal(h.get('x'), 0);
});

test('seznam kánonu nese kdo a kolik je odkryto (DM), družina kdo jen u hráčského kánonu', async () => {
  const { docasneRepo } = await import('./pomoc.js');
  const { Kanon } = await import('../server/kanon-modul.js');
  const { Zapisovac } = await import('../server/zapis.js');
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const r = await docasneRepo();
  try {
    const zapsat = async (rel, text) => {
      await fs.mkdir(path.dirname(path.join(r.c.kampan, rel)), { recursive: true });
      await fs.writeFile(path.join(r.c.kampan, rel), text);
    };
    await zapsat('npc/dorn/dorn.md', '---\nschema: 1\nid: dorn\ntyp: npc\nnazev: Dorn\nverejne: true\nkdo: [tajne]\n---\n# Dorn\n\n## Co ví družina\n\n- jedna %%zná%%\n- druhá\n- třetí\n');
    await zapsat('kanon/k1.md', '---\nschema: 1\nid: k1\ntyp: kanon\nnazev: K1\nverejne: true\nkdo: [parta]\n---\n## Co se stalo\n');
    const k = new Kanon({ cesty: r.c, zapisovac: new Zapisovac() });
    await k.nacist();
    const dm = k.seznam('dm').entity;
    assert.deepEqual(dm.find((e) => e.id === 'dorn').odkryto, { zna: 1, celkem: 3 });
    const druzina = k.seznam('druzina').entity;
    assert.deepEqual(druzina.find((e) => e.id === 'k1').kdo, ['parta']);
    assert.deepEqual(druzina.find((e) => e.id === 'dorn').kdo, []);
    assert.equal(druzina.find((e) => e.id === 'dorn').odkryto, null);
  } finally {
    await r.smazat();
  }
});
