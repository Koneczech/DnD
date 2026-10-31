// Návrh po sezení (⚠ body 153 a 157, rozhodnutí 77–80): načte návrh změn kánonu z
// hub/.stav/navrhy/sNN.yaml, zkontroluje ho proti kartám, drží rozhodnutí DM (schváleno, zamítnuto,
// upravený text, rozhodnutí rozporů) a schválené operace zapíše. Smlouva s přepisovým nástrojem je
// reference/prepis-kanon.md.
//
// Soubory ve složce hub/.stav/navrhy/ (lokální, mimo Git):
//   sNN.yaml               návrh (píše ho Claude podle podkladu z přepisového nástroje), schéma 2
//   revize-RRRR-MM-DD.yaml revize kánonu mimo sezení (jen doplnit, pole, vyradit, smazat)
//   *.dukazy.json          kontrola důkazů z přepisového nástroje (jména, čísla a citace v přepisu)
//   *.rozhodnuti.json      rozhodnutí DM u jednotlivých operací (píše Hub)
//   *.zapsano.json         co a kdy Hub zapsal (podle něj přepisový nástroj pozná stav „v kánonu“)
// Rozhodnutí o rozporech jdou do registru kampan/rozpory.yaml (v Gitu, čísla R17 a dál).
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import YAML from 'yaml';
import { nahraditTelo, teloKarty } from '../sdilene/hlavicka.js';
import { SLUG, nacistEntitu } from '../sdilene/karta-kanonu.js';
import {
  JMENO_NAVRHU, normalizujNavrh, overitNavrh, radekNeplatne, textNoveKarty, upravitExistujici, vyjmoutTelo, zapsatSezeni,
} from '../sdilene/navrh-sezeni.js';
import {
  DRUHY_ROZPORU, SOUBOR_ROZPORU, VOLBY_ROZPORU, ZASTUPCE_R, dalsiR, normalizujRegistr, potrebujeR, sezeniSlovy,
  textRozhodnuti, zaznamRegistru, zkratitCitat,
} from '../sdilene/rozpory.js';
import { PRAVIDLA, zkontrolovatKvalitu } from '../sdilene/kvalita-kanonu.js';
import { datumHarptos } from './data.js';
import { zapsatAtomicky } from './zapis.js';

const chyba = (zprava, status = 400) => Object.assign(new Error(zprava), { status });
/** Pole operace, která smí DM před schválením přepsat (hlavní text operace). */
const UPRAVITELNE = Object.freeze({
  nova_karta: ['nazev', 'telo'], doplnit: ['text'], pole: ['nove'], vazba: ['popis'],
  kanon: ['nazev', 'co_se_stalo', 'dusledek'], udalost: ['text'], sezeni: ['obsah'], rozpor: [],
  vyradit: ['nahradit', 'duvod'], smazat: [],
});
const STAVY = Object.freeze(['nerozhodnuto', 'schvaleno', 'zamitnuto']);
/** Textová pole, ve kterých Hub doplní číslo R místo zástupce R? (navazující operace rozporu). */
const POLE_S_R = ['text', 'nahradit', 'obsah', 'telo', 'co_se_stalo', 'dusledek', 'duvod'];
/** Pořadí zápisu: nejdřív nové karty (další operace na ně můžou mířit), pak úpravy, nakonec kalendář. */
const PORADI_ZAPISU = ['nova_karta', 'kanon', 'smazat', 'vyradit', 'doplnit', 'pole', 'vazba', 'sezeni', 'udalost'];
const dnesIso = () => new Date().toISOString().slice(0, 10);

