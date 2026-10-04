// Spouštěč DM Hubu. Spustí server, otevře panel a po pádu server spustí znovu.
// Na ploše ho volá zástupce „DM Hub“ (DM Hub.cmd).
//
// Před každým spuštěním serveru ověří, že knihovny odpovídají package-lock.json; po stažení
// nové verze Hubu je tak doinstaluje sám (audit S2). Opakovaný pád hned po startu se zkouší
// s rostoucí prodlevou a po pěti pokusech otevře stránku s chybou (audit N15).
import { fork, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cesty, HUB_DIR } from './server/cesty.js';
import { Nastaveni } from './server/nastaveni.js';

process.title = 'DM Hub spouštěč';

const c = cesty();
/** Prodlevy před dalším pokusem, když server padá hned po startu. */
const PRODLEVY_RESTARTU_MS = [1000, 2000, 5000, 10000, 30000];
/** Server, který běžel aspoň takhle dlouho, nepadá při startu: počítadlo pádů se nuluje. */
const STABILNI_BEH_MS = 30000;
/** Kód, kterým server končí na žádost z panelu (Restartovat Hub): spustí se hned znovu. */
const KOD_RESTARTU = 75;
const LOG = path.join(c.lokalniStav, 'hub.log');
const HASH_ZAVISLOSTI = path.join(c.lokalniStav, 'zavislosti.sha1');
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

/**
 * Knihovny odpovídají package-lock.json? Když ne (nová verze Hubu přinesla jinou knihovnu),
 * spustí npm ci. Při prvním spuštění jen zapamatuje otisk, pokud jsou knihovny na místě.
 */
function zkontrolovatZavislosti() {
  let otisk;
  let balicek;
  try {
    otisk = crypto.createHash('sha1').update(fs.readFileSync(path.join(HUB_DIR, 'package-lock.json'))).digest('hex');
    balicek = JSON.parse(fs.readFileSync(path.join(HUB_DIR, 'package.json'), 'utf8'));
  } catch {
    return;
  }
  const ulozeny = fs.existsSync(HASH_ZAVISLOSTI) ? fs.readFileSync(HASH_ZAVISLOSTI, 'utf8').trim() : null;
  const chybi = Object.keys(balicek.dependencies ?? {}).filter((jmeno) => !fs.existsSync(path.join(HUB_DIR, 'node_modules', jmeno, 'package.json')));
  if (!chybi.length && (ulozeny === otisk || ulozeny === null)) {
    if (ulozeny === null) fs.writeFileSync(HASH_ZAVISLOSTI, otisk);
    return;
  }
  zapsatLog(`Knihovny neodpovídají package-lock.json${chybi.length ? ` (chybí ${chybi.join(', ')})` : ''}, spouštím npm ci.`);
  console.log('Instaluji knihovny pro novou verzi Hubu (npm ci)…');
  // npm je na Windows npm.cmd: bez shellu ho Node 24 nespustí.
  const r = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: HUB_DIR, shell: process.platform === 'win32', encoding: 'utf8', windowsHide: true });
  if (r.status === 0) {
    fs.writeFileSync(HASH_ZAVISLOSTI, otisk);
    zapsatLog('npm ci proběhlo.');
  } else {
    zapsatLog(`npm ci selhalo (kód ${r.status ?? '-'}): ${String(r.stderr || r.error?.message || '').trim().split('\n').slice(-5).join(' | ')}`);
  }
}

/** Server se opakovaně nespustil: stránka s chybou místo panelu, který by se nenačetl. */
function ukazatChybu(text) {
  const soubor = path.join(c.lokalniStav, 'hub-se-nespustil.html');
  const bezpecne = String(text).replace(/[&<>]/g, (z) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[z]);
  fs.writeFileSync(
    soubor,
    `<!doctype html><meta charset="utf-8"><title>DM Hub se nespustil</title>` +
      `<body style="font:16px/1.5 system-ui;max-width:52rem;margin:3rem auto;padding:0 1rem">` +
      `<h1>DM Hub se nespustil</h1><p>Server pětkrát po sobě spadl hned po startu. Spouštěč to dál zkouší každých 30 s.</p>` +
      `<p>Pošli Claudovi tenhle text a soubor <code>${path.join(c.lokalniStav, 'hub.log')}</code>:</p>` +
      `<pre style="white-space:pre-wrap;background:#eee;padding:1rem">${bezpecne}</pre></body>`,
  );
  otevritProhlizec(new URL(`file:///${soubor.replace(/\\/g, '/').replace(/^\//, '')}`).href);
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
let padu = 0;
let chybaUkazana = false;

function spustitServer() {
  zkontrolovatZavislosti();
  const start = Date.now();
  let posledniChyba = '';
  potomek = fork(path.join(HUB_DIR, 'server', 'index.js'), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  potomek.stdout.on('data', (d) => {
    process.stdout.write(d);
    zapsatLog(String(d).trimEnd());
  });
  potomek.stderr.on('data', (d) => {
    process.stderr.write(d);
    posledniChyba = (posledniChyba + String(d)).slice(-4000);
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
    if (kod === KOD_RESTARTU) {
      zapsatLog('Restart z panelu.');
      padu = 0;
      setTimeout(spustitServer, 200);
      return;
    }
    padu = Date.now() - start >= STABILNI_BEH_MS ? 1 : padu + 1;
    const prodleva = PRODLEVY_RESTARTU_MS[Math.min(padu - 1, PRODLEVY_RESTARTU_MS.length - 1)];
    zapsatLog(`Server skončil (kód ${kod ?? '-'}, signál ${signal ?? '-'}), pokus ${padu}, spouštím znovu za ${prodleva} ms.`);
    if (padu >= 5 && !chybaUkazana && !otevreno) {
      chybaUkazana = true;
      ukazatChybu(posledniChyba || `Server skončil s kódem ${kod ?? '-'}.`);
    }
    setTimeout(spustitServer, prodleva);
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
