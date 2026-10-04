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
import { Vysilac, filtrUdalosti } from './sse.js';
import { Sezeni, datumCesky } from './sezeni.js';
import { Odpocet } from './odpocet.js';
import { jeVOneDrive, nainstalovatHook } from './prostredi.js';
import { Kalendar } from './kalendar.js';
import { DalsiDen } from './dalsiden.js';
import { Obchody } from './obchody.js';
import { HUB_DIR } from './cesty.js';
import { Mista } from './mista.js';
import { Scena } from './scena.js';
import { nacistStyl, sestavPrompt, ZABERY } from './dilna.js';

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
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/** Z kampan/ se přes HTTP servírují jen obrázky (výstupy pro OBS a náhledy v panelu). */
const OBRAZKY_KAMPANE = new Set(['.png', '.jpg', '.jpeg', '.webp']);

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const JMENA_LOOPBACKU = new Set(['127.0.0.1', 'localhost', '::1']);

/** Přihlášení PINem z domácí sítě platí 30 dní (nový PIN ho zruší hned). */
const PLATNOST_RELACE_MS = 30 * 24 * 3600 * 1000;
/** Po 5 chybných PINech z jedné adresy se další pokusy odmítají, nejdřív 60 s, pak déle (audit S5). */
const POKUSU_PINU = 5;

/**
 * Bezpečnostní hlavičky pro každou odpověď: panel nejde vložit do cizí stránky (audit N6).
 * Výstupy a náhled místa v panelu jsou ze stejného původu, takže je to neomezuje.
 */
