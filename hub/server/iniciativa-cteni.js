// Jedno čtení Player View pro celý Hub (otevřený bod 75). Během souboje Hub každou sekundu přečte
// veřejný stav /playerviews/<ID>; z téhož stavu pak pracují světla podle HP (bod 72) i animace zásahu.
// Improved Initiative tak dostane jeden dotaz za sekundu, ne jeden za každou funkci.
import { EventEmitter } from 'node:events';
import { idSetkani, nacistPlayerView } from './iniciativa-hp.js';

export const INTERVAL_CTENI_MS = 1000;

/** Události: 'stav' (id setkání, stav Player View; null, null = souboj skončil), 'chyba' (text nebo null). */
export class CteniPlayerView extends EventEmitter {
  constructor({ odkaz, aktivni, intervalMs = INTERVAL_CTENI_MS, nacist = nacistPlayerView }) {
    super();
    this.odkaz = odkaz; // () => odkaz na Player View
    this.aktivni = aktivni; // () => běží souboj
    this.intervalMs = intervalMs;
    this.nacist = nacist;
    this.id = null;
    this.stav = null;
    this.chyba = null;
    this.casovac = null;
    this.bezi = false;
  }

  spustit() {
    this.casovac = setInterval(() => this.krok().catch(() => {}), this.intervalMs);
    this.casovac.unref?.();
  }

  zastavit() {
    clearInterval(this.casovac);
  }

  /** Poslední přečtený stav bez dalšího dotazu (pro světla podle HP). Mimo souboj null. */
  async posledni() {
    return this.stav;
  }

  async krok() {
    if (this.bezi) return;
    this.bezi = true;
    try {
      const id = this.aktivni() ? idSetkani(this.odkaz()) : null;
      if (!id) {
        if (this.id || this.stav) {
          this.id = null;
          this.stav = null;
          this.emit('stav', null, null);
        }
        this.nastavitChybu(null);
        return;
      }
      try {
        const stav = await this.nacist(id);
        this.id = id;
        this.stav = stav;
        this.nastavitChybu(null);
        this.emit('stav', id, stav);
      } catch (e) {
        // Výpadek spojení: poslední stav zůstává (lampa pulzuje dál), další krok to zkusí znovu.
        this.nastavitChybu(`Player View se nepřečetl: ${e.message}`);
      }
    } finally {
      this.bezi = false;
    }
  }

  nastavitChybu(text) {
    if (text === this.chyba) return;
    this.chyba = text;
    this.emit('chyba', text);
  }
}
