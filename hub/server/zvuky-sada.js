// Zvuková sada (otevřené body 86 a 87): `kampan/zvuky-sada.yaml` říká, jaké zvuky má složka zvuku mít
// a jak je najít. Repo drží jen popis (hledaný text, délku, počet variant, licence); samotné soubory
// Hub stáhne do složky zvuku mimo repo (rozhodnutí 63) a autory zapíše do `zdroje.json`.
//
// Zdroje (v tomto pořadí):
//   Freesound  APIv2 s klíčem (token), náhledy MP3 bez OAuth; jen když je klíč vložený
//   Openverse  vyhledávač WordPressu nad volně licencovanými zvuky (Wikimedia Commons, Jamendo,
//              ccMixter, Freesound …), bez klíče
import path from 'node:path';
import { platneId } from './zvuky-knihovna.js';

export const FREESOUND_API = 'https://freesound.org/apiv2';
export const OPENVERSE_API = 'https://api.openverse.org/v1';
export const MAX_VARIANT = 6;
export const MAX_POLOZEK = 120;
/** Odstup mezi voláními API: Freesound dovolí 60 za minutu, Openverse bez klíče méně. */
export const ODSTUP_API_MS = 1100;
/** Licence, které sada smí stáhnout: CC0 a public domain vždy, CC BY jen když to položka dovolí. */
export const LICENCE = Object.freeze(['cc0', 'by']);
export const ZDROJE = Object.freeze(['freesound', 'openverse']);
/** Odkud smí Hub soubor stáhnout (https). */
const POVOLENE_HOSTY = /(^|\.)(freesound\.org|wikimedia\.org|jamendo\.com|ccmixter\.org|openverse\.org)$/i;
const PRIPONY = Object.freeze(['.mp3', '.ogg', '.opus', '.wav', '.flac']);
const MAX_BAJTU = 40 * 1024 * 1024;

const chyba = (zprava, status = 400) => Object.assign(new Error(zprava), { status });

/**
 * Položky sady z YAML. Klíč = cíl ve složce zvuku bez přípony (`nahodne/tabor/kun`, `vitezstvi`).
 * Hodnota: `hledat` (anglicky), `delka: [od, do]` v sekundách, `variant` (1 = jeden soubor,
 * víc = `cil-1` …), volitelně `popis` (česky pro panel) a `licence: [cc0, by]` (výchozí jen CC0).
 */
export function normalizujSadu(d) {
  const polozky = [];
  const chyby = [];
  const zdroj = d?.zvuky && typeof d.zvuky === 'object' ? d.zvuky : {};
  for (const [klic, x] of Object.entries(zdroj)) {
    const cil = platneId(klic);
    if (!cil || /\.[a-z0-9]{2,4}$/i.test(cil)) {
      chyby.push(`„${klic}“: cíl je cesta ve složce zvuku bez přípony`);
      continue;
    }
    const hledat = typeof x?.hledat === 'string' ? x.hledat.trim().slice(0, 120) : '';
    if (!hledat) {
      chyby.push(`„${cil}“: chybí hledat`);
      continue;
    }
    let delka = Array.isArray(x.delka) ? x.delka.map(Number) : [0.3, 30];
    if (delka.length !== 2 || delka.some((n) => !Number.isFinite(n) || n < 0) || delka[0] >= delka[1]) {
      chyby.push(`„${cil}“: delka je [od, do] v sekundách`);
      delka = [0.3, 30];
    }
    const v = Number(x.variant ?? 1);
    const licence = Array.isArray(x.licence) ? [...new Set(x.licence.map((l) => String(l).toLowerCase()))] : ['cc0'];
    if (licence.some((l) => !LICENCE.includes(l))) chyby.push(`„${cil}“: licence je cc0, nebo by`);
    polozky.push({
      cil,
      hledat,
      delka,
      variant: Number.isInteger(v) && v >= 1 ? Math.min(MAX_VARIANT, v) : 1,
      popis: typeof x.popis === 'string' ? x.popis.trim().slice(0, 80) : null,
      licence: licence.filter((l) => LICENCE.includes(l)).length ? licence.filter((l) => LICENCE.includes(l)) : ['cc0'],
    });
    if (polozky.length >= MAX_POLOZEK) break;
  }
  return { polozky, chyby };
}

