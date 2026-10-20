// Mapa kánonu: výběr víc uzlů — uspořádání (kruh, mřížka), výběr obdélníkem, hromadné přepínače.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { doKruhu, doMrizky, vObdelniku } from '../sdilene/sit.js';
import { Kanon } from '../server/kanon-modul.js';
import { Zapisovac } from '../server/zapis.js';
import { Hub } from '../server/app.js';
import { docasneRepo, FalesnyObs } from './pomoc.js';

const pozice = new Map([
  ['a', { x: 0, y: 0 }],
  ['b', { x: 100, y: 0 }],
  ['c', { x: 100, y: 100 }],
  ['d', { x: 0, y: 100 }],
  ['e', { x: 500, y: 500 }],
]);

test('výběr obdélníkem: uzly se středem uvnitř, rohy v libovolném pořadí', () => {
  assert.deepEqual(vObdelniku(pozice, { x: -10, y: -10 }, { x: 110, y: 50 }).sort(), ['a', 'b']);
  assert.deepEqual(vObdelniku(pozice, { x: 110, y: 110 }, { x: -10, y: -10 }).sort(), ['a', 'b', 'c', 'd']);
  assert.deepEqual(vObdelniku(pozice, { x: 200, y: 200 }, { x: 300, y: 300 }), []);
});

test('kruh: kolem těžiště výběru, stejné vzdálenosti, první nahoře', () => {
  const k = doKruhu(['a', 'b', 'c', 'd'], pozice);
  assert.equal(k.size, 4);
  const stred = { x: 50, y: 50 };
  const vzdalenosti = [...k.values()].map((p) => Math.round(Math.hypot(p.x - stred.x, p.y - stred.y)));
  assert.ok(vzdalenosti.every((v) => Math.abs(v - vzdalenosti[0]) <= 1));
  assert.ok(k.get('a').y < stred.y && Math.abs(k.get('a').x - stred.x) <= 1);
  assert.deepEqual(doKruhu(['e'], pozice).get('e'), { x: 500, y: 500 });
  // Víc uzlů = větší kruh, ať se nepřekrývají.
  const mnoho = new Map(Array.from({ length: 20 }, (_, i) => [`u${i}`, { x: i, y: 0 }]));
  const r20 = Math.hypot(...Object.values(doKruhu([...mnoho.keys()], mnoho).get('u0')).map((v, i) => v - [9.5, 0][i]));
  assert.ok(r20 > Math.hypot(k.get('a').x - 50, k.get('a').y - 50));
});

test('mřížka: řádky od levého horního rohu výběru, bez překryvu', () => {
  const m = doMrizky(['a', 'b', 'c', 'd', 'e'], pozice);
  assert.deepEqual(m.get('a'), { x: 0, y: 0 });
  const body = [...m.values()].map((p) => `${p.x},${p.y}`);
  assert.equal(new Set(body).size, 5);
  assert.ok([...m.values()].every((p) => p.x >= 0 && p.y >= 0));
});

async function repo() {
  const r = await docasneRepo();
  for (const [id, verejne, tags] of [['dorn', false, '[]'], ['vendla', false, '[aktualni]'], ['bruna', true, '[]']]) {
    const slozka = path.join(r.c.kampan, 'npc', id);
    await fs.mkdir(slozka, { recursive: true });
    await fs.writeFile(path.join(slozka, `${id}.md`), `---\nschema: 1\nid: ${id}\ntyp: npc\nnazev: ${id}\nverejne: ${verejne}\ntags: ${tags}\n---\nText.\n`);
  }
  return r;
}

test('hromadně: Družina zná a Ve hře pro víc karet, jedna změna na konci, chyby se jen ohlásí', async () => {
  const r = await repo();
  try {
    const k = new Kanon({ cesty: r.c, zapisovac: new Zapisovac() });
    await k.nacist();
    let zmen = 0;
    k.on('zmena', () => zmen++);
    const v = await k.nastavitHromadne({ ids: ['dorn', 'vendla', 'bruna', 'nikdo'], verejne: true, aktualni: true });
    assert.equal(v.zmeneno, 3);
    assert.deepEqual(v.chyby.map((c) => c.id), ['nikdo']);
    assert.equal(zmen, 1);
    for (const id of ['dorn', 'vendla', 'bruna']) {
      const text = await fs.readFile(path.join(r.c.kampan, 'npc', id, `${id}.md`), 'utf8');
      assert.match(text, /^verejne: true$/m);
      assert.match(text, /^tags: \[aktualni\]$/m);
    }
    // Co už hodnotu má, se nepřepisuje.
    const znovu = await k.nastavitHromadne({ ids: ['dorn', 'vendla'], aktualni: true });
    assert.equal(znovu.zmeneno, 0);
    await assert.rejects(k.nastavitHromadne({ ids: [], verejne: true }), /žádná/);
    await assert.rejects(k.nastavitHromadne({ ids: ['dorn'] }), /Není co změnit/);
    await assert.rejects(k.nastavitHromadne({ ids: ['dorn'], verejne: 'ano' }), /true nebo false/);
  } finally {
    await r.smazat();
  }
});

test('API: hromadná úprava z mapy', async () => {
  const r = await repo();
  const hub = new Hub({ cesty: r.c, obsKlient: new FalesnyObs(), gitSit: false, port: 0 });
  await hub.spustit();
  try {
    const o = await fetch(`${hub.adresa}/api/kanon/hromadne`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: ['dorn', 'vendla'], aktualni: false }) });
    const d = await o.json();
    assert.equal(o.status, 200);
    assert.equal(d.zmeneno, 1);
    const seznam = await (await fetch(`${hub.adresa}/api/kanon`)).json();
    assert.equal(seznam.entity.find((e) => e.id === 'vendla').aktualni, false);
  } finally {
    await hub.zastavit();
    await r.smazat();
  }
});
