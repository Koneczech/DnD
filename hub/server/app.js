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
import { Sezeni, datumCesky } from './sezeni.js';
import { Odpocet } from './odpocet.js';
import { jeVOneDrive, nainstalovatHook } from './prostredi.js';
import { Kalendar } from './kalendar.js';
import { DalsiDen } from './dalsiden.js';
import { Obchody } from './obchody.js';
import { HUB_DIR } from './cesty.js';

/** Po kolika ms od konce odpočtu se scéna po restartu Hubu ještě přepne (otevřený bod 21). */
export const PREPNUTI_PO_RESTARTU_MS = 10 * 60 * 1000;

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
    this.sezeni = new Sezeni({ cesty: this.c, data: this.data, zapisovac: this.zapisovac });
    this.odpocet = new Odpocet({ soubor: path.join(this.c.lokalniStav, 'odpocet.json') });
    this.hlidac = new Hlidac(this.c.kampan);
    this.nastaveni = new Nastaveni(this.c.env);
    this.obs = new Obs(obsKlient ? { klient: obsKlient } : {});
    this.git = new Git(this.c.koren);
    this.vysilac = new Vysilac();
    this.kalendar = new Kalendar({ cesty: this.c, data: this.data, zapisovac: this.zapisovac });
    this.dalsiDen = new DalsiDen({ cesty: this.c, kalendar: this.kalendar, sezeni: this.sezeni });
    this.obchody = new Obchody({ cesty: this.c, zapisovac: this.zapisovac });
    this.casovacOdpoctu = null;
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
    this.data.on('stav', () => {
      this.vyslatStav();
      // Datum a začátek kampaně žijí ve stav.md a kampan.yaml; výstupy kalendáře je potřebují hned.
      this.kalendar.oznam();
    });
    this.data.on('kontrola', (k) => this.vysilac.vyslat('kontrola', k));
    this.obs.on('stav', (s) => {
      this.vysilac.vyslat('obs', s);
      if (s.pripojeno) this.hlidatOdpocet();
    });
    this.odpocet.on('stav', (s) => {
      this.vysilac.vyslat('odpocet', s);
      this.hlidatOdpocet();
    });
    this.kalendar.on('zmena', (k) => this.vysilac.vyslat('kalendar-dm', k));
    this.kalendar.on('verejne', (k) => this.vyslatKalendar(k));
    this.obchody.on('zmena', (o) => this.vysilac.vyslat('obchody', o));
    this.obchody.on('ceniky', (c) => this.vysilac.vyslat('ceniky', c));
    this.hlidac.on('zmena', ({ soubor }) => this.souborZmenen(soubor).catch(() => {}));

    await this.zapisovac.obnovit();
    await this.data.nacist();
    await this.kalendar.nacist();
    await this.obchody.nacist();
    await this.odpocet.nacist();
    this.vysilac.vyslat('odpocet', this.odpocet.verejny());
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
    this.hlidatOdpocet();
    return this;
  }

  async souborZmenen(soubor) {
    if (await this.kalendar.souborZmenen(soubor)) return;
    if (await this.obchody.souborZmenen(soubor)) return;
    await this.data.souborZmenen(soubor);
  }

  /** Veřejný kalendář do výstupů; stejná data se neposílají dvakrát (orloj by se zbytečně překreslil). */
  vyslatKalendar(k = this.kalendar.verejne()) {
    const json = JSON.stringify(k);
    if (json === this.posledniKalendar) return;
    this.posledniKalendar = json;
    this.vysilac.vyslat('kalendar', k);
  }

  /**
   * Otevřený bod 21: po doběhnutí odpočtu přepne OBS na „Scénu po odpočtu“, jen jednou.
   * Když Hub naběhne až po konci, přepne, pokud od konce neuběhlo víc než 10 minut.
   */
  hlidatOdpocet() {
    clearTimeout(this.casovacOdpoctu);
    this.casovacOdpoctu = null;
    const s = this.odpocet.stav;
    if (s.stav !== 'bezi' || s.prepnuti || !s.konec) return;
    const zbyva = Date.parse(s.konec) - this.odpocet.hodiny();
    if (zbyva > 0) {
      // setTimeout zvládne nejvýš ~24,8 dne; odpočet má limit 24 h.
      this.casovacOdpoctu = setTimeout(() => this.hlidatOdpocet(), Math.min(zbyva, 2 ** 31 - 1));
      this.casovacOdpoctu.unref?.();
      return;
    }
    this.prepnoutPoOdpoctu(-zbyva).catch(() => {});
  }

  async prepnoutPoOdpoctu(poKonciMs) {
    const scena = this.nastaveni.hodnoty.OBS_SCENA_PO_ODPOCTU;
    if (!scena) return this.odpocet.zaznamenatPrepnuti({ scena: null, ok: false, duvod: 'Scéna po odpočtu není nastavená.' });
    if (poKonciMs > PREPNUTI_PO_RESTARTU_MS) {
      return this.odpocet.zaznamenatPrepnuti({ scena, ok: false, duvod: 'Odpočet doběhl dávno před startem Hubu, scéna se nepřepnula.' });
    }
    // OBS ještě není připojené (start Hubu, výpadek): přepne se po připojení, pokud je stále v limitu.
    if (!this.obs.pripojeno) return undefined;
    try {
      await this.obs.prepnoutScenu(scena);
      return this.odpocet.zaznamenatPrepnuti({ scena, ok: true });
    } catch (e) {
      return this.odpocet.zaznamenatPrepnuti({ scena, ok: false, duvod: `OBS scénu nepřepnul: ${e.message}` });
    }
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
    this.sezeni.verejne().then((s) => this.vysilac.vyslat('sezeni', s)).catch(() => {});
  }

  async prehled() {
    return {
      sezeni: await this.sezeni.verejne(),
      odpocet: this.odpocet.verejny(),
      stav: { ...this.data.verejnyStav(), odlozeneZapisy: this.odlozeneZapisy() },
      kontrola: this.data.kontrola,
      kalendar: this.kalendar.stavDm(),
      obchody: this.obchody.seznam(),
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
      if (!res.headersSent) poslatJson(res, status, { chyba: e.message, ...(e.kod ? { kod: e.kod } : {}) });
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
    if (p === '/api/prehled' && m === 'GET') return poslatJson(res, 200, await this.prehled());
    if (p === '/api/zdravi' && m === 'GET') return poslatJson(res, 200, { ok: true, pid: process.pid, spusteno: this.spusteno });
    if (p === '/api/stav' && m === 'GET') return poslatJson(res, 200, (await this.prehled()).stav);
    if (p === '/api/stav' && m === 'PUT') {
      const vysledek = await this.data.zmenitStav(await nacistJson(req));
      return poslatJson(res, 200, { ...vysledek, stav: (await this.prehled()).stav });
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
    if (p === '/api/sezeni/zahajit' && m === 'POST') {
      const telo = await nacistJson(req);
      if (this.git.stav.pozadu > 0 && !telo.potvrzenoBezStazeni) {
        throw Object.assign(new Error(`Na GitHubu jsou novější změny (${this.git.stav.pozadu}). Stáhni je, nebo zahaj sezení bez nich.`), { status: 409, kod: 'nestazene-zmeny' });
      }
      const pritomni = Array.isArray(telo.pritomni) ? telo.pritomni.map(String).slice(0, 20) : [];
      const vysledek = await this.sezeni.zahajit({ pritomni });
      if (telo.odpocet && (telo.odpocet.cas || telo.odpocet.minut)) await this.odpocet.pripravit(telo.odpocet);
      return poslatJson(res, 200, vysledek);
    }
    if (p === '/api/sezeni/ukoncit' && m === 'POST') {
      await nacistJson(req);
      const vysledek = await this.sezeni.ukoncit();
      if (this.odpocet.stav.stav !== 'zadny') await this.odpocet.zrusit();
      return poslatJson(res, 200, { ...vysledek, zpravaCommitu: `Sezení ${vysledek.cislo} — ${datumCesky()}` });
    }
    if (p === '/api/poznamka' && m === 'POST') {
      const { text } = await nacistJson(req);
      return poslatJson(res, 200, await this.sezeni.poznamka(text));
    }
    if (p.startsWith('/api/odpocet/') && m === 'POST') {
      const akce = p.slice('/api/odpocet/'.length);
      const telo = await nacistJson(req);
      const mapa = {
        pripravit: () => this.odpocet.pripravit(telo),
        spustit: () => this.odpocet.spustit(),
        pauza: () => this.odpocet.pauza(),
        zrusit: () => this.odpocet.zrusit(),
      };
      if (!mapa[akce]) throw Object.assign(new Error('Neznámá akce odpočtu'), { status: 404 });
      return poslatJson(res, 200, await mapa[akce]());
    }
    if (p === '/api/odpocet' && m === 'GET') return poslatJson(res, 200, this.odpocet.verejny());
    if (p === '/api/obs/souboj' && m === 'POST') {
      await nacistJson(req);
      const scena = this.nastaveni.hodnoty.OBS_SCENA_SOUBOJ;
      if (!scena) throw Object.assign(new Error('Scéna pro souboj není nastavená. Vyber ji v Nastavení.'), { status: 409 });
      const zacatek = Date.now();
      await this.obs.prepnoutScenu(scena);
      return poslatJson(res, 200, { ok: true, scena, ms: Date.now() - zacatek });
    }
    if (p.startsWith('/api/kalendar') || p.startsWith('/api/den/')) {
      const v = await this.apiKalendar(req, m, p);
      if (v !== undefined) return poslatJson(res, 200, v);
    }
    if (p.startsWith('/api/obchody')) {
      const v = await this.apiObchody(req, m, p);
      if (v !== undefined) return poslatJson(res, 200, v);
    }
    if (p === '/api/git/ulozit' && m === 'POST') {
      const telo = await nacistJson(req);
      const zprava = String(telo.zprava || '').trim() || `Ruční uložení — ${datumCesky()}`;
      const vysledek = await this.git.ulozit(zprava.slice(0, 200));
      this.obnovitGit(false);
      return poslatJson(res, 200, vysledek);
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
      await this.kalendar.nacist();
      await this.obchody.nacist();
      this.vysilac.vyslat('git', this.git.stav);
      return poslatJson(res, 200, this.git.stav);
    }
    throw Object.assign(new Error('Neznámá adresa'), { status: 404 });
  }

  async apiKalendar(req, m, p) {
    const k = this.kalendar;
    if (p === '/api/kalendar' && m === 'GET') return { ...k.stavDm(), import: await k.lzeImportovat() };
    if (p === '/api/kalendar/verejne' && m === 'GET') return k.verejne();
    if (p === '/api/kalendar/import' && m === 'POST') {
      const { prepsat } = await nacistJson(req);
      return k.importovat({ prepsat: prepsat === true });
    }
    if (p === '/api/kalendar/udalosti' && m === 'POST') return k.pridat(await nacistJson(req));
    const u = /^\/api\/kalendar\/udalosti\/([A-Za-z0-9_-]{1,80})$/.exec(p);
    if (u && m === 'PUT') return k.upravit(u[1], await nacistJson(req));
    if (u && m === 'DELETE') return k.smazat(u[1]);
    if (p === '/api/kalendar/dnes' && m === 'PUT') {
      const telo = await nacistJson(req);
      if (telo.posun !== undefined) {
        const n = Number(telo.posun);
        if (!Number.isInteger(n) || Math.abs(n) > 3660) throw Object.assign(new Error('Posun musí být celé číslo dní.'), { status: 400 });
        return k.posunout(n);
      }
      return k.nastavitDnes(telo.datum);
    }
    if (p === '/api/den/nahled' && m === 'GET') return this.dalsiDen.nahled();
    if (p === '/api/den/dalsi' && m === 'POST') {
      const { dukladny } = await nacistJson(req);
      if (typeof dukladny !== 'boolean') throw Object.assign(new Error('Odpověz, jestli proběhl důkladný odpočinek.'), { status: 400 });
      return this.dalsiDen.provest({ dukladny });
    }
    return undefined;
  }

  async apiObchody(req, m, p) {
    const o = this.obchody;
    if (p === '/api/obchody' && m === 'GET') return o.seznam();
    if (p === '/api/obchody/ceniky' && m === 'GET') return o.ceniky();
    if (p === '/api/obchody/sortimenty' && m === 'POST') return o.ulozit(await nacistJson(req, 256 * 1024));
    const s = /^\/api\/obchody\/sortimenty\/([a-z0-9-]{1,80})$/.exec(p);
    if (s && m === 'GET') {
      const sortiment = o.sortimenty.get(s[1]);
      if (!sortiment) throw Object.assign(new Error('Sortiment neexistuje.'), { status: 404 });
      return { id: s[1], sortiment };
    }
    if (s && m === 'DELETE') return o.smazat(s[1]);
    const slot = /^\/api\/obchody\/sloty\/(\d)$/.exec(p);
    if (slot && m === 'PUT') {
      const { id } = await nacistJson(req);
      return o.nastavitSlot(slot[1], id ? String(id) : null);
    }
    return undefined;
  }

  async staticky(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw Object.assign(new Error('Metoda není povolena'), { status: 405 });
    if (url.pathname === '/nastroje/generator.html') {
      const html = await this.obchody.generator();
      res.writeHead(200, { 'Content-Type': TYPY_SOUBORU['.html'], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      return res.end(req.method === 'HEAD' ? undefined : html);
    }
    let soubor;
    let koren = this.c.panel;
    if (url.pathname === '/' || url.pathname === '/panel' || url.pathname === '/panel/') soubor = path.join(this.c.panel, 'index.html');
    else if (url.pathname.startsWith('/panel/')) soubor = path.join(this.c.panel, decodeURIComponent(url.pathname.slice(7)));
    else if (url.pathname.startsWith('/vystupy/')) {
      koren = this.c.vystupy;
      soubor = path.join(koren, decodeURIComponent(url.pathname.slice(9)));
    } else if (url.pathname.startsWith('/sdilene/')) {
      // Moduly sdílené serverem i výstupy (motor Harptos, orloj).
      koren = path.join(HUB_DIR, 'sdilene');
      soubor = path.join(koren, decodeURIComponent(url.pathname.slice(9)));
    } else throw Object.assign(new Error('Stránka neexistuje'), { status: 404 });
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
    clearTimeout(this.casovacOdpoctu);
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
