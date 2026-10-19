// Zvuk scény (Blok 5, rozhodnutí 62, 63 a 67): hudba, ambient a efekty hrají z reproduktoru u stolu
// (stránka zvuk-u-stolu.html); hudba může hrát i v OBS (výstup hudba.html), když to DM přepne. Server jen rozhoduje, CO hraje;
// přehrávají stránky přes Web Audio. Soubory leží ve složce mimo repo a jdou jen přes localhost.
//
// Data kampaně: `zvuk.den` / `zvuk.noc` v hlavičce místa, `zvuk` ve vrstvách kampan/sceny/
// (načítá je svetla.js, sdílíme je). Nastavení tohoto PC: složka v hub/.env (ZVUK_SLOZKA),
// Ticho a hlasitosti v hub/.stav/zvuk.json.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import YAML from 'yaml';
import { zapsatAtomicky } from './zapis.js';
import { sestavitKnihovnu, najitSkupinu, vybratVariantu, normalizujMapu, zvukTahu, odkazyMapy, platneId, idSkupiny } from './zvuky-knihovna.js';
import { normalizujSadu, souboryPolozky, Freesound, Openverse, Kenney, hledatKandidaty, idKandidata, ZDROJE } from './zvuky-sada.js';
import { polozkyZip, rozbalit } from './zip.js';
import { HLADINY, ziskNaHladinu, VERZE_MERENI } from '../sdilene/mereni.js';

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
/** Konec souboje: bojová hudba pomalu dozní a svět se vrátí (⚠ návrh, DM 19. 10. 2026). */
export const KONEC_PROLNUTI_MS = 6000;
/** Playlist hudby: nejvýš tolik položek (souborů a složek) v jednom seznamu. */
export const MAX_POLOZEK_HUDBY = 20;
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
/** Kde hraje hudba: z reproduktoru u stolu (výchozí, rozhodnutí 67), nebo v OBS. */
export const HUDBA_KDE = Object.freeze(['stul', 'obs']);
/** Ucpané uši při málo HP (bod 73): co se tlumí a jak silně (dolní propust v Hz). */
export const TLUMENI = Object.freeze(['hudba', 'vse', 'vypnuto']);
export const TLUMENI_HZ = Object.freeze({ min: 200, max: 2000, vychozi: 500 });
const MAX_SOUBORU = 3000;
/** Srovnání hlasitosti (bod 86): hladiny podle druhu zvuku v LUFS a jejich meze. */
export const DRUHY_HLADIN = Object.freeze(Object.keys(HLADINY));
export const HLADINA_MEZE = Object.freeze({ min: -40, max: -6 });
/** Zvuk na tah déle než 2,5 s se plynule ztlumí (stříhat soubory není potřeba). */
export const MAX_TAH_S = 2.5;
/**
 * Dozvuk místa (bod 85): prostor, ve kterém zní náhodné zvuky a soundboard. Stránka u stolu
 * si dozvuk spočítá sama (Web Audio, bez souborů). `zadny` = venku, bez dozvuku.
 */
export const DOZVUKY = Object.freeze(['zadny', 'mistnost', 'kobka', 'sal', 'jeskyne']);
/** Náhodné zvuky prostředí (bod 85): nejvýš 8 na den nebo noc místa, interval 3 s až 10 min. */
/** Části zvuku místa: den a noc, a souboj (vlastní zvuk místa v boji, bod 85). */
export const CASTI_ZVUKU_MISTA = Object.freeze(['den', 'noc', 'souboj']);
export const NAHODNE = Object.freeze({ max: 8, minS: 3, maxS: 600, kazdychS: 30, nahodilost: 0.5, hlasitost: 0.8, vzdalenost: 0 });

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

/**
 * Hudba z dat: jeden soubor (`souboj.mp3`, hraje dokola), složka jako playlist (`hudba/souboj/`,
 * hrají všechny skladby ve složce v náhodném pořadí), nebo seznam obojího. Jinak null.
 * @returns {string|string[]|null}
 */
export function platnaHudba(x) {
  const jedna = (y) => {
    if (typeof y !== 'string') return null;
    const t = y.replace(/\\/g, '/').trim();
    if (t.endsWith('/')) {
      const id = platneId(t.slice(0, -1));
      return id ? `${id}/` : null;
    }
    return platneJmeno(t);
  };
  if (Array.isArray(x)) {
    const seznam = [...new Set(x.map(jedna).filter(Boolean))].slice(0, MAX_POLOZEK_HUDBY);
    return seznam.length === 0 ? null : seznam.length === 1 ? seznam[0] : seznam;
  }
  return jedna(x);
}

/** Je hudba playlist (složka nebo seznam), ne jeden soubor? */
export const jePlaylist = (h) => Array.isArray(h) || (typeof h === 'string' && h.endsWith('/'));

/**
 * Zvuk konce souboje (`zvuk.konec` v kampan/sceny/rezim/souboj.yaml): soubor nebo skupina variant
 * (`konec/buben` = buben-1, buben-2 …), dozvuk, ve kterém zazní, a jak dlouho dozní bojová hudba.
 * Starší zápis `konec: vitezstvi.mp3` platí dál.
 */
export function normalizujKonec(x) {
  const d = typeof x === 'string' ? { zvuk: x } : x;
  if (!d || typeof d !== 'object') return null;
  const zvuk = platneId(d.zvuk);
  if (!zvuk) return null;
  const s = Number(d.prolnuti_s);
  return {
    zvuk,
    dozvuk: DOZVUKY.includes(d.dozvuk) ? d.dozvuk : 'zadny',
    prolnutiMs: Number.isFinite(s) && s >= 1 && s <= 20 ? Math.round(s * 1000) : KONEC_PROLNUTI_MS,
  };
}

const cislo01 = (x, vychozi) => {
  const n = Number(x);
  return Number.isFinite(n) ? Math.round(Math.max(0, Math.min(1, n)) * 100) / 100 : vychozi;
};

/** Vzdálenost 0 (u stolu) až 1 (hodně daleko); jinak null. */
export function platnaVzdalenost(x) {
  if (x === undefined || x === null || x === '') return null;
  const n = Number(x);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? Math.round(n * 100) / 100 : null;
}

/**
 * Seznam náhodných zvuků z dat (místo nebo počasí). Položka: `zvuk` (skupina variant ze složky zvuku,
 * např. `tabor/hlasy`, nebo jméno souboru), `kazdych_s` (průměrný odstup), `nahodilost` 0–1 (0 = přesně
 * pravidelně), `hlasitost` 0–1, `vzdalenost` 0–1. Neplatné položky se vynechají.
 */
export function normalizujNahodne(seznam) {
  if (!Array.isArray(seznam)) return [];
  const vysledek = [];
  for (const x of seznam) {
    const zvuk = typeof x === 'string' ? platneId(x) : platneId(x?.zvuk);
    if (!zvuk || vysledek.some((y) => y.zvuk === zvuk)) continue;
    const k = Number(x?.kazdych_s);
    vysledek.push({
      zvuk,
      kazdych_s: Number.isFinite(k) ? Math.round(Math.max(NAHODNE.minS, Math.min(NAHODNE.maxS, k))) : NAHODNE.kazdychS,
      nahodilost: cislo01(x?.nahodilost, NAHODNE.nahodilost),
      hlasitost: cislo01(x?.hlasitost, NAHODNE.hlasitost),
      vzdalenost: cislo01(x?.vzdalenost, NAHODNE.vzdalenost),
    });
    if (vysledek.length >= NAHODNE.max) break;
  }
  return vysledek;
}

