// Návrh po sezení (⚠ bod 153): načte návrh změn kánonu z hub/.stav/navrhy/sNN.yaml, zkontroluje ho
// proti kartám, drží rozhodnutí DM (schváleno, zamítnuto, upravený text) a schválené operace zapíše.
//
// Soubory ve složce hub/.stav/navrhy/ (lokální, mimo Git):
//   sNN.yaml              návrh (píše ho Claude podle podkladu z přepisového nástroje)
//   sNN.dukazy.json       kontrola důkazů z přepisového nástroje (jména, čísla a citace v přepisu)
//   sNN.rozhodnuti.json   rozhodnutí DM u jednotlivých operací (píše Hub)
//   sNN.zapsano.json      co a kdy Hub zapsal (podle něj přepisový nástroj pozná stav „v kánonu“)
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { nahraditTelo, teloKarty } from '../sdilene/hlavicka.js';
import { SLUG, nacistEntitu } from '../sdilene/karta-kanonu.js';
import {
  normalizujNavrh, overitNavrh, textNoveKarty, upravitExistujici, zapsatSezeni,
} from '../sdilene/navrh-sezeni.js';
import { datumHarptos } from './data.js';
import { zapsatAtomicky } from './zapis.js';

const chyba = (zprava, status = 400) => Object.assign(new Error(zprava), { status });
const CISLO = /^s\d{2,3}$/;
/** Pole operace, která smí DM před schválením přepsat (hlavní text operace). */
const UPRAVITELNE = Object.freeze({
  nova_karta: ['nazev', 'telo'], doplnit: ['text'], pole: ['nove'], vazba: ['popis'],
  kanon: ['nazev', 'co_se_stalo', 'dusledek'], udalost: ['text'], sezeni: ['obsah'], rozpor: [],
});
const STAVY = Object.freeze(['nerozhodnuto', 'schvaleno', 'zamitnuto']);
/** Pořadí zápisu: nejdřív nové karty (další operace na ně můžou mířit), pak úpravy, nakonec kalendář. */
const PORADI_ZAPISU = ['nova_karta', 'kanon', 'doplnit', 'pole', 'vazba', 'sezeni', 'udalost'];

export class NavrhSezeni {
  /**
   * @param {{cesty: object, kanon: import('./kanon-modul.js').Kanon, kalendar: object, zapisovac: import('./zapis.js').Zapisovac}} z
   */
  constructor({ cesty, kanon, kalendar, zapisovac }) {
    this.c = cesty;
    this.kanon = kanon;
    this.kalendar = kalendar;
    this.zapisovac = zapisovac;
  }

  get slozka() {
    return path.join(this.c.lokalniStav, 'navrhy');
  }

  soubor(cislo, pripona) {
    if (!CISLO.test(cislo)) throw chyba('Neplatné číslo sezení (čekám s03).');
    return path.join(this.slozka, `${cislo}${pripona}`);
  }

  async cistJson(soubor, vychozi) {
    try {
      return JSON.parse(await fs.readFile(soubor, 'utf8'));
    } catch {
      return vychozi;
    }
  }

  /** Návrhy, které leží ve složce: číslo sezení, počet operací a stav rozhodování. */
  async seznam() {
    let soubory = [];
    try {
      soubory = await fs.readdir(this.slozka);
    } catch {
      return { navrhy: [] };
    }
    const navrhy = [];
    for (const jmeno of soubory.filter((s) => /^s\d{2,3}\.yaml$/.test(s)).sort()) {
      const cislo = jmeno.slice(0, -5);
      try {
        const d = await this.nacist(cislo);
        navrhy.push({ cislo, operaci: d.operace.length, ...d.pocty, naposledyZapsano: d.zapsano?.cas ?? null });
      } catch (err) {
        navrhy.push({ cislo, chyba: err.message });
      }
    }
    return { navrhy };
  }

  async surovyNavrh(cislo) {
    let text;
    try {
      // Bez BOM: Poznámkový blok a PowerShell ho do UTF-8 přidávají.
      text = (await fs.readFile(this.soubor(cislo, '.yaml'), 'utf8')).replace(/^﻿/, '');
    } catch {
      throw chyba(`Návrh pro sezení ${cislo} neexistuje (čekám ${path.join('hub', '.stav', 'navrhy', `${cislo}.yaml`)}).`, 404);
    }
    let data;
    try {
      data = YAML.parse(text);
    } catch (err) {
      throw chyba(`Návrh není platný YAML: ${err.message.split('\n')[0]}`);
    }
    return normalizujNavrh(data);
  }

