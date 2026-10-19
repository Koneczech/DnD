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
import { Kanon } from './kanon-modul.js';
import { Scena } from './scena.js';
import { Svetla, ROLE as ROLE_SVETEL } from './svetla.js';
import { Hue } from './zarizeni/hue.js';
import { Zvuk, TYPY_ZVUKU } from './zvuk.js';
import { Iniciativa } from './iniciativa.js';
import { PruchodIniciativy } from './iniciativa-pruchod.js';
import { SledovaniHp } from './iniciativa-hp.js';
import { CteniPlayerView } from './iniciativa-cteni.js';
import { ZivyPlayerView } from './iniciativa-zive.js';
import { Udery } from './udery.js';
import { Zaznam } from './zaznam.js';
import { createReadStream } from 'node:fs';
import { nacistStyl, sestavPrompt, ZABERY } from './dilna.js';

/**
 * Otisk kódu panelu a výstupů (obsah souborů v panel/, vystupy/ a sdilene/). Posílá se klientům
 * jako událost „verze“: když se po restartu Hubu změní, stránka se sama obnoví. OBS si jinak drží
 * starou verzi výstupu z mezipaměti a nové funkce (třeba kombinované počasí) v něm nefungují.
 */
export async function otiskKodu(slozky) {
  const hash = crypto.createHash('sha1');
  async function projit(slozka) {
    let polozky = [];
    try {
      polozky = await fs.readdir(slozka, { withFileTypes: true });
    } catch {
      return;
    }
    for (const p of polozky.sort((a, b) => a.name.localeCompare(b.name))) {
      const cesta = path.join(slozka, p.name);
      if (p.isDirectory()) await projit(cesta);
      else if (/\.(html|js|css)$/.test(p.name)) hash.update(p.name).update(await fs.readFile(cesta));
    }
  }
  for (const s of slozky) await projit(s);
  return hash.digest('hex').slice(0, 12);
}

