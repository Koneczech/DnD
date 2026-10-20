// Modul Kánon (Blok 3, rozhodnutí 69–71, body 99–102): síť entit z kampan/, karta vybrané entity,
// pohled družiny, malé úpravy hlavičky a nástěnky (uložená rozložení mapy).
//
// Hub čte všechny karty ze složek typů (TYPY_SLOZEK). Mění jen vazby, vztahy, přezdívky,
// štítek `aktualni`, `verejne` a u místa `lezi_v` (hlavicka.js); text karty se píše v Obsidianu.
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import YAML from 'yaml';
import { rozebrat, odkazy } from './frontmatter.js';
import { TYPY_SLOZEK } from './cesty.js';
import { upravitKartu, idZOdkazu, normalizujVztah } from './hlavicka.js';
import { PRIPONA_DOCASNA } from './zapis.js';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const STITEK_VE_HRE = 'aktualni';
export const ODDIL_DRUZINY = 'Co ví družina';
export const POHLEDY = Object.freeze(['dm', 'druzina']);
const MAX_ALIASU = 20;
const MAX_NASTENEK = 50;
const OBRAZEK = /\.(png|jpe?g|webp)$/i;

const chyba = (zprava, status = 400) => Object.assign(new Error(zprava), { status });
const bezDiakritiky = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Slug pro jméno nástěnky. */
export function slugNastenky(text) {
  return bezDiakritiky(text).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/**
 * Oddíly těla karty podle nadpisů ## (a ###…). Text před prvním nadpisem je oddíl bez nadpisu.
 * Bloky kódu (```) se nerozdělují.
 * @returns {Array<{nadpis: string|null, uroven: number, text: string}>}
 */
export function oddily(telo) {
  const vysledek = [];
  let aktualni = { nadpis: null, uroven: 0, radky: [] };
  let vKodu = false;
  for (const radek of String(telo ?? '').split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(radek)) vKodu = !vKodu;
    const m = !vKodu && /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(radek);
    if (m) {
      vysledek.push(aktualni);
      aktualni = { nadpis: m[2], uroven: m[1].length, radky: [radek] };
    } else {
      aktualni.radky.push(radek);
    }
  }
  vysledek.push(aktualni);
  return vysledek.map((o) => ({ nadpis: o.nadpis, uroven: o.uroven, text: o.radky.join('\n') })).filter((o) => o.nadpis !== null || o.text.trim());
}

/** Je nadpis oddílu jen pro DM? (`## DM`, `## DM — co postava neví`; ZADANI.md, Oddíly karty) */
export const jeOddilDm = (nadpis) => /^DM(\b|\s|—|-|:|$)/.test(String(nadpis ?? '').trim());

const jeOddilDruziny = (nadpis) => bezDiakritiky(String(nadpis ?? '').trim()) === bezDiakritiky(ODDIL_DRUZINY);

/**
 * Text, který smí vidět družina. Oddíl Co ví družina se vezme celý i s pododdíly, nic jiného.
 * Hráčský kánon (typ kanon) je záznam toho, co družina zažila: ukáže se celý kromě oddílů DM.
 */
export function teloDruziny(telo, typ) {
  const casti = oddily(telo);
  const vystup = [];
  let berUroven = 0; // > 0 = jsme uvnitř oddílu, který se ukazuje
  let vynechUroven = 0; // > 0 = jsme uvnitř oddílu DM
  for (const o of casti) {
    if (o.nadpis !== null) {
      if (berUroven && o.uroven <= berUroven) berUroven = 0;
      if (vynechUroven && o.uroven <= vynechUroven) vynechUroven = 0;
      if (!vynechUroven && jeOddilDm(o.nadpis)) vynechUroven = o.uroven;
      if (!berUroven && jeOddilDruziny(o.nadpis)) berUroven = o.uroven;
    }
    if (vynechUroven) continue;
    if (typ === 'kanon' || berUroven) vystup.push(o.text);
  }
  return vystup.join('\n').trim();
}

