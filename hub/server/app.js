// Složení Hubu: HTTP server, API, statické soubory, živé události.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { cesty as vychoziCesty } from './cesty.js';
import { Zapisovac } from './zapis.js';
import { DataKampane } from './data.js';
import { Hlidac } from './hlidac.js';
import { Nastaveni } from './nastaveni.js';
import { Obs } from './obs.js';
import { Git } from './git.js';
import { Vysilac } from './sse.js';
import { jeVOneDrive, nainstalovatHook } from './prostredi.js';

const TYPY_SOUBORU = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function poslatJson(res, status, data) {
  const telo = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(telo);
}

async function nacistJson(req, limit = 64 * 1024) {
  const typ = req.headers['content-type'] || '';
  // Jen JSON: obyčejný formulář z cizí stránky tak nemůže na Hub nic poslat.
  if (!typ.startsWith('application/json')) throw Object.assign(new Error('Očekávám JSON'), { status: 415 });
  let delka = 0;
  const casti = [];
  for await (const kus of req) {
    delka += kus.length;
    if (delka > limit) throw Object.assign(new Error('Příliš velký požadavek'), { status: 413 });
    casti.push(kus);
  }
  try {
    return casti.length ? JSON.parse(Buffer.concat(casti).toString('utf8')) : {};
  } catch {
    throw Object.assign(new Error('Neplatný JSON'), { status: 400 });
  }
}

export class Hub {
  /**
   * @param {object} volby
   * @param {object} [volby.cesty] přepis cest (testy)
   * @param {object} [volby.obsKlient] náhrada klienta OBS (testy)
   * @param {boolean} [volby.gitSit] kontrolovat GitHub při startu (výchozí true)
   */
  constructor({ cesty = vychoziCesty(), obsKlient, gitSit = true, port } = {}) {
    this.c = cesty;
    this.gitSit = gitSit;
    this.portPrepis = port;
    this.zapisovac = new Zapisovac({ zurnal: path.join(this.c.lokalniStav, 'odlozene-zapisy') });
    this.data = new DataKampane({ cesty: this.c, zapisovac: this.zapisovac });
    this.hlidac = new Hlidac(this.c.kampan);
    this.nastaveni = new Nastaveni(this.c.env);
    this.obs = new Obs(obsKlient ? { klient: obsKlient } : {});
    this.git = new Git(this.c.koren);
    this.vysilac = new Vysilac();
    this.server = null;
    this.spusteno = new Date().toISOString();
    this.prostredi = { oneDrive: jeVOneDrive(this.c.koren), hook: null };
    this.relace = new Set(); // platné přihlášení PINem z domácí sítě
  }

