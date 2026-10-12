// Záznam událostí Hubu (otevřený bod 84): co se dělo a co selhalo, aby šly chyby u stolu dohledat.
// Posledních 2000 záznamů drží v paměti (panel, /api/zaznam) a zapisuje je i do denního souboru
// hub/.stav/zaznam/hub-RRRR-MM-DD.log (mimo Git, staré soubory po 14 dnech maže).
// Do záznamu nikdy nejde nic tajného: hesla, klíče, relace ani PIN se sem nepředávají.
import fs from 'node:fs/promises';
import path from 'node:path';

export const UROVNE = Object.freeze(['info', 'varovani', 'chyba']);
const MAX_V_PAMETI = 2000;
const DNU_SOUBORU = 14;
const TAJNE = /(heslo|klic|key|token|relace|connect\.sid|pin|secret)/i;

/** Data záznamu bez tajných polí a bez dlouhých hodnot. */
export function ocistit(data) {
  if (data === undefined || data === null) return undefined;
  const pruchod = (x, hloubka) => {
    if (hloubka > 3) return '…';
    if (typeof x === 'string') return x.length > 300 ? `${x.slice(0, 300)}…` : x;
    if (Array.isArray(x)) return x.slice(0, 20).map((y) => pruchod(y, hloubka + 1));
    if (x && typeof x === 'object') {
      const v = {};
      for (const [k, h] of Object.entries(x)) v[k] = TAJNE.test(k) ? '•••' : pruchod(h, hloubka + 1);
      return v;
    }
    return x;
  };
  return pruchod(data, 0);
}

export class Zaznam {
  constructor({ slozka = null, hodiny = () => new Date() } = {}) {
    this.slozka = slozka;
    this.hodiny = hodiny;
    this.polozky = [];
    this.cislo = 0;
    this.fronta = Promise.resolve();
    this.posledni = new Map(); // klíč → text: stejné opakované hlášení se zapíše jen jednou
  }

  /**
   * Zapíše událost. `zdroj` = část Hubu (scena, zvuk, svetla, obs, iniciativa, stranka …).
   * @returns {object} záznam
   */
  zapsat(zdroj, uroven, zprava, data) {
    const cas = this.hodiny();
    const z = {
      cislo: ++this.cislo,
      cas: cas.toISOString(),
      zdroj: String(zdroj).slice(0, 30),
      uroven: UROVNE.includes(uroven) ? uroven : 'info',
      zprava: String(zprava).slice(0, 500),
      ...(data !== undefined ? { data: ocistit(data) } : {}),
    };
    this.polozky.push(z);
    if (this.polozky.length > MAX_V_PAMETI) this.polozky.splice(0, this.polozky.length - MAX_V_PAMETI);
    this.doSouboru(z);
    return z;
  }

  info(zdroj, zprava, data) {
    return this.zapsat(zdroj, 'info', zprava, data);
  }

  varovani(zdroj, zprava, data) {
    return this.zapsat(zdroj, 'varovani', zprava, data);
  }

  chyba(zdroj, zprava, data) {
    return this.zapsat(zdroj, 'chyba', zprava, data);
  }

  /** Zapíše, jen když se text pro daný klíč změnil (stav, který se hlásí každých pár sekund). */
  zmena(klic, zdroj, uroven, zprava, data) {
    const text = `${uroven}|${zprava}`;
    if (this.posledni.get(klic) === text) return null;
    this.posledni.set(klic, text);
    return this.zapsat(zdroj, uroven, zprava, data);
  }

  /** Posledních `n` záznamů, volitelně jen od čísla `od` nebo jen varování a chyby. */
  vypis({ n = 300, od = 0, jenProblemy = false } = {}) {
    const vse = this.polozky.filter((z) => z.cislo > od && (!jenProblemy || z.uroven !== 'info'));
    return vse.slice(-Math.max(1, Math.min(MAX_V_PAMETI, n)));
  }

  /** Text pro stažení: jeden záznam na řádek. */
  text(polozky = this.polozky) {
    return polozky.map((z) => `${z.cas} ${z.uroven.toUpperCase().padEnd(8)} ${z.zdroj.padEnd(11)} ${z.zprava}${z.data ? ` ${JSON.stringify(z.data)}` : ''}`).join('\n');
  }

  doSouboru(z) {
    if (!this.slozka) return;
    const radek = `${this.text([z])}\n`;
    const soubor = path.join(this.slozka, `hub-${z.cas.slice(0, 10)}.log`);
    // Záznam se jen připisuje na konec, není to soubor dat (zapis.js je pro data kampaně a stavu).
    this.fronta = this.fronta
      .then(() => fs.mkdir(this.slozka, { recursive: true }))
      .then(() => fs.appendFile(soubor, radek, 'utf8'))
      .catch(() => {});
  }

  /** Smaže denní soubory starší než 14 dní. */
  async uklidit() {
    if (!this.slozka) return;
    try {
      const hranice = this.hodiny().getTime() - DNU_SOUBORU * 86400000;
      for (const f of await fs.readdir(this.slozka)) {
        const m = f.match(/^hub-(\d{4}-\d{2}-\d{2})\.log$/);
        if (m && Date.parse(m[1]) < hranice) await fs.rm(path.join(this.slozka, f), { force: true });
      }
    } catch {
      /* složka ještě není */
    }
  }
}
