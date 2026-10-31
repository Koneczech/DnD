// Data kampaně: stav.md, kampan.yaml a Kontrola dat nad celou složkou kampan/.
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import YAML from 'yaml';
import { normalizujRegistr, SOUBOR_ROZPORU } from '../sdilene/rozpory.js';
import { rozebrat, upravitHlavicku, odkazy } from '../sdilene/frontmatter.js';
import { TYPY_SLOZEK, TYPY } from './cesty.js';
import { WIZ_SCENY } from './zarizeni/wiz.js';
import { PRIPONA_DOCASNA } from './zapis.js';
import { Harptos } from '../sdilene/harptos.js';
import { OSUDY, ODKAZOVA_POLE, POLE_TYPU, STAVY_ROZHODNUTI } from '../sdilene/typy-karet.js';
import { SOUBOR_LISTU, spocitatList } from '../sdilene/list-postavy-data.js';

export const SCHEMA = 1;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const POVINNE_ENTITY = ['schema', 'id', 'typ', 'nazev', 'verejne'];
/** Stav záznamu v registru rozhodnutí (Blok 3, převod z Notionu). */
export { STAVY_ROZHODNUTI };

/**
 * Pole `vztahy` v hlavičce (ZADANI.md, Datový model → Vztahy; rozhodnutí 70).
 * Vrátí problémy formátu a cíle vztahů (id bez [[ ]]), aby je Kontrola dat porovnala s ostatními soubory.
 * @returns {{problemy: Array<{uroven:'chyba'|'varovani', zprava:string}>, cile: string[]}}
 */
export function overVztahy(data) {
  const problemy = [];
  const cile = [];
  if (!('vztahy' in data) || data.vztahy == null) return { problemy, cile };
  if (!Array.isArray(data.vztahy)) {
    problemy.push({ uroven: 'chyba', zprava: 'vztahy musí být seznam' });
    return { problemy, cile };
  }
  const vazby = new Set(odkazy(JSON.stringify(data.vazby ?? [])));
  data.vztahy.forEach((v, i) => {
    const kde = `Vztah ${i + 1}`;
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      problemy.push({ uroven: 'chyba', zprava: `${kde} musí mít tvar { s: "[[id]]", popis: … }` });
      return;
    }
    const m = typeof v.s === 'string' ? /^\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/.exec(v.s.trim()) : null;
    if (!m) problemy.push({ uroven: 'chyba', zprava: `${kde}: s musí být odkaz v uvozovkách, např. "[[dorn-treestone]]"` });
    if (typeof v.popis !== 'string' || !v.popis.trim()) problemy.push({ uroven: 'chyba', zprava: `${kde}: chybí popis` });
    if ('postoj' in v && !(Number.isInteger(v.postoj) && v.postoj >= -3 && v.postoj <= 3)) {
      problemy.push({ uroven: 'chyba', zprava: `${kde}: postoj musí být celé číslo −3 až 3` });
    }
    if ('verejne' in v && typeof v.verejne !== 'boolean') problemy.push({ uroven: 'chyba', zprava: `${kde}: verejne musí být true nebo false` });
    if (!m) return;
    const cil = m[1].trim();
    cile.push(cil);
    if (!vazby.has(cil)) problemy.push({ uroven: 'varovani', zprava: `Vztah s [[${cil}]] chybí ve vazby (Obsidian ho neukáže v grafu)` });
  });
  return { problemy, cile };
}

