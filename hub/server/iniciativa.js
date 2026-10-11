// Odkaz na Player View z Improved Initiative (otevřený bod 69). Improved Initiative dává pro každé
// setkání nový odkaz; DM ho vloží do Hubu a Hub ho dosadí do zdroje Browser v OBS (ten má svoje CSS
// carouselu, takže se mění jen adresa) a do náhledu na U stolu. Tracker zůstává jeho (rozhodnutí 6).
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { zapsatAtomicky } from './zapis.js';

const HOSTITEL = /(^|\.)improvedinitiative\.app$/i;

/** Platný odkaz na Player View: https, doména Improved Initiative, ne pohled DM. */
export function platnyOdkaz(text) {
  let u;
  try {
    u = new URL(String(text ?? '').trim());
  } catch {
    return null;
  }
  // Jen https a doména Improved Initiative; pohled DM (/e/) do OBS nepatří, hráči by viděli statbloky.
  if (u.protocol !== 'https:' || !HOSTITEL.test(u.hostname) || /^\/e(\/|$)/.test(u.pathname) || u.pathname === '/') return null;
  return `https://${u.hostname}${u.pathname}${u.search}`;
}

/** Je to zdroj, který ukazuje Improved Initiative? Podle adresy, ne podle jména zdroje. */
export function jeZdrojIniciativy(url) {
  try {
    return HOSTITEL.test(new URL(String(url)).hostname);
  } catch {
    return false;
  }
}

/** Události: 'stav' (veřejný stav). */
export class Iniciativa extends EventEmitter {
  constructor({ cesty, obs }) {
    super();
    this.obs = obs;
    this.soubor = path.join(cesty.lokalniStav, 'iniciativa.json');
    this.odkaz = null;
    this.zdroje = [];
    this.chyba = null;
  }

  async nacist() {
    try {
      const d = JSON.parse(await fs.readFile(this.soubor, 'utf8'));
      this.odkaz = platnyOdkaz(d.odkaz);
    } catch {
      /* první spuštění */
    }
  }

  verejny() {
    return { odkaz: this.odkaz, zdroje: this.zdroje, chyba: this.chyba };
  }

  oznam() {
    this.emit('stav', this.verejny());
  }

  /** Uloží nový odkaz a dosadí ho do OBS. */
  async nastavit(text) {
    const odkaz = platnyOdkaz(text);
    if (!odkaz) {
      throw Object.assign(new Error('To není odkaz na Player View. Má tvar https://improvedinitiative.app/p/…'), { status: 400 });
    }
    this.odkaz = odkaz;
    await fs.mkdir(path.dirname(this.soubor), { recursive: true });
    await zapsatAtomicky(this.soubor, JSON.stringify({ odkaz }, null, 2));
    await this.doObs();
    return this.verejny();
  }

  /** Dosadí odkaz do všech zdrojů Browser v OBS, které ukazují Improved Initiative. */
  async doObs() {
    if (!this.odkaz) return;
    if (!this.obs.pripojeno) {
      this.chyba = 'OBS není připojené: odkaz se dosadí, až se připojí.';
      this.oznam();
      return;
    }
    try {
      this.zdroje = await this.obs.nastavitUrlZdroju(jeZdrojIniciativy, this.odkaz);
      this.chyba = this.zdroje.length ? null : 'V OBS není zdroj Browser s adresou Improved Initiative. Přidej ho do scény Souboj (adresa libovolného Player View).';
    } catch (e) {
      this.chyba = `OBS odkaz nepřevzal: ${e.message}`;
    }
    this.oznam();
  }
}
