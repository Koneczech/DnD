// Data kampaně: stav.md, kampan.yaml a Kontrola dat nad celou složkou kampan/.
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import YAML from 'yaml';
import { rozebrat, upravitHlavicku, odkazy } from './frontmatter.js';
import { TYPY_SLOZEK, TYPY } from './cesty.js';
import { PRIPONA_DOCASNA } from './zapis.js';

export const SCHEMA = 1;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const POVINNE_ENTITY = ['schema', 'id', 'typ', 'nazev', 'verejne'];

/** Slug podle konvence v ZADANI.md: malá písmena bez diakritiky, pomlčky. */
export function slug(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function relativni(koren, soubor) {
  return path.relative(koren, soubor).split(path.sep).join('/');
}

/** Ověří hodnoty stavu kampaně. Vrací seznam chyb (prázdný = v pořádku). */
export function overStav(data) {
  const chyby = [];
  if (!data || typeof data !== 'object') return ['Chybí hlavička'];
  if (data.schema !== SCHEMA) chyby.push(`schema musí být ${SCHEMA}`);
  if (typeof data.datum !== 'string') chyby.push('datum musí být text');
  if (typeof data.misto !== 'string') chyby.push('misto musí být text');
  if (!Number.isInteger(data.sezeni) || data.sezeni < 0) chyby.push('sezeni musí být celé číslo 0 nebo větší');
  if ('sezeni_bezi' in data && typeof data.sezeni_bezi !== 'boolean') chyby.push('sezeni_bezi musí být true nebo false');
  return chyby;
}

async function projdi(slozka) {
  const vysledek = [];
  let polozky;
  try {
    polozky = await fs.readdir(slozka, { withFileTypes: true });
  } catch {
    return vysledek;
  }
  for (const p of polozky) {
    if (p.name.startsWith('.') || p.name.endsWith(PRIPONA_DOCASNA)) continue;
    const cesta = path.join(slozka, p.name);
    if (p.isDirectory()) vysledek.push(...(await projdi(cesta)));
    else vysledek.push(cesta);
  }
  return vysledek;
}

/**
 * Kontrola dat (ZADANI.md, Datový model): rozbitý soubor nezastaví zbytek, jen se ohlásí.
 * @returns {Promise<{problemy: Array<{soubor:string, uroven:'chyba'|'varovani', zprava:string}>, pocetSouboru:number, entity:number}>}
 */
export async function kontrolaDat(c) {
  const problemy = [];
  const pridej = (soubor, uroven, zprava) => problemy.push({ soubor: relativni(c.koren, soubor), uroven, zprava });

  // Stav kampaně
  try {
    const r = rozebrat(await fs.readFile(c.stav, 'utf8'));
    if (r.chyba) pridej(c.stav, 'chyba', r.chyba);
    else for (const ch of overStav(r.data)) pridej(c.stav, 'chyba', ch);
  } catch (e) {
    pridej(c.stav, 'chyba', e.code === 'ENOENT' ? 'Soubor chybí' : e.message);
  }
  try {
    const d = YAML.parse(await fs.readFile(c.kampanYaml, 'utf8'));
    if (!d || d.schema !== SCHEMA) pridej(c.kampanYaml, 'chyba', `schema musí být ${SCHEMA}`);
    if (!d?.nazev) pridej(c.kampanYaml, 'chyba', 'Chybí nazev');
  } catch (e) {
    pridej(c.kampanYaml, 'chyba', e.code === 'ENOENT' ? 'Soubor chybí' : `Chyba v YAML: ${e.message.split('\n')[0]}`);
  }

  // Entity a záznamy
  const soubory = await projdi(c.kampan);
  const zaznamy = [];
  for (const soubor of soubory.filter((s) => s.endsWith('.md'))) {
    const casti = path.relative(c.kampan, soubor).split(path.sep);
    const typSlozky = TYPY_SLOZEK[casti[0]];
    if (!typSlozky) continue;
    const jmeno = path.basename(soubor, '.md');
    const jeZaznam = casti.length === 2;
    const jeEntita = casti.length === 3 && casti[1] === jmeno;
    if (!jeZaznam && !jeEntita) continue; // vedlejší soubory ve složce entity se nekontrolují

    let r;
    try {
      r = rozebrat(await fs.readFile(soubor, 'utf8'));
    } catch (e) {
      pridej(soubor, 'chyba', e.message);
      continue;
    }
    if (r.chyba) {
      pridej(soubor, 'chyba', r.chyba);
      continue;
    }
    if (!r.maHlavicku) {
      pridej(soubor, 'chyba', 'Chybí hlavička YAML');
      continue;
    }
    const d = r.data;
    for (const pole of POVINNE_ENTITY) if (!(pole in d)) pridej(soubor, 'chyba', `Chybí povinné pole ${pole}`);
    if ('schema' in d && d.schema !== SCHEMA) pridej(soubor, 'chyba', `Neznámá verze schématu ${d.schema}`);
    if ('id' in d) {
      if (!SLUG.test(String(d.id))) pridej(soubor, 'chyba', `id „${d.id}“ není slug (malá písmena bez diakritiky, pomlčky)`);
      if (String(d.id) !== jmeno) pridej(soubor, 'chyba', `id „${d.id}“ neodpovídá jménu souboru „${jmeno}“`);
    }
    if ('typ' in d) {
      if (!TYPY.includes(d.typ)) pridej(soubor, 'chyba', `Neznámý typ „${d.typ}“`);
      else if (d.typ !== typSlozky) pridej(soubor, 'chyba', `Typ „${d.typ}“ nepatří do složky ${casti[0]}/ (čeká se „${typSlozky}“)`);
    }
    if ('verejne' in d && typeof d.verejne !== 'boolean') pridej(soubor, 'chyba', 'verejne musí být true nebo false');
    zaznamy.push({ soubor, data: d, telo: r.telo, slozka: path.dirname(soubor) });
  }

  // Duplicitní id napříč kampaní
  const podleId = new Map();
  for (const z of zaznamy) {
    if (!z.data.id) continue;
    const id = String(z.data.id);
    if (!podleId.has(id)) podleId.set(id, []);
    podleId.get(id).push(z.soubor);
  }
  for (const [id, kde] of podleId) {
    if (kde.length > 1) for (const s of kde) pridej(s, 'chyba', `Duplicitní id „${id}“ (${kde.length}×)`);
  }

  // Vazby a obrázky
  for (const z of zaznamy) {
    const cile = new Set([...odkazy(JSON.stringify(z.data.vazby ?? [])), ...odkazy(z.telo)]);
    for (const cil of cile) if (!podleId.has(cil)) pridej(z.soubor, 'varovani', `Vazba [[${cil}]] vede na neexistující id`);
    const ilustrace = Array.isArray(z.data.ilustrace) ? z.data.ilustrace : [];
    for (const il of ilustrace) {
      if (!il?.soubor) {
        pridej(z.soubor, 'chyba', 'Ilustrace bez pole soubor');
        continue;
      }
      const cesta = String(il.soubor).startsWith('/') ? path.join(c.koren, il.soubor) : path.join(z.slozka, il.soubor);
      try {
        await fs.access(cesta);
      } catch {
        pridej(z.soubor, 'varovani', `Obrázek ${il.soubor} neexistuje`);
      }
    }
  }

  return { problemy, pocetSouboru: soubory.length, entity: zaznamy.length };
}

/**
 * Stav kampaně v paměti serveru. Soubor na disku má vždy přednost.
 * Události: 'stav' (nový stav), 'kontrola' (nový výsledek Kontroly dat)
 */
export class DataKampane extends EventEmitter {
  constructor({ cesty, zapisovac }) {
    super();
    this.c = cesty;
    this.zapisovac = zapisovac;
    this.stav = null;
    this.chybaStavu = null;
    this.kampan = null;
    this.kontrola = { problemy: [], pocetSouboru: 0, entity: 0 };
    this.kontrolaCasovac = null;
  }

  async nacist() {
    await this.nacistStav();
    await this.nacistKampan();
    await this.zkontrolovat();
  }

  async nacistStav(text) {
    try {
      const obsah = text ?? (await fs.readFile(this.c.stav, 'utf8'));
      const r = rozebrat(obsah);
      const chyby = r.chyba ? [r.chyba] : overStav(r.data);
      if (chyby.length) {
        this.chybaStavu = chyby.join('; ');
        // Poslední platný stav zůstává, aby se výstupy v OBS nevyprázdnily.
      } else {
        this.chybaStavu = null;
        this.stav = { datum: r.data.datum, misto: r.data.misto, sezeni: r.data.sezeni, sezeniBezi: Boolean(r.data.sezeni_bezi) };
      }
    } catch (e) {
      this.chybaStavu = e.code === 'ENOENT' ? 'Soubor kampan/stav.md chybí' : e.message;
    }
    this.emit('stav', this.verejnyStav());
  }

  async nacistKampan() {
    try {
      this.kampan = YAML.parse(await fs.readFile(this.c.kampanYaml, 'utf8'));
    } catch {
      this.kampan = null;
    }
  }

  verejnyStav() {
    return {
      stav: this.stav,
      chyba: this.chybaStavu,
      kampan: this.kampan ? { nazev: this.kampan.nazev ?? null } : null,
      odlozeno: Boolean(this.zapisovac.cekajici(this.c.stav)),
    };
  }

  /**
   * Změna z panelu. Zapíše se automaticky (autosave) a hned se pošle do výstupů.
   * @param {{datum?:string, misto?:string, sezeni?:number}} zmeny
   */
  async zmenitStav(zmeny) {
    const povolene = {};
    if ('datum' in zmeny) povolene.datum = String(zmeny.datum);
    if ('misto' in zmeny) povolene.misto = String(zmeny.misto);
    if ('sezeni' in zmeny) povolene.sezeni = Number(zmeny.sezeni);
    const chyby = overStav({ schema: SCHEMA, datum: '', misto: '', sezeni: 0, ...povolene });
    if (chyby.length) {
      const e = new Error(chyby.join('; '));
      e.status = 400;
      throw e;
    }
    const zaklad = this.zapisovac.cekajici(this.c.stav) ?? (await fs.readFile(this.c.stav, 'utf8'));
    const prevod = {};
    for (const [k, v] of Object.entries(povolene)) prevod[k] = v;
    const novyText = upravitHlavicku(zaklad, prevod);
    const { vysledek } = await this.zapisovac.zapsat(this.c.stav, novyText);
    await this.nacistStav(novyText);
    return { vysledek };
  }

  /** Volá hlídání souborů. */
  async souborZmenen(soubor) {
    if (path.resolve(soubor) === path.resolve(this.c.stav)) {
      let text;
      try {
        text = await fs.readFile(this.c.stav, 'utf8');
      } catch {
        text = undefined;
      }
      if (text !== undefined && this.zapisovac.jeVlastniZapis(this.c.stav, text)) return;
      // Změna zvenku: soubor na disku má přednost před odloženým zápisem.
      await this.zapisovac.zrusit(this.c.stav);
      await this.nacistStav(text);
    } else if (path.resolve(soubor) === path.resolve(this.c.kampanYaml)) {
      await this.nacistKampan();
      this.emit('stav', this.verejnyStav());
    }
    this.naplanovatKontrolu();
  }

  naplanovatKontrolu() {
    clearTimeout(this.kontrolaCasovac);
    this.kontrolaCasovac = setTimeout(() => this.zkontrolovat().catch(() => {}), 200);
    this.kontrolaCasovac.unref?.();
  }

  async zkontrolovat() {
    this.kontrola = await kontrolaDat(this.c);
    this.emit('kontrola', this.kontrola);
    return this.kontrola;
  }
}
