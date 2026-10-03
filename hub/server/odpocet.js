// Odpočet do začátku sezení (rozhodnutí 9 a 22). Stav se ukládá do hub/.stav/odpocet.json,
// aby přežil pád serveru. Výstup v OBS počítá zbývající čas sám z času konce, takže
// běží dál, i když server zrovna neodpovídá.
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { zapsatAtomicky } from './zapis.js';

export const STAVY = Object.freeze(['zadny', 'pripraveny', 'bezi', 'pauza']);
const MAX_MS = 24 * 60 * 60 * 1000;

/** Z „19:30“ spočítá nejbližší budoucí okamžik (dnes, nebo zítra). */
export function casNaDatum(hhmm, ted = new Date()) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
    throw Object.assign(new Error('Čas zadej jako HH:MM, např. 19:30.'), { status: 400 });
  }
  const d = new Date(ted);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (d.getTime() <= ted.getTime()) d.setDate(d.getDate() + 1);
  return d;
}

/**
 * Události: 'stav' (veřejný stav odpočtu)
 */
export class Odpocet extends EventEmitter {
  constructor({ soubor, hodiny = () => Date.now() }) {
    super();
    this.soubor = soubor;
    this.hodiny = hodiny;
    this.stav = Odpocet.prazdny();
  }

  static prazdny() {
    return { stav: 'zadny', konec: null, zbyvaMs: null, celkemMs: null, cilovyCas: null };
  }

  async nacist() {
    try {
      const d = JSON.parse(await fs.readFile(this.soubor, 'utf8'));
      if (STAVY.includes(d?.stav)) this.stav = { ...Odpocet.prazdny(), ...d };
    } catch {
      this.stav = Odpocet.prazdny();
    }
    return this;
  }

  verejny() {
    const ted = this.hodiny();
    const s = this.stav;
    const zbyvaMs = s.stav === 'bezi' ? Math.max(0, Date.parse(s.konec) - ted) : s.zbyvaMs;
    return { ...s, zbyvaMs, dobehl: s.stav === 'bezi' && zbyvaMs === 0, serverCas: new Date(ted).toISOString() };
  }

  async ulozit(novy) {
    this.stav = { ...Odpocet.prazdny(), ...novy };
    await fs.mkdir(path.dirname(this.soubor), { recursive: true });
    await zapsatAtomicky(this.soubor, JSON.stringify(this.stav, null, 2));
    const v = this.verejny();
    this.emit('stav', v);
    return v;
  }

  /**
   * Připraví odpočet, ale nespustí ho.
   * @param {{minut?: number, cas?: string}} z délka v minutách, nebo čas začátku hry HH:MM
   */
  async pripravit({ minut, cas } = {}) {
    if (cas) {
      const cil = casNaDatum(cas, new Date(this.hodiny()));
      const ms = cil.getTime() - this.hodiny();
      return this.ulozit({ stav: 'pripraveny', zbyvaMs: ms, celkemMs: ms, cilovyCas: cil.toISOString() });
    }
    const ms = Math.round(Number(minut) * 60000);
    if (!Number.isFinite(ms) || ms <= 0 || ms > MAX_MS) {
      throw Object.assign(new Error('Délka odpočtu musí být 1 minuta až 24 hodin.'), { status: 400 });
    }
    return this.ulozit({ stav: 'pripraveny', zbyvaMs: ms, celkemMs: ms });
  }

  /** Spustí připravený odpočet nebo pokračuje po pauze. */
  async spustit() {
    const s = this.stav;
    if (s.stav === 'bezi') return this.verejny();
    if (s.stav === 'zadny') throw Object.assign(new Error('Nejdřív odpočet nastav.'), { status: 409 });
    const ted = this.hodiny();
    // Odpočet na čas začátku hry míří na ten čas, i když se spustí později.
    const konec = s.stav === 'pripraveny' && s.cilovyCas ? Date.parse(s.cilovyCas) : ted + s.zbyvaMs;
    const celkemMs = s.stav === 'pripraveny' ? Math.max(konec - ted, 1) : s.celkemMs;
    return this.ulozit({ ...s, stav: 'bezi', konec: new Date(konec).toISOString(), zbyvaMs: null, celkemMs, cilovyCas: null });
  }

  async pauza() {
    const s = this.stav;
    if (s.stav !== 'bezi') throw Object.assign(new Error('Odpočet neběží.'), { status: 409 });
    const zbyvaMs = Math.max(0, Date.parse(s.konec) - this.hodiny());
    return this.ulozit({ ...s, stav: 'pauza', konec: null, zbyvaMs });
  }

  async zrusit() {
    return this.ulozit(Odpocet.prazdny());
  }
}
