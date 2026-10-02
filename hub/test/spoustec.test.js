// Kritérium Bloku 0: po ukončení serveru (Správce úloh) ho spouštěč do 5 s spustí znovu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { HUB_DIR } from '../server/cesty.js';
import { docasneRepo, dokud } from './pomoc.js';

async function volnyPort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function zdravi(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/zdravi`, { signal: AbortSignal.timeout(500) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

function zabit(pid) {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* už neběží */
  }
}

test('spouštěč po násilném ukončení serveru spustí server znovu do 5 s', { timeout: 30000 }, async () => {
  const repo = await docasneRepo();
  const port = await volnyPort();
  await fs.writeFile(repo.c.env, `HUB_PORT="${port}"\nOBS_URL="ws://127.0.0.1:1"\n`);
  const spoustec = spawn(process.execPath, [path.join(HUB_DIR, 'spoustec.js')], {
    env: { ...process.env, DMHUB_REPO: repo.koren, DMHUB_ENV: repo.c.env, DMHUB_NEOTEVIRAT: '1' },
    stdio: 'ignore',
  });
  const pidy = [];
  try {
    await dokud(async () => Boolean(await zdravi(port)), 10000, 100);
    const prvni = await zdravi(port);
    pidy.push(prvni.pid);

    const zacatek = Date.now();
    zabit(prvni.pid);
    let druhy = null;
    await dokud(
      async () => {
        druhy = await zdravi(port);
        return druhy && druhy.pid !== prvni.pid;
      },
      8000,
      100,
    );
    pidy.push(druhy.pid);
    const trvani = Date.now() - zacatek;
    assert.ok(trvani < 5000, `server běží znovu za ${trvani} ms`);

    const log = await fs.readFile(path.join(repo.c.lokalniStav, 'hub.log'), 'utf8');
    assert.match(log, /Server skončil/);
  } finally {
    zabit(spoustec.pid);
    for (const pid of pidy) zabit(pid);
    await new Promise((r) => setTimeout(r, 300));
    await repo.smazat();
  }
});