  /** Operace s úpravami od DM (upravené pole přepíše návrh). */
  sUpravami(navrh, rozhodnuti) {
    return navrh.operace.map((op) => {
      const r = rozhodnuti[String(op.id ?? '')];
      return r?.upraveno ? { ...op, ...r.upraveno } : op;
    });
  }

  /** Detail návrhu pro obrazovku Návrh po sezení. */
  async nacist(cislo) {
    const navrh = await this.surovyNavrh(cislo);
    const rozhodnuti = await this.cistJson(this.soubor(cislo, '.rozhodnuti.json'), {});
    const dukazy = (await this.cistJson(this.soubor(cislo, '.dukazy.json'), {}))?.operace ?? {};
    const zapsano = await this.cistJson(this.soubor(cislo, '.zapsano.json'), null);
    const operace = this.sUpravami(navrh, rozhodnuti);
    const kontrola = this.zkontrolovat({ ...navrh, operace }, cislo);
    const vysledek = await Promise.all(operace.map(async (op, i) => {
      const id = String(op.id ?? '');
      const r = rozhodnuti[id] ?? {};
      return {
        ...kontrola[i],
        stav: r.zapsano ? 'zapsano' : (STAVY.includes(r.stav) ? r.stav : 'nerozhodnuto'),
        upraveno: Boolean(r.upraveno),
        upravitelne: UPRAVITELNE[op.op] ?? [],
        jistota: op.jistota ?? 'nutno_potvrdit',
        dukaz: Array.isArray(op.dukaz) ? op.dukaz : [],
        dukazy: dukazy[id] ?? null,
        data: op,
        ukazka: kontrola[i].problemy.length ? null : await this.ukazka(op, cislo, navrh.zdroj).catch((err) => ({ chyba: err.message })),
      };
    }));
    const pocty = { schvaleno: 0, zamitnuto: 0, nerozhodnuto: 0, zapsano: 0 };
    for (const o of vysledek) pocty[o.stav]++;
    return { cislo, zdroj: navrh.zdroj, operace: vysledek, pocty, zapsano };
  }

  zkontrolovat(navrh, cislo) {
    return overitNavrh(navrh, {
      cislo,
      najit: (id) => this.kanon.entity.get(id),
      overDatum: (d) => datumHarptos(d).platne && Boolean(datumHarptos(d).datum),
    });
  }

  async textKarty(id) {
    const e = this.kanon.entity.get(id);
    if (!e) return null;
    return { e, text: await fs.readFile(path.join(this.c.koren, ...e.soubor.split('/')), 'utf8') };
  }

  async sablona(typ) {
    try {
      return await fs.readFile(path.join(this.c.koren, 'sablony', `${typ}.md`), 'utf8');
    } catch {
      return null;
    }
  }

  /** Jak bude změna vypadat: před a po (jen dotčená část), nebo celý text nové karty. */
  async ukazka(op, cislo, zdroj) {
    const dnes = new Date().toISOString().slice(0, 10);
    if (op.op === 'nova_karta' || op.op === 'kanon') {
      const typ = op.op === 'kanon' ? 'kanon' : op.typ;
      const k = textNoveKarty(op, { sablona: await this.sablona(typ), dnes, zdroj, cislo });
      return { soubor: k.soubor, po: k.text };
    }
    if (op.op === 'sezeni') {
      const k = await this.textKarty(cislo);
      if (!k) return null;
      const pred = teloKarty(k.text);
      return { soubor: k.e.soubor, ...rozdil(pred, zapsatSezeni(pred, op.sekce, op.obsah)) };
    }
    if (op.op === 'udalost') return { po: `${op.datum?.den}. ${op.datum?.mesic} ${op.datum?.rok}: ${op.text}` };
    if (op.op === 'rozpor') return null;
    const k = await this.textKarty(String(op.karta_id ?? ''));
    if (!k) return null;
    const um = { slozka: k.e.slozka, soubor: k.e.soubor, slozkaEntity: k.e.slozkaEntity };
    const po = upravitExistujici(k.text, [op], um, (id) => this.kanon.entity.get(id));
    return { soubor: k.e.soubor, ...rozdil(k.text, po) };
  }

