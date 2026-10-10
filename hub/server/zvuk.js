// Zvuk scény (Blok 5, rozhodnutí 62 a 63): hudba na TV (výstup hudba.html v OBS) a ambient
// s efekty u stolu (stránka zvuk-u-stolu.html, BT reproduktor). Server jen rozhoduje, CO hraje;
// přehrávají stránky přes Web Audio. Soubory leží ve složce mimo repo a jdou jen přes localhost.
//
// Data kampaně: `zvuk.den` / `zvuk.noc` v hlavičce místa, `zvuk` ve vrstvách kampan/sceny/
// (načítá je svetla.js, sdílíme je). Nastavení tohoto PC: složka v hub/.env (ZVUK_SLOZKA),
// Ticho a hlasitosti v hub/.stav/zvuk.json.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { zapsatAtomicky } from './zapis.js';

/** Formáty, které umí přehrát prohlížeč v OBS i Chrome/Edge. */
export const PRIPONY_ZVUKU = Object.freeze(['.mp3', '.ogg', '.opus', '.wav', '.flac', '.m4a']);
export const TYPY_ZVUKU = Object.freeze({
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
});
/** Prolnutí při přepnutí scény (Blok 5, Pravidla). */
export const PROLNUTI_MS = 2000;
/** Hlasitost ambientu počasí podle intenzity, když vrstva chce `hlasitost_podle_intenzity`. */
const HLASITOST_INTENZITY = [0.55, 0.7, 0.85, 1];
/** Souboj ztlumí ambient místa (ambient počasí nechá). */
const AMBIENT_MISTA_V_SOUBOJI = 0.35;
/** Hrom podle vzdálenosti bouřky: hlasitost a zda ho tlumit dolní propustí (vzdálený hrom duní). */
export const HROM = Object.freeze({
  daleko: { hlasitost: 0.45, filtr: 'daleko' },
  blizko: { hlasitost: 0.8, filtr: null },
  'nad-nami': { hlasitost: 1, filtr: null },
});
/** Stránka se hlásí každých 5 s; po 12 s bez hlášení je odpojená. */
export const PLATNOST_HLASENI_MS = 12000;
export const STRANKY = Object.freeze(['hudba', 'stul']);
const MAX_SOUBORU = 3000;

const chyba = (zprava, status = 400) => Object.assign(new Error(zprava), { status });

/** Výchozí složka zvuku na Windows: Dokumenty\DnD\audio (rozhodnutí 63). */
export function vychoziSlozka() {
  return path.join(os.homedir(), 'Documents', 'DnD', 'audio');
}

/** Jméno souboru z dat: relativní cesta ve složce zvuku s lomítky, bez „..“. */
export function platneJmeno(jmeno) {
  if (typeof jmeno !== 'string' || !jmeno || jmeno.length > 300) return null;
  const s = jmeno.replace(/\\/g, '/');
  if (s.startsWith('/') || /^[a-z]:/i.test(s) || s.split('/').some((x) => x === '..' || x === '' || x === '.')) return null;
  if (!PRIPONY_ZVUKU.includes(path.posix.extname(s).toLowerCase())) return null;
  return s;
}

/** Pole `zvuk` z hlavičky místa: jen den/noc s hudbou a ambientem. */
export function normalizujZvukMista(zvuk) {
  if (!zvuk || typeof zvuk !== 'object') return null;
  const vysledek = {};
  for (const v of ['den', 'noc']) {
    const x = zvuk[v];
    if (!x || typeof x !== 'object') continue;
    const z = {};
    if (platneJmeno(x.hudba)) z.hudba = platneJmeno(x.hudba);
    if (platneJmeno(x.ambient)) z.ambient = platneJmeno(x.ambient);
    if (Object.keys(z).length) vysledek[v] = z;
  }
  return Object.keys(vysledek).length ? vysledek : null;
}

const seznamJmen = (x) => (Array.isArray(x) ? x : x ? [x] : []).map(platneJmeno).filter(Boolean);

/**
 * Co má hrát (čistá funkce). Hudba z místa, v souboji z režimu; počasí hudbu nemění.
 * Ambient místa a ambienty efektů počasí hrají současně jako vrstvy.
 * @returns {{hudba: string|null, ambient: Array<{soubor:string, hlasitost:number, zdroj:string}>, hrom: string[]}}
 */
