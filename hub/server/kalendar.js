// Kalendář kampaně: události v kampan/kalendar/udalosti.yaml (kolekce), dnešní datum ve stav.md,
// začátek kampaně v kampan.yaml. Importér převezme data ze samostatného kalendáře
// (Apps/Calendar/kalendar-data.js), originál zůstává jako záloha (Migrace v ZADANI.md).
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import YAML from 'yaml';
import { Harptos, normalizujUdalost, seradit, noveId, MAX_LHUTA } from '../sdilene/harptos.js';
import { SCHEMA, datumHarptos } from './data.js';

const chyba = (zprava, status = 400) => Object.assign(new Error(zprava), { status });

/** Data ze souboru kalendar-data.js (window.KALENDAR = {...};). */
export function rozebratKalendarData(text) {
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b < a) throw chyba('Soubor kalendar-data.js neobsahuje data kalendáře.');
  return JSON.parse(text.slice(a, b + 1));
}

/** YAML s daty na jednom řádku ({rok: 1491, mesic: Eleint, den: 19}), aby se dal číst i v Obsidianu. */
export function slozitUdalosti(udalosti) {
  const dokument = new YAML.Document({
    schema: SCHEMA,
    udalosti: udalosti.map((u) => {
      const z = { id: u.id, datum: u.datum };
      if (u.konec) z.konec = u.konec;
      z.text = u.text;
      z.verejna = u.verejna;
      if (u.lhuta) z.lhuta = u.lhuta;
      return z;
    }),
  });
  YAML.visit(dokument, {
    Pair(_, pair) {
      if (['datum', 'konec'].includes(pair.key?.value) && YAML.isMap(pair.value)) pair.value.flow = true;
    },
  });
  dokument.commentBefore =
    ' Události kalendáře kampaně (Harptos). Upravuje je Hub na obrazovce Kalendář;\n' +
    ' ruční úpravy jsou možné, Hub je načte do 1 s. lhuta = kolik dní předem se událost ukazuje v OBS.';
  return dokument.toString({ lineWidth: 0 });
}

/**
 * Události: 'zmena' (DM: celý stav kalendáře), 'verejne' (výstupy: jen veřejné události)
 */
export class Kalendar extends EventEmitter {
  constructor({ cesty, data, zapisovac }) {
    super();
    this.c = cesty;
    this.data = data;
    this.zapisovac = zapisovac;
    this.soubor = path.join(cesty.kampan, 'kalendar', 'udalosti.yaml');
    this.zdrojImportu = path.join(cesty.koren, 'Apps', 'Calendar', 'kalendar-data.js');
    this.udalosti = [];
    this.existuje = false;
    this.chyba = null;
  }

  async nacist(text) {
    try {
      const obsah = text ?? (await fs.readFile(this.soubor, 'utf8'));
      const d = YAML.parse(obsah) ?? {};
      if (!Array.isArray(d.udalosti)) throw new Error('chybí seznam udalosti');
      const platne = [];
      let vadne = 0;
      for (const u of d.udalosti) {
        const n = normalizujUdalost(u);
        if (n) platne.push(n);
        else vadne++;
      }
      this.udalosti = platne;
      this.existuje = true;
      this.chyba = vadne ? `${vadne} událostí má neplatné datum nebo prázdný text a Hub je přeskočil.` : null;
    } catch (e) {
      if (e.code === 'ENOENT') {
        this.existuje = false;
        this.udalosti = [];
        this.chyba = null;
      } else {
        // Rozbitý soubor: poslední platné události zůstávají, aby se OBS nevyprázdnil.
        this.chyba = `Soubor udalosti.yaml nejde přečíst: ${e.message.split('\n')[0]}`;
      }
    }
    this.oznam();
  }

  dnes() {
    return this.data.stav?.datum ?? null;
  }

  /** Celý stav pro panel DM. */
  stavDm() {
    return {
      dnes: this.dnes(),
      zacatek: this.data.zacatek(),
      udalosti: seradit(this.udalosti),
      existuje: this.existuje,
      chyba: this.chyba,
    };
  }

  /** Jen to, co smí do OBS: skryté události se vůbec neposílají. */
  verejne() {
    return {
      dnes: this.dnes(),
      zacatek: this.data.zacatek(),
      udalosti: seradit(this.udalosti.filter((u) => u.verejna)),
    };
  }

  oznam() {
    this.emit('zmena', this.stavDm());
    this.emit('verejne', this.verejne());
  }

  async ulozit() {
    await fs.mkdir(path.dirname(this.soubor), { recursive: true });
    const { vysledek } = await this.zapisovac.zapsat(this.soubor, slozitUdalosti(this.udalosti));
    this.existuje = true;
    this.oznam();
    return vysledek;
  }

  overUdalost(vstup, puvodni = {}) {
    const n = normalizujUdalost({ ...puvodni, ...vstup, id: puvodni.id ?? noveId() });
    if (!n) throw chyba('Událost potřebuje text a platné datum Harptosu.');
    if (vstup.konec && !n.konec) throw chyba('Konec vícedenní události musí být až po začátku.');
    if (vstup.lhuta !== undefined && vstup.lhuta !== null && vstup.lhuta !== '' && !n.lhuta) {
      throw chyba(`Lhůta musí být celé číslo 1–${MAX_LHUTA} dní.`);
    }
    if (n.text.length > 200) throw chyba('Text události je delší než 200 znaků.');
    return n;
  }

  async pridat(vstup) {
    if (!this.existuje && (await this.lzeImportovat()).pocet > 0) {
      throw chyba('Nejdřív importuj události ze samostatného kalendáře, ať se nic nepřepíše.', 409);
    }
    const n = this.overUdalost(vstup);
    this.udalosti.push(n);
    return { udalost: n, vysledek: await this.ulozit() };
  }

