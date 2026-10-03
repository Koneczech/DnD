// Obchody (Blok 1b): uložené sortimenty v kampan/obchody/sortimenty/<id>.yaml, aktivní obchod,
// který ukazuje ceník v OBS (hub/.stav/obchod.json), a generátor servírovaný Hubem
// s daty z kampan/obchody/polozky.json.
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import YAML from 'yaml';
import { HUB_DIR } from './cesty.js';
import { zapsatAtomicky } from './zapis.js';

export const LOKALITY = Object.freeze(['rural', 'urban', 'premium']);
const MAX_POLOZEK = 60;

const chyba = (zprava, status = 400) => Object.assign(new Error(zprava), { status });

/** Slug pro jméno souboru: bez diakritiky, malá písmena, pomlčky. */
export function slug(text) {
  const s = String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return s || 'obchod';
}

const jeId = (id) => typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(id);
const kladneCele = (x) => Number.isInteger(x) && x > 0;

/**
 * Ověří sortiment ve formátu generátoru (stejná pravidla jako Apps/Shop/nacti_sortiment.py).
 * Vrací vyčištěný sortiment, nebo vyhodí chybu se seznamem problémů.
 */
export function overSortiment(d) {
  const chyby = [];
  if (!d || typeof d !== 'object') throw chyba('Sortiment chybí.');
  if (d.verze !== 1) chyby.push(`neznámá verze formátu: ${JSON.stringify(d.verze)}`);
  const o = d.obchod ?? {};
  for (const k of ['nazev', 'typ', 'lokalita']) if (!o[k]) chyby.push(`obchod.${k} chybí`);
  if (o.lokalita && !LOKALITY.includes(o.lokalita)) chyby.push(`obchod.lokalita ${o.lokalita} není z ${LOKALITY.join(', ')}`);
  const pol = Array.isArray(d.polozky) ? d.polozky : [];
  if (!pol.length) chyby.push('polozky chybí nebo jsou prázdné');
  if (pol.length > MAX_POLOZEK) chyby.push(`víc než ${MAX_POLOZEK} položek`);
  const videno = new Set();
  pol.forEach((p, i) => {
    const kde = `polozky[${i}]`;
    if (!p?.nazev) return chyby.push(`${kde}.nazev chybí`);
    if (videno.has(p.nazev)) chyby.push(`${kde}: ${p.nazev} je v sortimentu dvakrát`);
    videno.add(p.nazev);
    if (!kladneCele(p.cena_md)) chyby.push(`${kde}.cena_md musí být kladné celé číslo`);
    if (p.mnozstvi != null && !kladneCele(p.mnozstvi)) chyby.push(`${kde}.mnozstvi musí být kladné celé číslo nebo prázdné`);
  });
  if (chyby.length) throw Object.assign(chyba(`Sortiment není v pořádku: ${chyby.slice(0, 5).join('; ')}`), { chyby });
  const text = (x, max) => (x == null || x === '' ? null : String(x).slice(0, max));
  return {
    verze: 1,
    obchod: {
      nazev: String(o.nazev).slice(0, 80),
      typ: String(o.typ).slice(0, 40),
      lokalita: o.lokalita,
      mesto: text(o.mesto, 80),
      podtitul: text(o.podtitul, 160),
    },
    meta: {
      vygenerovano: text(d.meta?.vygenerovano, 40),
      seed: Number.isInteger(d.meta?.seed) ? d.meta.seed : null,
      generator: text(d.meta?.generator, 60),
    },
    polozky: pol.map((p) => ({
      nazev: String(p.nazev).slice(0, 80),
      cena_md: p.cena_md,
      mnozstvi: p.mnozstvi ?? null,
      jadro: Boolean(p.jadro),
    })),
  };
}

/** Data pro generátor: jen pole, která potřebuje (stejně jako Apps/Shop/postav_generator.py). */
export function stihlePolozky(databaze) {
  const pol = Array.isArray(databaze?.polozky) ? databaze.polozky : [];
  return pol.map((p) => {
    const z = {};
    for (const k of ['nazev_cs', 'nazev_en', 'cena_md', 'typy', 'lokality', 'bezne', 'kategorie']) if (k in p) z[k] = p[k];
    if ('kameny' in p) z.kameny = p.kameny;
    return z;
  });
}

/**
 * Události: 'zmena' (seznam pro panel), 'ceniky' (aktivní obchod pro OBS)
 */
export class Obchody extends EventEmitter {
  constructor({ cesty, zapisovac }) {
    super();
    this.c = cesty;
    this.zapisovac = zapisovac;
    this.slozka = path.join(cesty.kampan, 'obchody', 'sortimenty');
    this.databaze = path.join(cesty.kampan, 'obchody', 'polozky.json');
    this.sablona = path.join(HUB_DIR, 'nastroje', 'generator_sablona.html');
    this.souborAktivniho = path.join(cesty.lokalniStav, 'obchod.json');
    this.sortimenty = new Map(); // id → sortiment
    this.vadne = []; // soubory, které nejde přečíst
    this.aktivni = null; // id obchodu, který ceník právě ukazuje
  }

  async nacist() {
    await this.nacistSortimenty();
    try {
      const d = JSON.parse(await fs.readFile(this.souborAktivniho, 'utf8'));
      this.aktivni = jeId(d?.aktivni) ? d.aktivni : null;
    } catch {
      this.aktivni = null;
    }
    this.oznam();
  }