/** Po kolika ms od konce odpočtu se scéna po restartu Hubu ještě přepne (bod 21). */
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
  constructor({ cesty = vychoziCesty(), obsKlient, gitSit = true, port, ovladaceSvetel, sparovatHue, fetchZvuky, ziveIniciativa } = {}) {
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
    // Modul Kánon (Blok 3): mapa entit, karty, pohled družiny, nástěnky.
    this.kanon = new Kanon({ cesty: this.c, zapisovac: this.zapisovac, nastaveni: () => this.nastaveni.hodnoty });
    this.scena = new Scena({ soubor: path.join(this.c.lokalniStav, 'scena.json'), mista: this.mista });
    this.svetla = new Svetla({
      cesty: this.c,
      nastaveni: () => this.nastaveni.hodnoty,
      misto: (id) => this.mista.mista.get(id) ?? null,
      scena: () => this.scena.stav,
      ovladace: ovladaceSvetel,
    });
    this.zvuk = new Zvuk({
      cesty: this.c,
      nastaveni: () => this.nastaveni.hodnoty,
      misto: (id) => this.mista.mista.get(id) ?? null,
      scena: () => this.scena.stav,
      vrstvy: () => this.svetla.vrstvy,
      mista: () => [...this.mista.mista.values()],
      // Scéna Start v OBS: hraje hudba ze kampan/sceny/rezim/start.yaml (⚠ návrh DM 19. 10. 2026).
      start: () => Boolean(this.obs.aktualniScena) && this.obs.aktualniScena === this.nastaveni.hodnoty.OBS_SCENA_START,
      fetchZvuky,
    });
    this.data.dalsiKontroly = () => this.zvuk.kontrola();
    this.iniciativa = new Iniciativa({ cesty: this.c, obs: this.obs });
    // Záznam událostí (bod 84): co se dělo a co selhalo, i do hub/.stav/zaznam/.
    this.zaznam = new Zaznam({ slozka: path.join(this.c.lokalniStav, 'zaznam') });
    // Player View se čte jen během souboje, jednou za sekundu pro celý Hub (bod 75).
    // Živé spojení (socket.io jako Player View na TV) přinese změnu tahu hned; čtení je pojistka.
    this.cteniPlayerView = new CteniPlayerView({
      odkaz: () => this.iniciativa.odkaz,
      aktivni: () => this.scena.stav.rezim === 'souboj',
      zive: ziveIniciativa === undefined ? new ZivyPlayerView() : ziveIniciativa,
    });
    // Světla podle HP (bod 72) a zvuky na tahu (bod 76): ze stavu, který přečetlo cteniPlayerView.
    this.sledovaniHp = new SledovaniHp({
      odkaz: () => this.iniciativa.odkaz,
      // Player View se čte celý souboj (zvuky na tahu); málo HP jen se zapnutým vypínačem.
      // Obraz pulzuje i s vypnutým Řídit světla; lampa jen s ním (hlídá Svetla).
      aktivni: () => this.scena.stav.rezim === 'souboj',
      hlidatHp: () => this.nastaveni.hodnoty.HP_SVETLA !== '0',
      nacist: () => this.cteniPlayerView.posledni(),
    });
    // Animace zásahu (bod 75): výstup uder.html.
    this.udery = new Udery();
    this.sledovaniHp.on('zmena', (k) => this.svetla.nastavitKritickeHp(k));
    this.sledovaniHp.on('tah', (kdo) => this.zvuk.tah(kdo));
    this.svetla.on('kriticke-hp', (k) => {
      // Obraz tepe v rytmu lampy: délka cyklu = fáze A + B z Nastavení → Světla.
      const hp = this.svetla.mistni.hp;
      this.vysilac.vyslat('kriticke-hp', k ? { ...k, cyklus_s: hp.a.s + hp.b.s } : null);
      this.zvuk.nastavitKritickeHp(Boolean(k));
    });
    this.sparovatHue = sparovatHue ?? ((v) => Hue.sparovat(v));
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
    /** Naplánovaný restart po Aktualizovat (bod 91): čas v ms, nebo null. */
    this.restartV = null;
    this.casovacRestartu = null;
    /** Commit, se kterým Hub běží: `git pull` mimo Hub (PowerShell) se pozná podle změny. */
    this.hlavaKodu = null;
  }

  infoServeru() {
    return {
      spusteno: this.spusteno,
      pid: process.pid,
      restartNutny: this.restartNutny,
      restartZPanelu: Boolean(this.restartovat),
      restartV: this.restartV,
    };
  }

  /**
   * Po aktualizaci s novým kódem se Hub restartuje sám za 5 s (panel ukáže odpočet a „Teď ne“).
   * Během sezení ne: jen nabídne restart, ať se neztratí hudba ani světla uprostřed hry.
   * @returns {'auto'|'rucne'|'nejde'}
   */
  naplanovatRestart(zaMs = 5000) {
    if (!this.restartovat) return 'nejde';
    if (this.data.stav?.sezeniBezi) return 'rucne';
    clearTimeout(this.casovacRestartu);
    this.restartV = Date.now() + zaMs;
    this.casovacRestartu = setTimeout(() => {
      this.zaznam.info('hub', 'Restart po aktualizaci');
      this.restartovat();
    }, zaMs);
    this.casovacRestartu.unref?.();
    this.vysilac.vyslat('server', this.infoServeru());
    return 'auto';
  }

  zrusitRestart() {
    clearTimeout(this.casovacRestartu);
    this.casovacRestartu = null;
    this.restartV = null;
    this.vysilac.vyslat('server', this.infoServeru());
  }

  /** `git pull` mimo Hub: změnil se commit a s ním kód Hubu? Pak nabídne restart. */
  async zkontrolovatHlavu() {
    const hlava = await this.git.hlava().catch(() => null);
    if (!hlava || !this.hlavaKodu || hlava === this.hlavaKodu) return;
    const zmeny = await this.git.zmenyOd(this.hlavaKodu);
    this.hlavaKodu = hlava;
    this.oznacitZmenyKodu(zmeny);
    this.obnovitGit(false);
  }

  /**
   * Záznam událostí (bod 84): poslouchá části Hubu a zapisuje změny a chyby. Stavy, které se
   * hlásí opakovaně (stránky zvuku, OBS, světla), se zapisují jen při změně.
   */
  pripojitZaznam() {
    const z = this.zaznam;
    z.posluchac = (polozka) => this.vysilac.vyslat('zaznam', polozka);
    const puvodni = z.zapsat.bind(z);
    z.zapsat = (...a) => {
      const p = puvodni(...a);
      z.posluchac?.(p);
      return p;
    };
    this.scena.on('stav', (s) => {
      const pocasi = (s.pocasi ?? []).join('+') || 'bez počasí';
      z.zmena('scena', 'scena', 'info', `${s.misto?.nazev ?? 'bez místa'} · ${s.varianta} · ${s.rezim} · ${pocasi}${s.pocasi?.length ? ` ${s.intenzita}` : ''}${s.stav ? ` · stav ${s.stav}` : ''}`);
    });
    this.obs.on('stav', (s) => {
      z.zmena('obs', 'obs', s.pripojeno ? 'info' : s.nastaveno ? 'varovani' : 'info', s.pripojeno ? `OBS připojené, scéna ${s.aktualniScena ?? '?'}` : `OBS nepřipojené${s.chyba ? `: ${s.chyba}` : ''}`);
    });
    this.zvuk.on('zvuk', (v) => {
      const amb = v.ambient.map((a) => `${a.soubor} ${Math.round(a.hlasitost * 100)} %`).join(', ') || 'žádný';
      z.zmena('zvuk-co', 'zvuk', 'info', `Hraje: hudba ${v.hudba?.soubor ?? 'žádná'} (${v.hudbaKde}) · ambient ${amb}${v.smycky?.length ? ` · smyčky ${v.smycky.map((x) => x.soubor).join(', ')}` : ''}${v.nahodne?.length ? ` · náhodné ${v.nahodne.map((n) => n.zvuk).join(', ')}` : ''}${v.dozvuk && v.dozvuk !== 'zadny' ? ` · dozvuk ${v.dozvuk}` : ''}${v.ticho ? ' · TICHO' : ''}${v.tlumeni?.aktivni ? ' · ucpané uši' : ''}`);
    });
    this.zvuk.on('stav', (s) => {
      for (const [nazev, x] of Object.entries(s.stranky ?? {})) {
        if (!s.potrebne?.includes(nazev) && !x.pripojeno) continue;
        const popis = !x.pripojeno ? 'neotevřená' : x.odemceno === false ? 'čeká na kliknutí' : `hraje ${x.hraje?.join(', ') || 'nic'}${x.vystup ? ` do ${x.vystup.nazev}${x.vystup.ok === false ? ' (ODPOJENÝ)' : ''}` : ''}`;
        z.zmena(`stranka-${nazev}`, 'stranka', 'info', `Zvuk ${nazev === 'stul' ? 'u stolu' : 'v OBS'}: ${popis}`);
        const klicChyby = `stranka-${nazev}-chyba`;
        if (x.chyba) z.zmena(klicChyby, 'stranka', 'chyba', `Zvuk ${nazev === 'stul' ? 'u stolu' : 'v OBS'}: ${x.chyba}`);
        else if (z.posledni.has(klicChyby)) {
          z.posledni.delete(klicChyby);
          z.info('stranka', `Zvuk ${nazev === 'stul' ? 'u stolu' : 'v OBS'}: chyba pominula`);
        }
      }
      if (!this.zvuk.prohledano) return; // před prvním projitím složky by „chybělo“ všechno
      if (s.chybiTed?.length) z.zmena('zvuk-chybi', 'zvuk', 'varovani', `Ve složce zvuku chybí: ${s.chybiTed.join(', ')}`);
      else z.zmena('zvuk-chybi', 'zvuk', 'info', 'Všechny soubory scény ve složce jsou');
    });
    this.zvuk.on('sada', (s) => z[s.chyba ? 'varovani' : 'info']('zvuk', `Zvuková sada: ${s.text} (${s.hotovo}/${s.celkem})${s.chyba ? ` ${s.chyba}` : ''}`));
    this.zvuk.on('efekt', (e) => {
      if (!e.test) z.info('zvuk', `Efekt ${e.soubor ?? ''}${e.cil === 'hudba' ? ' (OBS)' : ''}`);
    });
    this.svetla.on('stav', (s) => {
      for (const d of s.zarizeni ?? []) {
        z.zmena(`svetlo-${d.klic}`, 'svetla', d.ok === false ? 'chyba' : 'info', `${d.role} ${d.typ === 'hue' ? 'Hue' : `WiZ ${d.id}`}: ${d.ok === false ? d.chyba ?? 'neodpovídá' : d.ok ? 'odpovídá' : 'zjišťuji'}`);
      }
      z.zmena('svetla-rizeni', 'svetla', 'info', `Řídit světla: ${s.ridit ? 'ano' : 'ne'}`);
    });
    this.svetla.on('kriticke-hp', (k) => z.zmena('kriticke-hp', 'svetla', 'info', k ? `Málo HP: ${k.jmeno} ${k.hp}/${k.max}` : 'Málo HP: konec'));
    this.svetla.on('blesk', (b) => z.info('svetla', `Blesk (${b.vzdalenost})`));
    this.cteniPlayerView.on('chyba', (t) => z.zmena('pv-chyba', 'iniciativa', t ? 'varovani' : 'info', t ?? 'Player View se čte bez chyby'));
    this.udery.on('uder', (u) => z.info('iniciativa', `Zásah: ${u.utocnik?.jmeno ?? '?'} → ${u.cile.map((c) => `${c.jmeno} ${c.druh === 'leceni' ? '+' : '−'}${c.o ?? (Number.isFinite(c.podil) ? `${Math.round(c.podil * 100)} %` : '?')}${c.padl ? ' (k zemi)' : ''}`).join(', ')}`));
    this.sledovaniHp.on('tah', (k) => z.info('iniciativa', `Na tahu: ${k.jmeno}${k.tagy.length ? ` [${k.tagy.join(', ')}]` : ''}${this.cteniPlayerView.zdroj === 'zive' ? ' (živě)' : ''}`));
    this.cteniPlayerView.zive?.on('spojeni', (ano) => z.zmena('iniciativa-zive', 'iniciativa', 'info', ano ? 'Živé spojení s Improved Initiative: připojeno' : 'Živé spojení s Improved Initiative: odpojeno (tahy se čtou každou sekundu)'));
    this.iniciativa.on('stav', () => {
      const i = this.stavIniciativy();
      z.zmena('ii-odkaz', 'iniciativa', i.chyba ? 'varovani' : 'info', `Player View ${i.odkaz ?? 'bez odkazu'}${i.chyba ? `: ${i.chyba}` : ''}`);
      const p = i.pruchod;
      if (p) z.zmena('ii-ucet', 'iniciativa', p.prihlasen === false || (p.ucet && (!p.ucet.encounterId || !p.ucet.portrety)) ? 'varovani' : 'info', `Epic účet: ${p.prihlasen === true ? 'přihlášen' : p.prihlasen === false ? 'NEPŘIHLÁŠEN' : 'ověřuji'}${p.ucet ? `, Encounter ID ${p.ucet.encounterId ?? 'CHYBÍ'}, portréty ${p.ucet.portrety ? 'ano' : 'NE'}` : ''}`);
    });
    this.odpocet.on('stav', (s) => z.zmena('odpocet', 'odpocet', 'info', `Odpočet: ${s.stav}${s.konec ? ` do ${s.konec}` : ''}`));
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
    this.zaznam.info('hub', 'Hub se spouští', { pid: process.pid, node: process.version });
    this.zaznam.uklidit().catch(() => {});
    this.pripojitZaznam();

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
      // Přepnutí na scénu Start (a z ní) mění hudbu; stránky dostanou jen skutečnou změnu.
      this.zvuk.zmenaSceny();
      if (s.pripojeno) this.hlidatOdpocet();
      // Po (opětovném) připojení OBS dostane poslední odkaz na Player View.
      if (s.pripojeno && !this.obsBylPripojen) this.iniciativa.doObs().catch(() => {});
      this.obsBylPripojen = s.pripojeno;
    });
    this.iniciativa.on('stav', () => this.vysilac.vyslat('iniciativa', this.stavIniciativy()));
    this.cteniPlayerView.on('stav', (id, stav) => {
      this.udery.zpracovat(id, stav);
      // Změna tahu a málo HP hned s novým stavem, ne až s dalším tikem časovače (zvuky tahů bez zpoždění).
      this.sledovaniHp.krok().catch(() => {});
    });
    this.cteniPlayerView.on('chyba', (text) => this.udery.nastavitChybu(text));
    this.udery.on('uder', (u) => this.vysilac.vyslat('uder', u));
    this.udery.on('stav', (s) => this.vysilac.vyslat('uder-stav', s));
    this.odpocet.on('stav', (s) => {
      this.vysilac.vyslat('odpocet', s);
      this.hlidatOdpocet();
      this.svetla.odpocet(this.odpocet.stav); // start hry: světla plynou do výchozího stavu (bod 77)
    });
    this.kalendar.on('zmena', (k) => this.vysilac.vyslat('kalendar-dm', k));
    this.kalendar.on('verejne', (k) => this.vyslatKalendar(k));
    this.obchody.on('zmena', (o) => this.vysilac.vyslat('obchody', o));
    this.kanon.on('zmena', (k) => this.vysilac.vyslat('kanon', k));
    this.obchody.on('ceniky', (c) => this.vysilac.vyslat('ceniky', c));
    this.mista.on('zmena', (m) => {
      this.vysilac.vyslat('mista', m);
      this.scena.mistaZmenena(); // vyšle 'stav' scény a ta pošle i světla místa
    });
    this.scena.on('stav', (s) => {
      this.vysilac.vyslat('scena', s);
      this.svetla.zmenaSceny();
      this.zvuk.zmenaSceny();
    });
    this.zvuk.on('zvuk', (z) => this.vysilac.vyslat('zvuk', z));
    this.zvuk.on('efekt', (e) => this.vysilac.vyslat('zvuk-efekt', e));
    this.zvuk.on('stav', (z) => this.vysilac.vyslat('zvuk-stav', z));
    this.zvuk.on('soubory', () => this.data.naplanovatKontrolu());
    this.svetla.on('stav', (s) => this.vysilac.vyslat('svetla', s));
    this.svetla.on('blesk', (b) => {
      this.vysilac.vyslat('blesk', b);
      this.zvuk.hrom(b); // hrom za 0–8 s podle vzdálenosti (Blok 4, tabulka Blesky)
    });
    this.hlidac.on('zmena', ({ soubor }) => this.souborZmenen(soubor).catch(() => {}));

    await this.zapisovac.obnovit();
    await this.data.nacist();
    await this.kalendar.nacist();
    await this.obchody.nacist();
    await this.mista.nacist();
    await this.kanon.nacist();
    await this.scena.nacist();
    await this.svetla.nacist();
    await this.zvuk.nacist();
    await this.iniciativa.nacist();
    this.cteniPlayerView.spustit();
    this.sledovaniHp.spustit();
    this.vysilac.vyslat('uder-stav', this.udery.verejny());
    if (this.obs.pripojeno) this.iniciativa.doObs().catch(() => {});
    await this.odpocet.nacist();
    this.vysilac.vyslat('odpocet', this.odpocet.verejny());
    this.vysilac.vyslat('verze', await otiskKodu([this.c.panel, this.c.vystupy, path.join(HUB_DIR, 'sdilene')]));
    await this.hlidac.spustit();

    const host = this.nastaveni.domaciSit ? '0.0.0.0' : '127.0.0.1';
    const port = this.portPrepis ?? this.nastaveni.port;
    // Průchod k Improved Initiative startuje dřív než panel: první přehled ho už musí znát,
    // jinak by se vložený Improved Initiative načetl napřímo bez přihlášení (port 0 = testy, volný port).
    this.portPruchodu = port ? port + 1 : 0;
    await this.zajistitPruchod();
    this.server = http.createServer((req, res) => this.obsluha(req, res));
    this.server.on('upgrade', (req, socket, head) => this.upgrade(req, socket, head));
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
    this.hlavaKodu = await this.git.hlava().catch(() => null);
    this.casovacHlavy = setInterval(() => this.zkontrolovatHlavu().catch(() => {}), 15000);
    this.casovacHlavy.unref?.();
    this.hlidatOdpocet();
    this.svetla.odpocet(this.odpocet.stav);
    this.svetla.zmenaSceny();
    this.svetla.overit().catch(() => {});
    return this;
  }

  async souborZmenen(soubor) {
    // Kánon čte všechny karty (i místa), takže se dozví o každé změně a ostatní moduly pokračují.
    this.kanon.souborZmenen(soubor);
    // Vrstvy světel (kampan/sceny/…): načíst znovu a poslat na světla.
    const relSceny = path.relative(path.join(this.c.kampan, 'sceny'), path.resolve(soubor));
    if (!relSceny.startsWith('..') && !path.isAbsolute(relSceny)) {
      await this.svetla.nacistVrstvy();
      this.svetla.zmenaSceny();
      this.zvuk.zmenaSceny();
      this.svetla.oznam();
      this.data.naplanovatKontrolu();
      return;
    }
    if (path.resolve(soubor) === path.join(this.c.kampan, 'zvuky-sada.yaml')) {
      await this.zvuk.nacistSadu();
      this.data.naplanovatKontrolu();
      return;
    }
    if (path.resolve(soubor) === path.join(this.c.kampan, 'zvuky.yaml')) {
      await this.zvuk.nacistMapu();
      this.data.naplanovatKontrolu();
      return;
    }
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
      svetla: this.svetla.verejny(),
      zvuk: this.zvuk.stav(),
      obs: this.obs.verejnyStav(),
      iniciativa: this.stavIniciativy(),
      git: this.git.stav,
      nastaveni: { ...this.nastaveni.verejne(), obsidianTrezorVychozi: path.basename(this.c.koren) },
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
      if (url.pathname.startsWith('/audio/')) return await this.zvukovySoubor(req, res, url);
      return await this.staticky(req, res, url);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) this.zaznam?.chyba('http', `${req.method} ${String(req.url).split('?')[0]}: ${e.message}`);
      if (!res.headersSent) poslatJson(res, status, { chyba: e.message, ...(e.kod ? { kod: e.kod } : {}) });
      else res.end();
    }
  }

  async prihlaseni(req, res, url) {
    if (req.method === 'POST') {
      // Nejdřív tělo, pak bez dalšího čekání kontrola zámku, porovnání a počítadlo: souběžné
      // požadavky s pomalu posílaným tělem tak zámek neobejdou (revize oprav).
      const telo = await nacistJson(req);
      const adresa = req.socket.remoteAddress;
      const pokusy = this.pokusyPinu.get(adresa) ?? { chyb: 0, zamcenoDo: 0 };
      const zbyva = pokusy.zamcenoDo - Date.now();
      if (zbyva > 0) {
        return poslatJson(res, 429, { chyba: `Příliš mnoho chybných pokusů. Zkus to znovu za ${Math.ceil(zbyva / 1000)} s.` });
      }
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
      delete telo.hueSparovani; // klíč Hue zapisuje jen spárování na serveru
      const pred = { port: this.nastaveni.port, domaciSit: this.nastaveni.domaciSit };
      const puvodniObs = [this.nastaveni.hodnoty.OBS_URL, this.nastaveni.hodnoty.OBS_HESLO].join('\n');
      await this.nastaveni.ulozit(telo);
      if ([this.nastaveni.hodnoty.OBS_URL, this.nastaveni.hodnoty.OBS_HESLO].join('\n') !== puvodniObs) {
        this.obs.nastavit(this.nastaveni.hodnoty.OBS_URL, this.nastaveni.hodnoty.OBS_HESLO);
      }
      if (telo.iiRelace || telo.smazatIiRelace) await this.zajistitPruchod();
      if (telo.freesoundKlic || telo.smazatFreesoundKlic) this.zvuk.oznamStav();
      this.svetla.sestavitZarizeni();
      this.svetla.zmenaSceny();
      this.svetla.overit().catch(() => {});
      if (telo.zvukSlozka !== undefined) {
        await this.zvuk.prohledat();
        this.data.naplanovatKontrolu();
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
      const vysledek = await this.sezeni.poznamka(text);
      // Obrazovka Sezení ukazuje poznámky: pošli je hned, ne až s další změnou stavu.
      this.sezeni.verejne().then((s) => this.vysilac.vyslat('sezeni', s)).catch(() => {});
      return poslatJson(res, 200, vysledek);
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
    if (p === '/api/zaznam' && m === 'GET') {
      const n = Number(url.searchParams.get('n')) || 300;
      const od = Number(url.searchParams.get('od')) || 0;
      return poslatJson(res, 200, { polozky: this.zaznam.vypis({ n, od, jenProblemy: url.searchParams.get('problemy') === '1' }) });
    }
    if (p === '/api/zaznam/text' && m === 'GET') {
      res.writeHead(200, { ...HLAVICKY_BEZPECNOSTI, 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="dm-hub-zaznam-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt"` });
      return res.end(this.zaznam.text());
    }
    if (p === '/api/zaznam' && m === 'POST') {
      // Chyba ze stránky (panel, výstup v OBS): zdroj je jméno stránky, nic dalšího se nepřebírá.
      const telo = await nacistJson(req);
      this.zaznam.chyba('stranka', `${String(telo.zdroj ?? '?').slice(0, 40)}: ${String(telo.zprava ?? '').slice(0, 400)}`);
      return poslatJson(res, 200, { ok: true });
    }
    if (p === '/api/iniciativa/overit' && m === 'POST') {
      await nacistJson(req);
      await this.pruchod?.overit();
      return poslatJson(res, 200, this.stavIniciativy());
    }
    if (p === '/api/iniciativa' && m === 'PUT') {
      const telo = await nacistJson(req);
      return poslatJson(res, 200, await this.iniciativa.nastavit(telo.odkaz));
    }
    if ((p === '/api/souboj' || p === '/api/obs/souboj') && m === 'POST') {
      const telo = await nacistJson(req);
      const v = await this.souboj(telo.zapnout !== false, { fanfara: telo.fanfara !== false });
      this.zaznam[v.chybaObs ? 'varovani' : 'info']('souboj', `${telo.zapnout !== false ? 'Souboj začal' : `Konec souboje${telo.fanfara === false ? ' potichu' : ''}`}${v.chybaObs ? `: ${v.chybaObs}` : ''}`);
      return poslatJson(res, 200, v);
    }
    if (p.startsWith('/api/zvuk')) {
      const v = await this.apiZvuk(req, m, p, url);
      if (v !== undefined) return poslatJson(res, 200, v);
    }
    if (p.startsWith('/api/svetla')) {
      const v = await this.apiSvetla(req, m, p);
      if (v !== undefined) return poslatJson(res, 200, v);
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
    if (p.startsWith('/api/kanon')) {
      const v = await this.apiKanon(req, m, p, url);
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
    if (p === '/api/git/aktualizovat' && m === 'POST') {
      await nacistJson(req);
      const pred = await this.git.hlava();
      const vysledek = await this.git.aktualizovat(`Úpravy z panelu — ${datumCesky()}`);
      const zmeny = await this.git.zmenyOd(pred);
      this.hlavaKodu = await this.git.hlava();
      this.oznacitZmenyKodu(zmeny);
      if (zmeny.length) {
        await this.data.nacist();
        await this.kalendar.nacist();
        await this.obchody.nacist();
        await this.mista.nacist();
      }
      const restart = this.restartNutny && zmeny.some((f) => f.startsWith('hub/') && !f.startsWith('hub/test/')) ? this.naplanovatRestart() : null;
      this.zaznam.info('git', `Aktualizovat: ${vysledek.ulozeno ? 'úpravy uloženy, ' : ''}staženo ${vysledek.stazeno}, ${vysledek.push ? 'odesláno' : 'neodesláno'}${restart ? `, restart ${restart}` : ''}`);
      this.vysilac.vyslat('git', this.git.stav);
      return poslatJson(res, 200, { ...vysledek, restart, git: this.git.stav });
    }
    if (p === '/api/restart/zrusit' && m === 'POST') {
      await nacistJson(req);
      this.zrusitRestart();
      return poslatJson(res, 200, this.infoServeru());
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

  /**
   * Souboj / Konec souboje (rozhodnutí 60). Zahájení si zapamatuje scénu OBS, která běžela,
   * přepne na scénu Souboj a světla na bojová. Konec vrátí OBS i světla do stavu před soubojem.
   * Scéna Hubu se přepne i bez OBS; chyba OBS se jen ohlásí.
   */
  async souboj(zapnout, { fanfara = true } = {}) {
    let scenaObs = null;
    let chybaObs = null;
    if (zapnout) {
      scenaObs = this.nastaveni.hodnoty.OBS_SCENA_SOUBOJ || null;
      if (!scenaObs) throw Object.assign(new Error('Scéna pro souboj není nastavená. Přiřaď ji v Nastavení → Role scén v OBS.'), { status: 409 });
      const predtim = this.scena.stav.rezim === 'souboj' ? undefined : this.obs.aktualniScena ?? null;
      if (predtim !== undefined) this.scena.zahajitSouboj({ obsScena: predtim === scenaObs ? null : predtim });
    } else {
      const bezel = this.scena.stav.rezim === 'souboj';
      // Konec souboje (⚠ návrh DM 19. 10. 2026): buben v dozvuku a bojová hudba pomalu dozní.
      // Musí být před přepnutím scény, aby přepnutí už mělo delší prolnutí. „Konec potichu“ jen dozní.
      if (bezel) this.zvuk.konecSouboje({ zvuk: fanfara });
      scenaObs = this.scena.ukoncitSouboj().obsScena;
    }
    const zacatek = Date.now();
    if (scenaObs) {
      try {
        await this.obs.prepnoutScenu(scenaObs);
      } catch (e) {
        chybaObs = `OBS scénu nepřepnul: ${e.message}`;
      }
    }
    return { ok: !chybaObs, rezim: this.scena.stav.rezim, scena: scenaObs, chybaObs, ms: Date.now() - zacatek };
  }

  async apiZvuk(req, m, p, url) {
    const z = this.zvuk;
    if (p === '/api/zvuk' && m === 'GET') {
      // Stránky (hudba, stůl) chtějí jen co hrát, panel celý stav.
      return url.searchParams.get('pro') === 'stranka' ? z.verejny() : z.stav();
    }
    if (p === '/api/zvuk' && m === 'PUT') return z.nastavit(await nacistJson(req));
    if (p === '/api/zvuk/soubory' && m === 'GET') return { soubory: z.soubory, slozka: z.slozka, slozkaExistuje: z.slozkaExistuje };
    if (p === '/api/zvuk/prohledat' && m === 'POST') {
      await nacistJson(req);
      await z.prohledat();
      this.data.naplanovatKontrolu();
      return z.stav();
    }
    if (p === '/api/zvuk/hlaseni' && m === 'POST') {
      const telo = await nacistJson(req);
      return z.hlasit(String(telo.stranka), telo);
    }
    if (p === '/api/zvuk/efekt' && m === 'POST') return z.efekt(await nacistJson(req));
    // Srovnání hlasitosti a zvuková sada (bod 86).
    if (p === '/api/zvuk/mereni' && m === 'POST') return z.zapsatMereni(await nacistJson(req));
    if (p === '/api/zvuk/sada/doplnit' && m === 'POST') {
      const telo = await nacistJson(req);
      return z.doplnitSadu({ cil: typeof telo.cil === 'string' ? telo.cil : null, soubor: typeof telo.soubor === 'string' ? telo.soubor : null, vymenit: telo.vymenit === true });
    }
    if (p === '/api/zvuk/smycka' && m === 'PUT') return z.smycka(await nacistJson(req));
    if (p === '/api/zvuk/smycky/zastavit' && m === 'POST') {
      await nacistJson(req);
      return z.zastavitSmycky();
    }
    return undefined;
  }

  /**
   * Zvukové soubory ze složky mimo repo (rozhodnutí 63): jen z tohoto počítače, nikdy z domácí sítě,
   * s podporou Range (prvek <audio> si soubor čte po částech).
   */
  async zvukovySoubor(req, res, url) {
    if (!LOOPBACK.has(req.socket.remoteAddress)) throw Object.assign(new Error('Zvuk jde jen na tomto počítači.'), { status: 403 });
    if (req.method !== 'GET' && req.method !== 'HEAD') throw Object.assign(new Error('Metoda není povolena'), { status: 405 });
    let jmeno;
    try {
      jmeno = url.pathname.slice('/audio/'.length).split('/').map(decodeURIComponent).join('/');
    } catch {
      throw Object.assign(new Error('Neplatná adresa'), { status: 400 });
    }
    const cesta = this.zvuk.cestaSouboru(jmeno);
    let info;
    try {
      info = await fs.stat(cesta);
      if (!info.isFile()) throw new Error('není soubor');
    } catch {
      throw Object.assign(new Error('Zvuk ve složce není.'), { status: 404 });
    }
    const hlavicky = {
      ...HLAVICKY_BEZPECNOSTI,
      'Content-Type': TYPY_ZVUKU[path.extname(cesta).toLowerCase()] ?? 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    };
    const rozsah = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    let od = 0;
    let do_ = info.size - 1;
    let status = 200;
    if (rozsah && (rozsah[1] || rozsah[2])) {
      if (rozsah[1]) {
        od = Number(rozsah[1]);
        if (rozsah[2]) do_ = Math.min(Number(rozsah[2]), info.size - 1);
      } else od = Math.max(0, info.size - Number(rozsah[2]));
      if (od > do_ || od >= info.size) {
        res.writeHead(416, { ...hlavicky, 'Content-Range': `bytes */${info.size}` });
        return res.end();
      }
      status = 206;
      hlavicky['Content-Range'] = `bytes ${od}-${do_}/${info.size}`;
    }
    hlavicky['Content-Length'] = do_ - od + 1;
    res.writeHead(status, hlavicky);
    if (req.method === 'HEAD' || info.size === 0) return res.end();
    const proud = createReadStream(cesta, { start: od, end: do_ });
    proud.on('error', () => res.destroy());
    res.on('close', () => proud.destroy());
    proud.pipe(res);
    return undefined;
  }

  async apiSvetla(req, m, p) {
    const s = this.svetla;
    if (p === '/api/svetla' && m === 'GET') return s.verejny();
    if (p === '/api/svetla/ridit' && m === 'PUT') {
      const { ridit } = await nacistJson(req);
      if (typeof ridit !== 'boolean') throw Object.assign(new Error('Řídit světla je zapnuto, nebo vypnuto.'), { status: 400 });
      return s.nastavitRidit(ridit);
    }
    if (p === '/api/svetla/overit' && m === 'POST') {
      await nacistJson(req);
      return s.overit();
    }
    if (p === '/api/svetla/normal' && m === 'POST') {
      await nacistJson(req);
      return s.normal();
    }
    if (p === '/api/svetla/blesk' && m === 'POST') {
      const { vzdalenost } = await nacistJson(req);
      return s.blesk({ vzdalenost: vzdalenost || undefined });
    }
    if (p === '/api/svetla/hp' && m === 'PUT') return s.nastavitHp(await nacistJson(req));
    if (p === '/api/svetla/nabeh' && m === 'PUT') return s.nastavitNabehStartu((await nacistJson(req)).zap === true);
    if (p === '/api/svetla/hp/zkouska' && m === 'POST') {
      await nacistJson(req);
      return s.zkusitHp();
    }
    if (p === '/api/svetla/test' && m === 'POST') {
      const { role } = await nacistJson(req);
      return s.testRole(String(role));
    }
    if (p === '/api/svetla/zachytit' && m === 'POST') {
      const telo = await nacistJson(req);
      if (telo.cil === 'vychozi') return s.zachytitVychozi();
      const role = await s.zachytitProMisto();
      const vysledek = await this.mista.ulozitSvetla(String(telo.misto ?? ''), telo.varianta, role);
      return { ...vysledek, zachyceno: role };
    }
    if (p === '/api/svetla/hue' && m === 'GET') {
      const n = this.nastaveni.hodnoty;
      if (!n.HUE_BRIDGE || !n.HUE_KLIC) throw Object.assign(new Error('Hue bridge není spárovaný.'), { status: 409 });
      return { svetla: await new Hue({ bridge: n.HUE_BRIDGE, klic: n.HUE_KLIC, otisk: n.HUE_OTISK || null }).svetla(), role: ROLE_SVETEL };
    }
    if (p === '/api/svetla/hue/sparovat' && m === 'POST') {
      const { bridge } = await nacistJson(req);
      if (bridge !== undefined) await this.nastaveni.ulozit({ hueBridge: bridge });
      const adresa = this.nastaveni.hodnoty.HUE_BRIDGE;
      if (!adresa) throw Object.assign(new Error('Nejdřív zadej IP adresu Hue bridge.'), { status: 400 });
      const sparovani = await this.sparovatHue({ bridge: adresa });
      await this.nastaveni.ulozit({ hueSparovani: sparovani });
      s.sestavitZarizeni();
      s.zmenaSceny();
      return { ok: true, nastaveni: this.nastaveni.verejne(), svetla: s.verejny() };
    }
    return undefined;
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
    const dz = /^\/api\/mista\/([a-z0-9-]{1,60})\/zvuk-dozvuk$/.exec(p);
    if (dz && m === 'PUT') return this.mista.nastavitDozvuk(dz[1], (await nacistJson(req)).dozvuk);
    const pz = /^\/api\/mista\/([a-z0-9-]{1,60})\/zvuk-pripnute$/.exec(p);
    if (pz && m === 'PUT') return this.mista.nastavitPripnute(pz[1], (await nacistJson(req)).pripnute);
    const mz = /^\/api\/mista\/([a-z0-9-]{1,60})\/zvuk\/(den|noc|souboj)$/.exec(p);
    if (mz && m === 'PUT') {
      const v = await this.mista.nastavitZvuk(mz[1], mz[2], await nacistJson(req));
      this.data.naplanovatKontrolu();
      return v;
    }
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

  /** Modul Kánon (rozhodnutí 69–71): mapa, karty, malé úpravy hlavičky, nástěnky. */
  async apiKanon(req, m, p, url) {
    const k = this.kanon;
    const pohled = url.searchParams.get('pohled') === 'druzina' ? 'druzina' : 'dm';
    if (p === '/api/kanon' && m === 'GET') return k.seznam(pohled);
    const ent = /^\/api\/kanon\/entita\/([a-z0-9-]{1,80})$/.exec(p);
    if (ent && m === 'GET') return k.karta(ent[1], pohled);
    if (ent && m === 'PUT') return this.poUpraveKanonu(await k.nastavit(ent[1], await nacistJson(req)));
    const vazby = /^\/api\/kanon\/entita\/([a-z0-9-]{1,80})\/vazby$/.exec(p);
    if (vazby && m === 'POST') return this.poUpraveKanonu(await k.pridatVazbu(vazby[1], String((await nacistJson(req)).cil ?? '')));
    const vazba = /^\/api\/kanon\/entita\/([a-z0-9-]{1,80})\/vazby\/([a-z0-9-]{1,80})$/.exec(p);
    if (vazba && m === 'DELETE') return this.poUpraveKanonu(await k.odebratVazbu(vazba[1], vazba[2]));
    const vztah = /^\/api\/kanon\/entita\/([a-z0-9-]{1,80})\/vztahy\/([a-z0-9-]{1,80})$/.exec(p);
    if (vztah && m === 'PUT') return this.poUpraveKanonu(await k.nastavitVztah(vztah[1], vztah[2], await nacistJson(req)));
    if (vztah && m === 'DELETE') return this.poUpraveKanonu(await k.odebratVztah(vztah[1], vztah[2]));
    if (p === '/api/kanon/nastenky' && m === 'POST') return k.ulozitNastenku(null, await nacistJson(req, 512 * 1024));
    const nast = /^\/api\/kanon\/nastenky\/([a-z0-9-]{1,60})$/.exec(p);
    if (nast && m === 'GET') return k.nastenka(nast[1]);
    if (nast && m === 'PUT') return k.ulozitNastenku(nast[1], await nacistJson(req, 512 * 1024));
    if (nast && m === 'DELETE') return k.smazatNastenku(nast[1]);
    return undefined;
  }

  /** Po úpravě karty: Kontrola dat hned (vztah bez vazby, neexistující cíl) a stav zápisu do lišty. */
  poUpraveKanonu(v) {
    this.data.naplanovatKontrolu();
    if (v.vysledek === 'odlozeno') this.vyslatStav();
    return v;
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
        if (!scena) chybaObs = 'Scéna obchodu není nastavená, OBS nepřepnul. Přiřaď ji v Nastavení → Role scén v OBS.';
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
    const dekodovat = (x) => {
      try {
        return decodeURIComponent(x);
      } catch {
        throw Object.assign(new Error('Neplatná adresa'), { status: 400 });
      }
    };
    if (url.pathname === '/' || url.pathname === '/panel' || url.pathname === '/panel/') soubor = path.join(this.c.panel, 'index.html');
    else if (url.pathname.startsWith('/panel/')) soubor = path.join(this.c.panel, dekodovat(url.pathname.slice(7)));
    else if (url.pathname.startsWith('/vystupy/')) {
      koren = this.c.vystupy;
      soubor = path.join(koren, dekodovat(url.pathname.slice(9)));
    } else if (url.pathname.startsWith('/kampan/')) {
      koren = this.c.kampan;
      soubor = path.join(koren, dekodovat(url.pathname.slice(8)));
      if (!OBRAZKY_KAMPANE.has(path.extname(soubor).toLowerCase())) throw Object.assign(new Error('Stránka neexistuje'), { status: 404 });
    } else if (url.pathname.startsWith('/sdilene/')) {
      // Moduly sdílené serverem i výstupy (motor Harptos, orloj).
      koren = path.join(HUB_DIR, 'sdilene');
      soubor = path.join(koren, dekodovat(url.pathname.slice(9)));
    } else if (OBRAZKY_KAMPANE.has(path.extname(url.pathname).toLowerCase())) {
      // Ilustrace s cestou od kořene repa (/monsters/…, portréty /Alba.png): jen obrázky, jen z kořene
      // a z monsters/ (audit N2). Kontroluje se dekódovaná cesta, ať %2F ani %5C nic neobejdou.
      koren = this.c.koren;
      soubor = path.join(koren, dekodovat(url.pathname.slice(1)));
      const relativni = path.relative(koren, soubor);
      const vKoreni = !relativni.includes(path.sep) && !relativni.includes('/') && !relativni.includes('\\');
      const vMonsters = relativni.startsWith(`monsters${path.sep}`);
      if (!vKoreni && !vMonsters) throw Object.assign(new Error('Stránka neexistuje'), { status: 404 });
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
      // Kód stránek (html, js, css) se nesmí brát z mezipaměti OBS, obrázky se jen ověří (ETag).
      'Cache-Control': /\.(html|js|css)$/i.test(soubor) ? 'no-store' : 'no-cache',
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

  /** Player View a průchod s přihlášením pro panel (relace nikdy, jen jestli platí). */
  stavIniciativy() {
    return {
      ...this.iniciativa.verejny(),
      pruchod: this.pruchod?.server ? { port: this.portPruchodu, prihlasen: this.pruchod.prihlasen, ucet: this.pruchod.ucet } : null,
      pruchodChyba: this.pruchodChyba ?? null,
    };
  }

  /**
   * Průchod k Improved Initiative s relací DM (bod 70): běží, jen když je relace vložená.
   * Selhání (obsazený port) Hub neshodí, jen ho ohlásí.
   */
  async zajistitPruchod() {
    const relace = () => this.nastaveni.hodnoty.II_RELACE || null;
    if (!relace()) {
      if (this.pruchod) await this.pruchod.zastavit();
      this.pruchod = null;
      clearInterval(this.casovacPruchodu);
    } else if (!this.pruchod) {
      const p = new PruchodIniciativy({ port: this.portPruchodu, relace });
      // Server poslal obnovenou relaci: uložit, ať vydrží další 4 týdny.
      p.on('relace', (nova) => this.nastaveni.ulozit({ iiRelace: nova }).catch(() => {}));
      p.on('stav', () => this.vysilac.vyslat('iniciativa', this.stavIniciativy()));
      // Vlastní Encounter ID z účtu = stálý odkaz na Player View: Hub ho dosadí do OBS i náhledu sám.
      p.on('encounter', (id) => {
        const odkaz = `https://improvedinitiative.app/p/${id}`;
        if (this.iniciativa.odkaz !== odkaz) this.iniciativa.nastavit(odkaz).catch(() => {});
      });
      try {
        await p.spustit();
        if (!p.port) p.port = p.server.address().port;
        this.portPruchodu = p.port;
        this.pruchod = p;
        this.pruchodChyba = null;
        // Každých 5 min: platnost přihlášení a změna vlastního Encounter ID v účtu.
        this.casovacPruchodu = setInterval(() => p.overit().catch(() => {}), 5 * 60000);
        this.casovacPruchodu.unref?.();
      } catch (e) {
        this.pruchodChyba = `Průchod k Improved Initiative se nespustil na portu ${this.portPruchodu}: ${e.message}`;
      }
    }
    this.pruchod?.overit().catch(() => {});
    this.vysilac.vyslat('iniciativa', this.stavIniciativy());
  }

  async zastavit() {
    clearTimeout(this.casovacOdpoctu);
    clearInterval(this.casovacHlavy);
    clearTimeout(this.casovacRestartu);
    clearInterval(this.casovacPruchodu);
    this.cteniPlayerView.zastavit();
    this.sledovaniHp.zastavit();
    await this.pruchod?.zastavit();
    this.scena.zastavit();
    this.svetla.zastavit();
    this.zvuk.zastavit();
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
