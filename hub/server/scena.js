// Scéna místa v OBS (Blok 2): které místo a která ilustrace je na TV, den/noc, stav místa,
// počasí, intenzita a samočinné střídání. Je to nastavení tohoto PC u stolu, proto žije
// v hub/.stav/scena.json (mimo Git). Odkrytí ilustrací patří k místu a ukládá ho mista.js.
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { zapsatAtomicky } from './zapis.js';
import { VARIANTY } from './mista.js';

export const POCASI = Object.freeze(['zadne', 'dest', 'snih', 'mlha']);
/** Efekty počasí, které jdou zapnout současně (déšť, sníh i mlha naráz). */
export const EFEKTY_POCASI = Object.freeze(['dest', 'snih', 'mlha', 'bourka']);
/** Vzdálenost bouřky (rozhodnutí 61): které role blikají a za jak dlouho přijde hrom. */
export const VZDALENOSTI_BOURKY = Object.freeze(['daleko', 'blizko', 'nad-nami']);

/**
 * Počasí jako seznam zapnutých efektů v pevném pořadí. Přijme i starý tvar jednoho řetězce
 * („dest“, „zadne“), aby fungoval dřívější scena.json i starší panel.
 * @returns {string[]|null} null = neplatné
 */
export function normalizujPocasi(vstup) {
  const seznam = Array.isArray(vstup) ? vstup : vstup === 'zadne' || vstup == null || vstup === '' ? [] : [vstup];
  if (!seznam.every((x) => EFEKTY_POCASI.includes(x))) return null;
  return EFEKTY_POCASI.filter((x) => seznam.includes(x));
}
export const INTENZITY = Object.freeze([0, 1, 2, 3]);
const MIN_STRIDANI = 5;
const MAX_STRIDANI = 3600;

const chyba = (zprava, status = 400) => Object.assign(new Error(zprava), { status });

export function vychoziStav() {
  return {
    misto: null,
    ilustrace: null, // jméno souboru aktuální ilustrace
    varianta: 'den',
    stav: null, // null = výchozí stav místa
    pocasi: [],
    intenzita: 0,
    stridani: { zapnuto: true, sekund: 50 },
    bourka: 'blizko',
    rezim: 'pruzkum', // pruzkum | souboj (rozhodnutí 60)
    zasobnik: null, // stav před soubojem, který Konec souboje vrátí
  };
}

/** Ilustrace, které smí do OBS: odkryté scény pro aktuální variantu a stav. */
export function viditelne(misto, { varianta, stav }) {
  if (!misto) return [];
  return misto.ilustrace.filter(
    (il) => il.ucel === 'scena' && !il.skryta && (!il.varianta || il.varianta === varianta) && (!il.stav || il.stav === stav),
  );
}

/** Stavy, které místo zná (z ilustrací). */
export function stavyMista(misto) {
  return [...new Set((misto?.ilustrace ?? []).map((il) => il.stav).filter(Boolean))];
}

/**
 * Události: 'stav' (veřejný stav scény pro výstup i panel)
 */
export class Scena extends EventEmitter {
  constructor({ soubor, mista, hodiny = () => Date.now() }) {
    super();
    this.soubor = soubor;
    this.mista = mista;
    this.hodiny = hodiny;
    this.stav = vychoziStav();
    this.casovac = null;
    this.zmeneno = this.hodiny();
  }

  async nacist() {
    try {
      const d = JSON.parse(await fs.readFile(this.soubor, 'utf8'));
      this.stav = { ...vychoziStav(), ...d, stridani: { ...vychoziStav().stridani, ...(d?.stridani ?? {}) } };
      this.stav.pocasi = normalizujPocasi(this.stav.pocasi) ?? [];
    } catch {
      this.stav = vychoziStav();
    }
    this.oznam(false);
  }

