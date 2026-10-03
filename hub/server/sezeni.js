// Životní cyklus sezení (rozhodnutí 17, Blok 1a): Zahájit, poznámky ze stolu, Ukončit.
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { rozebrat, upravitHlavicku, slozit } from './frontmatter.js';
import { SCHEMA } from './data.js';
import { Harptos } from '../sdilene/harptos.js';

export const ID_PRIPRAVY = 'priprava';

const dvojmistne = (n) => String(n).padStart(2, '0');

/** Reálný čas na PC DM ve tvaru 18:05. */
export function casHodiny(d = new Date()) {
  return `${dvojmistne(d.getHours())}:${dvojmistne(d.getMinutes())}`;
}

/** Reálné datum ve tvaru 2026-10-03 (místní čas). */
export function datumIso(d = new Date()) {
  return `${d.getFullYear()}-${dvojmistne(d.getMonth() + 1)}-${dvojmistne(d.getDate())}`;
}

/** Reálné datum ve tvaru 3. 10. 2026 (zpráva commitu). */
export function datumCesky(d = new Date()) {
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
}

/** Místní čas ve tvaru 2026-10-03T18:05 (bez časové zóny, čte se v Obsidianu i Hubu). */
export function casIso(d = new Date()) {
  return `${datumIso(d)}T${casHodiny(d)}`;
}

export function idSezeni(cislo) {
  return `s${dvojmistne(cislo)}`;
}

/**
 * Text poznámky jako položka seznamu; víceřádková poznámka se odsadí.
 * S datem Harptosu: „- 18:05 (19. Eleint) — text“.
 */
export function radekPoznamky(text, d = new Date(), harptos = null) {
  const radky = String(text).trim().split(/\r?\n/);
  const den = harptos ? ` (${Harptos.kratce(harptos)})` : '';
  return `- ${casHodiny(d)}${den} — ${radky[0]}${radky.slice(1).map((r) => `\n  ${r}`).join('')}\n`;
}

export class Sezeni {
  constructor({ cesty, data, zapisovac }) {
    this.c = cesty;
    this.data = data;
    this.zapisovac = zapisovac;
    this.fronta = Promise.resolve(); // zápisy do souborů sezení jdou postupně
  }

  slozkaSezeni() {
    return path.join(this.c.kampan, 'sezeni');
  }

  souborSezeni(cislo) {
    const id = idSezeni(cislo);
    return path.join(this.slozkaSezeni(), id, `${id}.md`);
  }

  souborPripravy() {
    return path.join(this.slozkaSezeni(), `${ID_PRIPRAVY}.md`);
  }

  /** Soubor, kam právě padají poznámky: aktuální sezení, nebo příprava mimo sezení. */
  aktualniSoubor() {
    const s = this.data.stav;
    return s?.sezeniBezi ? this.souborSezeni(s.sezeni) : this.souborPripravy();
  }

  async hraci() {
    try {
      const k = YAML.parse(await fs.readFile(this.c.kampanYaml, 'utf8'));
      return Array.isArray(k?.hraci) ? k.hraci.filter((h) => h?.jmeno).map((h) => ({ jmeno: String(h.jmeno), postava: h.postava ? String(h.postava) : null })) : [];
    } catch {
      return [];
    }
  }

  /** Spustí úlohu po předchozí, aby se dva zápisy do stejného souboru nepřepsaly. */
  poradi(uloha) {
    const vysledek = this.fronta.then(uloha, uloha);
    this.fronta = vysledek.catch(() => {});
    return vysledek;
  }

  async precist(soubor) {
    const cekajici = this.zapisovac.cekajici(soubor);
    if (cekajici !== undefined) return cekajici;
    return fs.readFile(soubor, 'utf8');
  }

