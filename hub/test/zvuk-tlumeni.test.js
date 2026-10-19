// Ucpané uši při málo HP a hudba z reproduktoru u stolu (rozhodnutí 67, bod 73).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Zvuk } from '../server/zvuk.js';

async function novyZvuk() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zvuk-tlumeni-'));
  const z = new Zvuk({
    cesty: { lokalniStav: dir },
    nastaveni: () => ({ ZVUK_SLOZKA: path.join(dir, 'audio') }),
    misto: () => null,
    scena: () => ({ varianta: 'den', rezim: 'normal', pocasi: [] }),
    vrstvy: () => ({}),
    mista: () => [],
  });
  return { z, dir };
}

test('hudba hraje výchozí u stolu, OBS stránka pak není potřeba', async () => {
  const { z } = await novyZvuk();
  assert.equal(z.verejny().hudbaKde, 'stul');
  assert.deepEqual(z.stav().potrebne, ['stul']);
  await z.nastavit({ hudbaKde: 'obs' });
  assert.equal(z.verejny().hudbaKde, 'obs');
  assert.deepEqual(z.stav().potrebne, ['hudba', 'stul']);
  await assert.rejects(z.nastavit({ hudbaKde: 'tv' }), /u stolu, nebo v OBS/);
});

test('málo HP zapne tlumení podle nastavení a pošle změnu stránkám', async () => {
  const { z } = await novyZvuk();
  const udalosti = [];
  z.on('zvuk', (v) => udalosti.push(v.tlumeni));
  assert.equal(z.verejny().tlumeni.aktivni, false);
  z.nastavitKritickeHp(true);
  assert.deepEqual(udalosti.at(-1), { aktivni: true, rozsah: 'hudba', hz: 500 });
  await z.nastavit({ tlumeni: 'vse', tlumeniHz: 300 });
  assert.deepEqual(udalosti.at(-1), { aktivni: true, rozsah: 'vse', hz: 300 });
  await z.nastavit({ tlumeni: 'vypnuto' });
  assert.equal(udalosti.at(-1).aktivni, false);
  await z.nastavit({ tlumeni: 'hudba' });
  z.nastavitKritickeHp(false);
  assert.equal(udalosti.at(-1).aktivni, false);
  await assert.rejects(z.nastavit({ tlumeniHz: 50 }), /200 až 2000 Hz/);
  await assert.rejects(z.nastavit({ tlumeni: 'trochu' }), /hudba, vše, nebo vypnuto/);
});

test('nastavení hudby a tlumení přežije restart', async () => {
  const { z, dir } = await novyZvuk();
  await z.nastavit({ hudbaKde: 'obs', tlumeni: 'vse', tlumeniHz: 900 });
  const d = JSON.parse(await fs.readFile(path.join(dir, 'zvuk.json'), 'utf8'));
  assert.equal(d.hudbaKde, 'obs');
  const { z: z2 } = await novyZvuk();
  z2.soubor = path.join(dir, 'zvuk.json');
  await z2.nacist();
  z2.zastavit();
  assert.equal(z2.verejny().hudbaKde, 'obs');
  assert.deepEqual(z2.verejny().tlumeni, { aktivni: false, rozsah: 'vse', hz: 900 });
  z.zastavit();
});