/** Otisk operace: když se v novém návrhu změní, staré rozhodnutí DM k ní neplatí. */
export const otiskOperace = (op) => crypto.createHash('sha1').update(JSON.stringify(op ?? {})).digest('hex').slice(0, 12);

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

  get souborRegistru() {
    return path.join(this.c.kampan, SOUBOR_ROZPORU);
  }

  soubor(jmeno, pripona) {
    if (!JMENO_NAVRHU.test(jmeno)) throw chyba('Neplatné jméno návrhu (čekám s03 nebo revize-2026-11-02).');
    return path.join(this.slozka, `${jmeno}${pripona}`);
  }

  async cistJson(soubor, vychozi) {
    try {
      return JSON.parse(await fs.readFile(soubor, 'utf8'));
    } catch {
      return vychozi;
    }
  }

  async ulozitJson(soubor, data) {
    await fs.mkdir(this.slozka, { recursive: true });
    await zapsatAtomicky(soubor, `${JSON.stringify(data, null, 1)}\n`);
  }

  /** Registr rozporů: záznamy a surový text (kvůli zápisu se zachováním komentářů). */
  async registr() {
    let text = '';
    try {
      text = (await fs.readFile(this.souborRegistru, 'utf8')).replace(/^﻿/, '');
    } catch {
      return { text: '', zaznamy: [], podleId: new Map() };
    }
    let zaznamy = [];
    try {
      zaznamy = normalizujRegistr(YAML.parse(text)).zaznamy;
    } catch {
      throw chyba(`Registr rozporů kampan/${SOUBOR_ROZPORU} není platný YAML. Oprav ho (Kontrola dat ukáže kde) a zkus to znovu.`, 409);
    }
    return { text, zaznamy, podleId: new Map(zaznamy.map((z) => [String(z.id), z])) };
  }

  /** Návrhy, které leží ve složce: jméno, počet operací, stav rozhodování a brána. */
  async seznam() {
    let soubory = [];
    try {
      soubory = await fs.readdir(this.slozka);
    } catch {
      return { navrhy: [] };
    }
    const navrhy = [];
    for (const jmeno of soubory.filter((s) => s.endsWith('.yaml') && JMENO_NAVRHU.test(s.slice(0, -5))).sort()) {
      const cislo = jmeno.slice(0, -5);
      try {
        const d = await this.nacist(cislo);
        navrhy.push({ cislo, revize: d.revize, stav: d.stav, operaci: d.operace.length, ...d.pocty, naposledyZapsano: d.zapsano?.cas ?? null });
      } catch (err) {
        navrhy.push({ cislo, chyba: err.message });
      }
    }
    // Sezení podle čísla, revize za nimi podle data.
    navrhy.sort((a, b) => Number(a.cislo.startsWith('revize')) - Number(b.cislo.startsWith('revize')) || a.cislo.localeCompare(b.cislo));
    return { navrhy };
  }

  async surovyNavrh(cislo) {
    let text;
    try {
      // Bez BOM: Poznámkový blok a PowerShell ho do UTF-8 přidávají.
      text = (await fs.readFile(this.soubor(cislo, '.yaml'), 'utf8')).replace(/^﻿/, '');
    } catch (err) {
      if (err.status) throw err;
      throw chyba(`Návrh ${cislo} neexistuje (čekám ${path.join('hub', '.stav', 'navrhy', `${cislo}.yaml`)}).`, 404);
    }
    let data;
    try {
      data = YAML.parse(text);
    } catch (err) {
      throw chyba(`Návrh není platný YAML: ${err.message.split('\n')[0]}`);
    }
    return { ...normalizujNavrh(data), hash: crypto.createHash('sha1').update(text).digest('hex').slice(0, 16) };
  }

  /**
   * Rozhodnutí DM, která pořád platí. Rozhodnutí k operaci, která se v novém návrhu změnila
   * (jiný otisk), se nepoužije: DM ji musí posoudit znovu. Zapsané zůstávají vždy.
   */
  platnaRozhodnuti(navrh, rozhodnuti) {
    const platna = {};
    const zmenene = new Set();
    for (const op of navrh.operace) {
      const id = String(op.id ?? '');
      const r = rozhodnuti[id];
      if (!r) continue;
      if (!r.zapsano && r.otisk && r.otisk !== otiskOperace(op)) {
        zmenene.add(id);
        continue;
      }
      platna[id] = r;
    }
    return { platna, zmenene };
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
    const revize = cislo.startsWith('revize-');
    const { platna: rozhodnuti, zmenene } = this.platnaRozhodnuti(navrh, await this.cistJson(this.soubor(cislo, '.rozhodnuti.json'), {}));
    const dukazy = (await this.cistJson(this.soubor(cislo, '.dukazy.json'), {}))?.operace ?? {};
    const zapsano = await this.cistJson(this.soubor(cislo, '.zapsano.json'), null);
    const registr = await this.registr().catch(() => ({ podleId: new Map(), zaznamy: [] }));
    const operace = this.sUpravami(navrh, rozhodnuti);
    const kontrola = this.zkontrolovat({ ...navrh, operace }, cislo, registr.podleId);
    const rozporyPodleId = new Map(operace.filter((o) => o.op === 'rozpor').map((o) => [String(o.id), o]));

    const vysledek = await Promise.all(operace.map(async (op, i) => {
      const id = String(op.id ?? '');
      const r = rozhodnuti[id] ?? {};
      const varovani = [...kontrola[i].varovani];
      if (zmenene.has(id)) varovani.unshift('Operace se v návrhu od tvého rozhodnutí změnila. Posuď ji znovu.');
      const blokuje = this.blokace(op, rozhodnuti, rozporyPodleId);
      const zaznam = {
        ...kontrola[i],
        varovani,
        stav: r.zapsano ? 'zapsano' : (STAVY.includes(r.stav) ? r.stav : 'nerozhodnuto'),
        automaticky: r.automaticky === true,
        upraveno: Boolean(r.upraveno),
        upravitelne: UPRAVITELNE[op.op] ?? [],
        jistota: op.jistota ?? 'nutno_potvrdit',
        dukaz: (Array.isArray(op.dukaz) ? op.dukaz : []).map((d) => ({ ...d, citat: d?.citat ? String(d.citat) : undefined })),
        dukazy: normalizujDukazy(dukazy[id]),
        z_rozporu: op.z_rozporu !== undefined ? String(op.z_rozporu) : null,
        blokuje,
        data: op,
        ukazka: kontrola[i].problemy.length || op.op === 'rozpor' ? null : await this.ukazka(op, cislo, navrh.zdroj).catch((err) => ({ chyba: err.message })),
      };
      if (op.op === 'rozpor') {
        const druh = DRUHY_ROZPORU[op.druh] ? op.druh : 'stul_vs_karta';
        zaznam.rozpor = {
          druh,
          nazevDruhu: DRUHY_ROZPORU[druh].nazev,
          vychozi: DRUHY_ROZPORU[druh].vychozi,
          bezR: DRUHY_ROZPORU[druh].bezR,
          navrzeneR: op.r ? String(op.r) : null,
          r: r.r ?? null,
          reseni: r.reseni ?? null,
          // Co navrhl Claude, nebo co DM rozhodl mimo Hub (jen předvolba, Hub sám nic nerozhodne).
          navrh: String(op.rozhodnuti ?? op.navrh_reseni ?? '').trim() || null,
          navazujici: operace.filter((o) => String(o.z_rozporu ?? '') === id).map((o) => String(o.id)),
        };
      }
      return zaznam;
    }));
    const pocty = { schvaleno: 0, zamitnuto: 0, nerozhodnuto: 0, zapsano: 0 };
    for (const o of vysledek) if (o.op !== 'rozpor') pocty[o.stav]++;
    const rozpory = vysledek.filter((o) => o.op === 'rozpor');
    const muzeZapsat = navrh.schema === 2 && navrh.stav === 'finalni';
    return {
      cislo,
      revize,
      sezeni: sezeniSlovy(cislo),
      zdroj: navrh.zdroj,
      schema: navrh.schema,
      stav: navrh.stav,
      scenar_verze: navrh.scenar_verze,
      varovani: navrh.varovani,
      // Brána: zapsat jde jen finální návrh ze schváleného scénáře.
      brana: muzeZapsat ? null : 'Předběžný návrh: vznikl z neschváleného scénáře, takže ho můžeš procházet a rozhodovat, ale zapsat ho nejde. Zapsat půjde finální návrh (stav: finalni), který vznikne po schválení scénáře.',
      operace: vysledek,
      pocty,
      rozpory: {
        celkem: rozpory.length,
        rozhodnuto: rozpory.filter((o) => o.rozpor.reseni && o.rozpor.reseni.volba !== 'odlozit').length,
        odlozeno: rozpory.filter((o) => o.rozpor.reseni?.volba === 'odlozit').length,
        zapsano: rozpory.filter((o) => o.stav === 'zapsano').length,
      },
      zapsano,
      hash: navrh.hash,
    };
  }

  /** Proč navazující operaci rozporu nejde schválit (null = jde). */
  blokace(op, rozhodnuti, rozporyPodleId) {
    if (op.z_rozporu === undefined) return null;
    const rid = String(op.z_rozporu);
    if (!rozporyPodleId.has(rid)) return null; // chybu hlásí kontrola návrhu
    const volba = rozhodnuti[rid]?.reseni?.volba;
    if (!volba) return `Nejdřív rozhodni rozpor ${rid}.`;
    if (volba === 'karta') return `U rozporu ${rid} platí karta, tahle operace se nezapíše.`;
    if (volba === 'odlozit') return `Rozpor ${rid} je odložený, tahle operace počká.`;
    return null;
  }

  zkontrolovat(navrh, cislo, rozpory = new Map()) {
    return overitNavrh(navrh, {
      cislo,
      revize: cislo.startsWith('revize-'),
      rozpory,
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
    const dnes = dnesIso();
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
    const k = await this.textKarty(String(op.karta_id ?? ''));
    if (!k) return null;
    const kontext = { datum: dnes, sezeni: cislo.startsWith('revize-') ? null : cislo };
    if (op.op === 'vyradit' && op.cela_karta === true) {
      return { soubor: k.e.soubor, po: `Karta „${k.e.nazev}“ dostane platnost: vyrazeno${op.r ? ` (${op.r})` : ''} a zmizí z pohledu družiny, mapy a hledání.`, neplatne: radekNeplatne({ r: op.r ?? null, datum: op.kdy ?? dnes, sezeni: kontext.sezeni, celaKarta: true, duvod: op.duvod }) };
    }
    if (op.op === 'vyradit') {
      // Změna v oddílu a řádek do Neplatné zvlášť: jinak by ukázka zabrala celou kartu mezi nimi.
      const pred = teloKarty(k.text);
      const v = vyjmoutTelo(pred, op, kontext);
      return { soubor: k.e.soubor, ...rozdil(pred, v.telo), neplatne: v.radek };
    }
    const um = { slozka: k.e.slozka, soubor: k.e.soubor, slozkaEntity: k.e.slozkaEntity };
    const po = upravitExistujici(k.text, [op], um, (id) => this.kanon.entity.get(id), kontext);
    return { soubor: k.e.soubor, ...rozdil(k.text, po) };
  }

  /**
   * Rozhodnutí DM u jedné operace:
   *   { stav?, upraveno? } — schválit, zamítnout, vrátit; upraveno = jen povolená pole, null smaže úpravu
   *   { reseni: { volba: stul|karta|jinak|odlozit, text? } | null } — rozhodnutí rozporu
   */
  async rozhodnout(cislo, id, vstup) {
    const navrh = await this.surovyNavrh(cislo);
    const op = navrh.operace.find((o) => String(o.id ?? '') === id);
    if (!op) throw chyba('Operace v návrhu není.', 404);
    const soubor = this.soubor(cislo, '.rozhodnuti.json');
    const vsechna = await this.cistJson(soubor, {});
    const { platna } = this.platnaRozhodnuti(navrh, vsechna);
    const r = { ...(platna[id] ?? {}) };
    if (r.zapsano) throw chyba('Operace už je zapsaná v kánonu.', 409);
    delete r.automaticky;

    if ('reseni' in vstup) {
      if (op.op !== 'rozpor') throw chyba('Rozhodnutí rozporu jde jen u operace rozpor.');
      if (vstup.reseni === null) {
        delete r.reseni;
        r.stav = 'nerozhodnuto';
      } else {
        const volba = vstup.reseni?.volba;
        if (!(volba in VOLBY_ROZPORU)) throw chyba(`Volba je ${Object.keys(VOLBY_ROZPORU).join(', ')}.`);
        const text = volba === 'jinak' ? textRozhodnuti('jinak', vstup.reseni.text) : null;
        if (text && text.length > 2000) throw chyba('Rozhodnutí je příliš dlouhé (nejvýš 2000 znaků).');
        r.reseni = { volba, ...(text ? { text } : {}), kdy: dnesIso() };
        r.stav = 'schvaleno';
      }
      // Navazující operace: když platí karta nebo je rozpor odložený, nezapíšou se. Hub je zamítne
      // sám a po změně rozhodnutí je vrátí mezi čekající (jen ty, které zamítl on).
      const volba = r.reseni?.volba;
      for (const n of navrh.operace.filter((o) => String(o.z_rozporu ?? '') === id)) {
        const nid = String(n.id ?? '');
        const nr = { ...(platna[nid] ?? {}) };
        if (nr.zapsano) continue;
        if (volba === 'karta' || volba === 'odlozit') {
          if (nr.stav !== 'zamitnuto') platna[nid] = { ...nr, stav: 'zamitnuto', automaticky: true, otisk: otiskOperace(n) };
        } else if (nr.automaticky) {
          platna[nid] = { ...nr, stav: 'nerozhodnuto', automaticky: false, otisk: otiskOperace(n) };
          delete platna[nid].automaticky;
        }
      }
    }
    if ('stav' in vstup) {
      if (!STAVY.includes(vstup.stav)) throw chyba(`Stav je ${STAVY.join(', ')}.`);
      if (op.op === 'rozpor' && vstup.stav === 'schvaleno') throw chyba('Rozpor se neschvaluje: vyber Platí stůl, Platí karta, Jinak, nebo Odložit.');
      if (vstup.stav === 'schvaleno') {
        const rozpory = new Map(navrh.operace.filter((o) => o.op === 'rozpor').map((o) => [String(o.id), o]));
        const duvod = this.blokace(op, platna, rozpory);
        if (duvod) throw chyba(duvod, 409);
      }
      if (op.op === 'rozpor' && vstup.stav === 'nerozhodnuto') delete r.reseni;
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
    r.otisk = otiskOperace(op);
    platna[id] = r;
    // Zapsaná rozhodnutí zůstanou i u operací, které už v návrhu nejsou.
    const ulozit = { ...Object.fromEntries(Object.entries(vsechna).filter(([, x]) => x?.zapsano)), ...platna };
    await this.ulozitJson(soubor, ulozit);
    return this.nacist(cislo);
  }

  /**
   * Plán zápisu nad aktuálními soubory v paměti: texty nových a upravených karet, události, nové
   * záznamy registru a výsledek Kvality kánonu před a po. Nic nezapisuje; když jediná operace nejde
   * použít, vyhodí chybu.
   */
  async naplanovat(cislo, detail = null) {
    const d = detail ?? await this.nacist(cislo);
    const revize = d.revize;
    const dnes = dnesIso();
    const schvalene = d.operace.filter((o) => o.stav === 'schvaleno' && o.op !== 'rozpor');
    const rozpory = d.operace.filter((o) => o.op === 'rozpor' && o.stav !== 'zapsano' && o.rozpor.reseni);
    const vadne = schvalene.filter((o) => o.problemy.length || o.blokuje);
    if (vadne.length) {
      throw chyba(`Schválené operace, které nejde zapsat: ${vadne.map((o) => `${o.id} (${o.problemy[0] ?? o.blokuje})`).join('; ')}. Oprav je, nebo je zamítni.`, 409);
    }
    const vadneRozpory = rozpory.filter((o) => o.problemy.length);
    if (vadneRozpory.length) throw chyba(`Rozpory s chybou: ${vadneRozpory.map((o) => `${o.id} (${o.problemy[0]})`).join('; ')}.`, 409);

    // 1) Čísla R: navržené číslo z návrhu, jinak další volné v registru.
    const registr = await this.registr();
    const obsazena = new Set([...registr.podleId.keys(), ...d.operace.filter((o) => o.op === 'rozpor' && o.data.r).map((o) => String(o.data.r))]);
    const cisloRozporu = new Map(); // id rozporu → R
    const zaznamy = [];
    const radkySezeni = [];
    for (const o of rozpory) {
      const { volba } = o.rozpor.reseni;
      if (!potrebujeR(o.rozpor.druh, volba)) {
        // Přeřeknutí nebo paměť hráčů, platí karta: kánon se nemění, jen řádek do zápisu sezení.
        if (!revize) radkySezeni.push(radekRozporuDoSezeni(o.data, o.rozpor));
        continue;
      }
      let r = o.data.r ? String(o.data.r) : null;
      if (!r) {
        r = dalsiR(obsazena);
        obsazena.add(r);
      }
      cisloRozporu.set(o.id, r);
      zaznamy.push(zaznamRegistru(o.data, o.rozpor.reseni, { id: r, sezeni: revize ? null : cislo }));
    }

    // 2) Operace: číslo R a datum rozhodnutí do navazujících operací.
    const reseniRozporu = new Map(d.operace.filter((o) => o.op === 'rozpor').map((o) => [o.id, o.rozpor.reseni]));
    const pripravit = (o) => {
      const op = { ...o.data };
      const rid = op.z_rozporu !== undefined ? String(op.z_rozporu) : null;
      const r = rid ? (cisloRozporu.get(rid) ?? (o.data.r ? String(o.data.r) : null)) : (op.r ? String(op.r) : null);
      if (r) {
        if (op.op === 'vyradit' && !op.r) op.r = r;
        for (const pole of POLE_S_R) if (typeof op[pole] === 'string') op[pole] = op[pole].replace(ZASTUPCE_R, r);
      }
      if (rid && reseniRozporu.get(rid)?.kdy && op.kdy === undefined) op.kdy = reseniRozporu.get(rid).kdy;
      // Důkaz do hlavičky karty jen zkrácený (repo je veřejné).
      if (Array.isArray(op.dukaz)) op.dukaz = op.dukaz.map((x) => (x && typeof x === 'object' ? { ...x, citat: zkratitCitat(x.citat) } : x));
      return op;
    };
    const ops = schvalene.map((o) => ({ id: o.id, op: pripravit(o) }));
    for (const [i, radek] of radkySezeni.entries()) {
      ops.push({ id: `rozpor-${i}`, op: { op: 'sezeni', sekce: 'fungovalo', obsah: radek }, interni: true });
    }
    if (!ops.length && !zaznamy.length) throw chyba('Není schválená žádná operace ani rozhodnutý rozpor k zápisu.');

    // 3) Simulace v paměti: nové karty, úpravy po kartách, zápis sezení.
    const najit = (id) => this.kanon.entity.get(id);
    const serazene = [...ops].sort((a, b) => PORADI_ZAPISU.indexOf(a.op.op) - PORADI_ZAPISU.indexOf(b.op.op));
    const nove = new Map(); // id → { soubor, text, um }
    const upravy = new Map(); // id → [operace]
    const udalosti = [];
    for (const { op } of serazene) {
      if (op.op === 'nova_karta' || op.op === 'kanon') {
        const typ = op.op === 'kanon' ? 'kanon' : op.typ;
        const k = textNoveKarty(op, { sablona: await this.sablona(typ), dnes, zdroj: d.zdroj, cislo });
        try {
          await fs.access(path.join(this.c.koren, ...k.soubor.split('/')));
          throw chyba(`Soubor ${k.soubor} už existuje.`, 409);
        } catch (err) {
          if (err.status) throw err;
        }
        nove.set(k.id, { soubor: k.soubor, text: k.text, um: { slozka: k.slozka, soubor: k.soubor, slozkaEntity: k.slozkaEntity } });
      } else if (op.op === 'udalost') {
        udalosti.push(op);
      } else {
        const id = op.op === 'sezeni' ? cislo : String(op.karta_id);
        if (!upravy.has(id)) upravy.set(id, []);
        upravy.get(id).push(op);
      }
    }
    const najitVcetneNovych = (id) => najit(id) ?? (nove.has(id) ? nacistEntitu(nove.get(id).text, nove.get(id).um) : undefined);
    const kontext = { datum: dnes, sezeni: revize ? null : cislo };
    const pouzit = (text, um, opsKarty) => {
      let t = text;
      const naKartu = opsKarty.filter((x) => x.op !== 'sezeni');
      if (naKartu.length) t = upravitExistujici(t, naKartu, um, najitVcetneNovych, kontext);
      for (const s of opsKarty.filter((x) => x.op === 'sezeni')) t = nahraditTelo(t, zapsatSezeni(teloKarty(t), s.sekce, s.obsah));
      return t;
    };
    const plan = [];
    const poZapisu = new Map(); // id → text po zápisu (kvůli Kvalitě kánonu)
    for (const [id, opsKarty] of upravy) {
      if (nove.has(id)) {
        const n = nove.get(id);
        n.text = pouzit(n.text, n.um, opsKarty);
        continue;
      }
      const k = await this.textKarty(id);
      if (!k) throw chyba(`Karta „${id}“ neexistuje.`, 404);
      const um = { slozka: k.e.slozka, soubor: k.e.soubor, slozkaEntity: k.e.slozkaEntity };
      poZapisu.set(id, { text: pouzit(k.text, um, opsKarty), um, upraveno: k.e.upraveno });
      plan.push({ id, um, ops: opsKarty });
    }
    for (const [id, n] of nove) poZapisu.set(id, { text: n.text, um: n.um, upraveno: null });
    for (const op of udalosti) {
      if (!this.kalendar) throw chyba('Kalendář není k dispozici.', 503);
      this.kalendar.overUdalost(vstupUdalosti(op));
    }

    // 4) Kvalita kánonu (rozhodnutí 79): zápis nesmí přidat chybu.
    const kvalita = this.porovnatKvalitu(poZapisu, [...registr.podleId.keys(), ...zaznamy.map((z) => z.id)]);

    return { detail: d, ops, nove, plan, pouzit, udalosti, zaznamy, registr, cisloRozporu, rozpory, kvalita };
  }

  /** Nové chyby Kvality kánonu po zápisu: karta a pravidlo, kde chyb přibylo. */
  porovnatKvalitu(poZapisu, rozhodnutiR) {
    const volby = { terminy: this.kanon.terminy ?? [], rozhodnutiR: new Set(rozhodnutiR) };
    const pred = zkontrolovatKvalitu(this.kanon.entity.values(), { ...volby, rozhodnutiR: this.kanon.rozhodnutiR?.() ?? new Set() });
    const po = new Map(this.kanon.entity);
    for (const [id, x] of poZapisu) po.set(id, nacistEntitu(x.text, { ...x.um, upraveno: x.upraveno }));
    const vysledekPo = zkontrolovatKvalitu(po.values(), volby);
    const pocty = (v) => {
      const m = new Map();
      for (const k of v.karty) for (const p of k.problemy) if (p.uroven === 'chyba') m.set(`${k.id}|${p.pravidlo}`, (m.get(`${k.id}|${p.pravidlo}`) ?? 0) + 1);
      return m;
    };
    const a = pocty(pred);
    const nove = [];
    for (const k of vysledekPo.karty) {
      const vypsane = new Set();
      for (const p of k.problemy) {
        const klic = `${k.id}|${p.pravidlo}`;
        if (p.uroven !== 'chyba' || vypsane.has(klic)) continue;
        const kolik = k.problemy.filter((x) => x.pravidlo === p.pravidlo && x.uroven === 'chyba').length;
        if (kolik > (a.get(klic) ?? 0)) {
          vypsane.add(klic);
          nove.push({ id: k.id, nazev: k.nazev, pravidlo: p.pravidlo, nazevPravidla: PRAVIDLA[p.pravidlo]?.nazev ?? p.pravidlo, zprava: p.zprava });
        }
      }
    }
    return { pred: pred.procento, po: vysledekPo.procento, nove };
  }

  /** Náhled před zápisem: co se zapíše a jestli zápis nepřidá chybu Kvality kánonu. */
  async kontrolaZapisu(cislo) {
    try {
      const p = await this.naplanovat(cislo);
      return {
        ok: !p.kvalita.nove.length && !p.detail.brana,
        operaci: p.ops.filter((o) => !o.interni).length,
        karet: new Set([...p.nove.keys(), ...p.plan.map((x) => x.id)]).size,
        udalosti: p.udalosti.length,
        rozporu: p.zaznamy.length,
        cislaR: p.zaznamy.map((z) => z.id),
        kvalita: p.kvalita,
        brana: p.detail.brana,
      };
    } catch (err) {
      return { ok: false, chyba: err.message };
    }
  }

  /**
   * Zapíše schválené operace a rozhodnuté rozpory. Nejdřív se všechno spočítá nad aktuálními
   * soubory v paměti; když jediná operace selže nebo by zápis přidal chybu Kvality kánonu,
   * nezapíše se nic. Pak jeden zápis na každý dotčený soubor (přes frontu zápisu, nad posledním
   * obsahem na disku), registr rozporů a události do kalendáře. Zapsané operace se označí, takže
   * opakování nic nezdvojí.
   */
  async zapsat(cislo) {
    const detail = await this.nacist(cislo);
    if (detail.brana) throw chyba(detail.brana, 409);
    const p = await this.naplanovat(cislo, detail);
    if (p.kvalita.nove.length) {
      throw chyba(`Zápis by přidal ${p.kvalita.nove.length === 1 ? 'chybu' : 'chyby'} Kvality kánonu (rozhodnutí 79): ${p.kvalita.nove.map((x) => `${x.nazev} — ${x.nazevPravidla} (${x.zprava})`).join('; ')}. Uprav nebo zamítni operace, které ji způsobí.`, 409);
    }

    // Zápis.
    const vysledek = { zapsano: [], odlozeno: 0 };
    for (const [id, n] of p.nove) {
      const cesta = path.join(this.c.koren, ...n.soubor.split('/'));
      await fs.mkdir(path.dirname(cesta), { recursive: true });
      const r = await this.zapisovac.zapsat(cesta, n.text);
      if (r.vysledek === 'odlozeno') vysledek.odlozeno++;
      vysledek.zapsano.push(id);
    }
    for (const x of p.plan) {
      const cesta = path.join(this.c.koren, ...x.um.soubor.split('/'));
      const r = await this.zapisovac.upravit(cesta, (text) => p.pouzit(text, x.um, x.ops));
      if (r.vysledek === 'odlozeno') vysledek.odlozeno++;
      vysledek.zapsano.push(x.id);
    }
    if (p.zaznamy.length) {
      const r = await this.zapsatRegistr(p.zaznamy);
      if (r.vysledek === 'odlozeno') vysledek.odlozeno++;
    }
    for (const op of p.udalosti) await this.kalendar.pridat(vstupUdalosti(op));

    // Označit zapsané, uložit záznam pro přepisový nástroj a načíst kánon znovu.
    const soubor = this.soubor(cislo, '.rozhodnuti.json');
    const rozhodnuti = await this.cistJson(soubor, {});
    const cas = new Date().toISOString();
    const zapsaneOps = p.ops.filter((o) => !o.interni).map((o) => o.id);
    for (const id of zapsaneOps) rozhodnuti[id] = { ...(rozhodnuti[id] ?? {}), stav: 'schvaleno', zapsano: cas };
    for (const o of p.rozpory) rozhodnuti[o.id] = { ...(rozhodnuti[o.id] ?? {}), zapsano: cas, ...(p.cisloRozporu.has(o.id) ? { r: p.cisloRozporu.get(o.id) } : {}) };
    await this.ulozitJson(soubor, rozhodnuti);
    const predtim = await this.cistJson(this.soubor(cislo, '.zapsano.json'), null);
    const zapsane = [...new Set([...(predtim?.zapsane ?? []), ...zapsaneOps, ...p.rozpory.map((o) => o.id)])];
    const zamitnute = detail.operace.filter((o) => o.stav === 'zamitnuto').map((o) => o.id);
    const upravene = [...new Set([...(predtim?.upravene ?? []), ...detail.operace.filter((o) => o.upraveno && zapsaneOps.includes(o.id)).map((o) => o.id)])];
    await this.ulozitJson(this.soubor(cislo, '.zapsano.json'), {
      sezeni: cislo, cas, navrh_hash: detail.hash, zapsane, zamitnute, upravene, rozpory: p.zaznamy.map((z) => z.id), commit: null,
    });
    await this.kanon.nacist();
    return {
      ...vysledek,
      operaci: zapsaneOps.length,
      karet: new Set(vysledek.zapsano).size,
      udalosti: p.udalosti.length,
      rozporu: p.zaznamy.length,
      cislaR: p.zaznamy.map((z) => z.id),
    };
  }

  /** Commit, který zápis uložil na GitHub (doplní Hub po Uložit; přepisový nástroj ho ukáže). */
  async oznacitCommit(cislo, commit) {
    const soubor = this.soubor(cislo, '.zapsano.json');
    const z = await this.cistJson(soubor, null);
    if (!z) return;
    await this.ulozitJson(soubor, { ...z, commit });
  }

  /**
   * Přidá záznamy do kampan/rozpory.yaml (soubor založí). Existující záznam se stejným id (odložený
   * rozpor, o kterém DM teď rozhodl) přepíše. Komentáře a zbytek souboru zůstanou.
   */
  async zapsatRegistr(zaznamy) {
    const uprava = (text) => upravitRegistr(text, zaznamy);
    try {
      await fs.access(this.souborRegistru);
      return await this.zapisovac.upravit(this.souborRegistru, uprava);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      return this.zapisovac.zapsat(this.souborRegistru, uprava(''));
    }
  }
}

const HLAVICKA_REGISTRU = `# Registr rozhodnutí o rozporech (rozhodnutí 77, reference/prepis-kanon.md § 6).
# Každé rozhodnutí DM o rozporu mezi stolem a kartou má číslo R a záznam tady. Čísla navazují
# na R1–R16 z převodu Notionu (reference/kanon-mapa.yaml). Zapisuje Hub (Návrh po sezení).
`;

/** Text registru s přidanými nebo přepsanými záznamy. */
export function upravitRegistr(text, zaznamy) {
  const zdroj = String(text ?? '').replace(/^﻿/, '');
  const doc = zdroj.trim() ? YAML.parseDocument(zdroj) : YAML.parseDocument(`${HLAVICKA_REGISTRU}[]\n`);
  if (doc.errors.length) throw chyba(`Registr rozporů není platný YAML: ${doc.errors[0].message.split('\n')[0]}`, 409);
  if (!YAML.isSeq(doc.contents)) {
    if (doc.contents === null || (YAML.isScalar(doc.contents) && doc.contents.value === null)) doc.contents = doc.createNode([]);
    else throw chyba('Registr rozporů musí být seznam záznamů.', 409);
  }
  doc.contents.flow = false;
  for (const z of zaznamy) {
    const uzel = doc.createNode(z);
    const dukaz = uzel.get('dukaz', true);
    if (YAML.isSeq(dukaz)) for (const polozka of dukaz.items) polozka.flow = true;
    const i = doc.contents.items.findIndex((x) => YAML.isMap(x) && String(x.get('id')) === z.id);
    if (i >= 0) doc.contents.items[i] = uzel;
    else doc.contents.items.push(uzel);
  }
  return doc.toString({ lineWidth: 0 }).replace(/\n*$/, '\n');
}

/** Řádek do zápisu sezení u rozporu bez R (přeřeknutí, paměť hráčů; platí karta). */
function radekRozporuDoSezeni(op, rozpor) {
  const karta = op.karta_id && SLUG.test(String(op.karta_id)) ? `[[${op.karta_id}]]` : null;
  const zaznelo = String(op.prepis_tvrzeni ?? '').replace(/\s+/g, ' ').trim();
  return `- ${rozpor.nazevDruhu}${karta ? ` (${karta})` : ''}: u stolu zaznělo „${zaznelo}“, platí karta.`;
}

/**
 * Kontrola důkazů z přepisového nástroje (prepis-kanon.md § 4 a Odpovědi relace Přepis):
 * `{ ok, problemy: [{ text, zavaznost: chyba|upozorneni }], dm?: [{ dm, citat }] }`. Upozornění
 * mohou mít i operace s `ok: true`. Starší tvar s problémy jako prostými texty se bere jako upozornění.
 */
export function normalizujDukazy(x) {
  if (!x || typeof x !== 'object') return null;
  const problemy = (Array.isArray(x.problemy) ? x.problemy : []).map((p) => (typeof p === 'string'
    ? { text: p, zavaznost: 'upozorneni' }
    : { text: String(p?.text ?? ''), zavaznost: p?.zavaznost === 'chyba' ? 'chyba' : 'upozorneni' })).filter((p) => p.text);
  const dm = (Array.isArray(x.dm) ? x.dm : [])
    .filter((d) => d && typeof d === 'object' && d.dm)
    .map((d) => ({ dm: String(d.dm), ...(d.citat ? { citat: String(d.citat) } : {}) }));
  return {
    ok: x.ok === true,
    problemy,
    chyb: problemy.filter((p) => p.zavaznost === 'chyba').length,
    upozorneni: problemy.filter((p) => p.zavaznost === 'upozorneni').length,
    dm,
  };
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
