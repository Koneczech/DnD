import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { najdiProblemy, jeZakazanySoubor } from '../hooks/pre-commit.js';
import { nainstalovatHook, OBSAH_HOOKU } from '../server/prostredi.js';
import { HUB_DIR } from '../server/cesty.js';

// Falešné tokeny se skládají za běhu, aby samotný test neobsahoval nic, co vypadá jako klíč.
const falesny = {
  github: 'ghp' + '_' + 'A'.repeat(36),
  openai: 'sk' + '-proj-' + 'b'.repeat(40),
  aws: 'AKIA' + 'C'.repeat(16),
};

test('hook: zakázané soubory .env, vzor .env.example je povolený', () => {
  assert.ok(jeZakazanySoubor('hub/.env'));
  assert.ok(jeZakazanySoubor('.env'));
  assert.ok(jeZakazanySoubor('hub\\.env.local'));
  assert.ok(!jeZakazanySoubor('hub/.env.example'));
  assert.ok(!jeZakazanySoubor('kampan/stav.md'));
});

test('hook: najde známé typy klíčů, hodnoty z .env i přiřazení v .env stylu', () => {
  const tajne = 'moje' + '-obs-' + 'tajemstvi';
  const problemy = najdiProblemy(
    [
      { cesta: 'a.md', obsah: `token ${falesny.github}` },
      { cesta: 'b.js', obsah: `const k = "${falesny.openai}"` },
      { cesta: 'c.txt', obsah: `id ${falesny.aws}` },
      { cesta: 'd.md', obsah: `heslo je ${tajne}` },
      { cesta: 'e.ini', obsah: 'OBS' + '_HESLO=' + 'nejake-heslo' },
      { cesta: 'hub/.env', obsah: null },
      { cesta: 'obrazek.png', obsah: null },
      { cesta: 'hub/.env.example', obsah: 'OBS' + '_HESLO=""\nPIN=""\n' },
      { cesta: 'kampan/stav.md', obsah: '---\nmisto: Mirabar\n---\n' },
    ],
    [tajne],
  );
  assert.deepEqual(
    problemy.map((p) => p.cesta),
    ['a.md', 'b.js', 'c.txt', 'd.md', 'e.ini', 'hub/.env'],
  );
});

function maGit() {
  return spawnSync('git', ['--version']).status === 0;
}

test('hook: skutečný commit v dočasném repu (Linux i Windows)', { skip: !maGit() && 'git není k dispozici' }, async () => {
  const koren = await fs.mkdtemp(path.join(os.tmpdir(), 'dmhub-hook-'));
  const g = (...a) => spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...a], { cwd: koren, encoding: 'utf8' });
  try {
    execFileSync('git', ['init', '-q'], { cwd: koren });
    for (const soubor of ['hooks/pre-commit.js', 'server/nastaveni.js', 'server/zapis.js']) {
      await fs.mkdir(path.join(koren, 'hub', path.dirname(soubor)), { recursive: true });
      await fs.copyFile(path.join(HUB_DIR, soubor), path.join(koren, 'hub', soubor));
    }
    await fs.writeFile(path.join(koren, 'hub', 'package.json'), JSON.stringify({ type: 'module' }));

    assert.equal(await nainstalovatHook(koren), 'nainstalovano');
    assert.equal(await nainstalovatHook(koren), 'aktualni');
    const hook = await fs.readFile(path.join(koren, '.git', 'hooks', 'pre-commit'), 'utf8');
    assert.equal(hook, OBSAH_HOOKU);
    assert.ok(!hook.includes('\r'), 'hook má LF konce řádků');

    g('add', 'hub');
    assert.equal(g('commit', '-q', '-m', 'kód').status, 0, 'čistý commit projde');

    const heslo = 'skutecne' + '-heslo-' + Date.now();
    await fs.writeFile(path.join(koren, 'hub', '.env'), `OBS_HESLO="${heslo}"\n`);
    g('add', '-f', 'hub/.env');
    const s1 = g('commit', '-q', '-m', 'env');
    assert.notEqual(s1.status, 0, 'commit .env musí selhat');
    assert.match(s1.stderr, /\.env/);
    g('reset', '-q', 'hub/.env');

    await fs.writeFile(path.join(koren, 'poznamky.md'), `heslo k OBS: ${heslo}\n`);
    g('add', 'poznamky.md');
    const s2 = g('commit', '-q', '-m', 'poznámky');
    assert.notEqual(s2.status, 0, 'commit s hodnotou z .env musí selhat');
    assert.match(s2.stderr, /hodnotu z hub\/\.env/);

    await fs.writeFile(path.join(koren, 'poznamky.md'), `klíč ${falesny.github}\n`);
    g('add', 'poznamky.md');
    assert.notEqual(g('commit', '-q', '-m', 'klíč').status, 0, 'commit s tokenem musí selhat');
  } finally {
    await fs.rm(koren, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('hook: cizí pre-commit hook se nepřepíše', { skip: !maGit() && 'git není k dispozici' }, async () => {
  const koren = await fs.mkdtemp(path.join(os.tmpdir(), 'dmhub-hook-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: koren });
    await fs.mkdir(path.join(koren, '.git', 'hooks'), { recursive: true });
    await fs.writeFile(path.join(koren, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho cizi\n');
    assert.equal(await nainstalovatHook(koren), 'cizi-hook');
    assert.match(await fs.readFile(path.join(koren, '.git', 'hooks', 'pre-commit'), 'utf8'), /cizi/);
  } finally {
    await fs.rm(koren, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
