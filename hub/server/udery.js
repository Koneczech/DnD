// Animace zásahu (bod 75): porovnává po sobě jdoucí stavy Player View a ohlásí zásah,
// léčení nebo pád. Výstup uder.html podle toho ukáže karty a animaci.
import { EventEmitter } from 'node:events';
import { zjistitUdery, rezimHp } from '../sdilene/udery.js';

/** Události: 'uder' (zásah pro výstup), 'stav' (co Hub vidí: režim HP, chyba čtení). */
export class Udery extends EventEmitter {
  constructor({ ted = () => Date.now() } = {}) {
    super();
    this.ted = ted;
    this.id = null;
    this.predchozi = null;
    this.cislo = 0;
    this.rezim = null;
    this.chyba = null;
    this.posledniUder = null;
  }

  /** Nový stav Player View. První stav setkání je jen výchozí bod, zásah se pozná až ze změny. */
  zpracovat(id, stav) {
    const s = stav?.encounterState ?? null;
    const rezim = s ? rezimHp(stav) : null;
    let zmena = JSON.stringify(rezim) !== JSON.stringify(this.rezim);
    this.rezim = rezim;
    let uder = null;
    if (!id || !s || id !== this.id) {
      const noveId = s ? id : null;
      if (noveId !== this.id) zmena = true;
      this.id = noveId;
      this.predchozi = s;
    } else {
      const nalez = zjistitUdery(this.predchozi, s);
      this.predchozi = s;
      if (nalez) {
        // Číslo a čas: výstup po znovupřipojení dostane poslední zprávu znovu a podle nich ji nepřehraje.
        uder = { ...nalez, cislo: ++this.cislo, cas: this.ted() };
        this.posledniUder = uder.cas;
        zmena = true;
      }
    }
    if (uder) this.emit('uder', uder);
    if (zmena) this.oznam();
    return uder;
  }

  nastavitChybu(text) {
    if (text === this.chyba) return;
    this.chyba = text;
    this.oznam();
  }

  verejny() {
    return { souboj: Boolean(this.id), rezim: this.rezim, chyba: this.chyba, posledniUder: this.posledniUder };
  }

  oznam() {
    this.emit('stav', this.verejny());
  }
}
