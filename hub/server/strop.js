// Obloha na strop z projektoru (výstup vystupy/strop.html). Server drží jen kalibraci projekce:
// čtyři rohy obrazu (jednoduchý videomapping), měkký okraj, jas a hvězdy. Je to nastavení tohoto PC
// (jaký projektor, kam svítí), proto žije v hub/.stav/strop.json mimo Git. Co obloha ukazuje,
// si stránka bere sama ze scény (/api/scena) a z blesků, server to nepočítá.
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { zapsatAtomicky } from './zapis.js';

/** Rohy jako podíl šířky a výšky okna: levý horní, pravý horní, pravý dolní, levý dolní. */
export const VYCHOZI_ROHY = Object.freeze([
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
]);

export const VYCHOZI = Object.freeze({
  rohy: VYCHOZI_ROHY,
  okraj: 0.12, // měkký okraj do tmy, podíl kratší strany obrazu
  jas: 0.75, // projektor svítí celou místnost, plný jas by přebil světla Hue
  hvezdy: true,
});

const chyba = (zprava) => Object.assign(new Error(zprava), { status: 400 });

function cislo(v, od, do_, zprava) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < od || n > do_) throw chyba(zprava);
  return n;
}

/** Ověří a doplní kalibraci; neznámá pole zahodí. */
export function overitKalibraci(z, puvodni = VYCHOZI) {
  const k = { ...puvodni, rohy: puvodni.rohy.map((r) => [...r]) };
  if (z == null || typeof z !== 'object') throw chyba('Kalibrace stropu musí být objekt.');
  if ('rohy' in z) {
    if (!Array.isArray(z.rohy) || z.rohy.length !== 4) throw chyba('Strop má právě čtyři rohy.');
    // Roh smí trochu za okraj okna (projektor svítí šikmo), ne ale nesmyslně daleko.
    k.rohy = z.rohy.map((r) => {
      if (!Array.isArray(r) || r.length !== 2) throw chyba('Roh je dvojice [x, y].');
      return r.map((v) => Math.round(cislo(v, -1, 2, 'Roh leží mimo rozumný rozsah (−1 až 2).') * 10000) / 10000);
    });
  }
  if ('okraj' in z) k.okraj = cislo(z.okraj, 0, 0.5, 'Okraj je 0 až 0,5.');
  if ('jas' in z) k.jas = cislo(z.jas, 0.05, 1, 'Jas je 5 až 100 %.');
  if ('hvezdy' in z) {
    if (typeof z.hvezdy !== 'boolean') throw chyba('Hvězdy jsou zapnuté, nebo vypnuté.');
    k.hvezdy = z.hvezdy;
  }
  return k;
}

/** Události: 'stav' (kalibrace pro výstup). */
export class Strop extends EventEmitter {
  constructor({ soubor }) {
    super();
    this.soubor = soubor;
    this.kalibrace = overitKalibraci({});
  }

  async nacist() {
    try {
      this.kalibrace = overitKalibraci(JSON.parse(await fs.readFile(this.soubor, 'utf8')));
    } catch {
      // Chybějící nebo rozbitý soubor: výchozí kalibrace, obloha přes celé okno.
      this.kalibrace = overitKalibraci({});
    }
    return this;
  }

  verejny() {
    return { ...this.kalibrace, rohy: this.kalibrace.rohy.map((r) => [...r]) };
  }

  async nastavit(z) {
    this.kalibrace = z?.vychozi === true ? overitKalibraci({}) : overitKalibraci(z, this.kalibrace);
    // Zápisy za sebou: rychlé tažení rohu pošle hodně změn a poslední musí vyhrát.
    this.ukladani = (this.ukladani ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        await fs.mkdir(path.dirname(this.soubor), { recursive: true });
        await zapsatAtomicky(this.soubor, JSON.stringify(this.kalibrace, null, 2));
      });
    await this.ukladani;
    const v = this.verejny();
    this.emit('stav', v);
    return v;
  }
}
