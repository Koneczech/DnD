// Zvuková sada (otevřený bod 86): `kampan/zvuky-sada.yaml` říká, jaké zvuky má složka zvuku mít
// a jak je najít na Freesoundu. Repo drží jen popis (hledaný text, délku, počet variant); samotné
// soubory Hub stáhne do složky zvuku mimo repo (rozhodnutí 63) a autory zapíše do `zdroje.json`.
//
// Freesound APIv2: vyhledávání s klíčem (token), náhledy MP3 bez OAuth. Jen licence CC0.
import { platneId } from './zvuky-knihovna.js';

export const FREESOUND_API = 'https://freesound.org/apiv2';
export const MAX_VARIANT = 6;
export const MAX_POLOZEK = 120;
/** Odstup mezi voláními API: limit je 60 za minutu. */
export const ODSTUP_API_MS = 1100;

const chyba = (zprava, status = 400) => Object.assign(new Error(zprava), { status });

/**
 * Položky sady z YAML. Klíč = cíl ve složce zvuku bez přípony (`nahodne/tabor/kun`, `vitezstvi`).
 * Hodnota: `hledat` (anglicky, jak se hledá na Freesoundu), `delka: [od, do]` v sekundách,
 * `variant` (1 = jeden soubor `cil.mp3`, víc = `cil-1.mp3` …), volitelně `popis` (česky pro panel).
 * @returns {{polozky: Array<{cil:string, hledat:string, delka:[number,number], variant:number, popis:string|null}>, chyby: string[]}}
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
    polozky.push({
      cil,
      hledat,
      delka,
      variant: Number.isInteger(v) && v >= 1 ? Math.min(MAX_VARIANT, v) : 1,
      popis: typeof x.popis === 'string' ? x.popis.trim().slice(0, 80) : null,
    });
    if (polozky.length >= MAX_POLOZEK) break;
  }
  return { polozky, chyby };
}

/** Jména souborů pro položku: `vitezstvi.mp3`, nebo `nahodne/tabor/kun-1.mp3` … */
export function souboryPolozky({ cil, variant }) {
  return variant === 1 ? [`${cil}.mp3`] : Array.from({ length: variant }, (_, i) => `${cil}-${i + 1}.mp3`);
}

/** Dotaz na vyhledávání: jen CC0, délka v mezích, nejlépe hodnocené. */
export function adresaHledani({ hledat, delka }, klic, strana = 1) {
  const u = new URL(`${FREESOUND_API}/search/text/`);
  u.searchParams.set('query', hledat);
  u.searchParams.set('filter', `license:"Creative Commons 0" duration:[${delka[0]} TO ${delka[1]}]`);
  u.searchParams.set('sort', 'rating_desc');
  u.searchParams.set('fields', 'id,name,username,license,duration,previews,url');
  u.searchParams.set('page_size', '30');
  u.searchParams.set('page', String(strana));
  u.searchParams.set('token', klic);
  return u.toString();
}

/** Klient Freesoundu. `fetch` jde podstrčit v testech. */
export class Freesound {
  constructor({ klic, fetch: f = globalThis.fetch, limitMs = 20000, odstupMs = ODSTUP_API_MS } = {}) {
    this.klic = klic;
    this.fetch = f;
    this.limitMs = limitMs;
    this.odstupMs = odstupMs;
    this.posledni = 0;
  }

  async volat(adresa, { binarni = false } = {}) {
    const cekat = this.posledni + this.odstupMs - Date.now();
    if (!binarni && cekat > 0) await new Promise((r) => setTimeout(r, cekat));
    if (!binarni) this.posledni = Date.now();
    let r;
    try {
      r = await this.fetch(adresa, { signal: AbortSignal.timeout(this.limitMs) });
    } catch (e) {
      throw chyba(`Freesound neodpovídá (${e.name === 'TimeoutError' ? 'vypršel čas' : e.message}).`, 502);
    }
    if (r.status === 401 || r.status === 403) throw chyba('Freesound odmítl klíč. Zkontroluj ho v Nastavení → Zvuk.', 400);
    if (r.status === 429) throw chyba('Freesound: dnešní nebo minutový limit vyčerpán. Zkus to později.', 429);
    if (!r.ok) throw chyba(`Freesound vrátil chybu ${r.status}.`, 502);
    return binarni ? Buffer.from(await r.arrayBuffer()) : r.json();
  }

  /** Kandidáti pro položku sady (CC0, s náhledem). */
  async hledat(polozka, strana = 1) {
    if (!this.klic) throw chyba('Chybí klíč Freesound. Vlož ho v Nastavení → Zvuk.', 400);
    const d = await this.volat(adresaHledani(polozka, this.klic, strana));
    return (d.results ?? [])
      .filter((x) => x.previews?.['preview-hq-mp3'] && /creativecommons\.org\/publicdomain\/zero/i.test(x.license ?? ''))
      .map((x) => ({
        id: x.id,
        nazev: String(x.name ?? '').slice(0, 120),
        autor: String(x.username ?? '').slice(0, 60),
        delka: Math.round((x.duration ?? 0) * 10) / 10,
        nahled: x.previews['preview-hq-mp3'],
        url: x.url ?? `https://freesound.org/s/${x.id}/`,
        licence: 'CC0',
      }));
  }

  /** Stáhne náhled MP3 (jen z freesound.org a jeho CDN). */
  async stahnout(nahled) {
    const u = new URL(nahled);
    if (u.protocol !== 'https:' || !/(^|\.)freesound\.org$/.test(u.hostname)) throw chyba('Náhled není z freesound.org.', 400);
    const data = await this.volat(u.toString(), { binarni: true });
    if (data.length < 500 || data.length > 40 * 1024 * 1024) throw chyba('Stažený zvuk má divnou velikost.', 502);
    return data;
  }
}