  /** Rozhodnutí DM u jedné operace: { stav?, upraveno? } (upraveno = jen povolená pole, null smaže úpravu). */
  async rozhodnout(cislo, id, vstup) {
    const navrh = await this.surovyNavrh(cislo);
    const op = navrh.operace.find((o) => String(o.id ?? '') === id);
    if (!op) throw chyba('Operace v návrhu není.', 404);
    const soubor = this.soubor(cislo, '.rozhodnuti.json');
    const rozhodnuti = await this.cistJson(soubor, {});
    const r = { ...(rozhodnuti[id] ?? {}) };
    if (r.zapsano) throw chyba('Operace už je zapsaná v kánonu.', 409);
    if ('stav' in vstup) {
      if (!STAVY.includes(vstup.stav)) throw chyba(`Stav je ${STAVY.join(', ')}.`);
      r.stav = vstup.stav;
    }
    if ('upraveno' in vstup) {
      if (vstup.upraveno === null) delete r.upraveno;
      else {
        if (typeof vstup.upraveno !== 'object' || Array.isArray(vstup.upraveno)) throw chyba('upraveno je mapa pole: hodnota.');
        const povolene = UPRAVITELNE[op.op] ?? [];
        const u = {};
        for (const [k, v] of Object.entries(vstup.upraveno)) {
          if (!povolene.includes(k)) throw chyba(`Pole ${k} u operace ${op.op} upravit nejde.`);
          if (typeof v !== 'string' || v.length > 20000) throw chyba(`Pole ${k} musí být text (nejvýš 20 000 znaků).`);
          u[k] = v;
        }
        r.upraveno = u;
      }
    }
    rozhodnuti[id] = r;
    await fs.mkdir(this.slozka, { recursive: true });
    await zapsatAtomicky(soubor, `${JSON.stringify(rozhodnuti, null, 1)}\n`);
    return this.nacist(cislo);
  }

