// Atomický zápis souborů dat (rozhodnutí 18, Provoz a odolnost v ZADANI.md).
//
// 1. Obsah se zapíše do dočasného souboru ve stejné složce a vynutí se na disk (fsync).
// 2. Dočasný soubor se přejmenuje přes cílový. Přejmenování je atomické, takže cílový
//    soubor je vždy buď celý starý, nebo celý nový.
// 3. Na Windows přejmenování selže (EPERM/EBUSY/EACCES), když cílový soubor drží
//    otevřený jiný proces bez sdílení (Obsidian, antivir, indexer). Zkusí se to
//    nejvýš 5× v celkovém limitu 1 s.
// 4. Když nepomůže ani to, změna zůstane v paměti jako odložený zápis a opakuje se
//    na pozadí. Nikdy se nesáhne po neatomickém zápisu.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

export const KODY_ZAMKU = new Set(['EPERM', 'EBUSY', 'EACCES']);
export const PRIPONA_DOCASNA = '.hub-tmp';

const cekej = (ms) => new Promise((r) => setTimeout(r, ms));

export class ZamcenySouborError extends Error {
  constructor(soubor, pricina) {
    super(`Soubor ${soubor} je zamčený jiným programem (${pricina?.code ?? 'neznámý kód'}).`);
    this.name = 'ZamcenySouborError';
    this.soubor = soubor;
    this.cause = pricina;
  }
}

function docasnaCesta(soubor) {
  const nahodne = crypto.randomBytes(4).toString('hex');
  return path.join(path.dirname(soubor), `.${path.basename(soubor)}.${process.pid}.${nahodne}${PRIPONA_DOCASNA}`);
}