/** Pole `zvuk` z hlavičky místa: den/noc s hudbou, ambientem a náhodnými zvuky, dozvuk a připnuté zvuky soundboardu. */
export function normalizujZvukMista(zvuk) {
  if (!zvuk || typeof zvuk !== 'object') return null;
  const vysledek = {};
  // Připnuté zvuky soundboardu pro toto místo (bod 76): ID skupin, nejvýš 24.
  if (Array.isArray(zvuk.pripnute)) {
    const p = [...new Set(zvuk.pripnute.map(platneId).filter(Boolean))].slice(0, 24);
    if (p.length) vysledek.pripnute = p;
  }
  for (const v of CASTI_ZVUKU_MISTA) {
    const x = zvuk[v];
    if (!x || typeof x !== 'object') continue;
    const z = {};
    if (platnaHudba(x.hudba)) z.hudba = platnaHudba(x.hudba);
    if (platneJmeno(x.ambient)) z.ambient = platneJmeno(x.ambient);
    // Vzdálenost ambientu místa (bod 85): 0 = u stolu, 1 = hodně daleko (tišší a tupější).
    if (platnaVzdalenost(x.vzdalenost)) z.vzdalenost = platnaVzdalenost(x.vzdalenost);
    const nahodne = normalizujNahodne(x.nahodne);
    if (nahodne.length) z.nahodne = nahodne;
    if (Object.keys(z).length) vysledek[v] = z;
  }
  if (DOZVUKY.includes(zvuk.dozvuk) && zvuk.dozvuk !== 'zadny') vysledek.dozvuk = zvuk.dozvuk;
  return Object.keys(vysledek).length ? vysledek : null;
}

const seznamJmen = (x) => (Array.isArray(x) ? x : x ? [x] : []).map(platneJmeno).filter(Boolean);

/**
 * Co má hrát (čistá funkce). Hudba z místa, v souboji z režimu; počasí hudbu nemění.
 * Ambient místa a ambienty efektů počasí hrají současně jako vrstvy, k nim náhodné zvuky místa
 * a počasí. V souboji místo ztichne (ambient i náhodné zvuky), počasí ne.
 * Na scéně Start v OBS (`start`) hraje jen zvuk vrstvy kampan/sceny/rezim/start.yaml, místo a počasí mlčí.
 * @returns {{hudba: string|string[]|null, ambient: Array<{soubor:string, hlasitost:number, zdroj:string, vzdalenost?:number}>,
 *   nahodne: Array<object>, dozvuk: string, hrom: string[]}}
 */