  /**
   * Zapíše schválené operace. Nejdřív se všechny spočítají nad aktuálními soubory v paměti; když
   * jediná selže, nezapíše se nic. Pak jeden zápis na každý dotčený soubor (přes frontu zápisu,
   * nad posledním obsahem na disku) a události do kalendáře. Zapsané operace se označí, takže
   * opakování nic nezdvojí.
   */
  async zapsat(cislo) {
    const detail = await this.nacist(cislo);
    const schvalene = detail.operace.filter((o) => o.stav === 'schvaleno' && o.op !== 'rozpor');
    if (!schvalene.length) throw chyba('Není schválená žádná operace k zápisu.');
    const vadne = schvalene.filter((o) => o.problemy.length);
    if (vadne.length) throw chyba(`Schválené operace s chybou: ${vadne.map((o) => `${o.id} (${o.problemy[0]})`).join('; ')}. Oprav je, nebo je zamítni.`, 409);

    const najit = (id) => this.kanon.entity.get(id);
    const dnes = new Date().toISOString().slice(0, 10);
    const serazene = [...schvalene].sort((a, b) => PORADI_ZAPISU.indexOf(a.op) - PORADI_ZAPISU.indexOf(b.op));
    // 1) Simulace v paměti: nové karty, úpravy po kartách, zápis sezení.
    const nove = new Map(); // id → { soubor, text, um }
    const upravy = new Map(); // id → [operace]
    const udalosti = [];
    for (const o of serazene) {
      const op = o.data;
      if (op.op === 'nova_karta' || op.op === 'kanon') {
        const typ = op.op === 'kanon' ? 'kanon' : op.typ;
        const k = textNoveKarty(op, { sablona: await this.sablona(typ), dnes, zdroj: detail.zdroj, cislo });
        try {
          await fs.access(path.join(this.c.koren, ...k.soubor.split('/')));
          throw chyba(`Soubor ${k.soubor} už existuje.`, 409);
        } catch (err) {
          if (err.status) throw err;
        }
        nove.set(k.id, { soubor: k.soubor, text: k.text, um: { slozka: k.slozka, soubor: k.soubor, slozkaEntity: k.slozkaEntity } });
      } else if (op.op === 'udalost') {
        udalosti.push(o);
      } else {
        const id = op.op === 'sezeni' ? cislo : String(op.karta_id);
        if (!upravy.has(id)) upravy.set(id, []);
        upravy.get(id).push(op);
      }
    }
    const najitVcetneNovych = (id) => najit(id) ?? (nove.has(id) ? nacistEntitu(nove.get(id).text, nove.get(id).um) : undefined);
    const pouzit = (text, um, ops) => {
      let t = text;
      const naKartu = ops.filter((x) => x.op !== 'sezeni');
      if (naKartu.length) t = upravitExistujici(t, naKartu, um, najitVcetneNovych);
      for (const s of ops.filter((x) => x.op === 'sezeni')) t = nahraditTelo(t, zapsatSezeni(teloKarty(t), s.sekce, s.obsah));
      return t;
    };
    const plan = [];
    for (const [id, ops] of upravy) {
      if (nove.has(id)) {
        const n = nove.get(id);
        n.text = pouzit(n.text, n.um, ops);
        continue;
      }
      const k = await this.textKarty(id);
      if (!k) throw chyba(`Karta „${id}“ neexistuje.`, 404);
      const um = { slozka: k.e.slozka, soubor: k.e.soubor, slozkaEntity: k.e.slozkaEntity };
      pouzit(k.text, um, ops); // simulace: chyba tady zastaví všechno před prvním zápisem
      plan.push({ id, um, ops });
    }
    for (const o of udalosti) {
      if (!this.kalendar) throw chyba('Kalendář není k dispozici.', 503);
      this.kalendar.overUdalost(vstupUdalosti(o.data));
    }

    // 2) Zápis.
    const vysledek = { zapsano: [], odlozeno: 0 };
    for (const [id, n] of nove) {
      const cesta = path.join(this.c.koren, ...n.soubor.split('/'));
      await fs.mkdir(path.dirname(cesta), { recursive: true });
      const r = await this.zapisovac.zapsat(cesta, n.text);
      if (r.vysledek === 'odlozeno') vysledek.odlozeno++;
      vysledek.zapsano.push(id);
    }
    for (const p of plan) {
      const cesta = path.join(this.c.koren, ...p.um.soubor.split('/'));
      const r = await this.zapisovac.upravit(cesta, (text) => pouzit(text, p.um, p.ops));
      if (r.vysledek === 'odlozeno') vysledek.odlozeno++;
      vysledek.zapsano.push(p.id);
    }
    for (const o of udalosti) await this.kalendar.pridat(vstupUdalosti(o.data));

    // 3) Označit zapsané, uložit záznam a načíst kánon znovu.
    const soubor = this.soubor(cislo, '.rozhodnuti.json');
    const rozhodnuti = await this.cistJson(soubor, {});
    const cas = new Date().toISOString();
    for (const o of schvalene) rozhodnuti[o.id] = { ...(rozhodnuti[o.id] ?? {}), stav: 'schvaleno', zapsano: cas };
    await zapsatAtomicky(soubor, `${JSON.stringify(rozhodnuti, null, 1)}\n`);
    const predtim = (await this.cistJson(this.soubor(cislo, '.zapsano.json'), null))?.operace ?? [];
    await zapsatAtomicky(this.soubor(cislo, '.zapsano.json'), `${JSON.stringify({
      sezeni: cislo, cas, operace: [...predtim, ...schvalene.map((o) => ({ id: o.id, op: o.op, cas }))],
    }, null, 1)}\n`);
    await this.kanon.nacist();
    return { ...vysledek, operaci: schvalene.length, karet: new Set(vysledek.zapsano).size, udalosti: udalosti.length };
  }
}

/** Vstup pro Kalendar.pridat z operace udalost. */
function vstupUdalosti(op) {
  const vazby = (Array.isArray(op.vazby) ? op.vazby : []).map((v) => String(v).replace(/^\[\[|\]\]$/g, '').split('|')[0]).filter((v) => SLUG.test(v));
  return { datum: op.datum, text: String(op.text ?? '').replace(/\s+/g, ' ').trim(), verejna: op.verejna === true, vazby };
}

/** Před a po jen v okolí změny (řádky, které přibyly nebo se změnily, s kouskem kontextu). */
function rozdil(pred, po) {
  const a = String(pred).split('\n');
  const b = String(po).split('\n');
  let z = 0;
  while (z < a.length && z < b.length && a[z] === b[z]) z++;
  let ka = a.length - 1;
  let kb = b.length - 1;
  while (ka >= z && kb >= z && a[ka] === b[kb]) {
    ka--;
    kb--;
  }
  const od = Math.max(0, z - 3);
  return {
    pred: a.slice(od, Math.min(a.length, ka + 4)).join('\n'),
    po: b.slice(od, Math.min(b.length, kb + 4)).join('\n'),
    radek: z + 1,
  };
}