/** Ilustrace z hlavičky → adresa obrázku přes Hub (stejné cesty jako jinde v Hubu). */
function adresaObrazku(il, entita) {
  const soubor = String(il?.soubor ?? '');
  if (!soubor || !OBRAZEK.test(soubor)) return null;
  if (soubor.startsWith('/')) return soubor;
  if (!entita.slozkaEntity) return null; // záznam (jeden soubor) nemá vlastní obrázky
  return `/kampan/${entita.slozka}/${encodeURIComponent(entita.id)}/${soubor.split('/').map(encodeURIComponent).join('/')}`;
}

/** Obrázky karty: portréty a ilustrace scén (bez skrytých, ty patří jen DM). */
function obrazky(data, entita) {
  const seznam = (Array.isArray(data.ilustrace) ? data.ilustrace : [])
    .map((il) => ({
      url: adresaObrazku(il, entita),
      ucel: ['portret', 'scena', 'token', 'karta'].includes(il?.ucel) ? il.ucel : 'scena',
      varianta: typeof il?.varianta === 'string' ? il.varianta : null,
      stav: typeof il?.stav === 'string' && il.stav !== 'vychozi' ? il.stav : null,
      skryta: il?.skryta === true,
      soubor: String(il?.soubor ?? ''),
    }))
    .filter((il) => il.url);
  return seznam;
}

/**
 * Nadřazené místo (`lezi_v: "[[mirabar]]"`, ⚠ bod 116). Jen u místa; jiný tvar se ignoruje
 * (Kontrola dat ho ohlásí).
 */
export function leziV(d) {
  if (d?.typ !== 'misto' || typeof d.lezi_v !== 'string') return null;
  const id = odkazy(d.lezi_v)[0] ?? '';
  return SLUG.test(id) && id !== d.id ? id : null;
}

const textovePole = (x) => (typeof x === 'string' ? x : Number.isFinite(x) ? String(x) : null);

/** Karta ze souboru v jednotném tvaru pro panel. */
export function nacistEntitu(text, { slozka, soubor, slozkaEntity }) {
  const r = rozebrat(text);
  if (r.chyba) throw new Error(r.chyba);
  if (!r.maHlavicku) throw new Error('Chybí hlavička YAML');
  const d = r.data;
  const id = String(d.id ?? '');
  if (!SLUG.test(id)) throw new Error(`id „${id}“ není slug`);
  const entita = {
    id,
    typ: String(d.typ ?? TYPY_SLOZEK[slozka]),
    slozka,
    slozkaEntity,
    soubor,
    nazev: String(d.nazev ?? id),
    verejne: d.verejne === true,
    ikona: typeof d.ikona === 'string' ? d.ikona : '',
    aliases: (Array.isArray(d.aliases) ? d.aliases : []).map(String).filter(Boolean),
    tags: (Array.isArray(d.tags) ? d.tags : []).map(String).filter(Boolean),
    vazby: [...new Set(odkazy(JSON.stringify(d.vazby ?? [])))],
    vztahy: (Array.isArray(d.vztahy) ? d.vztahy : []).map(normalizujVztah).filter(Boolean),
    leziV: leziV(d),
    odkazyVTextu: [...new Set(odkazy(r.telo))],
    udaje: {},
    telo: r.telo,
  };
  entita.aktualni = entita.tags.includes(STITEK_VE_HRE);
  entita.obrazky = obrazky(d, entita);
  // Hlavní údaje z hlavičky podle typu (karta je ukáže pod názvem).
  for (const pole of ['hrac', 'druh', 'povolani', 'stav', 'oblast', 'zaznamenano', 'sezeni', 'cislo']) {
    const h = textovePole(d[pole]);
    if (h) entita.udaje[pole] = h;
  }
  if (Array.isArray(d.kdo) && d.kdo.length) entita.udaje.kdo = d.kdo.map(String).join(', ');
  if (typeof d.doresit === 'boolean') entita.udaje.doresit = d.doresit ? 'ano' : 'ne';
  return entita;
}

