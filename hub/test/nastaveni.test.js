import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Nastaveni, rozebratEnv, slozitEnv } from '../server/nastaveni.js';
import { jeVOneDrive } from '../server/prostredi.js';
import { docasneRepo } from './pomoc.js';

// Falešné heslo vzniká za běhu, aby ho pre-commit hook nepovažoval za skutečné.
const HESLO = ['test', 'heslo', String(Date.now())].join('-');

test('.env: složení a rozebrání vrátí stejné hodnoty, i s uvozovkami a mezerami', () => {
  const hodnoty = { OBS_HESLO: 'a "b" c', HUB_PORT: '7420' };
  assert.deepEqual(rozebratEnv(slozitEnv(hodnoty)), hodnoty);
  assert.deepEqual(rozebratEnv("A=1\n# komentář\nB='x y'\r\nC=\"z\""), { A: '1', B: 'x y', C: 'z' });
});

test('Nastavení: bez .env existuje=false, heslo se nikdy nevrací panelu', async () => {
  const { c, smazat } = await docasneRepo();
  try {
    const n = await new Nastaveni(c.env).nacist();
    assert.equal(n.existuje, false);
    await n.ulozit({ obsUrl: 'ws://127.0.0.1:4455', obsHeslo: HESLO });
    const znovu = await new Nastaveni(c.env).nacist();
    assert.equal(znovu.existuje, true);
    assert.equal(znovu.hodnoty.OBS_HESLO, HESLO);
    assert.ok(!JSON.stringify(znovu.verejne()).includes(HESLO));
    assert.equal(znovu.verejne().obsHesloNastaveno, true);
    assert.ok(znovu.tajneHodnoty().includes(HESLO));

    // Prázdné heslo z panelu = beze změny
    await znovu.ulozit({ obsUrl: 'ws://127.0.0.1:4455' });
    assert.equal(znovu.hodnoty.OBS_HESLO, HESLO);
  } finally {
    await smazat();
  }
});

test('Nastavení: neplatné hodnoty se odmítnou', async () => {
  const { c, smazat } = await docasneRepo();
  try {
    const n = await new Nastaveni(c.env).nacist();
    await assert.rejects(n.ulozit({ obsUrl: 'http://x' }), /ws:\/\//);
    await assert.rejects(n.ulozit({ port: 80 }), /Port/);
    await assert.rejects(n.ulozit({ pin: 'abc' }), /PIN/);
    await assert.rejects(n.ulozit({ domaciSit: true }), /PIN/);
    await assert.rejects(fs.access(c.env));
  } finally {
    await smazat();
  }
});

test('OneDrive: pozná klon ve složce OneDrive i podle proměnné prostředí', () => {
  const zaklad = path.resolve('uzivatel');
  assert.equal(jeVOneDrive(path.join(zaklad, 'OneDrive', 'Dokumenty', 'DnD'), {}), true);
  assert.equal(jeVOneDrive(path.join(zaklad, 'OneDrive - Firma', 'DnD'), {}), true);
  assert.equal(jeVOneDrive(path.join(zaklad, 'Sync', 'DnD'), { OneDrive: path.join(zaklad, 'Sync') }), true);
  assert.equal(jeVOneDrive(path.join(zaklad, 'Projekty', 'DnD'), { OneDrive: path.join(zaklad, 'OneDrive') }), false);
  assert.equal(jeVOneDrive(path.join(zaklad, 'OneDriveNeni', 'DnD'), {}), false);
});
