import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Odpocet, casNaDatum } from '../server/odpocet.js';
import { docasneRepo } from './pomoc.js';

test('čas HH:MM míří na nejbližší budoucí okamžik', () => {
  const ted = new Date(2026, 9, 3, 18, 0);
  assert.equal(casNaDatum('19:30', ted).getTime(), new Date(2026, 9, 3, 19, 30).getTime());
  assert.equal(casNaDatum('17:00', ted).getTime(), new Date(2026, 9, 4, 17, 0).getTime());
  assert.throws(() => casNaDatum('25:00', ted), /HH:MM/);
  assert.throws(() => casNaDatum('půl osmé', ted), /HH:MM/);
});

test('odpočet: připravit, spustit, pauza, pokračovat, zrušit a přežití restartu', async () => {
  const { koren, smazat } = await docasneRepo();
  let ted = new Date(2026, 9, 3, 18, 0).getTime();
  const soubor = path.join(koren, 'hub', '.stav', 'odpocet.json');
  const o = await new Odpocet({ soubor, hodiny: () => ted }).nacist();
  try {
    assert.equal(o.verejny().stav, 'zadny');
    await assert.rejects(o.spustit(), /nastav/);
    await assert.rejects(o.pripravit({ minut: 0 }), /1 minuta/);

    await o.pripravit({ minut: 15 });
    assert.equal(o.verejny().zbyvaMs, 15 * 60000);
    await o.spustit();
    ted += 5 * 60000;
    assert.equal(o.verejny().zbyvaMs, 10 * 60000);

    await o.pauza();
    ted += 60 * 60000; // pauza nic neodečítá
    assert.equal(o.verejny().zbyvaMs, 10 * 60000);

    // Restart serveru: stav se načte ze souboru
    const po = await new Odpocet({ soubor, hodiny: () => ted }).nacist();
    assert.equal(po.verejny().stav, 'pauza');
    await po.spustit();
    ted += 10 * 60000 + 500;
    assert.equal(po.verejny().zbyvaMs, 0);
    assert.equal(po.verejny().dobehl, true);
    assert.equal(po.verejny().celkemMs, 15 * 60000, 'celková délka zůstává kvůli barevnému přechodu');

    await po.zrusit();
    assert.equal(JSON.parse(await fs.readFile(soubor, 'utf8')).stav, 'zadny');
  } finally {
    await smazat();
  }
});

test('odpočet na čas začátku hry míří na ten čas i při pozdějším spuštění', async () => {
  const { koren, smazat } = await docasneRepo();
  let ted = new Date(2026, 9, 3, 18, 0).getTime();
  const o = new Odpocet({ soubor: path.join(koren, 'hub', '.stav', 'odpocet.json'), hodiny: () => ted });
  try {
    await o.pripravit({ cas: '19:00' });
    ted += 20 * 60000; // DM spustí odpočet až v 18:20
    await o.spustit();
    assert.equal(Date.parse(o.verejny().konec), new Date(2026, 9, 3, 19, 0).getTime());
    assert.equal(o.verejny().zbyvaMs, 40 * 60000);
  } finally {
    await smazat();
  }
});
