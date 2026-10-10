// Místa (Blok 2): entity v kampan/mista/<id>/<id>.md s ilustracemi pro scénu v OBS.
// Hub mění v hlavičce jen to, co se mění z panelu (odkrytí, varianta, stav, nová ilustrace z dílny);
// komentáře, pořadí a tělo souboru zůstávají, aby se nepřepisovalo, co DM píše v Obsidianu.
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import YAML from 'yaml';
import { rozebrat, upravitDokument } from './frontmatter.js';
import { zapsatAtomicky } from './zapis.js';

export const UCELY = Object.freeze(['scena', 'portret', 'token', 'karta']);
export const VARIANTY = Object.freeze(['den', 'noc']);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const OBRAZEK = /\.(png|jpe?g|webp)$/i;
const MAX_OBRAZEK = 25 * 1024 * 1024;

const chyba = (zprava, status = 400) => Object.assign(new Error(zprava), { status });
const jeSlug = (x) => typeof x === 'string' && SLUG.test(x) && x.length <= 60;

/** Jméno souboru podle konvence <záběr>[-<varianta>][-<stav>].png (ZADANI.md, Datový model). */
export function jmenoIlustrace({ zaber, varianta, stav }, existujici = []) {
  const zaklad = [zaber, varianta, stav && stav !== 'vychozi' ? stav : null].filter(Boolean).join('-');
  let jmeno = `${zaklad}.png`;
  for (let i = 2; existujici.includes(jmeno); i++) jmeno = `${zaklad}-${i}.png`;
  return jmeno;
}

/** Ilustrace z hlavičky v jednotném tvaru. */
export function normalizujIlustraci(il) {
  if (!il || typeof il.soubor !== 'string' || !il.soubor) return null;
  return {
    soubor: il.soubor,
    ucel: UCELY.includes(il.ucel) ? il.ucel : 'scena',
    varianta: VARIANTY.includes(il.varianta) ? il.varianta : null,
    stav: typeof il.stav === 'string' && il.stav && il.stav !== 'vychozi' ? il.stav : null,
    skryta: il.skryta === true,
    prompt: typeof il.prompt === 'string' ? il.prompt : null,
  };
}

/** Pole `svetla` z hlavičky: jen den/noc a role jako objekty, zbytek se zahodí. */
export function normalizujSvetlaMista(svetla) {
  if (!svetla || typeof svetla !== 'object') return null;
  const vysledek = {};
  for (const v of VARIANTY) {
    const x = svetla[v];
    if (!x || typeof x !== 'object') continue;
    const role = Object.fromEntries(Object.entries(x).filter(([, h]) => h && typeof h === 'object' && !Array.isArray(h)));
    if (Object.keys(role).length) vysledek[v] = role;
  }
  return Object.keys(vysledek).length ? vysledek : null;
}

/**
 * Události: 'zmena' (seznam míst se všemi ilustracemi pro panel)
 */
export class Mista extends EventEmitter {
  constructor({ cesty, zapisovac }) {
    super();
    this.c = cesty;
    this.zapisovac = zapisovac;
    this.slozka = path.join(cesty.kampan, 'mista');
    /** @type {Map<string, object>} */
    this.mista = new Map();
    this.chyby = [];
  }

  cestaMista(id) {
    return path.join(this.slozka, id, `${id}.md`);
  }

  /** Veřejná adresa obrázku přes Hub (route /kampan/…). */
  url(id, soubor) {
    if (soubor.startsWith('/')) return soubor; // cesta od kořene repa (ZADANI.md)
    return `/kampan/mista/${encodeURIComponent(id)}/${encodeURIComponent(soubor)}`;
  }

  async nacistJedno(id) {
    const text = await fs.readFile(this.cestaMista(id), 'utf8');
    return this.nacistZTextu(id, text);
  }

  async nacist() {
    const mapa = new Map();
    const chyby = [];
    let slozky = [];
    try {
      slozky = (await fs.readdir(this.slozka, { withFileTypes: true })).filter((x) => x.isDirectory() && !x.name.startsWith('.'));
    } catch {
      /* složka zatím není */
    }
    for (const s of slozky.map((x) => x.name).sort()) {
      try {
        mapa.set(s, await this.nacistJedno(s));
      } catch (e) {
        if (e.code !== 'ENOENT') chyby.push({ misto: s, chyba: e.message.split('\n')[0] });
      }
    }
    this.mista = mapa;
    this.chyby = chyby;
    this.oznam();
  }

