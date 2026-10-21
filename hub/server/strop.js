// Obloha na strop z projektoru (výstup vystupy/strop.html). Server drží jen kalibraci projekce:
// čtyři rohy obrazu (jednoduchý videomapping), měkký okraj, jas a hvězdy. Je to nastavení tohoto PC
// (jaký projektor, kam svítí), proto žije v hub/.stav/strop.json mimo Git. Co obloha ukazuje,
// si stránka bere sama ze scény (/api/scena, včetně motivu místa) a z blesků.
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

/** Tvar oblohy: obdélník podle rohů, nebo volný tvar, který se pomalu přelévá (⚠ bod 143). */
export const TVARY = Object.freeze(['obdelnik', 'volny']);
export const MAX_MASEK = 8;
export const MAX_BODU_MASKY = 32;

export const VYCHOZI = Object.freeze({
  rohy: VYCHOZI_ROHY,
  okraj: 0.12, // měkký okraj do tmy, podíl kratší strany obrazu
  jas: 0.75, // projektor svítí celou místnost, plný jas by přebil světla Hue
  hvezdy: true,
  tvar: 'volny',
  clenitost: 0.5, // jak moc je volný tvar rozervaný (0 = skoro ovál, 1 = cáry)
  masky: [], // místa, kam projektor nesvítí: mnohoúhelníky v souřadnicích okna (0–1)
  ptaci: true, // hejna ptáků a netopýři přeletí sami (⚠ bod 144)
});

/** Kdo přeletí přes strop na pokyn z Hubu; auto = podle doby a motivu (⚠ bod 144). */
export const DRUHY_PTAKU = Object.freeze(['auto', 'hejno', 'klin', 'netopyri']);

/**
 * Motiv stropu podle místa (⚠ bod 143). Venku je obloha s počasím, uvnitř strop, kde se počasí
 * neukazuje a blesk jen prosvitne. Místo bez `strop` v hlavičce dostane motiv podle dozvuku.
 */
export const MOTIVY = Object.freeze(['nebe', 'les', 'tabor', 'jeskyne', 'interier']);
const MOTIV_PODLE_DOZVUKU = { jeskyne: 'jeskyne', kobka: 'jeskyne', mistnost: 'interier', sal: 'interier' };

export function motivStropu(misto) {
  if (!misto) return 'nebe';
  if (MOTIVY.includes(misto.strop)) return misto.strop;
  return MOTIV_PODLE_DOZVUKU[misto.zvuk?.dozvuk] ?? 'nebe';
}

const chyba = (zprava) => Object.assign(new Error(zprava), { status: 400 });

function cislo(v, od, do_, zprava) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < od || n > do_) throw chyba(zprava);
  return n;
}

const bod = (r, zprava) => {
  if (!Array.isArray(r) || r.length !== 2) throw chyba(zprava);
  return r.map((v) => Math.round(cislo(v, -1, 2, 'Bod leží mimo rozumný rozsah (−1 až 2).') * 10000) / 10000);
};

/** Ověří a doplní kalibraci; neznámá pole zahodí. */
export function overitKalibraci(z, puvodni = VYCHOZI) {
  const k = { ...VYCHOZI, ...puvodni, rohy: puvodni.rohy.map((r) => [...r]), masky: (puvodni.masky ?? []).map((m) => m.map((b) => [...b])) };
  if (z == null || typeof z !== 'object') throw chyba('Kalibrace stropu musí být objekt.');
  if ('rohy' in z) {
    if (!Array.isArray(z.rohy) || z.rohy.length !== 4) throw chyba('Strop má právě čtyři rohy.');
    // Roh smí trochu za okraj okna (projektor svítí šikmo), ne ale nesmyslně daleko.
    k.rohy = z.rohy.map((r) => bod(r, 'Roh je dvojice [x, y].'));
  }
  if ('tvar' in z) {
    if (!TVARY.includes(z.tvar)) throw chyba('Tvar je obdélník, nebo volný.');
    k.tvar = z.tvar;
  }
  if ('clenitost' in z) k.clenitost = cislo(z.clenitost, 0, 1, 'Členitost je 0 až 100 %.');
  if ('masky' in z) {
    if (!Array.isArray(z.masky) || z.masky.length > MAX_MASEK) throw chyba(`Masek jde nejvýš ${MAX_MASEK}.`);
    k.masky = z.masky.map((m) => {
      if (!Array.isArray(m) || m.length < 3 || m.length > MAX_BODU_MASKY) throw chyba(`Maska má 3 až ${MAX_BODU_MASKY} bodů.`);
      return m.map((b) => bod(b, 'Bod masky je dvojice [x, y].'));
    });
  }
  if ('okraj' in z) k.okraj = cislo(z.okraj, 0, 0.5, 'Okraj je 0 až 0,5.');
  if ('jas' in z) k.jas = cislo(z.jas, 0.05, 1, 'Jas je 5 až 100 %.');
  if ('hvezdy' in z) {
    if (typeof z.hvezdy !== 'boolean') throw chyba('Hvězdy jsou zapnuté, nebo vypnuté.');
    k.hvezdy = z.hvezdy;
  }
  if ('ptaci' in z) {
    if (typeof z.ptaci !== 'boolean') throw chyba('Ptáci sami jsou zapnutí, nebo vypnutí.');
    k.ptaci = z.ptaci;
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
    return { ...this.kalibrace, rohy: this.kalibrace.rohy.map((r) => [...r]), masky: this.kalibrace.masky.map((m) => m.map((b) => [...b])) };
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