/** Jména souborů pro položku (bez ohledu na příponu): `vitezstvi.mp3`, nebo `nahodne/tabor/kun-1.mp3` … */
export function souboryPolozky({ cil, variant }) {
  return variant === 1 ? [`${cil}.mp3`] : Array.from({ length: variant }, (_, i) => `${cil}-${i + 1}.mp3`);
}

/** Jednotné ID kandidáta napříč zdroji: zvuk z Freesoundu je stejný, ať přijde odkudkoli. */
export function idKandidata(x) {
  if (typeof x === 'number') return `fs:${x}`;
  return String(x);
}

/** Dotaz Freesoundu: licence z položky, délka v mezích, nejlépe hodnocené. */
export function adresaHledani({ hledat, delka, licence = ['cc0'] }, klic, strana = 1) {
  const u = new URL(`${FREESOUND_API}/search/text/`);
  const lic = licence.map((l) => (l === 'by' ? '"Attribution"' : '"Creative Commons 0"'));
  u.searchParams.set('query', hledat);
  u.searchParams.set('filter', `license:${lic.length > 1 ? `(${lic.join(' OR ')})` : lic[0]} duration:[${delka[0]} TO ${delka[1]}]`);
  u.searchParams.set('sort', 'rating_desc');
  u.searchParams.set('fields', 'id,name,username,license,duration,previews,url');
  u.searchParams.set('page_size', '30');
  u.searchParams.set('page', String(strana));
  u.searchParams.set('token', klic);
  return u.toString();
}

/** Dotaz Openverse: licence (CC0 a public domain, případně CC BY), zvuky a hudba. */
export function adresaOpenverse({ hledat, licence = ['cc0'] }, strana = 1) {
  const u = new URL(`${OPENVERSE_API}/audio/`);
  u.searchParams.set('q', hledat);
  u.searchParams.set('license', [...new Set([...licence, 'pdm'])].join(','));
  u.searchParams.set('page_size', '40');
  u.searchParams.set('page', String(strana));
  return u.toString();
}

