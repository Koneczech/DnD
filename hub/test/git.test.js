import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Git } from '../server/git.js';

const maGit = spawnSync('git', ['--version']).status === 0;

function identita() {
  Object.assign(process.env, {
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  });
}

test('Uložit do GitHubu: commit jen kampan/ a push na vzdálenou větev', { skip: !maGit && 'git není k dispozici' }, async () => {
  identita();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dmhub-git-'));
  const vzdalene = path.join(tmp, 'vzdalene.git');
  const koren = path.join(tmp, 'klon');
  const g = (...a) => execFileSync('git', a, { cwd: koren, encoding: 'utf8' }).trim();
  try {
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', vzdalene]);
    execFileSync('git', ['clone', '-q', vzdalene, koren]);
    await fs.mkdir(path.join(koren, 'kampan'), { recursive: true });
    await fs.writeFile(path.join(koren, 'kampan', 'stav.md'), 'v1\n');
    g('checkout', '-q', '-b', 'main');
    g('add', '.');
    g('commit', '-q', '-m', 'start');
    g('push', '-q', '-u', 'origin', 'main');

    // Změna dat i změna mimo kampan/ (ta se commitnout nesmí)
    await fs.writeFile(path.join(koren, 'kampan', 'stav.md'), 'v2\n');
    await fs.writeFile(path.join(koren, 'jiny.txt'), 'nekomitovat\n');

    const git = new Git(koren);
    const r = await git.ulozit('Sezení 3 — 3. 10. 2026');
    assert.equal(r.commit, true);
    assert.equal(r.push, true);
    assert.equal(r.chybaPush, null);
    assert.equal(g('log', '-1', '--format=%s'), 'Sezení 3 — 3. 10. 2026');
    assert.equal(execFileSync('git', ['--git-dir', vzdalene, 'log', '-1', '--format=%s', 'main'], { encoding: 'utf8' }).trim(), 'Sezení 3 — 3. 10. 2026');
    assert.equal(g('show', '--name-only', '--format=', 'HEAD'), 'kampan/stav.md');
    assert.match(g('status', '--porcelain'), /\?\? jiny\.txt/);

    // Nic nového: žádný commit, push proběhne
    const znovu = await git.ulozit('nic');
    assert.equal(znovu.commit, false);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('Uložit bez vzdálené větve: commit lokálně a srozumitelná hláška', { skip: !maGit && 'git není k dispozici' }, async () => {
  identita();
  const koren = await fs.mkdtemp(path.join(os.tmpdir(), 'dmhub-git-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: koren });
    await fs.mkdir(path.join(koren, 'kampan'));
    await fs.writeFile(path.join(koren, 'kampan', 'stav.md'), 'x\n');
    const r = await new Git(koren).ulozit('Sezení 1 — test');
    assert.equal(r.commit, true);
    assert.equal(r.push, false);
    assert.match(r.chybaPush, /jen lokálně/);
  } finally {
    await fs.rm(koren, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
