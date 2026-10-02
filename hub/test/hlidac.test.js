import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Hlidac } from '../server/hlidac.js';
import { docasneRepo, cekej } from './pomoc.js';

// Kritérium Bloku 0: změna souboru zvenku (Obsidian, editor) se zachytí do 1 s, i na Windows.
test('hlídání souborů zachytí změnu stav.md do 1 s', async () => {
  const { c, smazat } = await docasneRepo();
  const h = new Hlidac(c.kampan);
  try {
    await h.spustit();
    await cekej(200);
    const zmena = new Promise((resolve) => h.on('zmena', (u) => u.soubor === path.resolve(c.stav) && resolve(u)));
    const zacatek = Date.now();
    await fs.writeFile(c.stav, (await fs.readFile(c.stav, 'utf8')).replace('Mirabar', 'Triboar'));
    const u = await Promise.race([zmena, cekej(3000).then(() => null)]);
    const trvani = Date.now() - zacatek;
    assert.ok(u, 'změna nebyla zachycena vůbec');
    assert.equal(u.druh, 'change');
    assert.ok(trvani < 1000, `změna zachycena za ${trvani} ms`);
  } finally {
    await h.zastavit();
    await smazat();
  }
});

test('hlídání souborů zachytí nový soubor v podsložce a ignoruje dočasné soubory zápisu', async () => {
  const { c, smazat } = await docasneRepo();
  const h = new Hlidac(c.kampan);
  const zachycene = [];
  try {
    await h.spustit();
    h.on('zmena', (u) => zachycene.push(path.basename(u.soubor)));
    await cekej(200);
    await fs.mkdir(path.join(c.kampan, 'npc', 'torva'), { recursive: true });
    await fs.writeFile(path.join(c.kampan, 'npc', 'torva', '.torva.md.123.abcd.hub-tmp'), 'x');
    await fs.writeFile(path.join(c.kampan, 'npc', 'torva', 'torva.md'), '---\nid: torva\n---\n');
    await cekej(1000);
    assert.ok(zachycene.includes('torva.md'));
    assert.ok(!zachycene.some((s) => s.endsWith('.hub-tmp')));
  } finally {
    await h.zastavit();
    await smazat();
  }
});