export function slozitZvuk({ misto, scena, vrstvy, start = false }) {
  const zStartu = vrstvy.rezim?.start?.zvuk;
  if (start && scena.rezim !== 'souboj' && zStartu && typeof zStartu === 'object') {
    return {
      hudba: platnaHudba(zStartu.hudba),
      ambient: seznamJmen(zStartu.ambient).map((soubor) => ({ soubor, hlasitost: 1, zdroj: 'start' })),
      nahodne: [],
      dozvuk: 'zadny',
      hrom: [],
    };
  }
  const zm = misto?.zvuk ?? null;
  const varianta = scena.varianta === 'noc' ? 'noc' : 'den';
  // Noc bez vlastního zvuku vezme den (stejně jako světla).
  const zMista = zm?.[varianta] ?? (varianta === 'noc' ? zm?.den : null) ?? {};
  const souboj = scena.rezim === 'souboj';
  const zSouboje = souboj ? vrstvy.rezim?.souboj?.zvuk ?? {} : {};
  // Vlastní zvuk místa v souboji (`zvuk.souboj`): co nastaví, nahradí; co ne, platí jako dřív.
  const zBoje = souboj ? zm?.souboj ?? {} : {};
  const hudba = zBoje.hudba || (souboj && platnaHudba(zSouboje.hudba)) || zMista.hudba || null;

  const ambient = [];
  const pridat = (soubor, hlasitost, zdroj, vzdalenost = null) => {
    if (!soubor) return;
    const jiz = ambient.find((a) => a.soubor === soubor);
    if (jiz) jiz.hlasitost = Math.max(jiz.hlasitost, hlasitost);
    else ambient.push({ soubor, hlasitost: Math.round(hlasitost * 100) / 100, zdroj, ...(vzdalenost ? { vzdalenost } : {}) });
  };
  const nahodne = [];
  const pridatNahodne = (seznam, nasobek, zdroj) => {
    for (const n of normalizujNahodne(seznam)) {
      if (nahodne.some((x) => x.zvuk === n.zvuk)) continue;
      nahodne.push({ ...n, hlasitost: Math.round(n.hlasitost * nasobek * 100) / 100, zdroj });
    }
  };
  const tlumitMisto = souboj ? AMBIENT_MISTA_V_SOUBOJI : 1;
  if (zBoje.ambient) pridat(zBoje.ambient, 1, 'misto-souboj', platnaVzdalenost(zBoje.vzdalenost));
  else pridat(zMista.ambient, tlumitMisto, 'misto', platnaVzdalenost(zMista.vzdalenost));
  if (zBoje.nahodne?.length) pridatNahodne(zBoje.nahodne, 1, 'misto-souboj');
  else pridatNahodne(zMista.nahodne, tlumitMisto, 'misto');
  const hrom = [];
  for (const efekt of scena.pocasi ?? []) {
    const z = vrstvy.pocasi?.[efekt]?.zvuk;
    if (!z) continue;
    const h = z.hlasitost_podle_intenzity ? HLASITOST_INTENZITY[scena.intenzita] ?? 1 : 1;
    for (const s of seznamJmen(z.ambient)) pridat(s, h, efekt, platnaVzdalenost(z.vzdalenost));
    pridatNahodne(z.nahodne, h, efekt);
    hrom.push(...seznamJmen(z.hrom));
  }
  if (souboj) for (const s of seznamJmen(zSouboje.ambient)) pridat(s, 1, 'souboj');
  const dozvuk = DOZVUKY.includes(zm?.dozvuk) ? zm.dozvuk : 'zadny';
  return { hudba, ambient, nahodne, dozvuk, hrom };
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
  constructor({ cesty, nastaveni, misto, scena, vrstvy, mista, start = () => false, hodiny = () => Date.now(), nahodne = Math.random, fetchZvuky }) {
    super();
    this.start = start; // () => OBS ukazuje scénu Start
    this.prolnutiKonce = null; // { ms, do }: delší prolnutí po konci souboje
    this.c = cesty;
    this.nastaveni = nastaveni;
    this.misto = misto;
    this.scena = scena;
    this.vrstvy = vrstvy;
    this.mista = mista;
    this.hodiny = hodiny;
    this.nahodne = nahodne;
    this.soubor = path.join(cesty.lokalniStav, 'zvuk.json');
    this.mistni = { ticho: false, hudba: 0.8, ambient: 0.8, efekty: 1, hudbaKde: 'stul', tlumeni: 'hudba', tlumeniHz: TLUMENI_HZ.vychozi, tahy: true, tahyJenHraci: false, srovnat: true, hladiny: { ...HLADINY } };
    // Srovnání hlasitosti (bod 86): změřené soubory (stránka u stolu je měří a posílá).
    this.souborMereni = path.join(cesty.lokalniStav, 'zvuk-mereni.json');
    this.mereni = new Map(); // soubor → { klic, lufs, spicka, zacatek, konec, delka, chyba? }
    this.otisky = new Map(); // soubor → velikost:čas změny (změněný soubor se změří znovu)
    this.casovacMereni = null;
    // Zvuková sada (bod 86): kampan/zvuky-sada.yaml, stahování z Freesoundu.
    this.fetchZvuky = fetchZvuky; // testy: falešné zdroje zvuků
    this.sada = normalizujSadu();
    this.zdroje = { soubory: {}, vynechane: {} };
    this.prubehSady = { bezi: false, hotovo: 0, celkem: 0, text: null, chyba: null };
    this.mapa = normalizujMapu(); // kampan/zvuky.yaml
    this.chybaMapy = null;
    this.knihovna = sestavitKnihovnu([], this.mapa);
    this.smycky = new Map(); // ID → { soubor, hlasitost, casovac } ručně zapnuté smyčky soundboardu
    this.posledniVarianta = new Map(); // ID → poslední zahraný soubor (varianty se neopakují)
    this.kritickeHp = false; // postava na tahu s málo HP (i zkouška z Nastavení → Světla)
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
      if (HUDBA_KDE.includes(d.hudbaKde)) this.mistni.hudbaKde = d.hudbaKde;
      if (TLUMENI.includes(d.tlumeni)) this.mistni.tlumeni = d.tlumeni;
      for (const k of ['tahy', 'tahyJenHraci']) if (typeof d[k] === 'boolean') this.mistni[k] = d[k];
      if (Number.isFinite(d.tlumeniHz)) this.mistni.tlumeniHz = Math.max(TLUMENI_HZ.min, Math.min(TLUMENI_HZ.max, Math.round(d.tlumeniHz)));
      if (typeof d.srovnat === 'boolean') this.mistni.srovnat = d.srovnat;
      for (const k of DRUHY_HLADIN) if (Number.isFinite(d.hladiny?.[k])) this.mistni.hladiny[k] = Math.max(HLADINA_MEZE.min, Math.min(HLADINA_MEZE.max, d.hladiny[k]));
    } catch {
      /* první spuštění */
    }
    try {
      const m = JSON.parse(await fs.readFile(this.souborMereni, 'utf8'));
      for (const [soubor, x] of Object.entries(m ?? {})) if (x && typeof x.klic === 'string') this.mereni.set(soubor, x);
    } catch {
      /* zatím nic nezměřeno */
    }
    await this.nacistSadu();
    await this.nacistMapu();
    await this.prohledat();
    this.casovacKontroly = setInterval(() => this.oznamStav(), 5000);
    this.casovacKontroly.unref?.();
    // Složka je mimo repo a Hub ji nesleduje: nové soubory najde do 30 s (nebo hned tlačítkem).
    this.casovacSlozky = setInterval(() => this.prohledat().catch(() => {}), 30000);
    this.casovacSlozky.unref?.();
  }

  /** Mapa zvuků z kampan/zvuky.yaml (popisky, limity smyček, zvuky na tahu). Chybějící soubor = prázdná mapa. */
  async nacistMapu() {
    if (!this.c.kampan) return this.mapa;
    try {
      this.mapa = normalizujMapu(YAML.parse(await fs.readFile(path.join(this.c.kampan, 'zvuky.yaml'), 'utf8')) ?? {});
      this.chybaMapy = null;
    } catch (e) {
      if (e.code !== 'ENOENT') this.chybaMapy = `kampan/zvuky.yaml se nepodařilo přečíst: ${e.message}`;
      this.mapa = normalizujMapu();
    }
    this.knihovna = sestavitKnihovnu(this.soubory, this.mapa);
    this.oznamStav();
    return this.mapa;
  }

  /** Zvuková sada z kampan/zvuky-sada.yaml (bod 86). */
  async nacistSadu() {
    if (!this.c.kampan) return this.sada;
    try {
      this.sada = normalizujSadu(YAML.parse(await fs.readFile(path.join(this.c.kampan, 'zvuky-sada.yaml'), 'utf8')) ?? {});
    } catch (e) {
      this.sada = normalizujSadu();
      if (e.code !== 'ENOENT') this.sada.chyby.push(`Soubor se nepodařilo přečíst: ${e.message}`);
    }
    await this.nacistZdroje();
    this.oznamStav();
    return this.sada;
  }

  get souborZdroju() {
    return path.join(this.slozka, 'zdroje.json');
  }

  async nacistZdroje() {
    try {
      const d = JSON.parse(await fs.readFile(this.souborZdroju, 'utf8'));
      this.zdroje = { soubory: d.soubory ?? {}, vynechane: d.vynechane ?? {} };
    } catch {
      this.zdroje = { soubory: {}, vynechane: {} };
    }
  }

  async ulozitMistni() {
    await fs.mkdir(path.dirname(this.soubor), { recursive: true });
    await zapsatAtomicky(this.soubor, JSON.stringify(this.mistni, null, 2));
  }

  /** Seznam zvukových souborů ve složce (i v podsložkách, např. efekty/). */
  async prohledat() {
    const koren = this.slozka;
    const nalezene = [];
    const otisky = new Map();
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
        else if (PRIPONY_ZVUKU.includes(path.extname(p.name).toLowerCase())) {
          nalezene.push(r);
          try {
            const st = await fs.stat(path.join(slozka, p.name));
            otisky.set(r, `${st.size}:${Math.round(st.mtimeMs)}`);
          } catch {
            /* soubor mezitím zmizel */
          }
        }
      }
      return true;
    };
    const existuje = await projit(koren, '');
    const zmena =
      existuje !== this.slozkaExistuje ||
      nalezene.join('\n') !== this.soubory.join('\n') ||
      nalezene.some((f) => otisky.get(f) !== this.otisky.get(f));
    this.slozkaExistuje = existuje;
    this.soubory = nalezene;
    this.otisky = otisky;
    this.knihovna = sestavitKnihovnu(nalezene, this.mapa);
    this.prohledano = true;
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
    return slozitZvuk({ misto: s.misto ? this.misto(s.misto) : null, scena: s, vrstvy: this.vrstvy(), start: this.start() });
  }

  /**
   * Skladby hudby ve složce: soubor podle jména (na příponě nezáleží), u složky všechny zvukové
   * soubory v ní i v podsložkách. Každý soubor jen jednou, v pořadí ze seznamu.
   */
  souboryHudby(hudba) {
    const vysledek = [];
    for (const h of Array.isArray(hudba) ? hudba : hudba ? [hudba] : []) {
      if (h.endsWith('/')) {
        const predpona = h.toLowerCase();
        for (const f of this.soubory) if (f.toLowerCase().startsWith(predpona) && !vysledek.includes(f)) vysledek.push(f);
      } else {
        const f = this.najit(h);
        if (f && !vysledek.includes(f)) vysledek.push(f);
      }
    }
    return vysledek;
  }

  /**
   * Hudba pro stránky: jeden soubor hraje dokola jako dřív; playlist (složka nebo seznam) se dvěma
   * a více skladbami hraje skladby v náhodném pořadí s prolnutím mezi nimi.
   */
  hudbaProStranky(hudba) {
    const soubory = this.souboryHudby(hudba);
    if (!soubory.length) return null;
    if (!jePlaylist(hudba) || soubory.length === 1) return this.zvukovy(soubory[0], 'hudba');
    return {
      soubor: Array.isArray(hudba) ? hudba.join(' + ') : hudba,
      playlist: true,
      skladby: soubory.map((f) => this.zvukovy(f, 'hudba')),
    };
  }

  /** Soubory skupiny variant (`konec/buben` = buben-1, buben-2 …) nebo jeden soubor podle jména. */
  souboryVariant(id) {
    const n = najitSkupinu(this.knihovna, id);
    if (n) return n.skupina.soubory;
    const k = String(id).toLowerCase();
    const varianty = this.soubory.filter((f) => idSkupiny(f).toLowerCase() === k);
    if (varianty.length) return varianty;
    const f = platneJmeno(id) && this.najit(id);
    return f ? [f] : [];
  }

  /**
   * Zvuky, které stránka u stolu načte předem (během souboje): zvuky tahů a zvuk konce souboje.
   * První zvuk tahu tak nečeká na stažení a dekódování.
   */
  souboryPredem() {
    const tahy = this.knihovna.tahy.flatMap((g) => g.soubory);
    const mapa = odkazyMapy(this.mapa).flatMap((id) => this.souboryVariant(id));
    const konec = normalizujKonec(this.vrstvy().rezim?.souboj?.zvuk?.konec);
    return [...new Set([...tahy, ...mapa, ...(konec ? this.souboryVariant(konec.zvuk) : [])])].slice(0, 40);
  }

  /** Prolnutí pro stránky: po konci souboje delší (bojová hudba dozní), jinak výchozí. */
  get prolnutiMs() {
    return this.prolnutiKonce && this.hodiny() < this.prolnutiKonce.do ? this.prolnutiKonce.ms : PROLNUTI_MS;
  }

  /**
   * Skutečný soubor ve složce pro jméno z dat. Na příponě nezáleží: `dest.mp3` v datech najde
   * i `dest.wav` nebo `dest.ogg` (Freesound dává WAV a Windows přípony skrývá). Velikost písmen také ne.
   * @returns {string|null}
   */
  najit(jmeno) {
    if (!jmeno) return null;
    if (this.soubory.includes(jmeno)) return jmeno;
    const kmen = (x) => x.slice(0, x.length - path.posix.extname(x).length).toLowerCase();
    const k = kmen(jmeno);
    const shody = this.soubory.filter((x) => kmen(x) === k);
    if (!shody.length) return null;
    // Víc souborů se stejným jménem: přednost má pořadí PRIPONY_ZVUKU (mp3, ogg …).
    return shody.sort((a, b) => PRIPONY_ZVUKU.indexOf(path.posix.extname(a).toLowerCase()) - PRIPONY_ZVUKU.indexOf(path.posix.extname(b).toLowerCase()))[0];
  }

  /** Pro stránky: co hrát a jak hlasitě. Soubory, které ve složce nejsou, se vynechají. */
  verejny() {
    const c = this.cil();
    const souboj = this.scena().rezim === 'souboj';
    return {
      ticho: this.mistni.ticho,
      hlasitost: { hudba: this.mistni.hudba, ambient: this.mistni.ambient, efekty: this.mistni.efekty },
      hudba: this.hudbaProStranky(c.hudba),
      ambient: c.ambient
        .map((a) => ({ ...a, soubor: this.najit(a.soubor) }))
        .filter((a) => a.soubor)
        .map((a) => ({ ...a, ...this.zvukovy(a.soubor, 'ambient') })),
      // Náhodné zvuky prostředí (bod 85): kdy je zahrát, si počítá stránka u stolu.
      nahodne: c.nahodne
        .map((n) => ({ ...n, soubory: this.souboryZvuku(n.zvuk).map((f) => this.zvukovy(f, 'nahodne')) }))
        .filter((n) => n.soubory.length),
      dozvuk: c.dozvuk,
      prolnutiMs: this.prolnutiMs,
      // Během souboje stránka u stolu načte zvuky tahů předem (první tah bez zpoždění).
      predem: souboj ? this.souboryPredem().map((f) => this.url(f)) : [],
      // Ručně zapnuté smyčky soundboardu (hraje je stránka Zvuk u stolu na sběrnici efektů).
      smycky: [...this.smycky.entries()].map(([id, x]) => ({ ...this.zvukovy(x.soubor, 'efekty'), soubor: id, hlasitost: x.hlasitost })),
      // Soubory, které stránka u stolu ještě nezměřila (měří je postupně na pozadí).
      zmerit: this.nezmerene().slice(0, 5).map((f) => ({ soubor: f, url: this.url(f), klic: this.otisky.get(f) })),
      hudbaKde: this.mistni.hudbaKde,
      // Ucpané uši: stránky prolnou dolní propust na sběrnici hudby (a ambientu při „vse“).
      tlumeni: {
        aktivni: this.kritickeHp && this.mistni.tlumeni !== 'vypnuto',
        rozsah: this.mistni.tlumeni,
        hz: this.mistni.tlumeniHz,
      },
    };
  }

  /** Platné měření souboru (soubor se od měření nezměnil). */
  mereniSouboru(soubor) {
    const m = this.mereni.get(soubor);
    // Starší měření (jiný výpočet) neplatí: soubor se změří znovu.
    return m && m.klic === this.otisky.get(soubor) && m.verze === VERZE_MERENI ? m : null;
  }

  nezmerene() {
    return this.soubory.filter((f) => this.otisky.has(f) && !this.mereniSouboru(f));
  }

  /**
   * Soubor pro stránku: adresa, zesílení na hladinu druhu (srovnání hlasitosti) a začátek bez ticha.
   * @param {'hudba'|'ambient'|'nahodne'|'efekty'|'hrom'} druh
   */
  zvukovy(soubor, druh) {
    const m = this.mereniSouboru(soubor);
    const z = { soubor, url: this.url(soubor) };
    const zisk = this.mistni.srovnat ? ziskNaHladinu(m, this.mistni.hladiny[druh]) : 1;
    if (zisk !== 1) z.zisk = zisk;
    if (m?.zacatek > 0.02 && druh !== 'hudba' && druh !== 'ambient') z.zacatek = m.zacatek;
    return z;
  }

  /** Výsledek měření ze stránky u stolu. */
  zapsatMereni(d) {
    const soubor = typeof d?.soubor === 'string' ? d.soubor : '';
    if (!this.soubory.includes(soubor)) throw chyba('Soubor ve složce není.', 404);
    if (d.klic !== this.otisky.get(soubor)) return { ok: false, duvod: 'Soubor se mezitím změnil.' };
    const cislo = (x, min, max) => (Number.isFinite(x) && x >= min && x <= max ? x : null);
    const m = {
      klic: d.klic,
      lufs: cislo(d.lufs, -90, 10),
      spicka: cislo(d.spicka, 0, 10) ?? 1,
      zacatek: cislo(d.zacatek, 0, 36000) ?? 0,
      konec: cislo(d.konec, 0, 36000),
      delka: cislo(d.delka, 0, 36000),
      verze: VERZE_MERENI,
      ...(typeof d.chyba === 'string' ? { chyba: d.chyba.slice(0, 200) } : {}),
    };
    this.mereni.set(soubor, m);
    clearTimeout(this.casovacMereni);
    this.casovacMereni = setTimeout(() => this.ulozitMereni().catch(() => {}), 2000);
    this.casovacMereni.unref?.();
    this.oznam();
    return { ok: true };
  }

  async ulozitMereni() {
    const data = Object.fromEntries([...this.mereni].filter(([f]) => this.otisky.has(f) || !this.slozkaExistuje));
    await zapsatAtomicky(this.souborMereni, JSON.stringify(data, null, 1));
  }

  /** Soubory náhodného zvuku: varianty skupiny (bez smyček), nebo jeden soubor podle jména. */
  souboryZvuku(id) {
    const n = najitSkupinu(this.knihovna, id);
    if (n && n.druh !== 'smycky') return n.skupina.soubory;
    const f = platneJmeno(id) && this.najit(id);
    return f ? [f] : [];
  }

  /**
   * Adresa souboru pro stránky. `?v=` je otisk souboru (velikost a čas změny): vyměněný soubor
   * (Vyměnit, ↻, nový soubor se stejným jménem) má jinou adresu, takže ho stránka u stolu načte
   * znovu bez F5 a neschová se za starou kopii v paměti.
   */
  url(jmeno) {
    const otisk = this.otisky.get(jmeno);
    return `/audio/${jmeno.split('/').map(encodeURIComponent).join('/')}${otisk ? `?v=${encodeURIComponent(otisk)}` : ''}`;
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
      chybiTed: [
        ...(Array.isArray(c.hudba) ? c.hudba : c.hudba ? [c.hudba] : []).filter((h) => !this.souboryHudby(h).length).map((h) => (h.endsWith('/') ? `${h} (prázdný playlist)` : h)),
        ...[...c.ambient.map((a) => a.soubor), ...c.hrom].filter((s) => s && !this.najit(s)),
        ...c.nahodne.map((n) => n.zvuk).filter((id) => !this.souboryZvuku(id).length),
      ],
      hrom: c.hrom.map((s) => this.najit(s)).filter(Boolean),
      stranky,
      // Stránka Hudba v OBS je potřeba, jen když hudba hraje v OBS.
      potrebne: this.mistni.hudbaKde === 'obs' ? ['hudba', 'stul'] : ['stul'],
      // Soundboard (bod 76): knihovna podle složek a co z ní teď hraje.
      knihovna: { jednorazove: this.knihovna.jednorazove, smycky: this.knihovna.smycky, nahodne: this.knihovna.nahodne },
      zapnuteSmycky: [...this.smycky.keys()],
      tahy: { zapnuto: this.mistni.tahy, jenHraci: this.mistni.tahyJenHraci },
      chybaMapy: this.chybaMapy,
      // Srovnání hlasitosti a zvuková sada (bod 86).
      srovnani: {
        zapnuto: this.mistni.srovnat,
        hladiny: this.mistni.hladiny,
        zmereno: this.soubory.length - this.nezmerene().length,
        celkem: this.soubory.length,
        nejdou: this.soubory.filter((f) => this.mereniSouboru(f)?.chyba),
      },
      sada: this.stavSady(),
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

  /** Postava na tahu s málo HP (nebo zkouška): hudba zní jako přes ucpané uši. */
  nastavitKritickeHp(ano) {
    this.kritickeHp = Boolean(ano);
    this.oznam();
  }

  async nastavit(z) {
    if ('ticho' in z) {
      if (typeof z.ticho !== 'boolean') throw chyba('Ticho je zapnuto, nebo vypnuto.');
      this.mistni.ticho = z.ticho;
    }
    if ('hudbaKde' in z) {
      if (!HUDBA_KDE.includes(z.hudbaKde)) throw chyba('Hudba hraje u stolu, nebo v OBS.');
      this.mistni.hudbaKde = z.hudbaKde;
    }
    if ('tlumeni' in z) {
      if (!TLUMENI.includes(z.tlumeni)) throw chyba('Tlumení je hudba, vše, nebo vypnuto.');
      this.mistni.tlumeni = z.tlumeni;
    }
    if ('tlumeniHz' in z) {
      const n = Number(z.tlumeniHz);
      if (!Number.isFinite(n) || n < TLUMENI_HZ.min || n > TLUMENI_HZ.max) throw chyba(`Útlum je ${TLUMENI_HZ.min} až ${TLUMENI_HZ.max} Hz.`);
      this.mistni.tlumeniHz = Math.round(n);
    }
    for (const k of ['tahy', 'tahyJenHraci']) {
      if (!(k in z)) continue;
      if (typeof z[k] !== 'boolean') throw chyba('Zvuky tahů jsou zapnuté, nebo vypnuté.');
      this.mistni[k] = z[k];
    }
    for (const k of ['hudba', 'ambient', 'efekty']) {
      if (!(k in z)) continue;
      const n = Number(z[k]);
      if (!Number.isFinite(n) || n < 0 || n > 1) throw chyba('Hlasitost je 0 až 1.');
      this.mistni[k] = Math.round(n * 100) / 100;
    }
    if ('srovnat' in z) {
      if (typeof z.srovnat !== 'boolean') throw chyba('Srovnání hlasitosti je zapnuté, nebo vypnuté.');
      this.mistni.srovnat = z.srovnat;
    }
    if ('hladiny' in z) {
      for (const [k, x] of Object.entries(z.hladiny ?? {})) {
        const n = Number(x);
        if (!DRUHY_HLADIN.includes(k)) throw chyba('Neznámý druh zvuku.');
        if (!Number.isFinite(n) || n < HLADINA_MEZE.min || n > HLADINA_MEZE.max) throw chyba(`Hladina je ${HLADINA_MEZE.min} až ${HLADINA_MEZE.max} LUFS.`);
        this.mistni.hladiny[k] = Math.round(n);
      }
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

  /**
   * Jednorázový zvuk: tlačítko soundboardu (`zvuk` = ID skupiny, hraje náhodná varianta s drobnou
   * obměnou výšky a krátce ztlumí hudbu), ruční efekt podle souboru, nebo zkušební tón.
   */
  efekt({ soubor, zvuk, cil = 'stul', test = false } = {}) {
    if (!['stul', 'hudba'].includes(cil)) throw chyba('Efekt hraje u stolu, nebo v OBS.');
    if (test) {
      this.emit('efekt', { cil, test: true });
      return { ok: true, pripojeno: Boolean(this.stav().stranky[cil].pripojeno) };
    }
    if (zvuk !== undefined) {
      const n = najitSkupinu(this.knihovna, zvuk);
      if (!n) throw chyba('Zvuk ve složce není.', 404);
      if (n.druh === 'smycky') return this.smycka({ zvuk, zap: !this.smycky.has(n.skupina.id) });
      // Tlačítko soundboardu zní v prostoru místa (dozvuk, bod 85); zvuky na tah a fanfára ne.
      this.zahratSkupinu(n.skupina, { uhnout: true, prostor: true });
      return { ok: true };
    }
    const j = platneJmeno(soubor);
    const f = j && this.najit(j);
    if (!f) throw chyba('Zvuk ve složce není.', 404);
    this.emit('efekt', { cil, ...this.zvukovy(f, 'efekty'), hlasitost: 1 });
    return { ok: true };
  }

  /** Zahraje náhodnou variantu skupiny u stolu. */
  zahratSkupinu(skupina, { uhnout = false, hlasitost = 1, prostor = false, maxS = null } = {}) {
    const soubor = vybratVariantu(skupina, this.posledniVarianta.get(skupina.id), this.nahodne);
    this.posledniVarianta.set(skupina.id, soubor);
    this.emit('efekt', {
      cil: 'stul',
      ...this.zvukovy(soubor, 'efekty'),
      hlasitost,
      obmena: true,
      uhnout,
      ...(prostor ? { prostor: true } : {}),
      ...(maxS ? { maxS } : {}),
    });
    return soubor;
  }

  /**
   * Smyčka soundboardu: zapne (s náběhem), nebo vypne (s doběhem). Smyčka s `limit_s` v kampan/zvuky.yaml
   * se po té době vypne sama (poplašný zvon nemusí DM hlídat).
   */
  smycka({ zvuk, zap = true, hlasitost } = {}) {
    const n = najitSkupinu(this.knihovna, zvuk);
    if (!n || n.druh !== 'smycky') throw chyba('Smyčka ve složce smycky není.', 404);
    const id = n.skupina.id;
    const jiz = this.smycky.get(id);
    if (hlasitost !== undefined) {
      const h = Number(hlasitost);
      if (!Number.isFinite(h) || h < 0 || h > 1) throw chyba('Hlasitost je 0 až 1.');
      hlasitost = Math.round(h * 100) / 100;
    }
    if (!zap) {
      if (jiz) clearTimeout(jiz.casovac);
      this.smycky.delete(id);
    } else if (jiz) {
      if (hlasitost !== undefined) jiz.hlasitost = hlasitost;
    } else {
      const soubor = vybratVariantu(n.skupina, null, this.nahodne);
      const x = { soubor, hlasitost: hlasitost ?? 1, casovac: null };
      if (n.skupina.limit_s) {
        x.casovac = setTimeout(() => this.smycka({ zvuk: id, zap: false }), n.skupina.limit_s * 1000);
        x.casovac.unref?.();
      }
      this.smycky.set(id, x);
    }
    this.oznam();
    return this.stav();
  }

  /** Vypne všechny ruční smyčky soundboardu. */
  zastavitSmycky() {
    for (const x of this.smycky.values()) clearTimeout(x.casovac);
    this.smycky.clear();
    this.oznam();
    return this.stav();
  }

  /**
   * Zvuk na tah v souboji (bod 76): podle jména a tagů z Player View a mapy v kampan/zvuky.yaml.
   * @param {{jmeno: string, hrac: boolean, tagy: string[]}} kdo
   * @returns {string|null} zahraný soubor
   */
  tah(kdo) {
    if (!this.mistni.tahy || !kdo) return null;
    if (this.mistni.tahyJenHraci && !kdo.hrac) return null;
    const id = zvukTahu(this.mapa, kdo);
    const n = id && najitSkupinu(this.knihovna, id);
    if (!n || n.druh === 'smycky') return null;
    return this.zahratSkupinu(n.skupina, { maxS: MAX_TAH_S });
  }

  /**
   * Konec souboje (`zvuk.konec` v kampan/sceny/rezim/souboj.yaml, ⚠ návrh DM 19. 10. 2026): místo
   * fanfáry jeden úder (buben) v dozvuku a bojová hudba pod ním pomalu dozní. Volá se před přepnutím
   * scény, aby přepnutí už mělo delší prolnutí. `zvuk: false` = Konec potichu (útěk, prohra): jen doznění.
   * @returns {boolean} zda zazněl zvuk konce
   */
  konecSouboje({ zvuk = true } = {}) {
    const k = normalizujKonec(this.vrstvy().rezim?.souboj?.zvuk?.konec);
    const ms = k?.prolnutiMs ?? KONEC_PROLNUTI_MS;
    this.prolnutiKonce = { ms, do: this.hodiny() + ms + 2000 };
    if (!zvuk || !k) return false;
    const soubory = this.souboryVariant(k.zvuk);
    if (!soubory.length) return false;
    const soubor = vybratVariantu({ soubory }, this.posledniVarianta.get('konec'), this.nahodne);
    this.posledniVarianta.set('konec', soubor);
    this.emit('efekt', { cil: 'stul', ...this.zvukovy(soubor, 'efekty'), hlasitost: 1, ...(k.dozvuk !== 'zadny' ? { dozvuk: k.dozvuk } : {}) });
    return true;
  }

  /** Starší jméno (vítězná fanfára): zvuk konce souboje. */
  fanfara() {
    return this.konecSouboje();
  }

  /** Hrom po blesku (Blok 4, tabulka Blesky): zpoždění podle vzdálenosti, hlasitost a filtr. */
  hrom({ vzdalenost, hromZaMs }) {
    const soubory = this.cil().hrom.map((s) => this.najit(s)).filter(Boolean);
    if (!soubory.length) return false;
    const soubor = soubory[Math.floor(this.nahodne() * soubory.length) % soubory.length];
    const v = HROM[vzdalenost] ?? HROM.blizko;
    const casovac = setTimeout(() => {
      this.casovacHromu.delete(casovac);
      this.emit('efekt', { cil: 'stul', ...this.zvukovy(soubor, 'hrom'), hlasitost: v.hlasitost, filtr: v.filtr });
    }, Math.max(0, hromZaMs ?? 0));
    casovac.unref?.();
    this.casovacHromu.add(casovac);
    return true;
  }

  /** Zvuková sada pro panel: co má být ve složce, co chybí a odkud je co staženo. */
  stavSady() {
    return {
      klic: Boolean(this.nastaveni().FREESOUND_KLIC),
      zdroje: this.nastaveni().FREESOUND_KLIC ? ZDROJE : ZDROJE.filter((z) => z !== 'freesound'),
      chyby: this.sada.chyby,
      prubeh: this.prubehSady,
      polozky: this.sada.polozky.map((p) => {
        const soubory = souboryPolozky(p).map((f) => {
          const je = this.najit(f);
          const z = this.zdroje.soubory[f];
          return { soubor: f, je: Boolean(je), ...(je ? { url: this.url(je), skutecny: je } : {}), ...(z ? { zdroj: { autor: z.autor, nazev: z.nazev, url: z.url, licence: z.licence, odkud: z.zdroj ?? 'Freesound' } } : {}) };
        });
        return {
          cil: p.cil,
          popis: p.popis,
          hledat: p.hledat,
          delka: p.delka,
          ...(p.balik ? { balik: `Kenney: ${p.balik.nazev} (${p.balik.soubory.join(', ')})` } : {}),
          soubory,
          chybi: soubory.filter((f) => !f.je).length,
        };
      }),
    };
  }

  /** Zdroje zvuků v pořadí: Freesound (jen s klíčem), pak Openverse (bez klíče). Otevřený bod 87. */
  zdrojeZvuku() {
    const volby = this.fetchZvuky ? { fetch: this.fetchZvuky, odstupMs: 0 } : {};
    const klic = this.nastaveni().FREESOUND_KLIC;
    return [...(klic ? [new Freesound({ klic, ...volby })] : []), new Openverse(volby)];
  }

  /**
   * Balíček Kenney (bod 88): ZIP se stáhne jednou do složky zvuku (baliky/kenney_<jméno>.zip)
   * a dál se z něj jen vybírá. Vlastní ZIP stejného jména tam jde dát i ručně.
   */
  async balik(nazev) {
    const soubor = path.join(this.slozka, 'baliky', `kenney_${nazev}.zip`);
    try {
      return await fs.readFile(soubor);
    } catch {
      /* ještě není: stáhne se */
    }
    this.prubehSady.text = `Stahuji balíček Kenney ${nazev}…`;
    this.oznamStav();
    const data = await new Kenney(this.fetchZvuky ? { fetch: this.fetchZvuky, odstupMs: 0 } : {}).stahnoutBalik(nazev);
    await zapsatAtomicky(soubor, data);
    return data;
  }

  /** Soubory položky z balíčku: jméno v balíčku (bez přípony, bez ohledu na velikost písmen) → cíl. */
  async zBaliku(p, soubory, chyby) {
    const kmen = (f) => f.slice(0, f.length - path.posix.extname(f).length);
    let zip;
    try {
      zip = await this.balik(p.balik.nazev);
    } catch (e) {
      chyby.push(`${p.cil}: ${e.message}`);
      this.prubehSady.hotovo += soubory.length;
      return;
    }
    let polozky;
    try {
      polozky = polozkyZip(zip).filter((x) => !x.nazev.endsWith('/'));
    } catch (e) {
      chyby.push(`${p.cil}: balíček ${p.balik.nazev}: ${e.message}`);
      this.prubehSady.hotovo += soubory.length;
      return;
    }
    const vsechny = souboryPolozky(p);
    for (const f of soubory) {
      const jmeno = p.balik.soubory[vsechny.indexOf(f)];
      const x = polozky.find((y) => {
        const z = path.posix.basename(y.nazev);
        return PRIPONY_ZVUKU.includes(path.posix.extname(z).toLowerCase()) && kmen(z).toLowerCase() === jmeno.toLowerCase();
      });
      if (!x) {
        chyby.push(`${f}: v balíčku ${p.balik.nazev} není „${jmeno}“`);
        this.prubehSady.hotovo++;
        continue;
      }
      try {
        const cilovy = `${kmen(f)}${path.posix.extname(x.nazev).toLowerCase()}`;
        await zapsatAtomicky(path.join(this.slozka, ...cilovy.split('/')), rozbalit(zip, x));
        this.zdroje.soubory[f] = {
          id: `kenney:${p.balik.nazev}/${jmeno}`,
          soubor: cilovy,
          nazev: path.posix.basename(x.nazev),
          autor: 'Kenney',
          licence: 'CC0',
          url: `https://kenney.nl/assets/${p.balik.nazev}`,
          zdroj: `Kenney (${p.balik.nazev})`,
          cil: p.cil,
          stazeno: new Date(this.hodiny()).toISOString(),
        };
      } catch (e) {
        chyby.push(`${f}: ${e.message}`);
      }
      this.prubehSady.hotovo++;
    }
    await zapsatAtomicky(this.souborZdroju, JSON.stringify(this.zdroje, null, 1));
    await this.prohledat();
  }

  /**
   * Doplní chybějící soubory sady (Freesound, Openverse), nebo vymění soubory jedné položky
   * za další v pořadí. Běží na pozadí; průběh je ve stavu (sada.prubeh).
   * @param {{cil?: string, soubor?: string, vymenit?: boolean}} volby `soubor` = jen jedna varianta položky
   */
  doplnitSadu({ cil = null, soubor = null, vymenit = false } = {}) {
    if (this.prubehSady.bezi) throw chyba('Stahování už běží.', 409);
    if (!this.slozkaExistuje) throw chyba(`Složka zvuku ${this.slozka} neexistuje.`);
    const polozky = this.sada.polozky.filter((p) => (cil ? p.cil === cil : true));
    if (cil && !polozky.length) throw chyba('Taková položka v sadě není.', 404);
    if (vymenit && polozky.some((p) => p.balik)) throw chyba('Zvuk z balíčku nejde vyměnit za další: změň jméno souboru v kampan/zvuky-sada.yaml.');
    if (soubor && (!cil || !souboryPolozky(polozky[0]).includes(soubor))) throw chyba('Taková varianta v položce není.', 404);
    const prace = polozky
      .map((p) => ({ p, soubory: souboryPolozky(p).filter((f) => (!soubor || f === soubor) && (vymenit || !this.najit(f))) }))
      .filter((x) => x.soubory.length);
    const celkem = prace.reduce((n, x) => n + x.soubory.length, 0);
    this.prubehSady = { bezi: Boolean(celkem), hotovo: 0, celkem, text: celkem ? 'Hledám zvuky…' : 'Všechny soubory sady ve složce jsou.', chyba: null };
    this.oznamStav();
    if (!celkem) return { ok: true, celkem: 0 };
    this.uloha = this.stahnoutSadu(prace, vymenit, this.zdrojeZvuku());
    return { ok: true, celkem };
  }

  async stahnoutSadu(prace, vymenit, zdroje) {
    const chyby = [];
    const chybyZdroju = new Map(); // název zdroje → zpráva (každá jen jednou)
    const vadne = new Set(); // zdroj, který selhal, se do konce stahování už nezkouší
    const kmen = (f) => f.slice(0, f.length - path.posix.extname(f).length);
    try {
      for (const { p, soubory } of prace) {
        if (p.balik) {
          await this.zBaliku(p, soubory, chyby);
          continue;
        }
        const vynechane = new Set((this.zdroje.vynechane[p.cil] ?? []).map(idKandidata));
        if (vymenit) for (const f of soubory) if (this.zdroje.soubory[f]) vynechane.add(idKandidata(this.zdroje.soubory[f].id));
        const pouzite = souboryPolozky(p)
          .filter((f) => !soubory.includes(f))
          .map((f) => this.zdroje.soubory[f]?.id)
          .filter(Boolean)
          .map(idKandidata);
        this.prubehSady.text = `Hledám „${p.hledat}“ pro ${p.cil}…`;
        this.oznamStav();
        const { kandidati, chyby: ch } = await hledatKandidaty(zdroje, p, { kolik: soubory.length, vynechat: new Set([...vynechane, ...pouzite]), vadne });
        for (const e of ch) chybyZdroju.set(e.zdroj ?? e.message, e.message);
        if (!kandidati.length) {
          chyby.push(`${p.cil}: nic dalšího (${p.licence.join(', ').toUpperCase()}, ${p.delka[0]}–${p.delka[1]} s). Zkus v sadě jiné hledat, nebo víc dotazů: hledat: [první, druhý].`);
          this.prubehSady.hotovo += soubory.length;
          continue;
        }
        for (const f of soubory) {
          let hotovo = false;
          // Když se soubor nestáhne (úložiště neodpovídá), zkusí se další kandidát.
          while (!hotovo && kandidati.length) {
            const k = kandidati.shift();
            this.prubehSady.text = `Stahuji ${f} (${k.nazev}, ${k.autor}, ${k.zdroj})…`;
            this.oznamStav();
            try {
              const zdroj = zdroje.find((z) => k.zdroj.startsWith(z.nazev)) ?? zdroje.at(-1);
              const data = await zdroj.stahnout(k.nahled);
              const cilovy = `${kmen(f)}${k.pripona}`;
              // Starý soubor stejného jména s jinou příponou pryč, ať ve složce nejsou dva.
              for (const stary of this.soubory.filter((x) => kmen(x).toLowerCase() === kmen(f).toLowerCase() && x !== cilovy)) {
                await fs.rm(path.join(this.slozka, ...stary.split('/')), { force: true });
              }
              await zapsatAtomicky(path.join(this.slozka, ...cilovy.split('/')), data);
              this.zdroje.soubory[f] = { id: k.id, soubor: cilovy, nazev: k.nazev, autor: k.autor, licence: k.licence, url: k.url, zdroj: k.zdroj, cil: p.cil, stazeno: new Date(this.hodiny()).toISOString() };
              hotovo = true;
            } catch (e) {
              vynechane.add(k.id);
              if (!kandidati.length) chyby.push(`${f}: ${e.message}`);
            }
          }
          if (!hotovo && !chyby.some((c) => c.startsWith(`${f}:`))) chyby.push(`${f}: došli kandidáti`);
          this.prubehSady.hotovo++;
        }
        if (vynechane.size) this.zdroje.vynechane[p.cil] = [...vynechane].slice(-50);
        await zapsatAtomicky(this.souborZdroju, JSON.stringify(this.zdroje, null, 1));
        await this.prohledat();
      }
      // Nedostupný zdroj vadí, jen když něco chybí; jinak je to jen poznámka (stačil jiný zdroj).
      const zdroje_ = [...chybyZdroju.keys()].join(' a ');
      this.prubehSady = {
        ...this.prubehSady,
        bezi: false,
        text: chyby.length
          ? `Hotovo, ${chyby.length}× problém.`
          : `Hotovo. Zvuky jsou ve složce.${zdroje_ ? ` (${zdroje_} teď nešel, stačily ostatní zdroje.)` : ''}`,
        chyba: chyby.length ? [...chyby, ...chybyZdroju.values()].join('\n') : null,
      };
    } catch (e) {
      this.prubehSady = { ...this.prubehSady, bezi: false, text: 'Stahování se zastavilo.', chyba: e.message };
    }
    await this.prohledat().catch(() => {});
    this.oznamStav();
    this.emit('sada', this.prubehSady);
  }

  /**
   * Kontrola dat (rozhodnutí 63): soubory, na které odkazují místa a vrstvy, a ve složce nejsou.
   * @returns {Array<{soubor:string, uroven:string, zprava:string}>}
   */
  kontrola() {
    const odkazy = []; // [souborDat, jménoZvuku]
    const nahodneOdkazy = []; // [souborDat, skupina nebo soubor] (bod 85)
    const playlisty = []; // [souborDat, složka] (playlist hudby)
    const konce = []; // [souborDat, zvuk konce souboje]
    const pridatHudbu = (soubor, h) => {
      for (const x of Array.isArray(h) ? h : h ? [h] : []) (x.endsWith('/') ? playlisty : odkazy).push([soubor, x]);
    };
    for (const m of this.mista()) {
      for (const v of CASTI_ZVUKU_MISTA) {
        pridatHudbu(`kampan/mista/${m.id}/${m.id}.md`, m.zvuk?.[v]?.hudba);
        if (m.zvuk?.[v]?.ambient) odkazy.push([`kampan/mista/${m.id}/${m.id}.md`, m.zvuk[v].ambient]);
        for (const n of m.zvuk?.[v]?.nahodne ?? []) nahodneOdkazy.push([`kampan/mista/${m.id}/${m.id}.md`, n.zvuk]);
      }
    }
    // Zvuky na tah z kampan/zvuky.yaml: odkazují na skupiny (bez přípony), kontrolují se zvlášť níže.
    const vrstvy = this.vrstvy();
    for (const druh of ['pocasi', 'rezim']) {
      for (const [id, d] of Object.entries(vrstvy[druh] ?? {})) {
        const z = d?.zvuk;
        if (!z) continue;
        for (const s of [...seznamJmen(z.ambient), ...seznamJmen(z.hrom)]) odkazy.push([`kampan/sceny/${druh}/${id}.yaml`, s]);
        pridatHudbu(`kampan/sceny/${druh}/${id}.yaml`, platnaHudba(z.hudba));
        const konec = normalizujKonec(z.konec);
        if (konec) konce.push([`kampan/sceny/${druh}/${id}.yaml`, konec.zvuk]);
      }
    }
    const tahy = odkazyMapy(this.mapa);
    const sada = this.sada.chyby.map((zprava) => ({ soubor: 'kampan/zvuky-sada.yaml', uroven: 'varovani', zprava }));
    if (!odkazy.length && !tahy.length && !nahodneOdkazy.length && !playlisty.length && !konce.length && !this.chybaMapy) return sada;
    const mapa = [
      ...sada,
      ...(this.chybaMapy ? [{ soubor: 'kampan/zvuky.yaml', uroven: 'chyba', zprava: this.chybaMapy }] : []),
      ...(this.slozkaExistuje ? tahy.filter((id) => !najitSkupinu(this.knihovna, id)).map((id) => ({ soubor: 'kampan/zvuky.yaml', uroven: 'varovani', zprava: `Zvuk „${id}“ není ve složce zvuku` })) : []),
      ...(this.slozkaExistuje
        ? nahodneOdkazy.filter(([, id]) => !this.souboryZvuku(id).length).map(([soubor, id]) => ({ soubor, uroven: 'varovani', zprava: `Náhodný zvuk „${id}“ není ve složce zvuku` }))
        : []),
      ...(this.slozkaExistuje
        ? konce.filter(([, id]) => !this.souboryVariant(id).length).map(([soubor, id]) => ({ soubor, uroven: 'varovani', zprava: `Zvuk konce souboje „${id}“ není ve složce zvuku` }))
        : []),
      ...(this.slozkaExistuje
        ? playlisty.filter(([, h]) => !this.souboryHudby(h).length).map(([soubor, h]) => ({ soubor, uroven: 'varovani', zprava: `Playlist „${h}“ je prázdný: ve složce zvuku v něm nejsou žádné skladby` }))
        : []),
    ];
    if (!odkazy.length && !nahodneOdkazy.length && !playlisty.length && !konce.length) return mapa;
    if (!this.slozkaExistuje) {
      return [{ soubor: 'hub/.env', uroven: 'varovani', zprava: `Složka zvuku ${this.slozka} neexistuje. Nastav ji v Nastavení → Zvuk.` }];
    }
    const vse = [
      ...mapa,
      ...odkazy
        .filter(([, s]) => !this.najit(s))
        .map(([soubor, s]) => ({ soubor, uroven: 'varovani', zprava: `Zvuk „${s}“ není ve složce zvuku` })),
    ];
    // Stejný zvuk ve dne i v noci je v jednom souboru jedno hlášení.
    return vse.filter((x, i) => vse.findIndex((y) => y.soubor === x.soubor && y.zprava === x.zprava) === i);
  }

  zastavit() {
    clearTimeout(this.casovacMereni);
    clearInterval(this.casovacKontroly);
    clearInterval(this.casovacSlozky);
    for (const c of this.casovacHromu) clearTimeout(c);
    for (const x of this.smycky.values()) clearTimeout(x.casovac);
    this.casovacHromu.clear();
  }
}
