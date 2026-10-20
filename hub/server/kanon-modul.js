// Modul Kánon (Blok 3, rozhodnutí 69–71, body 99–102): síť entit z kampan/, karta vybrané entity,
// pohled družiny, malé úpravy hlavičky a nástěnky (uložená rozložení mapy).
//
// Hub čte všechny karty ze složek typů (TYPY_SLOZEK). Od 20. 10. 2026 je kánon wiki s plným
// editorem: Hub mění text karty i pole hlavičky (hlavicka.js mění jen měněné řádky), u místa i `lezi_v`,
// zakládá karty ze šablon a odkrývá jednotlivé odrážky oddílu Co ví družina. Obsidian funguje souběžně.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import YAML from 'yaml';
import { rozebrat, odkazy } from './frontmatter.js';
import { TYPY_SLOZEK } from './cesty.js';
import { upravitKartu, idZOdkazu, normalizujVztah, teloKarty, nahraditTelo, TEXTOVA_POLE } from './hlavicka.js';
import { PRIPONA_DOCASNA, zapsatAtomicky } from './zapis.js';
import { Harptos } from '../sdilene/harptos.js';
import { STAVY_ROZHODNUTI } from './data.js';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const STITEK_VE_HRE = 'aktualni';
export const ODDIL_DRUZINY = 'Co ví družina';
export const POHLEDY = Object.freeze(['dm', 'druzina']);
const MAX_ALIASU = 20;
const MAX_NASTENEK = 50;
const OBRAZEK = /\.(png|jpe?g|webp)$/i;
/** Typy, které jde v Hubu založit (sezení zakládá Zahájit sezení). */
export const TYPY_NOVE = Object.freeze(['postava', 'npc', 'padouch', 'frakce', 'misto', 'predmet', 'bytost', 'rozhodnuti', 'kanon']);
const SLOZKA_TYPU = Object.fromEntries(Object.entries(TYPY_SLOZEK).map(([slozka, typ]) => [typ, slozka]));
const ZAZNAMY = new Set(['rozhodnuti', 'kanon']);
const MAX_PORTRET = 15 * 1024 * 1024;
export const hashTela = (telo) => crypto.createHash('sha1').update(String(telo)).digest('hex').slice(0, 16);

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

/** Značka odkryté odrážky: komentář Obsidianu, v náhledu není vidět. */
export const ZNACKA_ZNA = '%%zná%%';
const ZNACKA = /[ \t]*%%\s*zn[aá]\s*%%/gi;
const ma = (text) => /%%\s*zn[aá]\s*%%/i.test(text);
export const bezZnacek = (text) => String(text ?? '').replace(ZNACKA, '');
/** Komentáře Obsidianu %%…%% se nikde neukazují (ani v pohledu družiny). */
const bezKomentaru = (text) => String(text ?? '').replace(/%%[\s\S]*?%%/g, '').replace(/[ \t]+$/gm, '');

const NADPIS = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const ODRAZKA = /^( ?)([-*+]|\d+[.)])\s+/;