const HLAVICKY_BEZPECNOSTI = {
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "frame-ancestors 'self'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

function poslatJson(res, status, data) {
  const telo = JSON.stringify(data);
  res.writeHead(status, { ...HLAVICKY_BEZPECNOSTI, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
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
    this.mista = new Mista({ cesty: this.c, zapisovac: this.zapisovac });
    this.scena = new Scena({ soubor: path.join(this.c.lokalniStav, 'scena.json'), mista: this.mista });
    this.casovacOdpoctu = null;
    this.server = null;
    this.spusteno = new Date().toISOString();
    this.prostredi = { oneDrive: jeVOneDrive(this.c.koren), hook: null };
    this.relace = new Map(); // token přihlášení PINem z domácí sítě -> čas přihlášení
    this.pokusyPinu = new Map(); // adresa -> { chyb, zamcenoDo }
    /** Funkce, která Hub restartuje (nastaví ji index.js, když běží pod spouštěčem). */
    this.restartovat = null;
    /** Proč je potřeba restart (stažený nový kód, změna portu), nebo null. */
    this.restartNutny = null;
  }

  infoServeru() {
    return { spusteno: this.spusteno, pid: process.pid, restartNutny: this.restartNutny, restartZPanelu: Boolean(this.restartovat) };
  }

  /** Po Stáhnout nebo Sloučit: změnil se kód Hubu? Pak běží starý server a je potřeba restart (audit S2). */
  oznacitZmenyKodu(soubory) {
    const kod = soubory.filter((f) => f.startsWith('hub/') && !f.startsWith('hub/test/'));
    if (!kod.length) return;
    this.restartNutny = kod.includes('hub/package-lock.json')
      ? 'Stáhl jsi novou verzi Hubu včetně knihoven. Restart je doinstaluje a spustí nový kód.'
      : 'Stáhl jsi novou verzi Hubu. Běží ale pořád ta stará, nová se spustí po restartu.';
    this.vysilac.vyslat('server', this.infoServeru());
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
    this.mista.on('zmena', (m) => {
      this.vysilac.vyslat('mista', m);
      this.scena.mistaZmenena();
    });
    this.scena.on('stav', (s) => this.vysilac.vyslat('scena', s));
    this.hlidac.on('zmena', ({ soubor }) => this.souborZmenen(soubor).catch(() => {}));

    await this.zapisovac.obnovit();
    await this.data.nacist();
    await this.kalendar.nacist();
    await this.obchody.nacist();
    await this.mista.nacist();
    await this.scena.nacist();
    await this.odpocet.nacist();
    this.vysilac.vyslat('odpocet', this.odpocet.verejny());
    await this.hlidac.spustit();

    this.server = http.createServer((req, res) => this.obsluha(req, res));
    this.server.on('upgrade', (req, socket, head) => this.upgrade(req, socket, head));
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
    if (await this.mista.souborZmenen(soubor)) {
      this.data.naplanovatKontrolu();
      return;
    }
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
      mista: this.mista.seznam(),
      scena: this.scena.verejny(),
      obs: this.obs.verejnyStav(),
      git: this.git.stav,
      nastaveni: this.nastaveni.verejne(),
      prostredi: this.prostredi,
      server: this.infoServeru(),
    };
  }

  /** Ochrana: jen localhost, nebo domácí síť s PINem. Hlavička Host brání útoku přes DNS rebinding. */
  povoleno(req) {
    const vzdaleny = !LOOPBACK.has(req.socket.remoteAddress);
    const host = String(req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    // Z tohoto počítače vždy jen s hlavičkou Host localhostu, i se zapnutou domácí sítí:
    // cizí stránka přes DNS rebinding má v Host svou doménu (audit S5).
    if (!vzdaleny) return JMENA_LOOPBACKU.has(host);
    if (!this.nastaveni.domaciSit) return false;
    const cookie = String(req.headers.cookie || '').match(/(?:^|;\s*)dmhub=([a-f0-9]+)/);
    const prihlasen = cookie ? this.relace.get(cookie[1]) : undefined;
    if (prihlasen === undefined) return false;
    if (Date.now() - prihlasen > PLATNOST_RELACE_MS) {
      this.relace.delete(cookie[1]);
      return false;
    }
    return true;
  }

  /** WebSocket pro živé změny (/api/zive): stejná pravidla přístupu jako HTTP a navíc stejný původ. */
  upgrade(req, socket, head) {
    socket.on('error', () => {});
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return socket.destroy();
    }
    // Cizí stránka v prohlížeči DM by se na WebSocket připojit uměla (WebSocket nehlídá CORS),
    // proto se kontroluje hlavička Origin: musí patřit Hubu, nebo chybět.
    const origin = req.headers.origin;
    let stejnyPuvod = !origin;
    if (origin) {
      try {
        stejnyPuvod = new URL(origin).host === req.headers.host;
      } catch {
        stejnyPuvod = false;
      }
    }
    if (url.pathname !== '/api/zive' || !stejnyPuvod || !this.povoleno(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return socket.destroy();
    }
    return this.vysilac.pripojitWs(req, socket, head, filtrUdalosti(url));
  }

  async obsluha(req, res) {
    try {
      // Rozbor adresy uvnitř ošetření chyb: poškozená adresa vrátí 400, ne pád spojení (audit N5).
      let url;
      try {
        url = new URL(req.url, 'http://localhost');
      } catch {
        throw Object.assign(new Error('Neplatná adresa'), { status: 400 });
      }
      if (url.pathname === '/prihlaseni' && this.nastaveni.domaciSit) return await this.prihlaseni(req, res, url);
      // Přihlašovací stránka z jiného zařízení potřebuje styly ještě před přihlášením.
      if (url.pathname === '/panel/styly.css' && this.nastaveni.domaciSit && req.method === 'GET') return await this.staticky(req, res, url);
      if (!this.povoleno(req)) {
        if (this.nastaveni.domaciSit && req.method === 'GET') {
          res.writeHead(302, { ...HLAVICKY_BEZPECNOSTI, Location: '/prihlaseni' });
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
      const adresa = req.socket.remoteAddress;
      const pokusy = this.pokusyPinu.get(adresa) ?? { chyb: 0, zamcenoDo: 0 };
      const zbyva = pokusy.zamcenoDo - Date.now();
      if (zbyva > 0) {
        return poslatJson(res, 429, { chyba: `Příliš mnoho chybných pokusů. Zkus to znovu za ${Math.ceil(zbyva / 1000)} s.` });
      }
      const telo = await nacistJson(req);
      const ocekavany = Buffer.from(String(this.nastaveni.hodnoty.PIN));
      const zadany = Buffer.from(String(telo.pin ?? ''));
      if (ocekavany.length !== zadany.length || !crypto.timingSafeEqual(ocekavany, zadany)) {
        pokusy.chyb++;
        if (pokusy.chyb >= POKUSU_PINU) {
          // 60 s, 120 s, 240 s … nejvýš 15 minut.
          pokusy.zamcenoDo = Date.now() + Math.min(60000 * 2 ** (pokusy.chyb - POKUSU_PINU), 15 * 60000);
        }
        this.pokusyPinu.set(adresa, pokusy);
        return poslatJson(res, 401, { chyba: 'Nesprávný PIN' });
      }
      this.pokusyPinu.delete(adresa);
      const token = crypto.randomBytes(24).toString('hex');
      this.relace.set(token, Date.now());
      res.setHeader('Set-Cookie', `dmhub=${token}; HttpOnly; SameSite=Strict; Path=/`);
      return poslatJson(res, 200, { ok: true });
    }
    return this.staticky(req, res, new URL('/panel/prihlaseni.html', url));
  }

  async api(req, res, url) {
    const m = req.method;
    const p = url.pathname;
    if (p === '/api/udalosti' && m === 'GET') return this.vysilac.pripojit(req, res, filtrUdalosti(url));
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
      const pred = { port: this.nastaveni.port, domaciSit: this.nastaveni.domaciSit };
      const puvodniObs = [this.nastaveni.hodnoty.OBS_URL, this.nastaveni.hodnoty.OBS_HESLO].join('\n');
      await this.nastaveni.ulozit(telo);
      if ([this.nastaveni.hodnoty.OBS_URL, this.nastaveni.hodnoty.OBS_HESLO].join('\n') !== puvodniObs) {
        this.obs.nastavit(this.nastaveni.hodnoty.OBS_URL, this.nastaveni.hodnoty.OBS_HESLO);
      }
      // Restart jen při změně toho, co server čte při startu (audit N4). Nový PIN ruší přihlášení.
      if (telo.pin) this.relace.clear();
      const restart = this.nastaveni.port !== pred.port || this.nastaveni.domaciSit !== pred.domaciSit;
      if (restart) {
        this.restartNutny = 'Změna portu nebo přístupu z domácí sítě se projeví po restartu Hubu.';
        this.vysilac.vyslat('server', this.infoServeru());
      }
      return poslatJson(res, 200, { nastaveni: this.nastaveni.verejne(), potrebaRestartu: restart, port: this.nastaveni.port });
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
      if (!scena) throw Object.assign(new Error('Scéna pro souboj není nastavená. Přiřaď ji na obrazovce U stolu v tabulce Role scén.'), { status: 409 });
      const zacatek = Date.now();
      await this.obs.prepnoutScenu(scena);
      return poslatJson(res, 200, { ok: true, scena, ms: Date.now() - zacatek });
    }
    if (p.startsWith('/api/kalendar') || p.startsWith('/api/den/')) {
      const v = await this.apiKalendar(req, m, p);
      if (v !== undefined) return poslatJson(res, 200, v);
    }
    if (p.startsWith('/api/mista') || p.startsWith('/api/scena') || p.startsWith('/api/dilna')) {
      const v = await this.apiMista(req, m, p, url);
      if (v !== undefined) return poslatJson(res, 200, v);
    }
    if (p.startsWith('/api/obchody')) {
      const v = await this.apiObchody(req, m, p);
      if (v !== undefined) return poslatJson(res, 200, v);
    }
    if (p === '/api/restart' && m === 'POST') {
      await nacistJson(req);
      if (!this.restartovat) {
        throw Object.assign(new Error('Hub neběží přes zástupce DM Hub, takže se nemůže restartovat sám. Zavři ho a spusť znovu.'), { status: 409 });
      }
      res.once('finish', () => setTimeout(() => this.restartovat(), 100));
      return poslatJson(res, 200, { ok: true, port: this.nastaveni.port });
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
      const pred = await this.git.hlava();
      await this.git.stahnout();
      this.oznacitZmenyKodu(await this.git.zmenyOd(pred));
      await this.data.nacist();
      await this.kalendar.nacist();
      await this.obchody.nacist();
      await this.mista.nacist();
      this.vysilac.vyslat('git', this.git.stav);
      return poslatJson(res, 200, this.git.stav);
    }
    if (p === '/api/git/sloucit' && m === 'POST') {
      await nacistJson(req);
      const pred = await this.git.hlava();
      const vysledek = await this.git.sloucit();
      this.oznacitZmenyKodu(await this.git.zmenyOd(pred));
      await this.data.nacist();
      await this.kalendar.nacist();
      await this.obchody.nacist();
      await this.mista.nacist();
      this.vysilac.vyslat('git', this.git.stav);
      return poslatJson(res, 200, { ...vysledek, git: this.git.stav });
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

  /** Přepne OBS na scénu místa, je-li nastavená. Chybu OBS vrátí jako text, scénu v Hubu nechá. */
  async prepnoutNaMisto() {
    const scena = this.nastaveni.hodnoty.OBS_SCENA_MISTO || null;
    if (!scena) return { scenaObs: null, chybaObs: null };
    try {
      await this.obs.prepnoutScenu(scena);
      return { scenaObs: scena, chybaObs: null };
    } catch (e) {
      return { scenaObs: scena, chybaObs: `OBS scénu nepřepnul: ${e.message}` };
    }
  }

  async apiMista(req, m, p, url) {
    if (p === '/api/mista' && m === 'GET') return this.mista.seznam();
    const il = /^\/api\/mista\/([a-z0-9-]{1,60})\/ilustrace\/([^/]{1,120})$/.exec(p);
    if (il && m === 'PUT') return this.mista.upravitIlustraci(il[1], decodeURIComponent(il[2]), await nacistJson(req));
    if (il && m === 'DELETE') return this.mista.smazatIlustraci(il[1], decodeURIComponent(il[2]));
    const popis = /^\/api\/mista\/([a-z0-9-]{1,60})\/popis$/.exec(p);
    if (popis && m === 'PUT') return this.mista.nastavitPopis(popis[1], (await nacistJson(req)).popis);

    if (p === '/api/scena' && m === 'GET') return this.scena.verejny();
    if (p === '/api/scena/zobrazit' && m === 'POST') {
      const telo = await nacistJson(req);
      const stav = await this.scena.zobrazit({ misto: telo.misto, ilustrace: telo.ilustrace });
      const obs = telo.prepnout ? await this.prepnoutNaMisto() : {};
      return { ...stav, ...obs };
    }
    if (p === '/api/scena/dalsi' && m === 'POST') {
      const { smer } = await nacistJson(req);
      return this.scena.posun(smer === -1 ? -1 : 1);
    }
    if (p === '/api/scena' && m === 'PUT') return this.scena.nastavit(await nacistJson(req));

    if (p === '/api/dilna/prompt' && m === 'GET') {
      const q = Object.fromEntries(url.searchParams);
      const misto = this.mista.get(q.misto);
      const styl = await nacistStyl(this.c.koren);
      return {
        prompt: sestavPrompt({
          misto,
          zaber: ZABERY[q.zaber] ? q.zaber : 'celek',
          varianta: q.varianta === 'noc' ? 'noc' : 'den',
          stav: q.stav || null,
          pocasi: q.pocasi || 'zadne',
          predloha: q.predloha === '1',
          styl,
        }),
        zabery: Object.keys(ZABERY),
      };
    }
    if (p === '/api/dilna/ilustrace' && m === 'POST') {
      // PNG je oříznuté a zvětšené v panelu; jde jako base64 v JSON (jen localhost, limit 40 MB).
      const telo = await nacistJson(req, 40 * 1024 * 1024);
      const png = Buffer.from(String(telo.png ?? ''), 'base64');
      if (telo.cil?.typ === 'obchod') return this.obchody.ulozitObrazek(String(telo.cil.id), png);
      return this.mista.pridatIlustraci(String(telo.cil?.id ?? ''), {
        png,
        zaber: telo.zaber,
        varianta: telo.varianta || null,
        stav: telo.stav || null,
        prompt: telo.prompt || '',
      });
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
    if (p === '/api/obchody/aktivni' && m === 'PUT') {
      // Ukázat v OBS: ceník převezme obchod a OBS přepne na scénu obchodu (je-li nastavená).
      const { id, prepnout } = await nacistJson(req);
      const seznam = await o.nastavitAktivni(id ? String(id) : null);
      let scena = null;
      let chybaObs = null;
      if (id && prepnout) {
        scena = this.nastaveni.hodnoty.OBS_SCENA_OBCHOD || null;
        if (!scena) chybaObs = 'Scéna obchodu není nastavená, OBS nepřepnul. Přiřaď ji na obrazovce U stolu v tabulce Role scén.';
        else {
          try {
            await this.obs.prepnoutScenu(scena);
          } catch (e) {
            chybaObs = `OBS scénu nepřepnul: ${e.message}`;
          }
        }
      }
      return { ...seznam, scena, chybaObs };
    }
    return undefined;
  }

  async staticky(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw Object.assign(new Error('Metoda není povolena'), { status: 405 });
    if (url.pathname === '/nastroje/generator.html') {
      const html = await this.obchody.generator();
      res.writeHead(200, { ...HLAVICKY_BEZPECNOSTI, 'Content-Type': TYPY_SOUBORU['.html'], 'Cache-Control': 'no-cache' });
      return res.end(req.method === 'HEAD' ? undefined : html);
    }
    let soubor;
    let koren = this.c.panel;
    if (url.pathname === '/' || url.pathname === '/panel' || url.pathname === '/panel/') soubor = path.join(this.c.panel, 'index.html');
    else if (url.pathname.startsWith('/panel/')) soubor = path.join(this.c.panel, decodeURIComponent(url.pathname.slice(7)));
    else if (url.pathname.startsWith('/vystupy/')) {
      koren = this.c.vystupy;
      soubor = path.join(koren, decodeURIComponent(url.pathname.slice(9)));
    } else if (url.pathname.startsWith('/kampan/')) {
      koren = this.c.kampan;
      soubor = path.join(koren, decodeURIComponent(url.pathname.slice(8)));
      if (!OBRAZKY_KAMPANE.has(path.extname(soubor).toLowerCase())) throw Object.assign(new Error('Stránka neexistuje'), { status: 404 });
    } else if (url.pathname.startsWith('/sdilene/')) {
      // Moduly sdílené serverem i výstupy (motor Harptos, orloj).
      koren = path.join(HUB_DIR, 'sdilene');
      soubor = path.join(koren, decodeURIComponent(url.pathname.slice(9)));
    } else if (
      OBRAZKY_KAMPANE.has(path.extname(url.pathname).toLowerCase()) &&
      (url.pathname.startsWith('/monsters/') || !url.pathname.slice(1).includes('/'))
    ) {
      // Ilustrace s cestou od kořene repa (/monsters/…, portréty /Alba.png): jen obrázky (audit N2).
      koren = this.c.koren;
      soubor = path.join(koren, decodeURIComponent(url.pathname.slice(1)));
    } else throw Object.assign(new Error('Stránka neexistuje'), { status: 404 });
    const rel = path.relative(koren, soubor);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw Object.assign(new Error('Stránka neexistuje'), { status: 404 });
    let obsah;
    let info;
    try {
      info = await fs.stat(soubor);
      if (!info.isFile()) throw new Error('není soubor');
    } catch {
      throw Object.assign(new Error('Stránka neexistuje'), { status: 404 });
    }
    // ETag: obrázky ve výstupech se při každém prolnutí jen ověří (304), nestahují se znovu.
    const etag = `"${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}"`;
    const hlavicky = {
      ...HLAVICKY_BEZPECNOSTI,
      'Content-Type': TYPY_SOUBORU[path.extname(soubor).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ETag: etag,
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, hlavicky);
      return res.end();
    }
    try {
      obsah = await fs.readFile(soubor);
    } catch {
      throw Object.assign(new Error('Stránka neexistuje'), { status: 404 });
    }
    res.writeHead(200, hlavicky);
    res.end(req.method === 'HEAD' ? undefined : obsah);
  }

  async zastavit() {
    clearTimeout(this.casovacOdpoctu);
    this.scena.zastavit();
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