  oznam() {
    this.emit('zmena', this.seznam());
  }

  seznam() {
    return { mista: [...this.mista.values()].sort((a, b) => a.nazev.localeCompare(b.nazev, 'cs')), chyby: this.chyby };
  }

  get(id) {
    const m = this.mista.get(id);
    if (!m) throw chyba('Místo neexistuje.', 404);
    return m;
  }

  async upravitSoubor(id, uprava) {
    // Čtení i zápis ve frontě souboru a včetně odložené změny: dvě rychlé úpravy ani zamčený
    // soubor nezpůsobí, že by druhá úprava zahodila první (audit S1, N1).
    const { vysledek, obsah } = await this.zapisovac.upravit(this.cestaMista(id), (text) => upravitDokument(text, uprava));
    this.mista.set(id, await this.nacistZTextu(id, obsah));
    this.oznam();
    return vysledek;
  }

  async nacistZTextu(id, text) {
    const r = rozebrat(text);
    if (r.chyba || !r.maHlavicku) throw new Error(r.chyba || 'Chybí hlavička YAML');
    const d = r.data;
    const ilustrace = (Array.isArray(d.ilustrace) ? d.ilustrace : []).map(normalizujIlustraci).filter(Boolean);
    return {
      id,
      nazev: String(d.nazev ?? id),
      verejne: d.verejne !== false,
      popisObrazu: typeof d.popis_obrazu === 'string' ? d.popis_obrazu : '',
      // Světla místa pro den a noc (Blok 4); skládá je svetla.js.
      svetla: normalizujSvetlaMista(d.svetla),
      ilustrace: ilustrace.map((il) => ({ ...il, url: this.url(id, il.soubor) })),
    };
  }

  /**
   * Zachytit světla: uloží stav rolí do `svetla.<varianta>` v hlavičce. Ostatní pole, pořadí
   * a komentáře zůstávají (upravitDokument mění jen tento uzel).
   * @param {Record<string, object>} role např. {hlavni: {barva, jas}, lampa: {wiz_scena, rychlost, jas}}
   */
  async ulozitSvetla(id, varianta, role) {
    this.get(id);
    if (!VARIANTY.includes(varianta)) throw chyba('Světla se ukládají pro den, nebo noc.');
    await this.upravitSoubor(id, (dok) => {
      let svetla = dok.get('svetla', true);
      if (!YAML.isMap(svetla)) {
        svetla = dok.createNode({});
        dok.set('svetla', svetla);
      }
      const uzel = dok.createNode({});
      for (const [r, hodnota] of Object.entries(role)) {
        const radek = dok.createNode(hodnota);
        radek.flow = true; // { barva: [...], jas: 55 } na jednom řádku jako v zadání
        uzel.set(r, radek);
      }
      svetla.set(varianta, uzel);
    });
    return { misto: this.get(id) };
  }

  /** Odkrytí, varianta a stav jedné ilustrace. */
  async upravitIlustraci(id, soubor, zmeny) {
    const m = this.get(id);
    if (!m.ilustrace.some((il) => il.soubor === soubor)) throw chyba('Ilustrace neexistuje.', 404);
    const nastavit = {};
    if ('skryta' in zmeny) nastavit.skryta = zmeny.skryta === true;
    if ('varianta' in zmeny) {
      if (zmeny.varianta !== null && !VARIANTY.includes(zmeny.varianta)) throw chyba('Varianta musí být den, noc, nebo žádná.');
      nastavit.varianta = zmeny.varianta;
    }
    if ('stav' in zmeny) {
      const s = zmeny.stav ? String(zmeny.stav).trim() : null;
      if (s && !jeSlug(s)) throw chyba('Stav pište jako jedno slovo bez diakritiky (např. po-pozaru).');
      nastavit.stav = s && s !== 'vychozi' ? s : null;
    }
    const vysledek = await this.upravitSoubor(id, (dok) => {
      const seznam = dok.get('ilustrace', true);
      const uzel = seznam.items.find((x) => YAML.isMap(x) && x.get('soubor') === soubor);
      for (const [k, v] of Object.entries(nastavit)) {
        if (v === null) uzel.delete(k);
        else uzel.set(k, v);
      }
    });
    return { vysledek, misto: this.get(id) };
  }