/** Řádky oddílu Co ví družina v těle karty: { od (nadpis), do, uroven }, nebo null. */
export function najitOddilDruziny(radky) {
  let od = -1;
  let uroven = 0;
  let vKodu = false;
  for (let i = 0; i < radky.length; i++) {
    if (/^\s*(```|~~~)/.test(radky[i])) vKodu = !vKodu;
    const m = !vKodu && NADPIS.exec(radky[i]);
    if (!m) continue;
    if (od >= 0 && m[1].length <= uroven) return { od, do: i, uroven };
    if (od < 0 && jeOddilDruziny(m[2])) {
      od = i;
      uroven = m[1].length;
    }
  }
  return od >= 0 ? { od, do: radky.length, uroven } : null;
}

/**
 * Bloky oddílu Co ví družina (rozhodnutí DM 20. 10. 2026): každá odrážka a každý odstavec se
 * odkrývá zvlášť. Odkrytý blok má na prvním řádku značku %%zná%%, bez ní ho družina nevidí.
 * Pododdíl s nadpisem DM… je vždy jen pro DM.
 * @returns {Array<{index: number, druh: 'odrazka'|'odstavec'|'nadpis', od: number, do: number, text: string, zna: boolean, dm: boolean, uroven?: number}>}
 *   od/do = řádky v těle karty, index = pořadí mezi bloky, které jde odkrýt
 */
export function blokyDruziny(telo) {
  const radky = String(telo ?? '').split('\n');
  const oddil = najitOddilDruziny(radky);
  if (!oddil) return [];
  const bloky = [];
  let blok = null;
  let dmUroven = 0;
  let index = 0;
  const ukoncit = (i) => {
    if (!blok) return;
    blok.do = i;
    const text = radky.slice(blok.od, i).join('\n');
    blok.zna = !blok.dm && ma(text);
    blok.text = bezZnacek(text).replace(/\s+$/, '');
    if (blok.druh === 'odrazka') blok.text = blok.text.replace(ODRAZKA, '');
    // Samotný komentář Obsidianu (nápověda ze šablony) není nic, co by se dalo odkrýt.
    if (bezKomentaru(blok.text).trim()) bloky.push(blok);
    else if (blok.index >= 0) index--;
    blok = null;
  };
  for (let i = oddil.od + 1; i < oddil.do; i++) {
    const r = radky[i];
    const nadpis = NADPIS.exec(r);
    if (nadpis) {
      ukoncit(i);
      const uroven = nadpis[1].length;
      if (dmUroven && uroven <= dmUroven) dmUroven = 0;
      if (!dmUroven && jeOddilDm(nadpis[2])) dmUroven = uroven;
      bloky.push({ index: -1, druh: 'nadpis', od: i, do: i + 1, text: nadpis[2], uroven, zna: false, dm: Boolean(dmUroven) });
      continue;
    }
    if (!r.trim()) {
      ukoncit(i);
      continue;
    }
    if (ODRAZKA.test(r)) {
      ukoncit(i);
      blok = { index: dmUroven ? -1 : index++, druh: 'odrazka', od: i, dm: Boolean(dmUroven) };
      continue;
    }
    // Pokračování odrážky (odsazený řádek nebo vnořená odrážka) zůstává v ní.
    if (blok && (blok.druh === 'odstavec' || /^\s{2,}/.test(r))) continue;
    ukoncit(i);
    blok = { index: dmUroven ? -1 : index++, druh: 'odstavec', od: i, dm: Boolean(dmUroven) };
  }
  ukoncit(oddil.do);
  return bloky;
}

/** Odkryje nebo skryje jeden blok Co ví družina; vrátí nové tělo. */
export function prepnoutBlok(telo, index, zna) {
  const blok = blokyDruziny(telo).find((b) => b.index === index);
  if (!blok) throw chyba('Tahle část oddílu Co ví družina neexistuje (karta se mezitím změnila?).', 409);
  const radky = String(telo).split('\n');
  for (let i = blok.od; i < blok.do; i++) radky[i] = bezZnacek(radky[i]);
  if (zna) radky[blok.od] = `${radky[blok.od].replace(/\s+$/, '')} ${ZNACKA_ZNA}`;
  return radky.join('\n');
}

/** Přidá odrážku na konec oddílu Co ví družina (oddíl založí, když chybí). */
export function pridatBlok(telo, text, zna) {
  const cisty = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!cisty) throw chyba('Napiš, co družina ví.');
  if (cisty.length > 600) throw chyba('Odrážka je příliš dlouhá (nejvýš 600 znaků).');
  const radek = `- ${cisty}${zna ? ` ${ZNACKA_ZNA}` : ''}`;
  const radky = String(telo ?? '').split('\n');
  const oddil = najitOddilDruziny(radky);
  if (!oddil) {
    const zaklad = String(telo ?? '').replace(/\s+$/, '');
    return `${zaklad}${zaklad ? '\n\n' : ''}## ${ODDIL_DRUZINY}\n\n${radek}\n`;
  }
  // Na konec hlavní části oddílu: před první pododdíl (ten může být DM…), za poslední neprázdný řádek.
  let kam = oddil.do;
  for (let i = oddil.od + 1; i < oddil.do; i++) {
    if (NADPIS.test(radky[i])) {
      kam = i;
      break;
    }
  }
  while (kam > oddil.od + 1 && !radky[kam - 1].trim()) kam--;
  const predchozi = radky[kam - 1] ?? '';
  const vlozit = kam === oddil.od + 1 || (!ODRAZKA.test(predchozi) && !/^\s{2,}/.test(predchozi)) ? ['', radek] : [radek];
  radky.splice(kam, 0, ...vlozit);
  return radky.join('\n');
}

/**
 * Text, který smí vidět družina. Z oddílu Co ví družina jen odkryté bloky (a nadpisy nad nimi),
 * nic jiného. Hráčský kánon (typ kanon) je záznam toho, co družina zažila: ukáže se celý kromě
 * oddílů DM. Komentáře Obsidianu %%…%% se vynechají vždy.
 */
export function teloDruziny(telo, typ) {
  if (typ === 'kanon') {
    const vystup = [];
    let vynechUroven = 0;
    for (const o of oddily(telo)) {
      if (o.nadpis !== null) {
        if (vynechUroven && o.uroven <= vynechUroven) vynechUroven = 0;
        if (!vynechUroven && jeOddilDm(o.nadpis)) vynechUroven = o.uroven;
      }
      if (!vynechUroven) vystup.push(o.text);
    }
    return bezKomentaru(vystup.join('\n')).trim();
  }
  const radky = String(telo ?? '').split('\n');
  const oddil = najitOddilDruziny(radky);
  if (!oddil) return '';
  const bloky = blokyDruziny(telo);
  if (!bloky.some((b) => b.zna)) return '';
  const vystup = [radky[oddil.od], ''];
  bloky.forEach((b, i) => {
    if (b.druh === 'nadpis') {
      // Nadpis jen tehdy, když pod ním (před dalším nadpisem stejné nebo vyšší úrovně) je něco odkrytého.
      const dalsi = bloky.slice(i + 1);
      const konec = dalsi.findIndex((x) => x.druh === 'nadpis' && x.uroven <= b.uroven);
      if (!b.dm && (konec === -1 ? dalsi : dalsi.slice(0, konec)).some((x) => x.zna)) vystup.push('', radky[b.od]);
      return;
    }
    if (!b.zna) return;
    vystup.push(...(b.druh === 'odstavec' ? ['', bezKomentaru(radky.slice(b.od, b.do).join('\n'))] : [bezKomentaru(radky.slice(b.od, b.do).join('\n'))]));
  });
  return vystup.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Tělo bez oddílu Co ví družina (wiki ho ukazuje zvlášť, po odrážkách). */
export function teloBezDruziny(telo) {
  const radky = String(telo ?? '').split('\n');
  const oddil = najitOddilDruziny(radky);
  if (!oddil) return String(telo ?? '');
  radky.splice(oddil.od, oddil.do - oddil.od);
  return radky.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** Krátký popis do seznamu karet: první odstavec textu bez formátování. */
export function kratkyPopis(text, max = 170) {
  for (const odstavec of String(text ?? '').split(/\n\s*\n/)) {
    const t = bezKomentaru(odstavec)
      .split('\n')
      .filter((r) => r.trim() && !NADPIS.test(r) && !/^\s*(```|~~~|\||---)/.test(r))
      .map((r) => r.replace(/^\s*(>\s*)+/, '').replace(ODRAZKA, ''))
      .join(' ')
      .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, id, popisek) => popisek ?? id)
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*_~`]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (t) return t.length > max ? `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : t;
  }
  return '';
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
export function nacistEntitu(text, { slozka, soubor, slozkaEntity, upraveno = null }) {
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
    pole: {},
    telo: r.telo,
    upraveno,
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
  // Pole pro editor karty (surové hodnoty z hlavičky).
  for (const pole of TEXTOVA_POLE) if (pole in d) entita.pole[pole] = textovePole(d[pole]) ?? '';
  if ('doresit' in d) entita.pole.doresit = d.doresit === true;
  if ('kdo' in d) entita.pole.kdo = (Array.isArray(d.kdo) ? d.kdo : []).map(String);
  entita.kdo = (Array.isArray(d.kdo) ? d.kdo : []).map(String).filter(Boolean);
  // Kolik z oddílu Co ví družina je odkryté (mapa: rozložení Co družina ví).
  const bloky = blokyDruziny(r.telo).filter((b) => b.index >= 0);
  entita.odkryto = { zna: bloky.filter((b) => b.zna).length, celkem: bloky.length };
  entita.popis = kratkyPopis(teloBezDruziny(r.telo));
  entita.popisDruziny = kratkyPopis(teloDruziny(r.telo, entita.typ));
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
      kdo: e.kdo ?? [], odkryto: e.odkryto ?? { zna: 0, celkem: 0 },
      obrazek: obrazekUzlu(obrazky)?.url ?? null, portret: obrazekUzlu(obrazky)?.ucel === 'portret', obrazky,
      popis: e.popis, upraveno: e.upraveno,
    };
  }
  if (!e.verejne) return null;
  const obrazky = e.obrazky.filter((o) => !o.skryta);
  const vztahy = e.vztahy.filter((v) => v.verejne && najit(v.s)?.verejne);
  return {
    id: e.id, typ: e.typ, nazev: e.nazev, verejne: true, ikona: e.ikona, aliases: [], tags: [], aktualni: false,
    vazby: vztahy.map((v) => v.s), vztahy, udaje: {}, soubor: null,
    // Hráčský kánon je celý pro družinu, včetně toho, koho se týká.
    kdo: e.typ === 'kanon' ? e.kdo ?? [] : [], odkryto: null,
    // Kde místo leží, družina ví, když zná obě místa.
    leziV: e.leziV && najit(e.leziV)?.verejne ? e.leziV : null,
    obrazek: obrazekUzlu(obrazky)?.url ?? null, portret: obrazekUzlu(obrazky)?.ucel === 'portret', obrazky,
    popis: e.popisDruziny, upraveno: null,
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
  constructor({ cesty, zapisovac, nastaveni = () => ({}), kalendar = null }) {
    super();
    this.c = cesty;
    this.zapisovac = zapisovac;
    this.nastaveni = nastaveni;
    /** Kalendář (události s vazbami na karty). */
    this.kalendar = kalendar;
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
        let upraveno;
        try {
          const cesta = path.join(this.c.koren, ...soubor.split('/'));
          text = await fs.readFile(cesta, 'utf8');
          upraveno = (await fs.stat(cesta)).mtime.toISOString();
        } catch {
          continue; // složka bez hlavního souboru (jen obrázky)
        }
        try {
          const e = nacistEntitu(text, { slozka, soubor, slozkaEntity, upraveno });
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
    // Hromadná úprava ohlásí změnu jednou na konci, ne po každé kartě.
    if (this.ticho) {
      this.cekaOznameni = true;
      return;
    }
    this.verze++;
    this.emit('zmena', { verze: this.verze });
  }

  /**
   * Hromadná úprava přepínačů na mapě (výběr víc uzlů): { ids, verejne?, aktualni? }.
   * Karty se mění jedna po druhé přes frontu zápisu; chyba jedné nezastaví ostatní.
   * @returns {Promise<{zmeneno: number, odlozeno: number, chyby: Array<{id: string, chyba: string}>}>}
   */
  async nastavitHromadne(telo) {
    const ids = Array.isArray(telo?.ids) ? [...new Set(telo.ids.map(String))] : [];
    if (!ids.length) throw chyba('Není vybraná žádná karta.');
    if (ids.length > 300) throw chyba('Nejvýš 300 karet najednou.');
    const zmeny = {};
    for (const klic of ['verejne', 'aktualni']) {
      if (!(klic in telo)) continue;
      if (typeof telo[klic] !== 'boolean') throw chyba(`${klic} musí být true nebo false.`);
      zmeny[klic] = telo[klic];
    }
    if (!Object.keys(zmeny).length) throw chyba('Není co změnit (verejne nebo aktualni).');
    const vysledek = { zmeneno: 0, odlozeno: 0, chyby: [] };
    this.ticho = true;
    try {
      for (const id of ids) {
        const e = this.entity.get(id);
        if (!e) {
          vysledek.chyby.push({ id, chyba: 'Entita neexistuje.' });
          continue;
        }
        const potreba = ('verejne' in zmeny && e.verejne !== zmeny.verejne) || ('aktualni' in zmeny && e.aktualni !== zmeny.aktualni);
        if (!potreba) continue;
        try {
          const r = await this.nastavit(id, zmeny);
          vysledek.zmeneno++;
          if (r.vysledek === 'odlozeno') vysledek.odlozeno++;
        } catch (err) {
          vysledek.chyby.push({ id, chyba: err.message });
        }
      }
    } finally {
      this.ticho = false;
      if (this.cekaOznameni) {
        this.cekaOznameni = false;
        this.oznam();
      }
    }
    return vysledek;
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

  /**
   * Události kalendáře pro daný pohled (vazby jen na entity, které pohled zná).
   * Družina vidí jen veřejné události.
   */
  udalosti(pohled = 'dm') {
    const vsechny = this.kalendar?.udalosti ?? [];
    return vsechny
      .filter((u) => pohled === 'dm' || u.verejna)
      .map((u) => ({
        id: u.id,
        datum: u.datum,
        konec: u.konec ?? null,
        datumText: Harptos.format(u.datum),
        konecText: u.konec ? Harptos.format(u.konec) : null,
        text: u.text,
        verejna: u.verejna,
        vazby: (u.vazby ?? []).filter((id) => {
          const e = this.entity.get(id);
          return e && (pohled === 'dm' || e.verejne);
        }),
        poradi: Harptos.absolutni(u.datum),
      }))
      .sort((a, b) => a.poradi - b.poradi)
      // Pořadí v rámci dne (víc událostí téhož dne): podle pořadí zápisu, mění se v Kalendáři.
      .map((u, i, vse) => {
        const den = vse.filter((x) => x.poradi === u.poradi);
        return { ...u, vDni: den.indexOf(u) + 1, vDniPocet: den.length, index: i };
      });
  }

  /**
   * Hráčský kánon v čase: karty typu kanon v pořadí událostí, na které jsou navázané
   * (událost po události, v rámci události v pořadí jejích vazeb). Karta bez události v řadě není.
   * @returns {Array<{id: string, nazev: string, udalost: object}>}
   */
  chronologie(pohled = 'dm') {
    const videno = new Set();
    const rada = [];
    for (const u of this.udalosti(pohled)) {
      for (const id of u.vazby) {
        const e = this.entity.get(id);
        if (e?.typ !== 'kanon' || videno.has(id)) continue;
        videno.add(id);
        rada.push({ id, nazev: e.nazev, udalost: { id: u.id, text: u.text, datumText: u.datumText, vDni: u.vDni, vDniPocet: u.vDniPocet } });
      }
    }
    return rada;
  }

  /** Místa, která v místě leží (i hlouběji), v daném pohledu. Map id → id přímého podmísta cesty. */
  podmistaVPohledu(id, pohled) {
    const deti = new Map();
    for (const e of this.entity.values()) {
      const v = vPohledu(e, pohled, this.najit);
      if (v?.leziV) deti.set(v.leziV, [...(deti.get(v.leziV) ?? []), e.id]);
    }
    const vysledek = new Map();
    const fronta = [id];
    while (fronta.length && vysledek.size < 500) {
      const m = fronta.shift();
      for (const d of deti.get(m) ?? []) {
        if (d === id || vysledek.has(d)) continue;
        vysledek.set(d, d);
        fronta.push(d);
      }
    }
    return vysledek;
  }

  /** Seznam pro wiki a mapu (bez textu karet). */
  seznam(pohled = 'dm') {
    const p = POHLEDY.includes(pohled) ? pohled : 'dm';
    const entity = [...this.entity.values()].map((e) => vPohledu(e, p, this.najit)).filter(Boolean);
    return {
      pohled: p,
      verze: this.verze,
      entity,
      udalosti: this.udalosti(p),
      typyNove: p === 'dm' ? TYPY_NOVE : [],
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
    // Oddíl Co ví družina wiki ukazuje po odrážkách; DM vidí všechny, družina jen odkryté.
    const bloky = blokyDruziny(e.telo);
    const druzina = (p === 'dm' ? bloky : bloky.filter((b) => b.zna || (b.druh === 'nadpis' && !b.dm))).map((b) => ({
      index: b.index, druh: b.druh, text: b.druh === 'nadpis' || p === 'dm' ? b.text : bezKomentaru(b.text), zna: b.zna, dm: b.dm, uroven: b.uroven,
    }));
    // Družině nadpisy bez odkrytého obsahu pod sebou nic neřeknou.
    const druzinaCista = p === 'dm'
      ? druzina
      : druzina.filter((b, i) => {
        if (b.druh !== 'nadpis') return true;
        const dalsi = druzina.slice(i + 1);
        const konec = dalsi.findIndex((x) => x.druh === 'nadpis' && x.uroven <= b.uroven);
        return (konec === -1 ? dalsi : dalsi.slice(0, konec)).some((x) => x.druh !== 'nadpis');
      });
    // Místo: události a hráčský kánon i z míst, která v něm leží (pres = id podmísta).
    const podmista = e.typ === 'misto' ? this.podmistaVPohledu(id, p) : new Map();
    const udalosti = this.udalosti(p)
      .map((u) => ({ ...u, pres: u.vazby.includes(id) ? null : u.vazby.find((x) => podmista.has(x)) ?? undefined }))
      .filter((u) => u.pres !== undefined);
    let zde = null;
    if (e.typ === 'misto') {
      const poradi = new Map(this.chronologie(p).map((x, i) => [x.id, x]));
      zde = [];
      for (const jina of this.entity.values()) {
        if (jina.typ !== 'kanon') continue;
        const jv = vPohledu(jina, p, this.najit);
        if (!jv) continue;
        const pres = jv.vazby.includes(id) ? null : jv.vazby.find((x) => podmista.has(x));
        if (pres === undefined) continue;
        zde.push({ id: jina.id, nazev: jina.nazev, pres, udalost: poradi.get(jina.id)?.udalost ?? null });
      }
      const klic = [...poradi.keys()];
      zde.sort((a, b) => (klic.indexOf(a.id) + 1 || 1e9) - (klic.indexOf(b.id) + 1 || 1e9) || a.nazev.localeCompare(b.nazev, 'cs'));
    }
    let telo;
    if (p === 'dm') telo = teloBezDruziny(e.telo);
    else telo = e.typ === 'kanon' ? teloDruziny(e.telo, e.typ) : '';
    return {
      ...v,
      telo,
      druzina: druzinaCista,
      maOddilDruziny: Boolean(najitOddilDruziny(e.telo.split('\n'))),
      udalosti,
      chronologie: e.typ === 'kanon' ? this.chronologieKarty(id, p) : null,
      zde,
      pole: p === 'dm' ? e.pole : {},
      odkazujici,
      odkazyVTextu: p === 'dm' ? e.odkazyVTextu.filter((x) => this.entity.has(x)) : [],
      obsidian: p === 'dm' ? odkazObsidian(this.trezor(), e.soubor) : null,
    };
  }

  /** Kdy se záznam hráčského kánonu stal a co bylo před ním a po něm. */
  chronologieKarty(id, pohled) {
    const rada = this.chronologie(pohled);
    const i = rada.findIndex((x) => x.id === id);
    if (i < 0) return { udalost: null, predtim: null, potom: null };
    return { udalost: rada[i].udalost, predtim: rada[i - 1] ?? null, potom: rada[i + 1] ?? null };
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
    const nova = nacistEntitu(obsah, { slozka: e.slozka, soubor: e.soubor, slozkaEntity: e.slozkaEntity, upraveno: new Date().toISOString() });
    this.entity.set(id, nova);
    this.oznam();
    return { vysledek, karta: this.karta(id) };
  }

  /** Celý soubor karty přes frontu zápisu: uprava(text, entita) vrátí nový text. */
  async upravitSoubor(id, uprava) {
    const e = this.get(id);
    const soubor = path.join(this.c.koren, ...e.soubor.split('/'));
    const { vysledek, obsah } = await this.zapisovac.upravit(soubor, (text) => uprava(text, nacistEntitu(text, { slozka: e.slozka, soubor: e.soubor, slozkaEntity: e.slozkaEntity })));
    this.entity.set(id, nacistEntitu(obsah, { slozka: e.slozka, soubor: e.soubor, slozkaEntity: e.slozkaEntity, upraveno: new Date().toISOString() }));
    this.oznam();
    return { vysledek, obsah, karta: this.karta(id) };
  }

  /** Pole hlavičky z editoru (název, ikona, hráč, druh, stav …) po kontrole. */
  overitPole(e, telo) {
    const z = {};
    for (const pole of TEXTOVA_POLE) {
      if (!(pole in telo)) continue;
      const t = String(telo[pole] ?? '').replace(/\s+/g, ' ').trim();
      if (pole === 'nazev' && !t) throw chyba('Karta potřebuje název.');
      if (t.length > (pole === 'nazev' ? 120 : 200)) throw chyba(`Pole ${pole} je příliš dlouhé.`);
      if (pole === 'ikona' && [...t].length > 4) throw chyba('Ikona je jeden emoji znak.');
      if (pole === 'stav' && e.typ === 'rozhodnuti' && !STAVY_ROZHODNUTI.includes(t)) throw chyba(`Stav rozhodnutí je ${STAVY_ROZHODNUTI.join(', ')}.`);
      if (pole === 'oblast' && t && !SLUG.test(t)) throw chyba('Oblast je kampan, nebo id postavy.');
      if ((e.pole[pole] ?? '') !== t) z[pole] = t;
    }
    if ('doresit' in telo) {
      if (typeof telo.doresit !== 'boolean') throw chyba('doresit musí být true nebo false.');
      if (telo.doresit !== (e.pole.doresit ?? false)) z.doresit = telo.doresit;
    }
    if ('kdo' in telo) {
      if (!Array.isArray(telo.kdo)) throw chyba('Kdo musí být seznam.');
      const kdo = [...new Set(telo.kdo.map((x) => String(x ?? '').trim()).filter(Boolean))].slice(0, 20);
      if (kdo.some((x) => x.length > 60)) throw chyba('Položka Kdo je příliš dlouhá.');
      if (JSON.stringify(kdo) !== JSON.stringify(e.pole.kdo ?? [])) z.kdo = kdo;
    }
    return z;
  }

  /** Text karty a pole hlavičky pro editor. hash slouží ke kontrole souběžné úpravy v Obsidianu. */
  async zdroj(id) {
    const e = this.get(id);
    const text = await fs.readFile(path.join(this.c.koren, ...e.soubor.split('/')), 'utf8');
    const telo = teloKarty(text);
    const aktualni = nacistEntitu(text, { slozka: e.slozka, soubor: e.soubor, slozkaEntity: e.slozkaEntity });
    return { id, typ: e.typ, telo, hash: hashTela(telo), pole: aktualni.pole, aliases: aktualni.aliases, slozkaEntity: e.slozkaEntity };
  }

  /**
   * Uloží text karty (a případně pole hlavičky) z editoru. Když se text na disku mezitím změnil
   * (Obsidian), vrátí 409 s aktuálním textem a nic nepřepíše, ledaže přijde prepsat: true.
   * @param {{telo?: string, zaklad?: string, prepsat?: boolean, pole?: object}} vstup
   */
  async ulozitZdroj(id, vstup) {
    const e = this.get(id);
    if (vstup.telo !== undefined && typeof vstup.telo !== 'string') throw chyba('Text karty musí být text.');
    if ((vstup.telo ?? '').length > 400000) throw chyba('Text karty je příliš dlouhý.');
    let konflikt = null;
    const r = await this.upravitSoubor(id, (text, aktualni) => {
      let novy = text;
      if (vstup.telo !== undefined) {
        const telo = teloKarty(text);
        if (!vstup.prepsat && vstup.zaklad && hashTela(telo) !== vstup.zaklad) {
          konflikt = { telo, hash: hashTela(telo) };
          return text;
        }
        novy = nahraditTelo(novy, vstup.telo);
      }
      if (vstup.pole) {
        const z = this.overitPole(aktualni, vstup.pole);
        if (Object.keys(z).length) novy = upravitKartu(novy, z);
      }
      return novy;
    });
    if (konflikt) {
      throw Object.assign(new Error('Karta se mezitím změnila jinde (Obsidian?). Načti její novou podobu, nebo ji přepiš svou.'), { status: 409, kod: 'konflikt', ...konflikt });
    }
    return { vysledek: r.vysledek, hash: hashTela(teloKarty(r.obsah)), karta: r.karta, nazev: e.nazev };
  }

  /** Odkryje nebo skryje jednu odrážku Co ví družina. */
  async prepnoutDruzinu(id, index, zna) {
    if (!Number.isInteger(index) || index < 0) throw chyba('Neplatná odrážka.');
    if (typeof zna !== 'boolean') throw chyba('zna musí být true nebo false.');
    const r = await this.upravitSoubor(id, (text) => nahraditTelo(text, prepnoutBlok(teloKarty(text), index, zna)));
    return { vysledek: r.vysledek, karta: r.karta };
  }

  /** Přidá odrážku do Co ví družina. */
  async pridatDruzinu(id, text, zna = true) {
    if (typeof zna !== 'boolean') throw chyba('zna musí být true nebo false.');
    const r = await this.upravitSoubor(id, (obsah) => nahraditTelo(obsah, pridatBlok(teloKarty(obsah), text, zna)));
    return { vysledek: r.vysledek, karta: r.karta };
  }

  /**
   * Nová karta ze šablony sablony/<typ>.md (bod 98): složka entity, nebo jeden soubor záznamu.
   * @param {{typ: string, nazev: string, id?: string}} vstup
   */
  async zalozit(vstup) {
    const typ = String(vstup?.typ ?? '');
    if (!TYPY_NOVE.includes(typ)) throw chyba('Tenhle typ karty v Hubu založit nejde.');
    const nazev = String(vstup?.nazev ?? '').replace(/\s+/g, ' ').trim();
    if (!nazev || nazev.length > 120) throw chyba('Karta potřebuje název (nejvýš 120 znaků).');
    const id = vstup.id ? String(vstup.id) : slugNastenky(nazev);
    if (!SLUG.test(id)) throw chyba('Z názvu nejde udělat id. Použij písmena nebo číslice.');
    if (this.entity.has(id)) throw chyba(`Karta s id „${id}“ už existuje (${this.entity.get(id).nazev}). Zvol jiný název.`, 409);
    const slozka = SLOZKA_TYPU[typ];
    const zaznam = ZAZNAMY.has(typ);
    const soubor = zaznam ? `kampan/${slozka}/${id}.md` : `kampan/${slozka}/${id}/${id}.md`;
    const cesta = path.join(this.c.koren, ...soubor.split('/'));
    try {
      await fs.access(cesta);
      throw chyba(`Soubor ${soubor} už existuje.`, 409);
    } catch (err) {
      if (err.status) throw err;
    }
    let sablona;
    try {
      sablona = await fs.readFile(path.join(this.c.koren, 'sablony', `${typ}.md`), 'utf8');
    } catch {
      sablona = `---\nschema: 1\nid:\ntyp: ${typ}\nnazev: "{{title}}"\nverejne: false\naliases: []\nvazby: []\ntags: []\n---\n# {{title}}\n\n## ${ODDIL_DRUZINY}\n`;
    }
    const dnes = new Date().toISOString().slice(0, 10);
    let text = sablona
      .replace(/^nazev: "\{\{title\}\}"/m, () => `nazev: ${JSON.stringify(nazev)}`)
      .replace(/\{\{title\}\}/g, () => nazev)
      .replace(/\{\{date(:[^}]*)?\}\}/g, dnes);
    text = text.replace(/^id:[^\n]*$/m, () => `id: ${id}`);
    nacistEntitu(text, { slozka, soubor, slozkaEntity: !zaznam }); // pojistka: šablona musí dát platnou kartu
    await fs.mkdir(path.dirname(cesta), { recursive: true });
    const { vysledek } = await this.zapisovac.zapsat(cesta, text);
    this.entity.set(id, nacistEntitu(text, { slozka, soubor, slozkaEntity: !zaznam, upraveno: new Date().toISOString() }));
    this.oznam();
    return { vysledek, karta: this.karta(id) };
  }

  /**
   * Portrét karty z editoru: uloží se do složky entity jako portret.<přípona> a zapíše do ilustrace.
   * @param {{data: string}} vstup obrázek v base64 (PNG, JPEG nebo WebP)
   */
  async ulozitPortret(id, vstup) {
    const e = this.get(id);
    if (!e.slozkaEntity) throw chyba('Záznam (rozhodnutí, hráčský kánon) nemá vlastní složku na obrázky.');
    const data = Buffer.from(String(vstup?.data ?? ''), 'base64');
    if (data.length < 12) throw chyba('Obrázek chybí.');
    if (data.length > MAX_PORTRET) throw chyba('Obrázek je větší než 15 MB.');
    let pripona = null;
    if (data.readUInt32BE(0) === 0x89504e47) pripona = 'png';
    else if (data[0] === 0xff && data[1] === 0xd8) pripona = 'jpg';
    else if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') pripona = 'webp';
    if (!pripona) throw chyba('Obrázek musí být PNG, JPEG nebo WebP.');
    const jmeno = `portret.${pripona}`;
    const slozka = path.dirname(path.join(this.c.koren, ...e.soubor.split('/')));
    // Obrázek je binární a jen Hubu: atomický zápis z zapis.js.
    await zapsatAtomicky(path.join(slozka, jmeno), data);
    const r = await this.upravitSoubor(id, (text, aktualni) => {
      if (aktualni.obrazky.some((o) => o.soubor === jmeno)) return text;
      return upravitKartu(text, { ilustrace: { soubor: jmeno, ucel: 'portret' } });
    });
    return { vysledek: r.vysledek, karta: r.karta, soubor: jmeno };
  }

  /** Naváže kartu na událost kalendáře, nebo vazbu zruší. */
  async vazbaUdalosti(udalostId, cil, pridat) {
    if (!this.kalendar) throw chyba('Kalendář není k dispozici.', 503);
    if (pridat) this.overitCil(null, cil);
    const u = this.kalendar.udalosti.find((x) => x.id === udalostId);
    if (!u) throw chyba('Událost neexistuje.', 404);
    const vazby = new Set(u.vazby ?? []);
    if (pridat) vazby.add(cil);
    else vazby.delete(cil);
    const r = await this.kalendar.nastavitVazby(udalostId, [...vazby]);
    this.oznam();
    return { vysledek: r.vysledek, udalost: this.udalosti('dm').find((x) => x.id === udalostId) };
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
    const maPole = [...TEXTOVA_POLE, 'doresit', 'kdo'].some((k) => k in telo);
    if (maPole) this.overitPole(this.get(id), telo); // chyba dřív, než se sáhne na soubor
    if (!Object.keys(zmeny).length && !aliasy && !('aktualni' in telo) && !maPole) throw chyba('Není co změnit.');
    return this.upravitHlavicku(id, (e) => {
      const z = { ...zmeny, ...(maPole ? this.overitPole(e, telo) : {}) };
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