async function zapsatDocasny(cesta, obsah) {
  const fh = await fs.open(cesta, 'wx');
  try {
    await fh.writeFile(obsah, 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }
}

/**
 * Jeden pokus o atomický zápis s opakováním přejmenování.
 * @returns {Promise<{pokusu:number}>}
 * @throws ZamcenySouborError když je soubor zamčený i po všech pokusech
 */
export async function zapsatAtomicky(soubor, obsah, { pokusu = 5, limitMs = 1000, prodlevyMs = [0, 50, 100, 200, 400] } = {}) {
  const zacatek = Date.now();
  const docasny = docasnaCesta(soubor);
  await fs.mkdir(path.dirname(soubor), { recursive: true });
  await zapsatDocasny(docasny, obsah);

  let posledniChyba;
  try {
    for (let i = 0; i < pokusu; i++) {
      const prodleva = prodlevyMs[Math.min(i, prodlevyMs.length - 1)];
      if (i > 0) {
        if (Date.now() + prodleva - zacatek > limitMs) break;
        await cekej(prodleva);
      }
      try {
        await fs.rename(docasny, soubor);
        return { pokusu: i + 1 };
      } catch (e) {
        if (!KODY_ZAMKU.has(e.code)) throw e;
        posledniChyba = e;
      }
    }
  } catch (e) {
    await fs.rm(docasny, { force: true }).catch(() => {});
    throw e;
  }
  await fs.rm(docasny, { force: true }).catch(() => {});
  throw new ZamcenySouborError(soubor, posledniChyba);
}

/**
 * Zapisovač s odloženými zápisy.
 *
 * Události:
 *  - 'odlozeno'  { soubor }  zápis neprošel, změna čeká v paměti
 *  - 'dokonceno' { soubor }  odložený zápis se podařilo dokončit
 *  - 'zahozeno'  { soubor }  odložený zápis zrušen, protože soubor na disku změnil někdo jiný
 */
export class Zapisovac extends EventEmitter {
  /**
   * @param {object} volby
   * @param {string} [volby.zurnal] složka, kam se odložené zápisy ukládají, aby přežily pád serveru
   */
  constructor({ intervalOpakovaniMs = 1000, volbyZapisu = {}, zurnal = null } = {}) {
    super();
    this.intervalOpakovaniMs = intervalOpakovaniMs;
    this.volbyZapisu = volbyZapisu;
    this.zurnal = zurnal;
    /** @type {Map<string, string>} soubor -> obsah čekající na zápis */
    this.odlozene = new Map();
    /** @type {Map<string, string>} soubor -> hash posledního obsahu, který zapsal Hub */
    this.posledniZapsane = new Map();
    this.casovac = null;
    this.bezi = false;
  }

  static hash(obsah) {
    return crypto.createHash('sha1').update(obsah).digest('hex');
  }

  /** Zapsal tento obsah Hub sám? Hlídání souborů tak pozná vlastní ozvěnu. */
  jeVlastniZapis(soubor, obsah) {
    return this.posledniZapsane.get(path.resolve(soubor)) === Zapisovac.hash(obsah);
  }

  /** Obsah, který čeká na zápis (nebo undefined). */
  cekajici(soubor) {
    return this.odlozene.get(path.resolve(soubor));
  }

  seznamOdlozenych() {
    return [...this.odlozene.keys()];
  }

  /**
   * Zapíše obsah atomicky. Zamčený soubor nevyhodí chybu, ale vrátí {vysledek:'odlozeno'}.
   * @returns {Promise<{vysledek:'zapsano'|'odlozeno'}>}
   */
  async zapsat(soubor, obsah) {
    const klic = path.resolve(soubor);
    // Novější změna nahrazuje starší odloženou.
    this.posledniZapsane.set(klic, Zapisovac.hash(obsah));
    try {
      await zapsatAtomicky(klic, obsah, this.volbyZapisu);
      const bylOdlozeny = this.odlozene.delete(klic);
      if (bylOdlozeny) {
        await this.smazZurnal(klic);
        this.emit('dokonceno', { soubor: klic });
      }
      this.zastavPokudPrazdne();
      return { vysledek: 'zapsano' };
    } catch (e) {
      if (!(e instanceof ZamcenySouborError)) throw e;
      const novy = !this.odlozene.has(klic);
      this.odlozene.set(klic, obsah);
      await this.zapisZurnal(klic, obsah);
      if (novy) this.emit('odlozeno', { soubor: klic });
      this.spustOpakovani();
      return { vysledek: 'odlozeno' };
    }
  }

  /** Soubor na disku má přednost: zruš odložený zápis, pokud nějaký čeká. */
  async zrusit(soubor) {
    const klic = path.resolve(soubor);
    if (this.odlozene.delete(klic)) {
      await this.smazZurnal(klic);
      this.emit('zahozeno', { soubor: klic });
      this.zastavPokudPrazdne();
    }
  }

  cestaZurnalu(soubor) {
    return path.join(this.zurnal, `${Zapisovac.hash(soubor)}.json`);
  }

  /** Odložený zápis se uloží i na disk (do jiného, nezamčeného souboru), aby přežil pád serveru. */
  async zapisZurnal(soubor, obsah) {
    if (!this.zurnal) return;
    try {
      await fs.mkdir(this.zurnal, { recursive: true });
      await zapsatAtomicky(this.cestaZurnalu(soubor), JSON.stringify({ soubor, obsah, cas: Date.now() }));
    } catch (e) {
      this.emit('chyba', { soubor, chyba: e });
    }
  }

  async smazZurnal(soubor) {
    if (!this.zurnal) return;
    await fs.rm(this.cestaZurnalu(soubor), { force: true }).catch(() => {});
  }

  /**
   * Po startu načte odložené zápisy ze žurnálu. Pokud se cílový soubor mezitím změnil
   * (je novější než záznam v žurnálu), má přednost soubor na disku a záznam se zahodí.
   * @returns {Promise<{obnoveno:string[], zahozeno:string[]}>}
   */
  async obnovit() {
    const vysledek = { obnoveno: [], zahozeno: [] };
    if (!this.zurnal) return vysledek;
    let soubory = [];
    try {
      soubory = await fs.readdir(this.zurnal);
    } catch {
      return vysledek;
    }
    for (const jmeno of soubory.filter((s) => s.endsWith('.json'))) {
      const cesta = path.join(this.zurnal, jmeno);
      try {
        const { soubor, obsah, cas } = JSON.parse(await fs.readFile(cesta, 'utf8'));
        const st = await fs.stat(soubor).catch(() => null);
        if (st && st.mtimeMs > cas) {
          await fs.rm(cesta, { force: true });
          vysledek.zahozeno.push(soubor);
          continue;
        }
        this.odlozene.set(path.resolve(soubor), obsah);
        this.posledniZapsane.set(path.resolve(soubor), Zapisovac.hash(obsah));
        vysledek.obnoveno.push(soubor);
      } catch (e) {
        this.emit('chyba', { soubor: cesta, chyba: e });
      }
    }
    if (this.odlozene.size) await this.zopakuj();
    if (this.odlozene.size) this.spustOpakovani();
    return vysledek;
  }

  spustOpakovani() {
    if (this.casovac) return;
    this.casovac = setInterval(() => this.zopakuj(), this.intervalOpakovaniMs);
    this.casovac.unref?.();
  }

  zastavPokudPrazdne() {
    if (this.odlozene.size === 0 && this.casovac) {
      clearInterval(this.casovac);
      this.casovac = null;
    }
  }

  async zopakuj() {
    if (this.bezi) return;
    this.bezi = true;
    try {
      for (const [soubor, obsah] of [...this.odlozene]) {
        try {
          await zapsatAtomicky(soubor, obsah, this.volbyZapisu);
          // Mezitím mohla přijít novější změna; smaž jen pokud čeká pořád tentýž obsah.
          if (this.odlozene.get(soubor) === obsah) {
            this.odlozene.delete(soubor);
            await this.smazZurnal(soubor);
            this.emit('dokonceno', { soubor });
          }
        } catch (e) {
          if (!(e instanceof ZamcenySouborError)) this.emit('chyba', { soubor, chyba: e });
        }
      }
    } finally {
      this.bezi = false;
      this.zastavPokudPrazdne();
    }
  }

  /** Před ukončením zkusí odložené zápisy ještě jednou. */
  async dokoncit() {
    await this.zopakuj();
    if (this.casovac) clearInterval(this.casovac);
    this.casovac = null;
  }
}