  /** Zahodí ilustraci: smaže řádek z hlavičky i soubor obrázku. */
  async smazatIlustraci(id, soubor) {
    const m = this.get(id);
    if (!m.ilustrace.some((il) => il.soubor === soubor)) throw chyba('Ilustrace neexistuje.', 404);
    await this.upravitSoubor(id, (dok) => {
      const seznam = dok.get('ilustrace', true);
      seznam.items = seznam.items.filter((x) => !(YAML.isMap(x) && x.get('soubor') === soubor));
    });
    if (!soubor.startsWith('/') && !soubor.includes('/') && !soubor.includes('\\')) {
      await fs.rm(path.join(this.slozka, id, soubor), { force: true });
    }
    return { misto: this.get(id) };
  }

  async nastavitPopis(id, popis) {
    this.get(id);
    const text = String(popis ?? '').slice(0, 1500);
    await this.upravitSoubor(id, (dok) => dok.set('popis_obrazu', text));
    return { misto: this.get(id) };
  }

  /**
   * Nová ilustrace z dílny: obrázek už oříznutý a zvětšený v panelu (PNG 1920×1080).
   * Je vždy skrytá, dokud ji DM neodkryje (ZADANI.md, Ilustrační dílna, krok 3).
   */
  async pridatIlustraci(id, { png, zaber, varianta = null, stav = null, prompt = '' }) {
    const m = this.get(id);
    if (!jeSlug(zaber)) throw chyba('Záběr pište jako jedno slovo bez diakritiky (celek, detail, interier …).');
    if (varianta && !VARIANTY.includes(varianta)) throw chyba('Varianta musí být den, noc, nebo žádná.');
    if (stav && !jeSlug(stav)) throw chyba('Stav pište jako jedno slovo bez diakritiky.');
    if (!Buffer.isBuffer(png) || png.length < 8 || png.readUInt32BE(0) !== 0x89504e47) throw chyba('Obrázek musí být PNG.');
    if (png.length > MAX_OBRAZEK) throw chyba('Obrázek je větší než 25 MB.');
    const soubor = jmenoIlustrace({ zaber, varianta, stav }, m.ilustrace.map((il) => il.soubor));
    // Obrázek je binární a nový: atomický zápis z zapis.js, bez odkládání (nikdo ho nemá otevřený).
    await zapsatAtomicky(path.join(this.slozka, id, soubor), png);
    const zaznam = { soubor, ucel: 'scena' };
    if (varianta) zaznam.varianta = varianta;
    if (stav && stav !== 'vychozi') zaznam.stav = stav;
    zaznam.skryta = true;
    if (prompt) zaznam.prompt = String(prompt).slice(0, 4000);
    const obrazek = path.join(this.slozka, id, soubor);
    await this.upravitSoubor(id, (dok) => {
      let seznam = dok.get('ilustrace', true);
      if (!YAML.isSeq(seznam)) {
        seznam = dok.createNode([]);
        dok.set('ilustrace', seznam);
      }
      seznam.flow = false;
      seznam.items.push(dok.createNode(zaznam));
    }).catch(async (e) => {
      // Hlavička se nezměnila: obrázek bez záznamu by v repu jen překážel.
      await fs.rm(obrazek, { force: true }).catch(() => {});
      throw e;
    });
    return { soubor, misto: this.get(id) };
  }

  async souborZmenen(soubor) {
    const rel = path.relative(this.slozka, path.resolve(soubor));
    if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
    const casti = rel.split(path.sep);
    const id = casti[0];
    if (casti.length === 2 && casti[1] === `${id}.md`) {
      let text;
      try {
        text = await fs.readFile(soubor, 'utf8');
      } catch {
        text = undefined;
      }
      if (text !== undefined && this.zapisovac.jeVlastniZapis(soubor, text)) return true;
      await this.zapisovac.zrusit(soubor);
      if (text === undefined) this.mista.delete(id);
      else {
        try {
          this.mista.set(id, await this.nacistZTextu(id, text));
        } catch {
          /* rozbitý soubor: poslední platný stav zůstává, Kontrola dat ho ohlásí */
        }
      }
      this.oznam();
      return true;
    }
    if (OBRAZEK.test(rel)) return true; // obrázek: hlavička se nemění, OBS si ho načte znovu
    if (casti.length === 1) {
      await this.nacist();
      return true;
    }
    return false;
  }
}