/** Zkratka licence pro zdroje.json a panel. */
function nazevLicence(text) {
  const t = String(text ?? '').toLowerCase();
  if (/zero|cc0/.test(t)) return 'CC0';
  if (/pdm|publicdomain\/mark|public domain/.test(t)) return 'Public domain';
  if (/\bby\b|attribution|licenses\/by\//.test(t)) return 'CC BY';
  return text ? String(text).slice(0, 40) : '?';
}

/** Společný základ: volání s časovým limitem, odstupem a srozumitelnými chybami. */
class Zdroj {
  constructor({ fetch: f = globalThis.fetch, limitMs = 20000, odstupMs = ODSTUP_API_MS } = {}) {
    this.fetch = f;
    this.limitMs = limitMs;
    this.odstupMs = odstupMs;
    this.posledni = 0;
  }

  async volat(adresa, { binarni = false, hlavicky = {} } = {}) {
    const cekat = this.posledni + this.odstupMs - Date.now();
    if (!binarni && cekat > 0) await new Promise((r) => setTimeout(r, cekat));
    if (!binarni) this.posledni = Date.now();
    let r;
    try {
      r = await this.fetch(adresa, { headers: hlavicky, signal: AbortSignal.timeout(this.limitMs) });
    } catch (e) {
      throw chyba(`${this.nazev} neodpovídá (${e.name === 'TimeoutError' ? 'vypršel čas' : e.message}).`, 502);
    }
    if (r.status === 401 || r.status === 403) throw chyba(this.odmitnuto, 400);
    if (r.status === 429) throw chyba(`${this.nazev}: limit požadavků vyčerpán. Zkus to později.`, 429);
    if (!r.ok) throw chyba(`${this.nazev} vrátil chybu ${r.status}.`, 502);
    return binarni ? Buffer.from(await r.arrayBuffer()) : r.json();
  }

  /** Stáhne soubor (jen https a jen ze známých úložišť zvuků). */
  async stahnout(adresa) {
    const u = new URL(adresa);
    if (u.protocol !== 'https:' || !POVOLENE_HOSTY.test(u.hostname)) throw chyba(`Soubor není ze známého úložiště (${u.hostname}).`, 400);
    const data = await this.volat(u.toString(), { binarni: true });
    if (data.length < 500 || data.length > MAX_BAJTU) throw chyba('Stažený zvuk má divnou velikost.', 502);
    return data;
  }
}

/** Freesound APIv2. `fetch` jde podstrčit v testech. */
export class Freesound extends Zdroj {
  constructor({ klic, ...volby } = {}) {
    super(volby);
    this.klic = klic;
    this.nazev = 'Freesound';
    this.odmitnuto = 'Freesound odmítl klíč. Zkontroluj ho v Nastavení → Zvuk.';
  }

  async hledat(polozka, strana = 1) {
    if (!this.klic) throw chyba('Chybí klíč Freesound.', 400);
    const d = await this.volat(adresaHledani(polozka, this.klic, strana));
    return (d.results ?? [])
      .filter((x) => x.previews?.['preview-hq-mp3'] && povolenaLicence(x.license, polozka.licence))
      .map((x) => ({
        id: `fs:${x.id}`,
        nazev: String(x.name ?? '').slice(0, 120),
        autor: String(x.username ?? '').slice(0, 60),
        delka: Math.round((x.duration ?? 0) * 10) / 10,
        nahled: x.previews['preview-hq-mp3'],
        pripona: '.mp3',
        url: x.url ?? `https://freesound.org/s/${x.id}/`,
        licence: nazevLicence(x.license),
        zdroj: 'Freesound',
      }));
  }
}

/** Openverse (bez klíče). Freesound v něm dostane stejné ID jako přímo z Freesoundu. */
export class Openverse extends Zdroj {
  constructor(volby = {}) {
    super(volby);
    this.nazev = 'Openverse';
    this.odmitnuto = 'Openverse odmítl požadavek.';
  }

  async hledat(polozka, strana = 1) {
    const d = await this.volat(adresaOpenverse(polozka, strana), { hlavicky: { Accept: 'application/json' } });
    const [od, do_] = polozka.delka;
    return (d.results ?? [])
      .map((x) => {
        const delka = Number.isFinite(x.duration) ? x.duration / 1000 : null;
        const pripona = priponaSouboru(x.filetype, x.url);
        const fs = String(x.foreign_landing_url ?? '').match(/freesound\.org\/people\/[^/]+\/sounds\/(\d+)/);
        return {
          id: fs ? `fs:${fs[1]}` : `ov:${x.id}`,
          nazev: String(x.title ?? '').slice(0, 120),
          autor: String(x.creator ?? '').slice(0, 60),
          delka: delka === null ? null : Math.round(delka * 10) / 10,
          nahled: x.url,
          pripona,
          url: x.foreign_landing_url ?? x.url,
          licence: nazevLicence(x.license),
          zdroj: `Openverse (${String(x.source ?? x.provider ?? '?').slice(0, 30)})`,
          velikost: x.filesize ?? null,
          licenceKod: String(x.license ?? '').toLowerCase(),
        };
      })
      .filter((k) => k.nahled && k.pripona && k.delka !== null && k.delka >= od && k.delka <= do_)
      .filter((k) => !k.velikost || k.velikost <= MAX_BAJTU)
      .filter((k) => k.licenceKod === 'pdm' || polozka.licence.includes(k.licenceKod))
      .map(({ velikost, licenceKod, ...k }) => k);
  }
}

function povolenaLicence(text, licence = ['cc0']) {
  const l = nazevLicence(text);
  return l === 'CC0' || l === 'Public domain' || (l === 'CC BY' && licence.includes('by'));
}

function priponaSouboru(filetype, url) {
  const t = String(filetype ?? '').toLowerCase().replace(/^\./, '');
  const z = t ? `.${t === 'mpeg' ? 'mp3' : t === 'oga' ? 'ogg' : t}` : path.posix.extname(new URL(url ?? 'https://x/').pathname).toLowerCase();
  return PRIPONY.includes(z) ? z : null;
}

/**
 * Kandidáti pro položku ze všech zdrojů v pořadí, bez duplicit a bez vyřazených.
 * Chyba jednoho zdroje (špatný klíč, limit) nezastaví ostatní; vrací ji v `chyby`.
 */
export async function hledatKandidaty(zdroje, polozka, { kolik, vynechat = new Set() }) {
  const kandidati = [];
  const videne = new Set(vynechat);
  const chyby = [];
  for (const z of zdroje) {
    for (const strana of [1, 2]) {
      try {
        for (const k of await z.hledat(polozka, strana)) {
          if (videne.has(k.id)) continue;
          videne.add(k.id);
          kandidati.push(k);
        }
      } catch (e) {
        chyby.push(e);
        break;
      }
      if (kandidati.length >= kolik) return { kandidati, chyby };
    }
  }
  return { kandidati, chyby };
}