  /**
   * Zahájit sezení: zvýší číslo ve stav.md a založí sezeni/sNN/sNN.md.
   * @param {{pritomni?: string[], kdy?: Date}} volby
   */
  zahajit({ pritomni = [], kdy = new Date() } = {}) {
    return this.poradi(async () => {
      const stav = this.data.stav;
      if (!stav) throw Object.assign(new Error('Stav kampaně nejde přečíst. Oprav kampan/stav.md (Kontrola dat).'), { status: 409 });
      if (stav.sezeniBezi) throw Object.assign(new Error(`Sezení ${stav.sezeni} už běží. Nejdřív ho ukonči.`), { status: 409 });
      const cislo = stav.sezeni + 1;
      const soubor = this.souborSezeni(cislo);
      try {
        await fs.access(soubor);
        throw Object.assign(new Error(`Soubor ${idSezeni(cislo)}.md už existuje. Zkontroluj číslo sezení ve stavu kampaně.`), { status: 409 });
      } catch (e) {
        if (e.status) throw e;
      }
      const hlavicka = {
        schema: SCHEMA,
        id: idSezeni(cislo),
        typ: 'sezeni',
        nazev: `Sezení ${cislo}`,
        verejne: false,
        cislo,
        datum_realne: datumIso(kdy),
        zacatek: casIso(kdy),
        konec: null,
        pritomni: pritomni.map(String),
      };
      const harptos = stav.datum ?? null;
      const telo = `\n# Sezení ${cislo}\n\n## Poznámky ze stolu\n\n${radekPoznamky('Začátek sezení', kdy, harptos)}`;
      let obsah = slozit(hlavicka, telo);
      if (harptos) obsah = upravitHlavicku(obsah, { harptos_zacatek: harptos });
      await fs.mkdir(path.dirname(soubor), { recursive: true });
      const { vysledek } = await this.zapisovac.zapsat(soubor, obsah);
      await this.data.zmenitStav({ sezeni: cislo, sezeniBezi: true }, { interni: true });
      return { cislo, soubor: this.relativni(soubor), vysledek };
    });
  }

  /** Ukončit sezení: zapíše konec do souboru sezení a vypne příznak běžícího sezení. */
  ukoncit({ kdy = new Date() } = {}) {
    return this.poradi(async () => {
      const stav = this.data.stav;
      if (!stav?.sezeniBezi) throw Object.assign(new Error('Žádné sezení neběží.'), { status: 409 });
      const soubor = this.souborSezeni(stav.sezeni);
      let text;
      try {
        text = await this.precist(soubor);
      } catch {
        text = null;
      }
      let vysledek = 'zapsano';
      if (text !== null && !rozebrat(text).chyba) {
        const harptos = stav.datum ?? null;
        const novy = upravitHlavicku(text, { konec: casIso(kdy), ...(harptos ? { harptos_konec: harptos } : {}) });
        const konec = `${novy.endsWith('\n') ? '' : '\n'}${radekPoznamky('Konec sezení', kdy, harptos)}`;
        ({ vysledek } = await this.zapisovac.zapsat(soubor, novy + konec));
      }
      await this.data.zmenitStav({ sezeniBezi: false }, { interni: true });
      return { cislo: stav.sezeni, soubor: this.relativni(soubor), vysledek, souborChybel: text === null };
    });
  }

  /** Poznámka ze stolu s reálným časem. Bez běžícího sezení jde do sezeni/priprava.md. */
  poznamka(text, { kdy = new Date() } = {}) {
    const obsah = String(text ?? '').trim();
    if (!obsah) return Promise.reject(Object.assign(new Error('Poznámka je prázdná.'), { status: 400 }));
    if (obsah.length > 5000) return Promise.reject(Object.assign(new Error('Poznámka je delší než 5000 znaků.'), { status: 413 }));
    return this.poradi(async () => {
      const soubor = this.aktualniSoubor();
      let text;
      try {
        text = await this.precist(soubor);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
        if (soubor !== this.souborPripravy()) {
          throw Object.assign(new Error('Soubor běžícího sezení chybí. Ukonči sezení a zahaj nové.'), { status: 409 });
        }
        text = slozit(
          { schema: SCHEMA, id: ID_PRIPRAVY, typ: 'sezeni', nazev: 'Poznámky mimo sezení', verejne: false },
          '\n# Poznámky mimo sezení\n\n',
        );
      }
      const novy = `${text}${text.endsWith('\n') ? '' : '\n'}${radekPoznamky(obsah, kdy, this.data.stav?.datum ?? null)}`;
      await fs.mkdir(path.dirname(soubor), { recursive: true });
      const { vysledek } = await this.zapisovac.zapsat(soubor, novy);
      return { soubor: this.relativni(soubor), vysledek, cas: casHodiny(kdy) };
    });
  }

  relativni(soubor) {
    return path.relative(this.c.koren, soubor).split(path.sep).join('/');
  }

  /** Co panel potřebuje vědět o sezení. */
  async verejne() {
    const s = this.data.stav;
    return {
      bezi: Boolean(s?.sezeniBezi),
      cislo: s?.sezeni ?? null,
      soubor: s ? this.relativni(this.aktualniSoubor()) : null,
      hraci: await this.hraci(),
    };
  }
}
