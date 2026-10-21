// Obloha na strop z projektoru: kalibrace projekce (hub/.stav/strop.json), API a výstup strop.html.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Strop, overitKalibraci, VYCHOZI } from '../server/strop.js';
import { Vysilac } from '../server/sse.js';
import { Hub } from '../server/app.js';
import { docasneRepo, FalesnyObs } from './pomoc.js';

test('kalibrace stropu: výchozí hodnoty, ověření a zahození neznámých polí', () => {
  const k = overitKalibraci({});
  assert.deepEqual(k.rohy, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  assert.equal(k.okraj, VYCHOZI.okraj);
  assert.equal(k.jas, VYCHOZI.jas);
  assert.equal(k.hvezdy, true);

  const z = overitKalibraci({ rohy: [[0.1, -0.05], [0.9, 0], [1.2, 1], [0, 0.95]], okraj: 0.2, jas: 0.5, hvezdy: false, cizi: 1 });
  assert.deepEqual(z.rohy[0], [0.1, -0.05]);
  assert.equal(z.okraj, 0.2);
  assert.equal(z.hvezdy, false);
  assert.equal('cizi' in z, false);

  // Částečná změna nechá ostatní hodnoty.
  assert.equal(overitKalibraci({ jas: 0.3 }, z).okraj, 0.2);

  assert.throws(() => overitKalibraci({ rohy: [[0, 0], [1, 0], [1, 1]] }), /čtyři rohy/);
  assert.throws(() => overitKalibraci({ rohy: [[0, 0], [1, 0], [1, 1], [0, 5]] }), /rozsah/);
  assert.throws(() => overitKalibraci({ rohy: [[0, 0], [1, 0], [1, 1], 'roh'] }), /dvojice/);
  assert.throws(() => overitKalibraci({ okraj: 0.9 }), /Okraj/);
  assert.throws(() => overitKalibraci({ jas: 0 }), /Jas/);
  assert.throws(() => overitKalibraci({ hvezdy: 'ano' }), /Hvězdy/);
});

test('kalibrace stropu přežije restart, rozbitý soubor vrátí výchozí, Výchozí ji zahodí', async () => {
  const { c, smazat } = await docasneRepo();
  const soubor = path.join(c.lokalniStav, 'strop.json');
  try {
    const s = await new Strop({ soubor }).nacist();
    const zmeny = [];
    s.on('stav', (k) => zmeny.push(k));
    await s.nastavit({ rohy: [[0.05, 0.02], [0.97, 0], [1, 0.9], [0.02, 1]], jas: 0.4 });
    assert.equal(zmeny.length, 1);

    const po = await new Strop({ soubor }).nacist();
    assert.deepEqual(po.verejny().rohy[0], [0.05, 0.02]);
    assert.equal(po.verejny().jas, 0.4);

    await assert.rejects(po.nastavit({ jas: 7 }), /Jas/);
    assert.equal(po.verejny().jas, 0.4, 'odmítnutá změna nic nezmění');

    await po.nastavit({ vychozi: true });
    assert.deepEqual(po.verejny(), overitKalibraci({}));

    await fs.writeFile(soubor, '{ rozbité');
    const rozbity = await new Strop({ soubor }).nacist();
    assert.deepEqual(rozbity.verejny(), overitKalibraci({}));
  } finally {
    await smazat();
  }
});

test('blesk je jednorázová událost: nově připojená stránka ho znovu nedostane', () => {
  const v = new Vysilac();
  try {
    v.vyslat('scena', { pocasi: ['bourka'] });
    v.vyslat('blesk', { vzdalenost: 'nad-nami' });
    assert.equal(v.posledni.has('scena'), true);
    assert.equal(v.posledni.has('blesk'), false);
  } finally {
    v.zavrit();
  }
});

test('Hub: /api/strop čte a ukládá kalibraci, výstup strop.html se servíruje', async () => {
  const repo = await docasneRepo();
  const hub = new Hub({ cesty: repo.c, obsKlient: new FalesnyObs(), gitSit: false, port: 0 });
  await hub.spustit();
  try {
    let r = await fetch(hub.adresa + '/api/strop');
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).rohy, [[0, 0], [1, 0], [1, 1], [0, 1]]);

    r = await fetch(hub.adresa + '/api/strop', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ okraj: 0.25 }) });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).okraj, 0.25);
    assert.equal(JSON.parse(await fs.readFile(path.join(repo.c.lokalniStav, 'strop.json'), 'utf8')).okraj, 0.25);

    r = await fetch(hub.adresa + '/api/strop', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rohy: [] }) });
    assert.equal(r.status, 400);

    r = await fetch(hub.adresa + '/vystupy/strop.html');
    assert.equal(r.status, 200);
    assert.match(await r.text(), /Kalibrace stropu/);
  } finally {
    await hub.zastavit();
    await repo.smazat();
  }
});