export function slozitZvuk({ misto, scena, vrstvy }) {
  const zm = misto?.zvuk ?? null;
  const varianta = scena.varianta === 'noc' ? 'noc' : 'den';
  // Noc bez vlastního zvuku vezme den (stejně jako světla).
  const zMista = zm?.[varianta] ?? (varianta === 'noc' ? zm?.den : null) ?? {};
  const souboj = scena.rezim === 'souboj';
  const zSouboje = souboj ? vrstvy.rezim?.souboj?.zvuk ?? {} : {};
  const hudba = (souboj && platneJmeno(zSouboje.hudba)) || zMista.hudba || null;

  const ambient = [];
  const pridat = (soubor, hlasitost, zdroj) => {
    if (!soubor) return;
    const jiz = ambient.find((a) => a.soubor === soubor);
    if (jiz) jiz.hlasitost = Math.max(jiz.hlasitost, hlasitost);
    else ambient.push({ soubor, hlasitost: Math.round(hlasitost * 100) / 100, zdroj });
  };
  pridat(zMista.ambient, souboj ? AMBIENT_MISTA_V_SOUBOJI : 1, 'misto');
  const hrom = [];
  for (const efekt of scena.pocasi ?? []) {
    const z = vrstvy.pocasi?.[efekt]?.zvuk;
    if (!z) continue;
    const h = z.hlasitost_podle_intenzity ? HLASITOST_INTENZITY[scena.intenzita] ?? 1 : 1;
    for (const s of seznamJmen(z.ambient)) pridat(s, h, efekt);
    hrom.push(...seznamJmen(z.hrom));
  }
  if (souboj) for (const s of seznamJmen(zSouboje.ambient)) pridat(s, 1, 'souboj');
  return { hudba, ambient, hrom };
}

/**
 * Události: 'zvuk' (co hrát, pro stránky hudba a stůl), 'efekt' (jednorázový zvuk pro stůl nebo
 * hudbu), 'stav' (stav pro panel: hlášení stránek, chybějící soubory).
 */
export class Zvuk extends EventEmitter {
  /**
   * @param {object} volby
   * @param {() => Record<string,string>} volby.nastaveni hodnoty z hub/.env
   * @param {(id: string) => object|null} volby.misto
   * @param {() => object} volby.scena stav scény
   * @param {() => object} volby.vrstvy vrstvy z kampan/sceny (sdílené se světly)
   * @param {() => Array<object>} volby.mista všechna místa (Kontrola dat)
   */
  constructor({ cesty, nastaveni, misto, scena, vrstvy, mista, hodiny = () => Date.now(), nahodne = Math.random }) {
    super();
    this.c = cesty;
    this.nastaveni = nastaveni;
    this.misto = misto;
    this.scena = scena;
    this.vrstvy = vrstvy;
    this.mista = mista;
    this.hodiny = hodiny;
    this.nahodne = nahodne;
    this.soubor = path.join(cesty.lokalniStav, 'zvuk.json');
    this.mistni = { ticho: false, hudba: 0.8, ambient: 0.8, efekty: 1 };
    this.hlaseni = {}; // stranka → { ...hlášení, cas }
    this.soubory = []; // jména ve složce (relativní, s lomítky)
    this.slozkaExistuje = false;
    this.casovacHromu = new Set();
    this.posledniZvuk = null;
    this.posledniStav = null;
  }

  get slozka() {
    const s = this.nastaveni().ZVUK_SLOZKA;
    return s ? path.resolve(s) : vychoziSlozka();
  }

  async nacist() {
    try {
      const d = JSON.parse(await fs.readFile(this.soubor, 'utf8'));
      for (const k of ['hudba', 'ambient', 'efekty']) if (Number.isFinite(d[k])) this.mistni[k] = Math.max(0, Math.min(1, d[k]));
      this.mistni.ticho = d.ticho === true;
    } catch {
      /* první spuštění */
    }
    await this.prohledat();
    this.casovacKontroly = setInterval(() => this.oznamStav(), 5000);
    this.casovacKontroly.unref?.();
    // Složka je mimo repo a Hub ji nesleduje: nové soubory najde do 30 s (nebo hned tlačítkem).
    this.casovacSlozky = setInterval(() => this.prohledat().catch(() => {}), 30000);
    this.casovacSlozky.unref?.();
  }

  async ulozitMistni() {
    await fs.mkdir(path.dirname(this.soubor), { recursive: true });
    await zapsatAtomicky(this.soubor, JSON.stringify(this.mistni, null, 2));
  }