  async upravit(id, vstup) {
    const i = this.udalosti.findIndex((u) => u.id === id);
    if (i < 0) throw chyba('Událost neexistuje.', 404);
    const zaklad = { ...this.udalosti[i] };
    // Pole, která formulář výslovně vyprázdnil, se smažou.
    if ('konec' in vstup && !vstup.konec) delete zaklad.konec;
    if ('lhuta' in vstup && (vstup.lhuta === null || vstup.lhuta === '')) delete zaklad.lhuta;
    const cisty = Object.fromEntries(Object.entries(vstup).filter(([, v]) => v !== null && v !== ''));
    const n = this.overUdalost(cisty, zaklad);
    this.udalosti[i] = n;
    return { udalost: n, vysledek: await this.ulozit() };
  }

  async smazat(id) {
    const i = this.udalosti.findIndex((u) => u.id === id);
    if (i < 0) throw chyba('Událost neexistuje.', 404);
    this.udalosti.splice(i, 1);
    return { vysledek: await this.ulozit() };
  }

  /** Posun dnešního data o n dní (Další den, tlačítka ±1 v panelu). */
  async posunout(n) {
    const dnes = this.dnes();
    if (!dnes) throw chyba('Dnešní datum ještě není zadané. Nastav ho v Kalendáři.', 409);
    const nove = Harptos.posun(dnes, n);
    const { vysledek } = await this.data.zmenitStav({ datum: nove });
    return { dnes: nove, vysledek };
  }

  async nastavitDnes(datum) {
    const d = datumHarptos(datum);
    if (!d.platne || !d.datum) throw chyba('Neplatné datum Harptosu.');
    const { vysledek } = await this.data.zmenitStav({ datum: d.datum });
    return { dnes: d.datum, vysledek };
  }

  /* ---------- Import ze samostatného kalendáře ---------- */

  async nacistZdroj() {
    const text = await fs.readFile(this.zdrojImportu, 'utf8');
    return rozebratKalendarData(text);
  }

  /** Co by import přinesl, bez zápisu. */
  async lzeImportovat() {
    try {
      const zdroj = await this.nacistZdroj();
      const udalosti = Array.isArray(zdroj.udalosti) ? zdroj.udalosti : [];
      return {
        dostupny: true,
        pocet: udalosti.length,
        platnych: udalosti.map(normalizujUdalost).filter(Boolean).length,
        dnes: Harptos.normalizuj(zdroj.dnes),
        zacatek: Harptos.normalizuj(zdroj.zacatek),
        seznam: udalosti.map((u) => ({ id: u.id ?? null, text: u.text ?? '', datum: Harptos.normalizuj(u.datum) })),
      };
    } catch {
      return { dostupny: false, pocet: 0, platnych: 0, seznam: [] };
    }
  }

  /**
   * Import: události do udalosti.yaml, dnešní datum do stav.md, začátek do kampan.yaml.
   * Existující udalosti.yaml přepíše jen s prepsat=true.
   */
  async importovat({ prepsat = false } = {}) {
    if (this.existuje && !prepsat) throw chyba('Události už v repu jsou. Import by je přepsal.', 409);
    let zdroj;
    try {
      zdroj = await this.nacistZdroj();
    } catch {
      throw chyba('Soubor Apps/Calendar/kalendar-data.js nebyl nalezen.', 404);
    }
    const vstup = Array.isArray(zdroj.udalosti) ? zdroj.udalosti : [];
    const udalosti = vstup.map(normalizujUdalost).filter(Boolean);
    const vadne = vstup.length - udalosti.length;
    this.udalosti = udalosti;
    await this.ulozit();
    // Přečti zpět ze souboru, ať report porovnává skutečný výsledek zápisu.
    await this.nacist(this.zapisovac.cekajici(this.soubor) ?? undefined);

    const dnes = Harptos.normalizuj(zdroj.dnes);
    if (dnes) await this.data.zmenitStav({ datum: dnes });
    const zacatek = Harptos.normalizuj(zdroj.zacatek);
    if (zacatek) {
      const text = await fs.readFile(this.c.kampanYaml, 'utf8');
      const dok = YAML.parseDocument(text);
      const uzel = dok.createNode(zacatek);
      uzel.flow = true;
      const puvodni = dok.get('startovni_datum', true);
      if (puvodni?.comment) uzel.comment = puvodni.comment;
      dok.set('startovni_datum', uzel);
      await this.zapisovac.zapsat(this.c.kampanYaml, dok.toString({ lineWidth: 0 }));
      await this.data.nacistKampan();
    }
    this.oznam();
    return {
      pocetZdroj: vstup.length,
      pocetCil: this.udalosti.length,
      vadne,
      dnes,
      zacatek,
      zdroj: vstup.map((u) => ({ id: u.id ?? null, text: u.text ?? '', datum: Harptos.normalizuj(u.datum) })),
      cil: seradit(this.udalosti).map((u) => ({ id: u.id, text: u.text, datum: u.datum })),
    };
  }

  async souborZmenen(soubor) {
    if (path.resolve(soubor) !== path.resolve(this.soubor)) return false;
    let text;
    try {
      text = await fs.readFile(this.soubor, 'utf8');
    } catch {
      text = undefined;
    }
    if (text !== undefined && this.zapisovac.jeVlastniZapis(this.soubor, text)) return true;
    await this.zapisovac.zrusit(this.soubor);
    await this.nacist(text);
    return true;
  }
}