/** Portrét do uzlu mapy: první portrét, jinak první ilustrace scény. */
function obrazekUzlu(obrazky) {
  return obrazky.find((o) => o.ucel === 'portret' && !o.varianta) ?? obrazky.find((o) => o.ucel === 'portret') ?? obrazky.find((o) => o.ucel === 'scena') ?? null;
}

/**
 * Entita pro daný pohled. Pohled družiny (rozhodnutí 71) je filtr, ne ochrana (rozhodnutí 2):
 * jen entity s `verejne: true`, vztahy s `verejne: true` k veřejným entitám, žádné holé vazby,
 * přezdívky, štítky ani údaje z hlavičky; z obrázků jen neskryté.
 * @param {object} e entita z nacistEntitu
 * @param {(id: string) => object|undefined} najit
 */
export function vPohledu(e, pohled, najit) {
  if (pohled !== 'druzina') {
    const obrazky = e.obrazky;
    return {
      id: e.id, typ: e.typ, nazev: e.nazev, verejne: e.verejne, ikona: e.ikona, aliases: e.aliases, tags: e.tags,
      aktualni: e.aktualni, vazby: e.vazby, vztahy: e.vztahy, leziV: e.leziV, udaje: e.udaje, soubor: e.soubor,
      obrazek: obrazekUzlu(obrazky)?.url ?? null, portret: obrazekUzlu(obrazky)?.ucel === 'portret', obrazky,
    };
  }
  if (!e.verejne) return null;
  const obrazky = e.obrazky.filter((o) => !o.skryta);
  const vztahy = e.vztahy.filter((v) => v.verejne && najit(v.s)?.verejne);
  return {
    id: e.id, typ: e.typ, nazev: e.nazev, verejne: true, ikona: e.ikona, aliases: [], tags: [], aktualni: false,
    vazby: vztahy.map((v) => v.s), vztahy, udaje: {}, soubor: null,
    // Kde místo leží, družina ví, když zná obě místa.
    leziV: e.leziV && najit(e.leziV)?.verejne ? e.leziV : null,
    obrazek: obrazekUzlu(obrazky)?.url ?? null, portret: obrazekUzlu(obrazky)?.ucel === 'portret', obrazky,
  };
}

/** Odkaz Otevřít v Obsidianu (bod 101). */
export function odkazObsidian(trezor, soubor) {
  return `obsidian://open?vault=${encodeURIComponent(trezor)}&file=${encodeURIComponent(soubor)}`;
}

/** Nástěnka ze souboru v jednotném tvaru. Rozbité položky se tiše vynechají. */
export function normalizujNastenku(id, d) {
  const entity = [];
  const videno = new Set();
  for (const x of Array.isArray(d?.entity) ? d.entity : []) {
    const eid = idZOdkazu(x?.id);
    if (!SLUG.test(eid) || videno.has(eid) || !Number.isFinite(Number(x?.x)) || !Number.isFinite(Number(x?.y))) continue;
    videno.add(eid);
    entity.push({ id: eid, x: Math.round(Number(x.x)), y: Math.round(Number(x.y)) });
  }
  return {
    id,
    nazev: typeof d?.nazev === 'string' && d.nazev.trim() ? d.nazev.trim() : id,
    pohled: d?.pohled === 'druzina' ? 'druzina' : 'dm',
    jen_tyto: d?.jen_tyto === true,
    entity,
  };
}

/**
 * Události: 'zmena' { verze } — panel si podle ní načte seznam a otevřenou kartu znovu.
 */
