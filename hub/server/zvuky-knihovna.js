// Soundboard a zvuky na tahu (otevřený bod 76): čisté funkce nad seznamem souborů ve složce zvuku
// a nad mapou `kampan/zvuky.yaml`. Soubory zůstávají mimo repo (rozhodnutí 63); repo zná jen jména.
//
// Složky ve složce zvuku:
//   jednorazove/<kategorie>/…  jednorázové zvuky (klik = jedno přehrání); stará složka efekty/ platí taky
//   smycky/<kategorie>/…       smyčky (klik = zapnout, další klik = vypnout)
//   tahy/…                     zvuky na tah v souboji
//   nahodne/<kategorie>/…      náhodné zvuky prostředí (otevřený bod 85): hrají samy občas pod ambientem
// Varianty jednoho zvuku: `vlk-1.mp3`, `vlk-2.mp3` … jsou jedno tlačítko „vlk“, hraje náhodná varianta.
import path from 'node:path';

export const DRUHY = Object.freeze(['jednorazove', 'smycky', 'tahy', 'nahodne']);
/** Kořenová složka → druh zvuku. `efekty/` je původní složka ručních efektů (Blok 5). */
const KORENY = Object.freeze({ jednorazove: 'jednorazove', efekty: 'jednorazove', smycky: 'smycky', tahy: 'tahy', nahodne: 'nahodne' });
const MAX_LIMIT_S = 600;

/** ID skupiny: cesta bez přípony a bez čísla varianty na konci (`jednorazove/boj/mec-2.mp3` → `jednorazove/boj/mec`). */
export function idSkupiny(soubor) {
  const bez = soubor.slice(0, soubor.length - path.posix.extname(soubor).length);
  return bez.replace(/[-_ ]\d{1,3}$/, '');
}

/** Platné ID zvuku z dat: relativní cesta s lomítky, bez „..“ a bez přípony. */
export function platneId(id) {
  if (typeof id !== 'string' || !id || id.length > 200) return null;
  const s = id.replace(/\\/g, '/').trim();
  if (s.startsWith('/') || /^[a-z]:/i.test(s) || s.split('/').some((x) => x === '..' || x === '' || x === '.')) return null;
  return s;
}