  /** Seznam zvukových souborů ve složce (i v podsložkách, např. efekty/). */
  async prohledat() {
    const koren = this.slozka;
    const nalezene = [];
    const projit = async (slozka, rel) => {
      let polozky;
      try {
        polozky = await fs.readdir(slozka, { withFileTypes: true });
      } catch {
        return false;
      }
      for (const p of polozky.sort((a, b) => a.name.localeCompare(b.name, 'cs'))) {
        if (nalezene.length >= MAX_SOUBORU || p.name.startsWith('.')) continue;
        const r = rel ? `${rel}/${p.name}` : p.name;
        if (p.isDirectory()) await projit(path.join(slozka, p.name), r);
        else if (PRIPONY_ZVUKU.includes(path.extname(p.name).toLowerCase())) nalezene.push(r);
      }
      return true;
    };
    const existuje = await projit(koren, '');
    const zmena = existuje !== this.slozkaExistuje || nalezene.join('\n') !== this.soubory.join('\n');
    this.slozkaExistuje = existuje;
    this.soubory = nalezene;
    if (zmena) {
      this.oznam();
      this.emit('soubory', this.soubory);
    }
    return this.soubory;
  }

  /** Cesta k souboru ve složce zvuku, nebo chyba (nic mimo složku). */
  cestaSouboru(jmeno) {
    const j = platneJmeno(jmeno);
    if (!j) throw chyba('Neplatné jméno zvukového souboru.', 404);
    const cesta = path.resolve(this.slozka, ...j.split('/'));
    const rel = path.relative(this.slozka, cesta);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw chyba('Soubor neexistuje.', 404);
    return cesta;
  }

  cil() {
    const s = this.scena();
    return slozitZvuk({ misto: s.misto ? this.misto(s.misto) : null, scena: s, vrstvy: this.vrstvy() });
  }

  /** Pro stránky: co hrát a jak hlasitě. Soubory, které ve složce nejsou, se vynechají. */
  verejny() {
    const c = this.cil();
    const je = (s) => this.soubory.includes(s);
    return {
      ticho: this.mistni.ticho,
      hlasitost: { hudba: this.mistni.hudba, ambient: this.mistni.ambient, efekty: this.mistni.efekty },
      hudba: c.hudba && je(c.hudba) ? { soubor: c.hudba, url: this.url(c.hudba) } : null,
      ambient: c.ambient.filter((a) => je(a.soubor)).map((a) => ({ ...a, url: this.url(a.soubor) })),
      prolnutiMs: PROLNUTI_MS,
    };
  }

  url(jmeno) {
    return `/audio/${jmeno.split('/').map(encodeURIComponent).join('/')}`;
  }

  /** Pro panel: stav stránek, chybějící soubory, seznam efektů. */
  stav() {
    const ted = this.hodiny();
    const c = this.cil();
    const stranky = Object.fromEntries(
      STRANKY.map((s) => {
        const h = this.hlaseni[s];
        const pripojeno = Boolean(h && ted - h.cas < PLATNOST_HLASENI_MS);
        return [s, pripojeno ? { pripojeno, odemceno: h.odemceno, hraje: h.hraje, chyba: h.chyba, vystup: h.vystup } : { pripojeno: false }];
      }),
    );
    return {
      ...this.verejny(),
      slozka: this.slozka,
      slozkaNastavena: Boolean(this.nastaveni().ZVUK_SLOZKA),
      slozkaExistuje: this.slozkaExistuje,
      pocetSouboru: this.soubory.length,
      efekty: this.soubory.filter((s) => s.startsWith('efekty/')),
      chybiTed: [c.hudba, ...c.ambient.map((a) => a.soubor), ...c.hrom].filter((s) => s && !this.soubory.includes(s)),
      hrom: c.hrom.filter((s) => this.soubory.includes(s)),
      stranky,
    };
  }

  /** Pošle stránkám jen skutečnou změnu (střídání ilustrací scénu mění, zvuk ne). */
  oznam(vynutit = false) {
    const v = this.verejny();
    const json = JSON.stringify(v);
    if (vynutit || json !== this.posledniZvuk) {
      this.posledniZvuk = json;
      this.emit('zvuk', v);
    }
    this.oznamStav();
  }

  oznamStav() {
    const s = this.stav();
    const json = JSON.stringify(s);
    if (json === this.posledniStav) return;
    this.posledniStav = json;
    this.emit('stav', s);
  }

  zmenaSceny() {
    this.oznam();
  }

  async nastavit(z) {
    if ('ticho' in z) {
      if (typeof z.ticho !== 'boolean') throw chyba('Ticho je zapnuto, nebo vypnuto.');
      this.mistni.ticho = z.ticho;
    }
    for (const k of ['hudba', 'ambient', 'efekty']) {
      if (!(k in z)) continue;
      const n = Number(z[k]);
      if (!Number.isFinite(n) || n < 0 || n > 1) throw chyba('Hlasitost je 0 až 1.');
      this.mistni[k] = Math.round(n * 100) / 100;
    }
    await this.ulozitMistni();
    this.oznam();
    return this.stav();
  }

