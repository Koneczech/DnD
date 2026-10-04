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
 * Všechny operace nad jedním souborem (zápis, úprava, opakování odloženého zápisu, zrušení) běží
 * ve frontě za sebou. Novější změna tak nikdy nepředběhne starší a opakování odloženého zápisu
 * zapíše vždy nejnovější obsah, ne ten, který čekal jako první (audit S1, N1).
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
    /**
     * soubor -> otisky posledních obsahů, které zapsal Hub (nejnovější poslední). Pamatuje si jich
     * víc: hlídání souborů může ohlásit starší vlastní zápis až po novějším a ten by jinak
     * vypadal jako cizí změna a vrátil by Hub do staršího stavu.
     * @type {Map<string, Array<{hash: string, cas: number}>>}
     */
    this.posledniZapsane = new Map();
    /** @type {Map<string, Promise<unknown>>} soubor -> konec fronty operací nad ním */
    this.fronty = new Map();
    this.casovac = null;
    this.bezi = false;
  }

  static hash(obsah) {
    return crypto.createHash('sha1').update(obsah).digest('hex');
  }

  /** Spustí operaci nad souborem až po dokončení všech předchozích operací nad ním. */
  poradi(klic, operace) {
    const predchozi = this.fronty.get(klic) ?? Promise.resolve();
    const vysledek = predchozi.catch(() => {}).then(operace);
    const konec = vysledek.catch(() => {});
    this.fronty.set(klic, konec);
    konec.then(() => {
      if (this.fronty.get(klic) === konec) this.fronty.delete(klic);
    });
    return vysledek;
  }

  /** Zapsal tento obsah Hub sám? Hlídání souborů tak pozná vlastní ozvěnu. */
  jeVlastniZapis(soubor, obsah) {
    const hash = Zapisovac.hash(obsah);
    return (this.posledniZapsane.get(path.resolve(soubor)) ?? []).some((z) => z.hash === hash);
  }

  /** Zapamatuje si vlastní zápis: posledních 5 a nejvýš 10 s staré (nejnovější vždy). */
  zapamatovat(klic, obsah) {
    const ted = Date.now();
    const seznam = (this.posledniZapsane.get(klic) ?? []).filter((z) => ted - z.cas < 10000).slice(-4);
    seznam.push({ hash: Zapisovac.hash(obsah), cas: ted });
    this.posledniZapsane.set(klic, seznam);
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
  zapsat(soubor, obsah) {
    const klic = path.resolve(soubor);
    return this.poradi(klic, () => this.zapsatTed(klic, obsah));
  }

  /**
   * Přečte poslední obsah souboru (včetně odloženého zápisu), nechá ho upravit a zapíše výsledek.
   * Čtení i zápis běží ve frontě souboru, takže se dvě úpravy nikdy nepřepíšou (read-modify-write).
   * @param {(text:string) => string|Promise<string>} uprava vrátí nový obsah
   * @returns {Promise<{vysledek:'zapsano'|'odlozeno', obsah:string}>}
   */
  upravit(soubor, uprava) {
    const klic = path.resolve(soubor);
    return this.poradi(klic, async () => {
      const text = this.odlozene.get(klic) ?? (await fs.readFile(klic, 'utf8'));
      const obsah = await uprava(text);
      const { vysledek } = await this.zapsatTed(klic, obsah);
      return { vysledek, obsah };
    });
  }

  async zapsatTed(klic, obsah) {
    this.zapamatovat(klic, obsah);
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
      // Novější změna nahrazuje starší odloženou.
      const novy = !this.odlozene.has(klic);
      this.odlozene.set(klic, obsah);
      await this.zapisZurnal(klic, obsah);
      if (novy) this.emit('odlozeno', { soubor: klic });
      this.spustOpakovani();
      return { vysledek: 'odlozeno' };
    }
  }

  /** Soubor na disku má přednost: zruš odložený zápis, pokud nějaký čeká. */
  zrusit(soubor) {
    const klic = path.resolve(soubor);
    return this.poradi(klic, async () => {
      if (this.odlozene.delete(klic)) {
        await this.smazZurnal(klic);
        this.emit('zahozeno', { soubor: klic });
        this.zastavPokudPrazdne();
      }
    });
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
        this.zapamatovat(path.resolve(soubor), obsah);
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
      for (const soubor of [...this.odlozene.keys()]) {
        await this.poradi(soubor, async () => {
          // Ve frontě souboru: obsah se čte až teď, takže je to vždy nejnovější odložená změna.
          const obsah = this.odlozene.get(soubor);
          if (obsah === undefined) return;
          try {
            await zapsatAtomicky(soubor, obsah, this.volbyZapisu);
            this.odlozene.delete(soubor);
            await this.smazZurnal(soubor);
            this.emit('dokonceno', { soubor });
          } catch (e) {
            if (!(e instanceof ZamcenySouborError)) this.emit('chyba', { soubor, chyba: e });
          }
        });
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