  async spustit() {
    await this.nastaveni.nacist();
    await fs.mkdir(this.c.lokalniStav, { recursive: true });

    this.zapisovac.on('odlozeno', () => this.vyslatStav());
    this.zapisovac.on('dokonceno', () => this.vyslatStav());
    this.zapisovac.on('zahozeno', () => this.vyslatStav());
    this.data.on('stav', () => this.vyslatStav());
    this.data.on('kontrola', (k) => this.vysilac.vyslat('kontrola', k));
    this.obs.on('stav', (s) => this.vysilac.vyslat('obs', s));
    this.hlidac.on('zmena', ({ soubor }) => this.data.souborZmenen(soubor).catch(() => {}));

    await this.zapisovac.obnovit();
    await this.data.nacist();
    await this.hlidac.spustit();

    this.server = http.createServer((req, res) => this.obsluha(req, res));
    const host = this.nastaveni.domaciSit ? '0.0.0.0' : '127.0.0.1';
    const port = this.portPrepis ?? this.nastaveni.port;
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, host, resolve);
    });

    // Pomalé věci až po startu, aby se panel otevřel hned.
    this.prostredi.hook = await nainstalovatHook(this.c.koren).catch(() => 'chyba');
    if (this.nastaveni.hodnoty.OBS_URL && this.nastaveni.existuje) {
      this.obs.nastavit(this.nastaveni.hodnoty.OBS_URL, this.nastaveni.hodnoty.OBS_HESLO);
    }
    this.obnovitGit(this.gitSit);
    return this;
  }

  get adresa() {
    const a = this.server?.address();
    return a ? `http://127.0.0.1:${a.port}` : null;
  }

  async obnovitGit(sit = true) {
    try {
      if (sit) await this.git.zkontrolovatVzdaleny();
      else await this.git.lokalniStav();
    } catch {
      /* stav nese chybu */
    }
    this.vysilac.vyslat('git', this.git.stav);
  }

  odlozeneZapisy() {
    return this.zapisovac.seznamOdlozenych().map((s) => path.relative(this.c.koren, s).split(path.sep).join('/'));
  }

  vyslatStav() {
    this.vysilac.vyslat('stav', { ...this.data.verejnyStav(), odlozeneZapisy: this.odlozeneZapisy() });
  }

  prehled() {
    return {
      stav: { ...this.data.verejnyStav(), odlozeneZapisy: this.odlozeneZapisy() },
      kontrola: this.data.kontrola,
      obs: this.obs.verejnyStav(),
      git: this.git.stav,
      nastaveni: this.nastaveni.verejne(),
      prostredi: this.prostredi,
      server: { spusteno: this.spusteno, pid: process.pid },
    };
  }

  /** Ochrana: jen localhost, nebo domácí síť s PINem. Hlavička Host brání útoku přes DNS rebinding. */
  povoleno(req) {
    const vzdaleny = !LOOPBACK.has(req.socket.remoteAddress);
    const host = String(req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    if (!vzdaleny) return ['127.0.0.1', 'localhost', '::1'].includes(host) || this.nastaveni.domaciSit;
    if (!this.nastaveni.domaciSit) return false;
    const cookie = String(req.headers.cookie || '').match(/(?:^|;\s*)dmhub=([a-f0-9]+)/);
    return Boolean(cookie && this.relace.has(cookie[1]));
  }

  async obsluha(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/prihlaseni' && this.nastaveni.domaciSit) return await this.prihlaseni(req, res, url);
      if (!this.povoleno(req)) {
        if (this.nastaveni.domaciSit && req.method === 'GET') {
          res.writeHead(302, { Location: '/prihlaseni' });
          return res.end();
        }
        return poslatJson(res, 403, { chyba: 'Přístup jen z tohoto počítače.' });
      }
      if (url.pathname.startsWith('/api/')) return await this.api(req, res, url);
      return await this.staticky(req, res, url);
    } catch (e) {
      const status = e.status || 500;
      if (!res.headersSent) poslatJson(res, status, { chyba: e.message });
      else res.end();
    }
  }

  async prihlaseni(req, res, url) {
    if (req.method === 'POST') {
      const telo = await nacistJson(req);
      const ocekavany = Buffer.from(String(this.nastaveni.hodnoty.PIN));
      const zadany = Buffer.from(String(telo.pin ?? ''));
      if (ocekavany.length !== zadany.length || !crypto.timingSafeEqual(ocekavany, zadany)) {
        return poslatJson(res, 401, { chyba: 'Nesprávný PIN' });
      }
      const token = crypto.randomBytes(24).toString('hex');
      this.relace.add(token);
      res.setHeader('Set-Cookie', `dmhub=${token}; HttpOnly; SameSite=Strict; Path=/`);
      return poslatJson(res, 200, { ok: true });
    }
    return this.staticky(req, res, new URL('/panel/prihlaseni.html', url));
  }

  async api(req, res, url) {
    const m = req.method;
    const p = url.pathname;
    if (p === '/api/udalosti' && m === 'GET') return this.vysilac.pripojit(req, res);
    if (p === '/api/prehled' && m === 'GET') return poslatJson(res, 200, this.prehled());
    if (p === '/api/zdravi' && m === 'GET') return poslatJson(res, 200, { ok: true, pid: process.pid, spusteno: this.spusteno });
    if (p === '/api/stav' && m === 'GET') return poslatJson(res, 200, this.prehled().stav);
    if (p === '/api/stav' && m === 'PUT') {
      const vysledek = await this.data.zmenitStav(await nacistJson(req));
      return poslatJson(res, 200, { ...vysledek, stav: this.prehled().stav });
    }
    if (p === '/api/kontrola' && m === 'GET') return poslatJson(res, 200, await this.data.zkontrolovat());
    if (p === '/api/nastaveni' && m === 'GET') return poslatJson(res, 200, this.nastaveni.verejne());
    if (p === '/api/nastaveni' && m === 'PUT') {
      const telo = await nacistJson(req);
      const puvodniPort = this.nastaveni.port;
      await this.nastaveni.ulozit(telo);
      if (telo.obsUrl !== undefined || telo.obsHeslo || telo.smazatObsHeslo) {
        this.obs.nastavit(this.nastaveni.hodnoty.OBS_URL, this.nastaveni.hodnoty.OBS_HESLO);
      }
      const restart = this.nastaveni.port !== puvodniPort || telo.domaciSit !== undefined;
      return poslatJson(res, 200, { nastaveni: this.nastaveni.verejne(), potrebaRestartu: restart });
    }
    if (p === '/api/obs/pripojit' && m === 'POST') {
      await nacistJson(req);
      const ok = await this.obs.pripojit();
      return poslatJson(res, 200, { ok, obs: this.obs.verejnyStav() });
    }
    if (p === '/api/obs/scena' && m === 'POST') {
      const { nazev } = await nacistJson(req);
      const zacatek = Date.now();
      await this.obs.prepnoutScenu(String(nazev));
      return poslatJson(res, 200, { ok: true, ms: Date.now() - zacatek });
    }
    if (p === '/api/git/obnovit' && m === 'POST') {
      await nacistJson(req);
      await this.obnovitGit(true);
      return poslatJson(res, 200, this.git.stav);
    }
    if (p === '/api/git/stahnout' && m === 'POST') {
      await nacistJson(req);
      await this.git.stahnout();
      await this.data.nacist();
      this.vysilac.vyslat('git', this.git.stav);
      return poslatJson(res, 200, this.git.stav);
    }
    throw Object.assign(new Error('Neznámá adresa'), { status: 404 });
  }

  async staticky(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw Object.assign(new Error('Metoda není povolena'), { status: 405 });
    let soubor;
    if (url.pathname === '/' || url.pathname === '/panel' || url.pathname === '/panel/') soubor = path.join(this.c.panel, 'index.html');
    else if (url.pathname.startsWith('/panel/')) soubor = path.join(this.c.panel, decodeURIComponent(url.pathname.slice(7)));
    else if (url.pathname.startsWith('/vystupy/')) soubor = path.join(this.c.vystupy, decodeURIComponent(url.pathname.slice(9)));
    else throw Object.assign(new Error('Stránka neexistuje'), { status: 404 });

    const koren = url.pathname.startsWith('/vystupy/') ? this.c.vystupy : this.c.panel;
    const rel = path.relative(koren, soubor);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw Object.assign(new Error('Stránka neexistuje'), { status: 404 });
    let obsah;
    try {
      obsah = await fs.readFile(soubor);
    } catch {
      throw Object.assign(new Error('Stránka neexistuje'), { status: 404 });
    }
    res.writeHead(200, {
      'Content-Type': TYPY_SOUBORU[path.extname(soubor)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : obsah);
  }

  async zastavit() {
    this.vysilac.zavrit();
    await this.hlidac.zastavit();
    await this.obs.ukoncit();
    await this.zapisovac.dokoncit();
    if (this.server) {
      this.server.closeAllConnections?.();
      await new Promise((r) => this.server.close(r));
    }
  }
}
