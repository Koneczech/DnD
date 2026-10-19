// Jedno čtení Player View pro celý Hub (bod 75). Během souboje Hub každou sekundu přečte
// veřejný stav /playerviews/<ID>; z téhož stavu pak pracují světla podle HP (bod 72) i animace zásahu.
// Improved Initiative tak dostane jeden dotaz za sekundu, ne jeden za každou funkci.
// Vedle toho drží živé spojení (iniciativa-zive.js): změna tahu přijde hned, ne až s dalším čtením.
import { EventEmitter } from 'node:events';
import { idSetkani, nacistPlayerView } from './iniciativa-hp.js';

export const INTERVAL_CTENI_MS = 1000;

/**
 * Události: 'stav' (id setkání, stav Player View, zdroj 'cteni' | 'zive'; null, null = souboj skončil),
 * 'chyba' (text nebo null).
 */
export class CteniPlayerView extends EventEmitter {
  constructor({ odkaz, aktivni, intervalMs = INTERVAL_CTENI_MS, nacist = nacistPlayerView, limitMs = 8000, zive = null, hodiny = () => Date.now() }) {
    super();
    this.zive = zive; // ZivyPlayerView nebo null
    this.hodiny = hodiny;
    this.posledniZive = 0; // kdy přišel poslední stav živým spojením
    this.zive?.on('stav', (id, stav) => this.zeZiveho(id, stav));
    this.odkaz = odkaz; // () => odkaz na Player View
    this.aktivni = aktivni; // () => běží souboj
    this.intervalMs = intervalMs;
    this.nacist = nacist;
    this.limitMs = limitMs;
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
    this.zive?.zastavit();
  }

  /** Stav z živého spojení: hned dál (zvuky tahů, málo HP, zásahy). Nastavení Player View zůstává z posledního čtení. */
  zeZiveho(id, stav) {
    if (!id || id !== this.idAktivni) return;
    this.posledniZive = this.hodiny();
    this.id = id;
    this.stav = { ...(this.stav ?? {}), encounterState: stav.encounterState };
    this.zdroj = 'zive';
    this.emit('stav', id, this.stav, 'zive');
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
      this.idAktivni = id;
      this.zive?.sledovat(id);
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
        // I vlastní nacist (testy, jiná cesta) má nejvýš 8 s; zaseknuté čtení nesmí zastavit další kroky.
        let casovac;
        const zacatek = this.hodiny();
        const stav = await Promise.race([
          this.nacist(id),
          new Promise((_, ne) => {
            casovac = setTimeout(() => ne(new Error('čas vypršel')), this.limitMs);
          }),
        ]).finally(() => clearTimeout(casovac));
        // Čtení odeslané dřív, než přišla živá změna, může nést starší stav (předchozí tah):
        // takový výsledek se zahodí, jinak by tah na chvíli „skočil“ zpátky a zvuk zazněl dvakrát.
        if (this.posledniZive >= zacatek) {
          this.nastavitChybu(null);
          return;
        }
        this.id = id;
        this.stav = stav;
        this.nastavitChybu(null);
        this.zdroj = 'cteni';
        this.emit('stav', id, stav, 'cteni');
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