  /**
   * Uložení stavu scény. Zápisy jdou za sebou a každý bere stav až v okamžiku zápisu: rychlé
   * změny (intenzita, počasí) se tak nemůžou zapsat v opačném pořadí a po restartu by se
   * nevrátil starší stav.
   */
  ulozit() {
    this.ukladani = (this.ukladani ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        await fs.mkdir(path.dirname(this.soubor), { recursive: true });
        await zapsatAtomicky(this.soubor, JSON.stringify(this.stav, null, 2));
      });
    return this.ukladani;
  }

  aktualniMisto() {
    return this.stav.misto ? this.mista.mista.get(this.stav.misto) ?? null : null;
  }

  /** Co ukazuje OBS. Skryté ilustrace v něm nejsou vůbec, ani jako adresa. */
  verejny() {
    const misto = this.aktualniMisto();
    const seznam = viditelne(misto, this.stav);
    const aktualni = seznam.find((il) => il.soubor === this.stav.ilustrace) ?? seznam[0] ?? null;
    return {
      misto: misto ? { id: misto.id, nazev: misto.nazev } : null,
      ilustrace: aktualni ? { soubor: aktualni.soubor, url: aktualni.url } : null,
      pocet: seznam.length,
      poradi: aktualni ? seznam.indexOf(aktualni) + 1 : 0,
      varianta: this.stav.varianta,
      stav: this.stav.stav,
      stavy: stavyMista(misto),
      pocasi: this.stav.pocasi,
      intenzita: this.stav.intenzita,
      stridani: this.stav.stridani,
      bourka: this.stav.bourka,
      rezim: this.stav.rezim,
      // Další ilustrace, aby si ji výstup přednačetl a prolnutí nezačínalo černým snímkem.
      dalsi: seznam.length > 1 && aktualni ? seznam[(seznam.indexOf(aktualni) + 1) % seznam.length].url : null,
    };
  }

  oznam(ulozit = true) {
    this.naplanovat();
    const v = this.verejny();
    this.emit('stav', v);
    if (ulozit) this.ulozit().catch(() => {});
    return v;
  }

  /** Samočinné střídání: časovač na serveru, aby panel i OBS ukazovaly totéž. */
  naplanovat() {
    clearTimeout(this.casovac);
    this.casovac = null;
    const { zapnuto, sekund } = this.stav.stridani;
    if (!zapnuto || viditelne(this.aktualniMisto(), this.stav).length < 2) return;
    this.casovac = setTimeout(() => {
      this.posun(1, { samo: true }).catch(() => {});
    }, sekund * 1000);
    this.casovac.unref?.();
  }

  async zobrazit({ misto, ilustrace } = {}) {
    if (misto !== undefined) {
      if (misto !== null && !this.mista.mista.has(misto)) throw chyba('Místo neexistuje.', 404);
      if (misto !== this.stav.misto) {
        this.stav.stav = null;
        this.stav.ilustrace = null;
      }
      this.stav.misto = misto;
    }
    if (ilustrace !== undefined) {
      const m = this.aktualniMisto();
      const il = m?.ilustrace.find((x) => x.soubor === ilustrace);
      if (!il) throw chyba('Ilustrace neexistuje.', 404);
      if (il.skryta) throw chyba('Ilustrace je skrytá. Nejdřív ji odkryj.', 409);
      // Ilustrace jiné varianty nebo stavu přepne scénu na ni (klik v panelu = „chci tohle“).
      if (il.varianta) this.stav.varianta = il.varianta;
      if (il.stav) this.stav.stav = il.stav;
      this.stav.ilustrace = ilustrace;
    }
    return this.oznam();
  }

  /**
   * Souboj jako režim se zásobníkem (rozhodnutí 60): zapamatuje si, co bylo před ním (scéna OBS),
   * a Konec souboje to vrátí. Zásobník je v scena.json, takže přežije restart Hubu.
   */
  zahajitSouboj({ obsScena = null } = {}) {
    if (this.stav.rezim === 'souboj') return this.oznam();
    this.stav.zasobnik = { obsScena };
    this.stav.rezim = 'souboj';
    return this.oznam();
  }

  /** @returns {{obsScena: string|null}} co bylo před soubojem */
  ukoncitSouboj() {
    const predtim = this.stav.zasobnik ?? { obsScena: null };
    this.stav.rezim = 'pruzkum';
    this.stav.zasobnik = null;
    this.oznam();
    return predtim;
  }

  async posun(o, { samo = false } = {}) {
    const seznam = viditelne(this.aktualniMisto(), this.stav);
    if (!seznam.length) return this.oznam(!samo);
    const i = Math.max(0, seznam.findIndex((il) => il.soubor === this.stav.ilustrace));
    this.stav.ilustrace = seznam[(i + o + seznam.length) % seznam.length].soubor;
    return this.oznam(!samo);
  }

  async nastavit(z = {}) {
    if ('varianta' in z) {
      if (!VARIANTY.includes(z.varianta)) throw chyba('Varianta musí být den nebo noc.');
      this.stav.varianta = z.varianta;
    }
    if ('stav' in z) {
      const s = z.stav || null;
      if (s && !stavyMista(this.aktualniMisto()).includes(s)) throw chyba('Místo takový stav nemá.');
      this.stav.stav = s;
    }
    if ('pocasi' in z) {
      const pocasi = normalizujPocasi(z.pocasi);
      if (!pocasi) throw chyba('Počasí je kombinace deště, sněhu, mlhy a bouřky (nebo žádné).');
      this.stav.pocasi = pocasi;
    }
    if ('bourka' in z) {
      if (!VZDALENOSTI_BOURKY.includes(z.bourka)) throw chyba('Bouřka je daleko, blízko, nebo nad námi.');
      this.stav.bourka = z.bourka;
    }
    if ('intenzita' in z) {
      const n = Number(z.intenzita);
      if (!INTENZITY.includes(n)) throw chyba('Intenzita je 0 až 3.');
      this.stav.intenzita = n;
    }
    if ('stridani' in z) {
      const st = { ...this.stav.stridani };
      if ('zapnuto' in z.stridani) st.zapnuto = Boolean(z.stridani.zapnuto);
      if ('sekund' in z.stridani) {
        const n = Number(z.stridani.sekund);
        if (!Number.isInteger(n) || n < MIN_STRIDANI || n > MAX_STRIDANI) throw chyba(`Střídání po ${MIN_STRIDANI}–${MAX_STRIDANI} s.`);
        st.sekund = n;
      }
      this.stav.stridani = st;
    }
    return this.oznam();
  }

  /** Změnil se seznam ilustrací (odkrytí, nová, smazaná): přepočítej, co jde do OBS. */
  mistaZmenena() {
    const misto = this.aktualniMisto();
    if (this.stav.misto && !misto) this.stav.misto = null;
    return this.oznam(false);
  }

  zastavit() {
    clearTimeout(this.casovac);
  }
}