export class Kanon extends EventEmitter {
  constructor({ cesty, zapisovac, nastaveni = () => ({}) }) {
    super();
    this.c = cesty;
    this.zapisovac = zapisovac;
    this.nastaveni = nastaveni;
    /** @type {Map<string, object>} */
    this.entity = new Map();
    /** @type {Map<string, object>} */
    this.nastenky = new Map();
    this.chyby = [];
    this.verze = 0;
    this.casovac = null;
  }

  get slozkaNastenek() {
    return path.join(this.c.kampan, 'nastenky');
  }

  /** Všechny karty a nástěnky znovu z disku. */
  async nacist() {
    const entity = new Map();
    const chyby = [];
    for (const slozka of Object.keys(TYPY_SLOZEK)) {
      let polozky = [];
      try {
        polozky = await fs.readdir(path.join(this.c.kampan, slozka), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const p of polozky.sort((a, b) => a.name.localeCompare(b.name))) {
        if (p.name.startsWith('.') || p.name.endsWith(PRIPONA_DOCASNA)) continue;
        let soubor = null;
        let slozkaEntity = false;
        if (p.isFile() && p.name.endsWith('.md')) soubor = `kampan/${slozka}/${p.name}`;
        else if (p.isDirectory()) {
          soubor = `kampan/${slozka}/${p.name}/${p.name}.md`;
          slozkaEntity = true;
        }
        if (!soubor) continue;
        // Poznámky mimo sezení (Poznámka F2 bez běžícího sezení) nejsou kánon.
        if (soubor === 'kampan/sezeni/priprava.md') continue;
        let text;
        try {
          text = await fs.readFile(path.join(this.c.koren, ...soubor.split('/')), 'utf8');
        } catch {
          continue; // složka bez hlavního souboru (jen obrázky)
        }
        try {
          const e = nacistEntitu(text, { slozka, soubor, slozkaEntity });
          if (entity.has(e.id)) chyby.push({ soubor, chyba: `Duplicitní id „${e.id}“` });
          else entity.set(e.id, e);
        } catch (err) {
          chyby.push({ soubor, chyba: err.message.split('\n')[0] });
        }
      }
    }
    this.entity = entity;
    this.chyby = chyby;
    await this.nacistNastenky();
    this.oznam();
  }

  async nacistNastenky() {
    const mapa = new Map();
    let soubory = [];
    try {
      soubory = await fs.readdir(this.slozkaNastenek);
    } catch {
      /* zatím žádná */
    }
    for (const jmeno of soubory.filter((s) => s.endsWith('.yaml')).sort()) {
      const id = jmeno.slice(0, -5);
      if (!SLUG.test(id)) continue;
      try {
        mapa.set(id, normalizujNastenku(id, YAML.parse(await fs.readFile(path.join(this.slozkaNastenek, jmeno), 'utf8'))));
      } catch {
        /* rozbitý soubor nástěnky se jen neukáže */
      }
    }
    this.nastenky = mapa;
  }

  oznam() {
    this.verze++;
    this.emit('zmena', { verze: this.verze });
  }

  /**
   * Hlídání souborů: změna karty nebo nástěnky načte kánon znovu (s krátkým zpožděním, Obsidian
   * ukládá po částech). Vrací true, když soubor patří kánonu.
   */
  souborZmenen(soubor) {
    const rel = path.relative(this.c.kampan, path.resolve(soubor));
    if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
    const prvni = rel.split(path.sep)[0];
    if (!TYPY_SLOZEK[prvni] && prvni !== 'nastenky') return false;
    clearTimeout(this.casovac);
    this.casovac = setTimeout(() => this.nacist().catch(() => {}), 120);
    this.casovac.unref?.();
    return true;
  }

  trezor() {
    return String(this.nastaveni().OBSIDIAN_TREZOR || '').trim() || path.basename(this.c.koren);
  }

  najit = (id) => this.entity.get(id);

  /** Seznam pro mapu (bez textu karet). */
  seznam(pohled = 'dm') {
    const p = POHLEDY.includes(pohled) ? pohled : 'dm';
    const entity = [...this.entity.values()].map((e) => vPohledu(e, p, this.najit)).filter(Boolean);
    return {
      pohled: p,
      verze: this.verze,
      entity,
      nastenky: [...this.nastenky.values()].map((n) => ({ ...n, entity: undefined, pocet: n.entity.length })),
      chyby: p === 'dm' ? this.chyby : [],
    };
  }

  /** Karta jedné entity s textem pro daný pohled. */
  karta(id, pohled = 'dm') {
    const e = this.entity.get(id);
    const p = POHLEDY.includes(pohled) ? pohled : 'dm';
    const v = e ? vPohledu(e, p, this.najit) : null;
    if (!v) throw chyba('Entita neexistuje.', 404);
    // Kdo na entitu odkazuje (vazbou nebo vztahem) — v pohledu družiny jen veřejné vztahy.
    const odkazujici = [];
    for (const jina of this.entity.values()) {
      if (jina.id === id) continue;
      const jv = vPohledu(jina, p, this.najit);
      if (!jv) continue;
      const vztah = jv.vztahy.find((x) => x.s === id);
      if (vztah || jv.vazby.includes(id)) odkazujici.push({ id: jina.id, vztah: vztah ?? null });
    }
    const telo = p === 'druzina' ? teloDruziny(e.telo, e.typ) : e.telo;
    return {
      ...v,
      telo,
      odkazujici,
      odkazyVTextu: p === 'dm' ? e.odkazyVTextu.filter((x) => this.entity.has(x)) : [],
      obsidian: p === 'dm' ? odkazObsidian(this.trezor(), e.soubor) : null,
    };
  }

  get(id) {
    const e = this.entity.get(id);
    if (!e) throw chyba('Entita neexistuje.', 404);
    return e;
  }

  /** Úprava hlavičky jedné karty přes frontu zápisu (zamčený soubor = odložený zápis). */
  async upravitHlavicku(id, zmenyZEntity) {
    const e = this.get(id);
    const soubor = path.join(this.c.koren, ...e.soubor.split('/'));
    const { vysledek, obsah } = await this.zapisovac.upravit(soubor, (text) => {
      // Změna se počítá z posledního obsahu na disku, ne z paměti: Obsidian mohl mezitím uložit.
      const aktualni = nacistEntitu(text, { slozka: e.slozka, soubor: e.soubor, slozkaEntity: e.slozkaEntity });
      const zmeny = zmenyZEntity(aktualni);
      return zmeny ? upravitKartu(text, zmeny) : text;
    });
    const nova = nacistEntitu(obsah, { slozka: e.slozka, soubor: e.soubor, slozkaEntity: e.slozkaEntity });
    this.entity.set(id, nova);
    this.oznam();
    return { vysledek, karta: this.karta(id) };
  }

  overitCil(id, cil) {
    if (!SLUG.test(String(cil))) throw chyba('Neplatné id cíle.');
    if (cil === id) throw chyba('Entita nemůže mít vazbu sama na sebe.');
    if (!this.entity.has(cil)) throw chyba(`Entita „${cil}“ neexistuje.`, 404);
  }

  /** Přepínače a přezdívky: { verejne?, aktualni?, aliases? } */
  async nastavit(id, telo) {
    const zmeny = {};
    if ('verejne' in telo) {
      if (typeof telo.verejne !== 'boolean') throw chyba('verejne musí být true nebo false.');
      zmeny.verejne = telo.verejne;
    }
    let aliasy = null;
    if ('aliases' in telo) {
      if (!Array.isArray(telo.aliases)) throw chyba('Přezdívky musí být seznam.');
      aliasy = [];
      for (const a of telo.aliases) {
        const t = String(a ?? '').replace(/\s+/g, ' ').trim();
        if (!t) continue;
        if (t.length > 80) throw chyba('Přezdívka je příliš dlouhá (nejvýš 80 znaků).');
        if (!aliasy.includes(t)) aliasy.push(t);
      }
      if (aliasy.length > MAX_ALIASU) throw chyba(`Nejvýš ${MAX_ALIASU} přezdívek.`);
    }
    if ('aktualni' in telo && typeof telo.aktualni !== 'boolean') throw chyba('aktualni musí být true nebo false.');
    if (!Object.keys(zmeny).length && !aliasy && !('aktualni' in telo)) throw chyba('Není co změnit.');
    return this.upravitHlavicku(id, (e) => {
      const z = { ...zmeny };
      if (z.verejne === e.verejne) delete z.verejne;
      if (aliasy && JSON.stringify(aliasy) !== JSON.stringify(e.aliases)) z.aliases = aliasy;
      if ('aktualni' in telo && telo.aktualni !== e.aktualni) {
        z.tags = telo.aktualni ? [...e.tags, STITEK_VE_HRE] : e.tags.filter((t) => t !== STITEK_VE_HRE);
      }
      return Object.keys(z).length ? z : null;
    });
  }

  /** Přidá vazbu (bez popisu). */
  async pridatVazbu(id, cil) {
    this.overitCil(id, cil);
    return this.upravitHlavicku(id, (e) => (e.vazby.includes(cil) ? null : { vazby: [...e.vazby, cil] }));
  }

  /** Odebere vazbu i vztahy ke stejnému cíli (vztah bez vazby by Kontrola dat hlásila, bod 100). */
  async odebratVazbu(id, cil) {
    this.get(id);
    return this.upravitHlavicku(id, (e) => {
      const z = {};
      if (e.vazby.includes(cil)) z.vazby = e.vazby.filter((x) => x !== cil);
      if (e.vztahy.some((v) => v.s === cil)) z.vztahy = e.vztahy.filter((v) => v.s !== cil);
      return Object.keys(z).length ? z : null;
    });
  }

  /**
   * Založí nebo upraví vztah k cíli (rozhodnutí 70). Hub zapisuje obojí: vztah i vazbu.
   * @param {{popis: string, postoj?: number|null, verejne?: boolean}} telo
   */
  async nastavitVztah(id, cil, telo) {
    this.overitCil(id, cil);
    const popis = String(telo?.popis ?? '').replace(/\s+/g, ' ').trim();
    if (!popis) throw chyba('Vztah potřebuje popis (např. „adoptivní otec“).');
    if (popis.length > 200) throw chyba('Popis vztahu je příliš dlouhý (nejvýš 200 znaků).');
    const postoj = telo.postoj === null || telo.postoj === undefined || telo.postoj === '' ? null : Number(telo.postoj);
    if (postoj !== null && !(Number.isInteger(postoj) && postoj >= -3 && postoj <= 3)) throw chyba('Postoj je celé číslo −3 až +3.');
    if ('verejne' in telo && typeof telo.verejne !== 'boolean') throw chyba('verejne musí být true nebo false.');
    return this.upravitHlavicku(id, (e) => {
      const i = e.vztahy.findIndex((v) => v.s === cil);
      const novy = { s: cil, popis, postoj, verejne: 'verejne' in telo ? telo.verejne : (e.vztahy[i]?.verejne ?? false) };
      const vztahy = [...e.vztahy];
      if (i === -1) vztahy.push(novy);
      else vztahy[i] = novy;
      const z = { vztahy };
      if (!e.vazby.includes(cil)) z.vazby = [...e.vazby, cil];
      return z;
    });
  }

  /** Odebere vztah, vazba zůstane (čára na mapě bez popisu). */
  async odebratVztah(id, cil) {
    this.get(id);
    return this.upravitHlavicku(id, (e) => (e.vztahy.some((v) => v.s === cil) ? { vztahy: e.vztahy.filter((v) => v.s !== cil) } : null));
  }

  /**
   * Nadřazené místo (⚠ bod 116): `cil` = id místa, nebo null (místo nikam nepatří).
   * Jen místo v místě, jeden rodič, bez cyklu (Mirabar nesmí ležet v komoře, která leží v Mirabaru).
   */
  async nastavitLeziV(id, cil) {
    const e = this.get(id);
    if (e.typ !== 'misto') throw chyba('Leží v jde nastavit jen u místa.');
    if (cil !== null) {
      this.overitCil(id, cil);
      if (this.entity.get(cil).typ !== 'misto') throw chyba('Místo může ležet jen v jiném místě.');
      for (let m = this.entity.get(cil), kroku = 0; m && kroku < 100; m = m.leziV ? this.entity.get(m.leziV) : null, kroku++) {
        if (m.id === id) throw chyba(`${this.entity.get(cil).nazev} leží v ${e.nazev}, nemůže být zároveň naopak.`);
      }
    }
    return this.upravitHlavicku(id, (a) => ((a.leziV ?? null) === cil ? null : { lezi_v: cil }));
  }

  nastenka(id) {
    const n = this.nastenky.get(id);
    if (!n) throw chyba('Nástěnka neexistuje.', 404);
    return n;
  }

  /**
   * Uloží rozložení mapy jako nástěnku (kampan/nastenky/<id>.yaml).
   * @param {{nazev: string, pohled?: string, jen_tyto?: boolean, entity: Array<{id, x, y}>}} telo
   */
  async ulozitNastenku(idNebo, telo) {
    const nazev = String(telo?.nazev ?? '').replace(/\s+/g, ' ').trim();
    if (!nazev || nazev.length > 80) throw chyba('Nástěnka potřebuje název (nejvýš 80 znaků).');
    let id = idNebo;
    if (!id) {
      // Nová nástěnka: jméno souboru z názvu, existující se nepřepíše (mapa-2, mapa-3 …).
      const zaklad = slugNastenky(nazev);
      if (!SLUG.test(zaklad)) throw chyba('Z názvu nejde udělat jméno souboru. Použij písmena nebo číslice.');
      id = zaklad;
      for (let i = 2; this.nastenky.has(id); i++) id = `${zaklad}-${i}`;
    } else if (!SLUG.test(id)) throw chyba('Neplatné jméno nástěnky.');
    if (!this.nastenky.has(id) && this.nastenky.size >= MAX_NASTENEK) throw chyba(`Nejvýš ${MAX_NASTENEK} nástěnek.`);
    const n = normalizujNastenku(id, { ...telo, nazev });
    n.entity = n.entity.filter((x) => this.entity.has(x.id));
    if (!n.entity.length) throw chyba('Na mapě není žádná entita k uložení.');
    const data = { nazev: n.nazev, pohled: n.pohled, jen_tyto: n.jen_tyto, entity: n.entity.map((x) => ({ id: x.id, x: x.x, y: x.y })) };
    const text = `# Nástěnka mapy kánonu (rozhodnutí 69). Ukládá ji Hub tlačítkem Uložit rozložení.\n${YAML.stringify(data, { lineWidth: 0, collectionStyle: 'block' }).replace(/^ {2}- id: (.*)\n {4}x: (.*)\n {4}y: (.*)$/gm, '  - { id: $1, x: $2, y: $3 }')}`;
    await fs.mkdir(this.slozkaNastenek, { recursive: true });
    const soubor = path.join(this.slozkaNastenek, `${id}.yaml`);
    // Celý soubor patří Hubu (pozice uzlů), proto zápis celého obsahu, atomicky.
    const { vysledek } = await this.zapisovac.zapsat(soubor, text);
    this.nastenky.set(id, n);
    this.oznam();
    return { vysledek, nastenka: n };
  }

  async smazatNastenku(id) {
    this.nastenka(id);
    await fs.rm(path.join(this.slozkaNastenek, `${id}.yaml`), { force: true });
    this.nastenky.delete(id);
    this.oznam();
    return { ok: true };
  }
}