  /** Hlášení stránky (každých 5 s a při změně): kontrolka Zvuk a Sezení → Před hrou. */
  hlasit(stranka, d) {
    if (!STRANKY.includes(stranka)) throw chyba('Neznámá stránka zvuku.');
    const text = (x, n = 300) => (typeof x === 'string' ? x.slice(0, n) : null);
    this.hlaseni[stranka] = {
      cas: this.hodiny(),
      odemceno: d.odemceno === true,
      hraje: Array.isArray(d.hraje) ? d.hraje.filter((x) => typeof x === 'string').slice(0, 20).map((x) => x.slice(0, 300)) : [],
      chyba: text(d.chyba),
      vystup: d.vystup && typeof d.vystup === 'object' ? { nazev: text(d.vystup.nazev, 120), ok: d.vystup.ok !== false, vybrany: d.vystup.vybrany === true } : null,
    };
    this.oznamStav();
    return { ok: true };
  }

  /** Jednorázový zvuk: ruční efekt z panelu, nebo zkušební tón (bez souboru). */
  efekt({ soubor, cil = 'stul', test = false } = {}) {
    if (!['stul', 'hudba'].includes(cil)) throw chyba('Efekt hraje u stolu, nebo v OBS.');
    if (test) {
      this.emit('efekt', { cil, test: true });
      return { ok: true, pripojeno: Boolean(this.stav().stranky[cil].pripojeno) };
    }
    const j = platneJmeno(soubor);
    if (!j || !this.soubory.includes(j)) throw chyba('Zvuk ve složce není.', 404);
    this.emit('efekt', { cil, soubor: j, url: this.url(j), hlasitost: 1 });
    return { ok: true };
  }

  /** Hrom po blesku (Blok 4, tabulka Blesky): zpoždění podle vzdálenosti, hlasitost a filtr. */
  hrom({ vzdalenost, hromZaMs }) {
    const soubory = this.cil().hrom.filter((s) => this.soubory.includes(s));
    if (!soubory.length) return false;
    const soubor = soubory[Math.floor(this.nahodne() * soubory.length) % soubory.length];
    const v = HROM[vzdalenost] ?? HROM.blizko;
    const casovac = setTimeout(() => {
      this.casovacHromu.delete(casovac);
      this.emit('efekt', { cil: 'stul', soubor, url: this.url(soubor), hlasitost: v.hlasitost, filtr: v.filtr });
    }, Math.max(0, hromZaMs ?? 0));
    casovac.unref?.();
    this.casovacHromu.add(casovac);
    return true;
  }

  /**
   * Kontrola dat (rozhodnutí 63): soubory, na které odkazují místa a vrstvy, a ve složce nejsou.
   * @returns {Array<{soubor:string, uroven:string, zprava:string}>}
   */
  kontrola() {
    const odkazy = []; // [souborDat, jménoZvuku]
    for (const m of this.mista()) {
      for (const v of ['den', 'noc']) {
        for (const k of ['hudba', 'ambient']) if (m.zvuk?.[v]?.[k]) odkazy.push([`kampan/mista/${m.id}/${m.id}.md`, m.zvuk[v][k]]);
      }
    }
    const vrstvy = this.vrstvy();
    for (const druh of ['pocasi', 'rezim']) {
      for (const [id, d] of Object.entries(vrstvy[druh] ?? {})) {
        const z = d?.zvuk;
        if (!z) continue;
        for (const s of [...seznamJmen(z.ambient), ...seznamJmen(z.hudba), ...seznamJmen(z.hrom)]) odkazy.push([`kampan/sceny/${druh}/${id}.yaml`, s]);
      }
    }
    if (!odkazy.length) return [];
    if (!this.slozkaExistuje) {
      return [{ soubor: 'hub/.env', uroven: 'varovani', zprava: `Složka zvuku ${this.slozka} neexistuje. Nastav ji v Nastavení → Zvuk.` }];
    }
    return odkazy
      .filter(([, s]) => !this.soubory.includes(s))
      .map(([soubor, s]) => ({ soubor, uroven: 'varovani', zprava: `Zvuk „${s}“ není ve složce zvuku` }));
  }

  zastavit() {
    clearInterval(this.casovacKontroly);
    clearInterval(this.casovacSlozky);
    for (const c of this.casovacHromu) clearTimeout(c);
    this.casovacHromu.clear();
  }
}