  async nacistSortimenty() {
    const mapa = new Map();
    const vadne = [];
    let soubory = [];
    try {
      soubory = (await fs.readdir(this.slozka)).filter((f) => f.endsWith('.yaml'));
    } catch {
      /* složka zatím není */
    }
    for (const f of soubory.sort()) {
      const id = f.slice(0, -5);
      try {
        const d = YAML.parse(await fs.readFile(path.join(this.slozka, f), 'utf8'));
        mapa.set(id, overSortiment(d));
      } catch (e) {
        vadne.push({ soubor: f, chyba: e.message.split('\n')[0] });
      }
    }
    this.sortimenty = mapa;
    this.vadne = vadne;
  }

  seznam() {
    return {
      sortimenty: [...this.sortimenty].map(([id, s]) => ({
        id,
        nazev: s.obchod.nazev,
        mesto: s.obchod.mesto,
        typ: s.obchod.typ,
        lokalita: s.obchod.lokalita,
        pocet: s.polozky.length,
        vygenerovano: s.meta.vygenerovano,
      })),
      aktivni: this.sortimenty.has(this.aktivni) ? this.aktivni : null,
      vadne: this.vadne,
    };
  }

  /** Co ukazuje ceník v OBS: celý aktivní sortiment, nebo null (panel se skryje). */
  ceniky() {
    return { id: this.seznam().aktivni, sortiment: this.sortimenty.get(this.aktivni) ?? null };
  }

  oznam() {
    this.emit('zmena', this.seznam());
    this.emit('ceniky', this.ceniky());
  }

  cestaSortimentu(id) {
    return path.join(this.slozka, `${id}.yaml`);
  }

  /**
   * Uloží sortiment z generátoru. Bez id vznikne nový soubor podle názvu obchodu
   * (při shodě jména s číslem), s id se přepíše existující.
   */
  async ulozit({ sortiment, id } = {}) {
    const s = overSortiment(sortiment);
    let cil = id;
    if (cil !== undefined && cil !== null && cil !== '') {
      if (!jeId(cil)) throw chyba('Neplatné id sortimentu.');
    } else {
      const zaklad = slug([s.obchod.nazev, s.obchod.mesto].filter(Boolean).join(' '));
      cil = zaklad;
      for (let i = 2; this.sortimenty.has(cil); i++) cil = `${zaklad}-${i}`;
    }
    await fs.mkdir(this.slozka, { recursive: true });
    const dok = new YAML.Document(s);
    dok.commentBefore = ' Sortiment obchodu z generátoru (Hub, obrazovka Obchody). Ceny v měďácích: 1 zl = 100 md, 1 st = 10 md.';
    const { vysledek } = await this.zapisovac.zapsat(this.cestaSortimentu(cil), dok.toString({ lineWidth: 0 }));
    this.sortimenty.set(cil, s);
    this.oznam();
    return { id: cil, vysledek };
  }

  async smazat(id) {
    if (!jeId(id) || !this.sortimenty.has(id)) throw chyba('Sortiment neexistuje.', 404);
    await this.zapisovac.zrusit(this.cestaSortimentu(id));
    await fs.rm(this.cestaSortimentu(id), { force: true });
    this.sortimenty.delete(id);
    if (this.aktivni === id) await this.ulozitAktivni(null);
    this.oznam();
    return { ok: true };
  }

  /** Obchod, který má ceník v OBS ukázat (null = ceník skrýt). */
  async nastavitAktivni(id) {
    if (id !== null && !this.sortimenty.has(id)) throw chyba('Sortiment neexistuje.', 404);
    await this.ulozitAktivni(id);
    this.oznam();
    return this.seznam();
  }

  async ulozitAktivni(id) {
    // Co právě visí v OBS je nastavení tohoto PC, ne data kampaně: hub/.stav, mimo Git.
    this.aktivni = id;
    await fs.mkdir(path.dirname(this.souborAktivniho), { recursive: true });
    await zapsatAtomicky(this.souborAktivniho, JSON.stringify({ aktivni: id }, null, 2));
  }

  /** generator.html se zapečenými položkami a příznakem, že běží v Hubu. */
  async generator() {
    let sablona;
    let databaze;
    try {
      sablona = await fs.readFile(this.sablona, 'utf8');
    } catch {
      throw chyba('Šablona generátoru hub/nastroje/generator_sablona.html chybí.', 404);
    }
    try {
      databaze = JSON.parse(await fs.readFile(this.databaze, 'utf8'));
    } catch (e) {
      throw chyba(`Databázi kampan/obchody/polozky.json nejde přečíst: ${e.message.split('\n')[0]}`, 500);
    }
    if (!sablona.includes('%%DATA%%')) throw chyba('V šabloně generátoru chybí značka %%DATA%%.', 500);
    // </script> uvnitř JSONu by ukončil blok dřív, než má
    const blob = JSON.stringify({ polozky: stihlePolozky(databaze) }).replace(/<\//g, '<\\/');
    const hub = '<script>window.DMHUB = { verze: 1 };</script>\n';
    return sablona.replace('%%DATA%%', () => blob).replace('<script id="data"', () => `${hub}<script id="data"`);
  }

  async souborZmenen(soubor) {
    const rel = path.relative(this.slozka, path.resolve(soubor));
    if (rel.startsWith('..') || path.isAbsolute(rel) || !rel.endsWith('.yaml')) return false;
    // Vlastní zápis už je v paměti; jinak (Obsidian, git pull) načti složku znovu.
    let text;
    try {
      text = await fs.readFile(soubor, 'utf8');
    } catch {
      text = undefined;
    }
    if (text !== undefined && this.zapisovac.jeVlastniZapis(soubor, text)) return true;
    await this.nacistSortimenty();
    this.oznam();
    return true;
  }
}
