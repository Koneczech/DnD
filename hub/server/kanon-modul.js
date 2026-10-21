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
import { TYPY_SLOZEK } from './cesty.js';
import { upravitKartu, teloKarty, nahraditTelo } from '../sdilene/hlavicka.js';
import { prepnoutBlokTextu } from '../sdilene/odkryvani.js';
import { PRIPONA_DOCASNA, zapsatAtomicky } from './zapis.js';
import { Harptos } from '../sdilene/harptos.js';
import { SOUBOR_LISTU, spocitatList, listProDruzinu } from '../sdilene/list-postavy-data.js';
import { overitPole, zmenyKarty, textKarty, ODDIL_DRUZINY, SLUG, nacistEntitu, normalizujNastenku, odkazObsidian, prepnoutBlok, pridatBlok, slugNastenky, vPohledu } from '../sdilene/karta-kanonu.js';

// Text karty (nacistEntitu, Co ví družina, pohled družiny …) je ve sdíleném modulu; odsud se dál
// exportuje, aby ho importy serveru a testů našly na starém místě.
export * from '../sdilene/karta-kanonu.js';

export const POHLEDY = Object.freeze(['dm', 'druzina']);
const MAX_NASTENEK = 50;
/** Typy, které jde v Hubu založit (sezení zakládá Zahájit sezení). */
export const TYPY_NOVE = Object.freeze(['postava', 'npc', 'padouch', 'frakce', 'misto', 'predmet', 'bytost', 'rozhodnuti', 'kanon']);
const SLOZKA_TYPU = Object.fromEntries(Object.entries(TYPY_SLOZEK).map(([slozka, typ]) => [typ, slozka]));
const ZAZNAMY = new Set(['rozhodnuti', 'kanon']);
const MAX_PORTRET = 15 * 1024 * 1024;
export const hashTela = (telo) => crypto.createHash('sha1').update(String(telo)).digest('hex').slice(0, 16);

const chyba = (zprava, status = 400) => Object.assign(new Error(zprava), { status });

/**
 * Události: 'zmena' { verze } — panel si podle ní načte seznam a otevřenou kartu znovu.
 */
/**
 * List postavy z list.yaml (⚠ bod 151). Bez souboru null; rozbitý YAML vrátí chybu,
 * kterou ukáže list i Kontrola dat.
 * @returns {Promise<{soubor: string, data: object|null, chyba: string|null}|null>}
 */
export async function nacistListPostavy(cesta) {
  let text;
  try {
    text = await fs.readFile(cesta, 'utf8');
  } catch {
    return null;
  }
  try {
    return { data: YAML.parse(text) ?? {}, chyba: null };
  } catch (err) {
    return { data: null, chyba: `Chyba v YAML: ${err.message.split('\n')[0]}` };
  }
}

/** List pro pohled: DM celý i s rozpory, družina jen s `public: true` a bez poznámek DM. */
export function listVPohledu(list, pohled) {
  if (!list) return null;
  if (list.chyba) return pohled === 'dm' ? { chybaSouboru: list.chyba } : null;
  const l = spocitatList(list.data);
  if (l.prazdny) return pohled === 'dm' ? { chybaSouboru: l.chyby[0] } : null;
  if (pohled === 'dm') return l;
  return l.verejne ? listProDruzinu(l) : null;
}

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
          // List postavy jako data vedle karty (⚠ bod 151).
          if (e.typ === 'postava' && slozkaEntity) e.list = await nacistListPostavy(path.join(this.c.kampan, slozka, p.name, SOUBOR_LISTU));
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
    // Kdo a co odkazuje na tuto kartu polem hlavičky (rozhodnutí 74): NPC s kde, frakce se sidlo,
    // předmět s u_koho. U místa i z míst v něm (pres = id podmísta).
    const odkazujePolem = [];
    for (const jina of this.entity.values()) {
      if (jina.id === id) continue;
      const jv = vPohledu(jina, p, this.najit);
      if (!jv) continue;
      for (const [pole, cil] of Object.entries(jv.odkazyPole ?? {})) {
        const pres = cil === id ? null : podmista.has(cil) ? cil : undefined;
        if (pres !== undefined) odkazujePolem.push({ id: jina.id, nazev: jina.nazev, typ: jina.typ, pole, pres });
      }
    }
    odkazujePolem.sort((a, b) => a.nazev.localeCompare(b.nazev, 'cs'));
    return {
      ...v,
      ...textKarty(e, p),
      udalosti,
      chronologie: e.typ === 'kanon' ? this.chronologieKarty(id, p) : null,
      zde,
      odkazujePolem,
      pole: p === 'dm' ? e.pole : {},
      odkazujici,
      odkazyVTextu: p === 'dm' ? e.odkazyVTextu.filter((x) => this.entity.has(x)) : [],
      obsidian: p === 'dm' ? odkazObsidian(this.trezor(), e.soubor) : null,
      list: listVPohledu(e.list, p),
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
    nova.list = e.list;
    this.entity.set(id, nova);
    this.oznam();
    return { vysledek, karta: this.karta(id) };
  }

  /** Celý soubor karty přes frontu zápisu: uprava(text, entita) vrátí nový text. */
  async upravitSoubor(id, uprava) {
    const e = this.get(id);
    const soubor = path.join(this.c.koren, ...e.soubor.split('/'));
    const { vysledek, obsah } = await this.zapisovac.upravit(soubor, (text) => uprava(text, nacistEntitu(text, { slozka: e.slozka, soubor: e.soubor, slozkaEntity: e.slozkaEntity })));
    const nova = nacistEntitu(obsah, { slozka: e.slozka, soubor: e.soubor, slozkaEntity: e.slozkaEntity, upraveno: new Date().toISOString() });
    nova.list = e.list;
    this.entity.set(id, nova);
    this.oznam();
    return { vysledek, obsah, karta: this.karta(id) };
  }

  /** Pole hlavičky z editoru (název, ikona, hráč, druh, stav …) po kontrole. */
  overitPole(e, telo) {
    return overitPole(e, telo, (id) => this.entity.get(id));
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

  /**
   * Odkryje nebo skryje odstavec, odrážku nebo citaci z textu karty (rozhodnutí 75). Blok se
   * pozná podle prvního řádku a pořadí mezi bloky se stejným prvním řádkem.
   */
  async prepnoutText(id, { prvni, poradi = 0, zna } = {}) {
    if (typeof prvni !== 'string' || !prvni.trim() || prvni.length > 2000) throw chyba('Chybí první řádek odstavce.');
    if (!Number.isInteger(poradi) || poradi < 0) throw chyba('Neplatné pořadí odstavce.');
    if (typeof zna !== 'boolean') throw chyba('zna musí být true nebo false.');
    const e = this.get(id);
    if (e.typ === 'kanon') throw chyba('Hráčský kánon vidí družina celý, odkrývat v něm není co.');
    const r = await this.upravitSoubor(id, (text) => {
      const nove = prepnoutBlokTextu(teloKarty(text), { prvni, poradi }, zna);
      if (nove === null) throw chyba('Tenhle odstavec v kartě není (karta se mezitím změnila?). Načti ji znovu.', 409);
      return nahraditTelo(text, nove);
    });
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
    const najit = (x) => this.entity.get(x);
    zmenyKarty(this.get(id), telo, najit); // chyba dřív, než se sáhne na soubor
    return this.upravitHlavicku(id, (e) => zmenyKarty(e, telo, najit));
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