/** Popisek ze jména souboru: `poplasny-zvon` → „Poplasny zvon“. */
function popisek(id) {
  const t = id.split('/').pop().replace(/[-_]+/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : id;
}

/**
 * Knihovna ze seznamu souborů ve složce zvuku.
 * @param {string[]} soubory relativní cesty s lomítky
 * @param {object} mapa normalizovaná mapa z kampan/zvuky.yaml (popisky, limity smyček)
 * @returns {{jednorazove: object[], smycky: object[], tahy: object[], nahodne: object[]}} skupiny {id, nazev, kategorie, soubory, limit_s?}
 */
export function sestavitKnihovnu(soubory, mapa = normalizujMapu()) {
  const skupiny = new Map();
  for (const soubor of soubory) {
    const casti = soubor.split('/');
    const druh = KORENY[casti[0]];
    if (!druh || casti.length < 2) continue;
    const id = idSkupiny(soubor);
    let s = skupiny.get(id);
    if (!s) {
      const kategorie = casti[0] === 'efekty' ? 'efekty' : casti.length > 2 ? casti[1] : 'ostatní';
      const meta = mapa.zvuky[id] ?? {};
      s = { id, druh, nazev: meta.nazev ?? popisek(id), kategorie, soubory: [] };
      if (druh === 'smycky' && meta.limit_s) s.limit_s = meta.limit_s;
      skupiny.set(id, s);
    }
    s.soubory.push(soubor);
  }
  const vysledek = { jednorazove: [], smycky: [], tahy: [], nahodne: [] };
  for (const s of skupiny.values()) {
    const { druh, ...zbytek } = s;
    vysledek[druh].push(zbytek);
  }
  const razeni = (a, b) => a.kategorie.localeCompare(b.kategorie, 'cs') || a.nazev.localeCompare(b.nazev, 'cs');
  for (const d of DRUHY) vysledek[d].sort(razeni);
  return vysledek;
}

/**
 * Skupina podle ID z dat. Stačí i krátké ID bez kořene (`zvirata/vlk` najde `jednorazove/zvirata/vlk`).
 * @returns {{skupina: object, druh: string}|null}
 */
export function najitSkupinu(knihovna, id) {
  const j = platneId(id);
  if (!j) return null;
  const kandidati = [j, `jednorazove/${j}`, `nahodne/${j}`, `tahy/${j}`, `efekty/${j}`, `smycky/${j}`];
  for (const k of kandidati) {
    for (const druh of DRUHY) {
      const skupina = knihovna[druh].find((s) => s.id.toLowerCase() === k.toLowerCase());
      if (skupina) return { skupina, druh };
    }
  }
  return null;
}

/** Náhodná varianta, nikdy dvakrát stejná za sebou (když jsou aspoň dvě). */
export function vybratVariantu(skupina, posledni, nahodne = Math.random) {
  const moznosti = skupina.soubory.length > 1 ? skupina.soubory.filter((s) => s !== posledni) : skupina.soubory;
  return moznosti[Math.floor(nahodne() * moznosti.length) % moznosti.length];
}

const textNeboNull = (x) => (typeof x === 'string' && x.trim() ? x.trim() : null);

/** Mapa tagů {„Vlk“: id} → klíče malými písmeny. */
function mapaTagu(x) {
  const m = {};
  if (x && typeof x === 'object') for (const [tag, id] of Object.entries(x)) if (platneId(id)) m[tag.trim().toLowerCase()] = platneId(id);
  return m;
}

/**
 * `kampan/zvuky.yaml`:
 *   zvuky: { <id>: { nazev, limit_s } }   popisky tlačítek a automatický konec smyček
 *   tahy:
 *     postavy: { <jméno>: <id> | { vychozi: <id>, podle_tagu: { <tag>: <id> } } }
 *     tagy: { <tag>: <id> }                pro kohokoli na tahu (třeba Unconscious)
 *     nepratele: <id>                      jeden společný zvuk pro ostatní bytosti
 */
export function normalizujMapu(d = {}) {
  const zvuky = {};
  for (const [id, meta] of Object.entries(d?.zvuky ?? {})) {
    const j = platneId(id);
    if (!j || !meta || typeof meta !== 'object') continue;
    const z = {};
    if (textNeboNull(meta.nazev)) z.nazev = textNeboNull(meta.nazev).slice(0, 60);
    const limit = Number(meta.limit_s);
    if (Number.isFinite(limit) && limit > 0) z.limit_s = Math.min(MAX_LIMIT_S, Math.round(limit));
    zvuky[j] = z;
  }
  const t = d?.tahy ?? {};
  const postavy = {};
  for (const [jmeno, x] of Object.entries(t.postavy ?? {})) {
    const klic = jmeno.trim().toLowerCase();
    if (!klic) continue;
    if (typeof x === 'string') {
      if (platneId(x)) postavy[klic] = { vychozi: platneId(x), podle_tagu: {} };
    } else if (x && typeof x === 'object') {
      postavy[klic] = { vychozi: platneId(x.vychozi), podle_tagu: mapaTagu(x.podle_tagu) };
    }
  }
  return { zvuky, tahy: { postavy, tagy: mapaTagu(t.tagy), nepratele: platneId(t.nepratele) } };
}

/** Odpovídá jméno z Improved Initiative klíči z mapy? „Alba“ najde i „Alba Nox“ a „Alba (vlk)“. */
function shodaJmena(jmeno, klic) {
  const j = jmeno.trim().toLowerCase();
  return j === klic || j.startsWith(`${klic} `) || j.startsWith(`${klic} (`) || klic.startsWith(`${j} `);
}

/**
 * Zvuk na tah. Pořadí: tag postavy → tag pro kohokoli → výchozí zvuk postavy → společný zvuk nepřátel
 * (jen pro bytosti, které nejsou postavy hráčů). Postava hráče bez zápisu v mapě zůstane potichu.
 * @param {{jmeno: string, hrac: boolean, tagy: string[]}} kdo
 * @returns {string|null} ID zvuku
 */
export function zvukTahu(mapa, { jmeno, hrac, tagy = [] }) {
  const t = mapa.tahy;
  const malymi = tagy.map((x) => x.trim().toLowerCase());
  const klic = Object.keys(t.postavy).find((k) => shodaJmena(String(jmeno ?? ''), k));
  const postava = klic ? t.postavy[klic] : null;
  for (const tag of malymi) if (postava?.podle_tagu[tag]) return postava.podle_tagu[tag];
  for (const tag of malymi) if (t.tagy[tag]) return t.tagy[tag];
  if (postava?.vychozi) return postava.vychozi;
  if (!hrac && !postava) return t.nepratele;
  return null;
}

/** Všechna ID, na která mapa odkazuje (Kontrola dat). */
export function odkazyMapy(mapa) {
  const t = mapa.tahy;
  const ids = [t.nepratele, ...Object.values(t.tagy)];
  for (const p of Object.values(t.postavy)) ids.push(p.vychozi, ...Object.values(p.podle_tagu));
  return [...new Set(ids.filter(Boolean))];
}