/** Slug podle konvence v ZADANI.md: malá písmena bez diakritiky, pomlčky. */
export function slug(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function relativni(koren, soubor) {
  return path.relative(koren, soubor).split(path.sep).join('/');
}

/**
 * Datum Harptosu z hlavičky: mapa {rok, mesic, den} / {rok, svatek}, starší text „19. Eleint 1491“,
 * nebo prázdná hodnota (datum zatím není zadané).
 * @returns {{platne: boolean, datum: object|null}}
 */
export function datumHarptos(hodnota) {
  if (hodnota === null || hodnota === undefined || hodnota === '') return { platne: true, datum: null };
  if (typeof hodnota === 'string') {
    const d = Harptos.zTextu(hodnota);
    return { platne: Boolean(d), datum: d };
  }
  if (typeof hodnota === 'object') {
    const d = Harptos.normalizuj(hodnota);
    return { platne: Boolean(d), datum: d };
  }
  return { platne: false, datum: null };
}

/** Ověří hodnoty stavu kampaně. Vrací seznam chyb (prázdný = v pořádku). */
export function overStav(data) {
  const chyby = [];
  if (!data || typeof data !== 'object') return ['Chybí hlavička'];
  if (data.schema !== SCHEMA) chyby.push(`schema musí být ${SCHEMA}`);
  if (!datumHarptos(data.datum).platne) chyby.push('datum musí být datum Harptosu, např. {rok: 1491, mesic: Eleint, den: 19}');
  if (typeof data.misto !== 'string') chyby.push('misto musí být text');
  if (!Number.isInteger(data.sezeni) || data.sezeni < 0) chyby.push('sezeni musí být celé číslo 0 nebo větší');
  if ('sezeni_bezi' in data && typeof data.sezeni_bezi !== 'boolean') chyby.push('sezeni_bezi musí být true nebo false');
  return chyby;
}

async function projdi(slozka) {
  const vysledek = [];
  let polozky;
  try {
    polozky = await fs.readdir(slozka, { withFileTypes: true });
  } catch {
    return vysledek;
  }
  for (const p of polozky) {
    if (p.name.startsWith('.') || p.name.endsWith(PRIPONA_DOCASNA)) continue;
    const cesta = path.join(slozka, p.name);
    if (p.isDirectory()) vysledek.push(...(await projdi(cesta)));
    else vysledek.push(cesta);
  }
  return vysledek;
}

/**
 * Kontrola dat (ZADANI.md, Datový model): rozbitý soubor nezastaví zbytek, jen se ohlásí.
 * @returns {Promise<{problemy: Array<{soubor:string, uroven:'chyba'|'varovani', zprava:string}>, pocetSouboru:number, entity:number}>}
 */
export async function kontrolaDat(c) {
  const problemy = [];
  const pridej = (soubor, uroven, zprava) => problemy.push({ soubor: relativni(c.koren, soubor), uroven, zprava });

  // Stav kampaně
  try {
    const r = rozebrat(await fs.readFile(c.stav, 'utf8'));
    if (r.chyba) pridej(c.stav, 'chyba', r.chyba);
    else for (const ch of overStav(r.data)) pridej(c.stav, 'chyba', ch);
  } catch (e) {
    pridej(c.stav, 'chyba', e.code === 'ENOENT' ? 'Soubor chybí' : e.message);
  }
  try {
    const d = YAML.parse(await fs.readFile(c.kampanYaml, 'utf8'));
    if (!d || d.schema !== SCHEMA) pridej(c.kampanYaml, 'chyba', `schema musí být ${SCHEMA}`);
    if (!d?.nazev) pridej(c.kampanYaml, 'chyba', 'Chybí nazev');
  } catch (e) {
    pridej(c.kampanYaml, 'chyba', e.code === 'ENOENT' ? 'Soubor chybí' : `Chyba v YAML: ${e.message.split('\n')[0]}`);
  }

  // Entity a záznamy
  const soubory = await projdi(c.kampan);

  // Vrstvy scén (Blok 4): rozbitý YAML by světla tiše ignorovala.
  const sceny = path.join(c.kampan, 'sceny');
  for (const soubor of soubory.filter((s) => s.endsWith('.yaml') && !path.relative(sceny, s).startsWith('..'))) {
    try {
      const d = YAML.parse(await fs.readFile(soubor, 'utf8'));
      if (d?.svetla !== undefined && (typeof d.svetla !== 'object' || Array.isArray(d.svetla))) pridej(soubor, 'chyba', 'svetla musí být mapa rolí (hlavni, pozadi, lampa, vsechny)');
      for (const [role, v] of Object.entries(d?.svetla ?? {})) {
        if (!['hlavni', 'pozadi', 'lampa', 'vsechny'].includes(role)) pridej(soubor, 'varovani', `Neznámá role světla „${role}“`);
        if (v?.wiz_scena && !WIZ_SCENY[v.wiz_scena]) pridej(soubor, 'varovani', `Neznámá scéna WiZ „${v.wiz_scena}“`);
      }
    } catch (e) {
      pridej(soubor, 'chyba', `Chyba v YAML: ${e.message.split('\n')[0]}`);
    }
  }
  const zaznamy = [];
  for (const soubor of soubory.filter((s) => s.endsWith('.md'))) {
    const casti = path.relative(c.kampan, soubor).split(path.sep);
    const typSlozky = TYPY_SLOZEK[casti[0]];
    if (!typSlozky) continue;
    const jmeno = path.basename(soubor, '.md');
    const jeZaznam = casti.length === 2;
    const jeEntita = casti.length === 3 && casti[1] === jmeno;
    if (!jeZaznam && !jeEntita) continue; // vedlejší soubory ve složce entity se nekontrolují

    let r;
    try {
      r = rozebrat(await fs.readFile(soubor, 'utf8'));
    } catch (e) {
      pridej(soubor, 'chyba', e.message);
      continue;
    }
    if (r.chyba) {
      pridej(soubor, 'chyba', r.chyba);
      continue;
    }
    if (!r.maHlavicku) {
      pridej(soubor, 'chyba', 'Chybí hlavička YAML');
      continue;
    }
    const d = r.data;
    for (const pole of POVINNE_ENTITY) if (!(pole in d)) pridej(soubor, 'chyba', `Chybí povinné pole ${pole}`);
    if ('schema' in d && d.schema !== SCHEMA) pridej(soubor, 'chyba', `Neznámá verze schématu ${d.schema}`);
    if ('id' in d) {
      if (!SLUG.test(String(d.id))) pridej(soubor, 'chyba', `id „${d.id}“ není slug (malá písmena bez diakritiky, pomlčky)`);
      if (String(d.id) !== jmeno) pridej(soubor, 'chyba', `id „${d.id}“ neodpovídá jménu souboru „${jmeno}“`);
    }
    if ('typ' in d) {
      if (!TYPY.includes(d.typ)) pridej(soubor, 'chyba', `Neznámý typ „${d.typ}“`);
      else if (d.typ !== typSlozky) pridej(soubor, 'chyba', `Typ „${d.typ}“ nepatří do složky ${casti[0]}/ (čeká se „${typSlozky}“)`);
    }
    if ('verejne' in d && typeof d.verejne !== 'boolean') pridej(soubor, 'chyba', 'verejne musí být true nebo false');
    if (d.typ === 'rozhodnuti' && 'stav' in d && !STAVY_ROZHODNUTI.includes(d.stav)) {
      pridej(soubor, 'varovani', `stav rozhodnutí musí být ${STAVY_ROZHODNUTI.join(', ')}`);
    }
    const vztahy = overVztahy(d);
    for (const p of vztahy.problemy) pridej(soubor, p.uroven, p.zprava);
    zaznamy.push({ soubor, data: d, telo: r.telo, slozka: path.dirname(soubor), cileVztahu: vztahy.cile });
  }

  // Duplicitní id napříč kampaní
  const podleId = new Map();
  for (const z of zaznamy) {
    if (!z.data.id) continue;
    const id = String(z.data.id);
    if (!podleId.has(id)) podleId.set(id, []);
    podleId.get(id).push(z.soubor);
  }
  for (const [id, kde] of podleId) {
    if (kde.length > 1) for (const s of kde) pridej(s, 'chyba', `Duplicitní id „${id}“ (${kde.length}×)`);
  }

  // Nadřazené místo (⚠ bod 116): lezi_v jen u místa, vede na jiné místo a netvoří kruh.
  const typPodleId = new Map(zaznamy.filter((z) => z.data.id).map((z) => [String(z.data.id), z.data.typ]));
  const rodicPodleId = new Map();
  for (const z of zaznamy) {
    if (!('lezi_v' in z.data) || z.data.lezi_v == null) continue;
    const cil = typeof z.data.lezi_v === 'string' ? odkazy(z.data.lezi_v)[0] : null;
    if (!cil) pridej(z.soubor, 'chyba', 'lezi_v musí být odkaz na místo, např. "[[mirabar]]"');
    else if (z.data.typ !== 'misto') pridej(z.soubor, 'varovani', 'lezi_v má smysl jen u místa (typ misto)');
    else if (cil === String(z.data.id)) pridej(z.soubor, 'chyba', 'Místo nemůže ležet samo v sobě');
    else if (!typPodleId.has(cil)) pridej(z.soubor, 'varovani', `lezi_v vede na neexistující místo [[${cil}]]`);
    else if (typPodleId.get(cil) !== 'misto') pridej(z.soubor, 'chyba', `lezi_v [[${cil}]] není místo`);
    else rodicPodleId.set(String(z.data.id), { cil, soubor: z.soubor });
  }
  for (const [id, { soubor }] of rodicPodleId) {
    const videno = new Set([id]);
    for (let m = rodicPodleId.get(id)?.cil; m; m = rodicPodleId.get(m)?.cil) {
      if (videno.has(m)) {
        if (m === id) pridej(soubor, 'chyba', 'lezi_v tvoří kruh (místo nakonec leží samo v sobě)');
        break;
      }
      videno.add(m);
    }
  }

  // Pole typových stránek (rozhodnutí 74): osud a odkazová pole kde, frakce, sidlo, u_koho.
  for (const z of zaznamy) {
    const d = z.data;
    if ('osud' in d && d.osud != null && d.osud !== '' && !(String(d.osud) in OSUDY)) {
      pridej(z.soubor, 'varovani', `osud musí být ${Object.keys(OSUDY).join(', ')}`);
    }
    for (const [pole, { cil: typyCile }] of Object.entries(ODKAZOVA_POLE)) {
      if (!(pole in d) || d[pole] == null || d[pole] === '') continue;
      const cil = typeof d[pole] === 'string' ? odkazy(d[pole])[0] : null;
      if (!cil) pridej(z.soubor, 'chyba', `${pole} musí být odkaz na kartu, např. "[[${typyCile[0] === 'misto' ? 'mirabar' : 'id'}]]"`);
      else if (!(POLE_TYPU[d.typ] ?? []).includes(pole)) pridej(z.soubor, 'varovani', `${pole} karta typu ${d.typ} nepoužívá`);
      else if (cil === String(d.id)) pridej(z.soubor, 'chyba', `${pole} vede na kartu samu`);
      else if (!typPodleId.has(cil)) pridej(z.soubor, 'varovani', `${pole} vede na neexistující kartu [[${cil}]]`);
      else if (!typyCile.includes(typPodleId.get(cil))) pridej(z.soubor, 'chyba', `${pole} [[${cil}]] musí vést na: ${typyCile.join(', ')}`);
    }
  }

  // Vazby a obrázky
  for (const z of zaznamy) {
    const cile = new Set([...odkazy(JSON.stringify(z.data.vazby ?? [])), ...odkazy(z.telo), ...z.cileVztahu]);
    for (const cil of cile) if (!podleId.has(cil)) pridej(z.soubor, 'varovani', `Vazba [[${cil}]] vede na neexistující id`);
    const ilustrace = Array.isArray(z.data.ilustrace) ? z.data.ilustrace : [];
    for (const il of ilustrace) {
      if (!il?.soubor) {
        pridej(z.soubor, 'chyba', 'Ilustrace bez pole soubor');
        continue;
      }
      const cesta = String(il.soubor).startsWith('/') ? path.join(c.koren, il.soubor) : path.join(z.slozka, il.soubor);
      try {
        await fs.access(cesta);
      } catch {
        pridej(z.soubor, 'varovani', `Obrázek ${il.soubor} neexistuje`);
      }
    }
  }

  // List postavy jako data (⚠ bod 151): chyby v souboru a rozpory s původním listem.
  for (const z of zaznamy) {
    if (z.data.typ !== 'postava' || path.basename(z.slozka) !== String(z.data.id)) continue;
    const soubor = path.join(z.slozka, SOUBOR_LISTU);
    let text;
    try {
      text = await fs.readFile(soubor, 'utf8');
    } catch {
      continue; // postava bez listu
    }
    let d;
    try {
      d = YAML.parse(text);
    } catch (e) {
      pridej(soubor, 'chyba', `Chyba v YAML: ${e.message.split('\n')[0]}`);
      continue;
    }
    const l = spocitatList(d);
    for (const ch of l.chyby) pridej(soubor, 'chyba', ch);
    for (const r of l.rozpory) pridej(soubor, 'varovani', `Rozpor s původním listem: ${r.nazev} — v listu ${r.uvedeno}, podle pravidel ${r.spocteno} (stated.${r.klic})`);
  }

  // Vazby událostí kalendáře na karty kánonu (Blok 3)
  const souborUdalosti = path.join(c.kampan, 'kalendar', 'udalosti.yaml');
  try {
    const d = YAML.parse(await fs.readFile(souborUdalosti, 'utf8'));
    for (const u of Array.isArray(d?.udalosti) ? d.udalosti : []) {
      for (const cil of odkazy(JSON.stringify(u?.vazby ?? []))) {
        if (!podleId.has(cil)) pridej(souborUdalosti, 'varovani', `Událost „${u.text ?? u.id}“: vazba [[${cil}]] vede na neexistující id`);
      }
    }
  } catch {
    /* chybějící nebo rozbitý kalendář hlásí modul Kalendář */
  }

  // Registr rozporů (rozhodnutí 77): tvar záznamů, odkazy na karty a odložené rozpory.
  const souborRozporu = path.join(c.kampan, SOUBOR_ROZPORU);
  let textRozporu = null;
  try {
    textRozporu = await fs.readFile(souborRozporu, 'utf8');
  } catch {
    /* registr zatím není */
  }
  if (textRozporu !== null) {
    try {
      const r = normalizujRegistr(YAML.parse(textRozporu));
      for (const p of r.problemy) pridej(souborRozporu, 'chyba', p);
      for (const z of r.zaznamy) {
        if (z.karta && !podleId.has(String(z.karta))) pridej(souborRozporu, 'varovani', `${z.id}: karta [[${z.karta}]] neexistuje`);
        if (z.stav === 'otevrene') pridej(souborRozporu, 'varovani', `${z.id} je odložený rozpor${z.karta ? ` u [[${z.karta}]]` : ''}: ${z.otazka ?? z.prepis_tvrzeni ?? 'čeká na rozhodnutí DM'}`);
      }
    } catch (e) {
      pridej(souborRozporu, 'chyba', `Chyba v YAML: ${e.message.split('\n')[0]}`);
    }
  }

  return { problemy, pocetSouboru: soubory.length, entity: zaznamy.length };
}

/**
 * Stav kampaně v paměti serveru. Soubor na disku má vždy přednost.
 * Události: 'stav' (nový stav), 'kontrola' (nový výsledek Kontroly dat)
 */
export class DataKampane extends EventEmitter {
  constructor({ cesty, zapisovac }) {
    super();
    this.c = cesty;
    this.zapisovac = zapisovac;
    this.stav = null;
    this.chybaStavu = null;
    this.kampan = null;
    this.kontrola = { problemy: [], pocetSouboru: 0, entity: 0 };
    this.kontrolaCasovac = null;
  }

  async nacist() {
    await this.nacistStav();
    await this.nacistKampan();
    await this.zkontrolovat();
  }

  async nacistStav(text) {
    try {
      const obsah = text ?? (await fs.readFile(this.c.stav, 'utf8'));
      const r = rozebrat(obsah);
      const chyby = r.chyba ? [r.chyba] : overStav(r.data);
      if (chyby.length) {
        this.chybaStavu = chyby.join('; ');
        // Poslední platný stav zůstává, aby se výstupy v OBS nevyprázdnily.
      } else {
        this.chybaStavu = null;
        const datum = datumHarptos(r.data.datum).datum;
        this.stav = {
          datum,
          datumText: datum ? Harptos.format(datum) : '',
          misto: r.data.misto,
          sezeni: r.data.sezeni,
          sezeniBezi: Boolean(r.data.sezeni_bezi),
        };
      }
    } catch (e) {
      this.chybaStavu = e.code === 'ENOENT' ? 'Soubor kampan/stav.md chybí' : e.message;
    }
    this.emit('stav', this.verejnyStav());
  }

  async nacistKampan() {
    try {
      this.kampan = YAML.parse(await fs.readFile(this.c.kampanYaml, 'utf8'));
    } catch {
      this.kampan = null;
    }
  }

  /** Začátek kampaně (kampan.yaml, startovni_datum) jako datum Harptosu, nebo null. */
  zacatek() {
    return datumHarptos(this.kampan?.startovni_datum).datum;
  }

  verejnyStav() {
    return {
      stav: this.stav,
      chyba: this.chybaStavu,
      kampan: this.kampan ? { nazev: this.kampan.nazev ?? null, zacatek: this.zacatek() } : null,
      odlozeno: Boolean(this.zapisovac.cekajici(this.c.stav)),
    };
  }

  /**
   * Změna z panelu. Zapíše se automaticky (autosave) a hned se pošle do výstupů.
   * @param {{datum?:object|null, misto?:string, sezeni?:number, sezeniBezi?:boolean}} zmeny
   * @param {{interni?:boolean}} volby sezeniBezi smí měnit jen Zahájit/Ukončit sezení, ne panel
   */
  async zmenitStav(zmeny, { interni = false } = {}) {
    const povolene = {};
    if (interni && 'sezeniBezi' in zmeny) povolene.sezeni_bezi = Boolean(zmeny.sezeniBezi);
    if ('datum' in zmeny) {
      const d = datumHarptos(zmeny.datum);
      if (!d.platne) throw Object.assign(new Error('Neplatné datum Harptosu.'), { status: 400 });
      povolene.datum = d.datum;
    }
    if ('misto' in zmeny) povolene.misto = String(zmeny.misto);
    if ('sezeni' in zmeny) povolene.sezeni = Number(zmeny.sezeni);
    const chyby = overStav({ schema: SCHEMA, datum: null, misto: '', sezeni: 0, ...povolene });
    if (chyby.length) {
      const e = new Error(chyby.join('; '));
      e.status = 400;
      throw e;
    }
    // Čtení posledního obsahu (i odloženého) a zápis běží ve frontě souboru: dvě změny stavu
    // těsně po sobě se nepřepíšou (audit N1).
    const { vysledek, obsah } = await this.zapisovac.upravit(this.c.stav, (zaklad) => upravitHlavicku(zaklad, { ...povolene }));
    await this.nacistStav(obsah);
    return { vysledek };
  }

  /** Volá hlídání souborů. */
  async souborZmenen(soubor) {
    if (path.resolve(soubor) === path.resolve(this.c.stav)) {
      let text;
      try {
        text = await fs.readFile(this.c.stav, 'utf8');
      } catch {
        text = undefined;
      }
      if (text !== undefined && this.zapisovac.jeVlastniZapis(this.c.stav, text)) return;
      // Změna zvenku: soubor na disku má přednost před odloženým zápisem.
      await this.zapisovac.zrusit(this.c.stav);
      await this.nacistStav(text);
    } else if (path.resolve(soubor) === path.resolve(this.c.kampanYaml)) {
      await this.nacistKampan();
      this.emit('stav', this.verejnyStav());
    }
    this.naplanovatKontrolu();
  }

  naplanovatKontrolu() {
    clearTimeout(this.kontrolaCasovac);
    this.kontrolaCasovac = setTimeout(() => this.zkontrolovat().catch(() => {}), 200);
    this.kontrolaCasovac.unref?.();
  }

  async zkontrolovat() {
    this.kontrola = await kontrolaDat(this.c);
    // Další kontroly mimo složku kampaně (chybějící zvukové soubory, Blok 5).
    if (this.dalsiKontroly) {
      try {
        const navic = await this.dalsiKontroly();
        this.kontrola = { ...this.kontrola, problemy: [...this.kontrola.problemy, ...navic] };
      } catch {
        /* doplňková kontrola nesmí shodit hlavní */
      }
    }
    this.emit('kontrola', this.kontrola);
    return this.kontrola;
  }
}
