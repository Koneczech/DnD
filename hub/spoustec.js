// Spouštěč DM Hubu. Spustí server, otevře panel a po pádu server do 5 s spustí znovu.
// Na ploše ho volá zástupce „DM Hub“ (DM Hub.cmd).
import { fork, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { cesty, HUB_DIR } from './server/cesty.js';
import { Nastaveni } from './server/nastaveni.js';

process.title = 'DM Hub spouštěč';

const c = cesty();
const PRODLEVA_RESTARTU_MS = 1000;
const LOG = path.join(c.lokalniStav, 'hub.log');
fs.mkdirSync(c.lokalniStav, { recursive: true });

function zapsatLog(text) {
  try {
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > 1024 * 1024) fs.renameSync(LOG, LOG + '.1');
    fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${text}\n`);
  } catch {
    /* log není kritický */
  }
}

function otevritProhlizec(url) {
  if (process.env.DMHUB_NEOTEVIRAT === '1') return;
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', `start "" "${url}"`], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref();
    return;
  }
  const [prikaz, argumenty] = process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(prikaz, argumenty, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

async function jizBezi(port) {
  try {
    const odpoved = await fetch(`http://127.0.0.1:${port}/api/zdravi`, { signal: AbortSignal.timeout(1000) });
    return odpoved.ok;
  } catch {
    return false;
  }
}

const nastaveni = await new Nastaveni(c.env).nacist();
const url = `http://127.0.0.1:${nastaveni.port}/`;

if (await jizBezi(nastaveni.port)) {
  console.log('DM Hub už běží, otevírám panel.');
  otevritProhlizec(url);
  process.exit(0);
}

let otevreno = false;
let konci = false;
let potomek = null;

function spustitServer() {
  potomek = fork(path.join(HUB_DIR, 'server', 'index.js'), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  potomek.stdout.on('data', (d) => {
    process.stdout.write(d);
    zapsatLog(String(d).trimEnd());
  });
  potomek.stderr.on('data', (d) => {
    process.stderr.write(d);
    zapsatLog('CHYBA ' + String(d).trimEnd());
  });
  potomek.on('message', (z) => {
    if (z?.typ === 'pripraveno' && !otevreno) {
      otevreno = true;
      otevritProhlizec(url);
    }
  });
  potomek.on('exit', (kod, signal) => {
    potomek = null;
    if (konci) return;
    if (kod === 3) {
      zapsatLog('Port je obsazený jiným programem, spouštěč končí.');
      console.error(`Port ${nastaveni.port} je obsazený jiným programem. Hub nespouštím.`);
      process.exit(3);
    }
    zapsatLog(`Server skončil (kód ${kod ?? '-'}, signál ${signal ?? '-'}), spouštím znovu za ${PRODLEVA_RESTARTU_MS} ms.`);
    setTimeout(spustitServer, PRODLEVA_RESTARTU_MS);
  });
}

function ukoncit() {
  konci = true;
  if (potomek) potomek.send({ typ: 'ukoncit' });
  setTimeout(() => process.exit(0), 3000).unref();
  potomek?.once('exit', () => process.exit(0));
  if (!potomek) process.exit(0);
}
process.on('SIGINT', ukoncit);
process.on('SIGTERM', ukoncit);

zapsatLog('Spouštěč startuje.');
spustitServer();
