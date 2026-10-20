// Zkušební režim v GitHub Codespaces: adresa Codespace projde, cizí Host ne, na GitHub se nic neukládá.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Hub } from '../server/app.js';
import { Git, git } from '../server/git.js';
import { zkusebniRezim } from '../server/zkouska.js';
import { docasneRepo } from './pomoc.js';

Object.assign(process.env, {
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
});

const CODESPACE = { DMHUB_ZKOUSKA: '1', CODESPACE_NAME: 'zkusebni-codespace', GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev' };

test('zkušební režim: povolená adresa podle jména Codespace a portu', () => {
  assert.deepEqual([...zkusebniRezim(CODESPACE, 7420).hosty], ['zkusebni-codespace-7420.app.github.dev']);
  assert.equal(zkusebniRezim({ ...CODESPACE, DMHUB_ZKOUSKA: undefined }, 7420).zapnuto, false);
  assert.equal(zkusebniRezim({ ...CODESPACE, DMHUB_ZKOUSKA: undefined }, 7420).hosty.size, 0, 'bez zapnutí žádná cizí adresa');
  assert.deepEqual([...zkusebniRezim({ DMHUB_ZKOUSKA: '1', DMHUB_ZKOUSKA_HOSTY: 'Jinde.example, ' }, 7420).hosty], ['jinde.example']);
});

function surovy(hub, cesta, hlavicky = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(hub.adresa + cesta, { headers: hlavicky }, (res) => {
      let telo = '';
      res.setEncoding('utf8');
      res.on('data', (k) => (telo += k));
      res.on('end', () => resolve({ status: res.statusCode, telo }));
    });
    req.on('error', reject);
  });
}

async function spustitHub(prostredi) {
  const repo = await docasneRepo();
  const hub = new Hub({ cesty: repo.c, gitSit: false, port: 0, prostredi });
  await hub.spustit();
  return { hub, zastavit: async () => { await hub.zastavit(); await repo.smazat(); } };
}

test('zkušební režim: panel projde přes adresu Codespace, cizí Host dál ne', async () => {
  const { hub, zastavit } = await spustitHub(CODESPACE);
  try {
    const port = new URL(hub.adresa).port;
    const odpoved = await surovy(hub, '/api/prehled', { Host: `zkusebni-codespace-${port}.app.github.dev` });
    assert.equal(odpoved.status, 200);
    assert.equal(JSON.parse(odpoved.telo).prostredi.zkouska, true);
    assert.equal((await surovy(hub, '/api/prehled', { Host: 'utocnik.example' })).status, 403);
    assert.equal((await surovy(hub, '/api/prehled', { Host: `jiny-codespace-${port}.app.github.dev` })).status, 403);
  } finally {
    await zastavit();
  }
});

test('mimo zkušební režim adresa Codespace neprojde', async () => {
  const { hub, zastavit } = await spustitHub({ ...CODESPACE, DMHUB_ZKOUSKA: '0' });
  try {
    const port = new URL(hub.adresa).port;
    assert.equal((await surovy(hub, '/api/prehled', { Host: `zkusebni-codespace-${port}.app.github.dev` })).status, 403);
    assert.equal((await surovy(hub, '/api/zdravi', { Host: `127.0.0.1:${port}` })).status, 200);
  } finally {
    await zastavit();
  }
});

async function zapsat(koren, relativni, text) {
  const cil = path.join(koren, ...relativni.split('/'));
  await fs.mkdir(path.dirname(cil), { recursive: true });
  await fs.writeFile(cil, text);
}

/** Vzdálený repozitář („GitHub“), klon A (domácí PC) a klon B (Codespace). */
async function dvaKlony() {
  const koren = await fs.mkdtemp(path.join(os.tmpdir(), 'dmhub-zkouska-'));
  const vzdaleny = path.join(koren, 'origin.git');
  const a = path.join(koren, 'a');
  const b = path.join(koren, 'b');
  await fs.mkdir(vzdaleny);
  await git(vzdaleny, ['init', '--bare', '-q', '-b', 'main']);
  await git(koren, ['clone', '-q', vzdaleny, 'a']);
  await git(a, ['checkout', '-q', '-B', 'main']);
  await zapsat(a, 'kampan/stav.md', 'datum: 1\n');
  await git(a, ['add', '.']);
  await git(a, ['commit', '-q', '-m', 'základ']);
  await git(a, ['push', '-q', '-u', 'origin', 'main']);
  await git(koren, ['clone', '-q', vzdaleny, 'b']);
  return { a, b, vzdaleny, smazat: () => fs.rm(koren, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) };
}

test('zkušební režim: Aktualizovat jen stáhne, rozdělané změny zůstanou a nic se neodešle', async () => {
  const k = await dvaKlony();
  try {
    // Doma přibyla novinka a v Codespace je rozdělaná změna kampaně.
    await zapsat(k.a, 'hub/novy.js', 'z GitHubu\n');
    await git(k.a, ['add', '.']);
    await git(k.a, ['commit', '-q', '-m', 'novinka']);
    await git(k.a, ['push', '-q']);
    await zapsat(k.b, 'kampan/poznamka.md', 'jen zkouška\n');

    const pred = await git(k.vzdaleny, ['rev-parse', 'main']);
    const zkouska = new Git(k.b, { jenStahovat: true });
    const vysledek = await zkouska.aktualizovat('Úpravy z panelu');
    assert.equal(vysledek.ulozeno, false);
    assert.equal(vysledek.stazeno, 1);
    assert.equal(vysledek.push, false);
    assert.equal((await fs.readFile(path.join(k.b, 'hub', 'novy.js'), 'utf8')).replace(/\r\n/g, '\n'), 'z GitHubu\n');
    assert.equal(await fs.readFile(path.join(k.b, 'kampan', 'poznamka.md'), 'utf8'), 'jen zkouška\n', 'rozdělaná změna zůstala');
    assert.equal(await git(k.vzdaleny, ['rev-parse', 'main']), pred, 'na GitHub nic neodešlo');
    assert.equal(await git(k.b, ['status', '--porcelain', '--', 'kampan']), '?? kampan/poznamka.md', 'nic se necommitovalo');

    await assert.rejects(zkouska.ulozit('Sezení 9'), (e) => e.status === 409 && /Zkušební režim/.test(e.message));
    await assert.rejects(zkouska.sloucit(), (e) => e.status === 409 && /Zkušební režim/.test(e.message));
    assert.equal(await git(k.vzdaleny, ['rev-parse', 'main']), pred);
  } finally {
    await k.smazat();
  }
});
