// Převod kánonu (Blok 3): mapa převodu (reference/kanon-mapa.yaml) proti souborům v kampan/.
// Report ke každé skupině odpovídá na akceptační kritéria Bloku 3: počet položek ve zdroji a souborů
// v repu, každý rozdíl vysvětlený (vynecháno, doplnit), `zdroj` u každého souboru a hlášení
// z Kontroly dat. Nic nezapisuje.
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { rozebrat } from '../sdilene/frontmatter.js';
import { TYPY_SLOZEK, cesty } from './cesty.js';
import { kontrolaDat } from './data.js';

export const AKCE = Object.freeze(['prevest', 'sloucit', 'vynechat', 'doplnit', 'ponechat']);
/** Akce, po kterých má v repu ležet soubor. */
const DO_REPA = new Set(['prevest', 'sloucit', 'ponechat']);
/** Typy, které jsou záznam (jeden soubor), ne entita (složka). */
const ZAZNAMY = new Set(['rozhodnuti', 'kanon']);
const SLOZKA_TYPU = Object.fromEntries(Object.entries(TYPY_SLOZEK).map(([slozka, typ]) => [typ, slozka]));
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Cesta souboru položky relativně ke kořeni repa (s /), nebo null, když typ do kampan/ nepatří. */
export function cilPolozky(p) {
  if (p.do) return p.do;
  if (p.cil) return p.cil;
  const slozka = SLOZKA_TYPU[p.typ];
  if (!slozka) return null;
  return ZAZNAMY.has(p.typ) ? `kampan/${slozka}/${p.id}.md` : `kampan/${slozka}/${p.id}/${p.id}.md`;
}

/** Id stránky Notionu z odkazu (32 hex znaků), nebo null. */
export function idNotionu(text) {
  const m = /([0-9a-f]{32})(?![0-9a-f])/i.exec(String(text ?? '').replace(/-/g, ''));
  return m ? m[1].toLowerCase() : null;
}

export async function nacistMapu(soubor) {
  return YAML.parse(await fs.readFile(soubor, 'utf8'));
}

/**
 * Ověří mapu převodu. Chyby brání převodu, varování ne.
 * @returns {{chyby: string[], varovani: string[]}}
 */
export function overitMapu(mapa) {
  const chyby = [];
  const varovani = [];
  const skupiny = new Set((mapa?.skupiny ?? []).map((s) => s.id));
  const polozky = Array.isArray(mapa?.polozky) ? mapa.polozky : [];
  if (!skupiny.size) chyby.push('Mapa nemá žádné skupiny.');
  const ids = new Map();
  const notion = new Map();
  for (const p of polozky) {
    const kdo = p?.id ?? '(bez id)';
    if (!p?.id || !SLUG.test(String(p.id))) chyby.push(`Položka „${kdo}“: id musí být slug (malá písmena bez diakritiky, pomlčky).`);
    if (ids.has(p.id)) chyby.push(`Duplicitní id „${p.id}“.`);
    ids.set(p.id, p);
    if (!skupiny.has(p.skupina)) chyby.push(`Položka „${kdo}“: neznámá skupina „${p.skupina}“.`);
    if (!AKCE.includes(p.akce)) chyby.push(`Položka „${kdo}“: neznámá akce „${p.akce}“.`);
    if (DO_REPA.has(p.akce) && !cilPolozky(p)) chyby.push(`Položka „${kdo}“: typ „${p.typ}“ nemá složku v kampan/ a chybí pole cil.`);
    if (p.akce === 'sloucit' && !p.do) chyby.push(`Položka „${kdo}“: sloučení potřebuje pole do.`);
    if (p.akce === 'vynechat' && !p.proc) chyby.push(`Položka „${kdo}“: vynechání potřebuje vysvětlení v poli proc.`);
    const n = idNotionu(p.zdroj);
    if (n) {
      if (notion.has(n)) chyby.push(`Karta Notionu ${n} je v mapě dvakrát („${notion.get(n)}“ a „${kdo}“).`);
      notion.set(n, kdo);
    }
  }
  for (const p of polozky) {
    for (const v of p.vazby ?? []) if (!ids.has(v)) varovani.push(`Položka „${p.id}“: vazba na „${v}“, které v mapě není.`);
  }
  return { chyby, varovani };
}

async function hlavicka(soubor) {
  try {
    const r = rozebrat(await fs.readFile(soubor, 'utf8'));
    return r.maHlavicku && !r.chyba ? r.data : { chybaHlavicky: r.chyba ?? 'Chybí hlavička YAML' };
  } catch {
    return null;
  }
}

async function souboryEntit(koren, slozka) {
  const vysledek = [];
  let polozky;
  try {
    polozky = await fs.readdir(path.join(koren, 'kampan', slozka), { withFileTypes: true });
  } catch {
    return vysledek;
  }
  for (const p of polozky) {
    if (p.name.startsWith('.')) continue;
    if (p.isFile() && p.name.endsWith('.md')) vysledek.push(`kampan/${slozka}/${p.name}`);
    if (p.isDirectory()) {
      const hlavni = `kampan/${slozka}/${p.name}/${p.name}.md`;
      try {
        await fs.access(path.join(koren, ...hlavni.split('/')));
        vysledek.push(hlavni);
      } catch {
        /* složka bez hlavního souboru (třeba jen obrázky) */
      }
    }
  }
  return vysledek;
}

/**
 * Report převodu po skupinách.
 * @param {{koren: string, mapa: object}} volby
 */
export async function reportPrevodu({ koren, mapa }) {
  const overeni = overitMapu(mapa);
  const polozky = Array.isArray(mapa?.polozky) ? mapa.polozky : [];
  const kontrola = await kontrolaDat(cesty(koren));
  const problemyPodleSouboru = new Map();
  for (const pr of kontrola.problemy) {
    if (!problemyPodleSouboru.has(pr.soubor)) problemyPodleSouboru.set(pr.soubor, []);
    problemyPodleSouboru.get(pr.soubor).push(pr);
  }
  const vMape = new Set(polozky.filter((p) => DO_REPA.has(p.akce)).map((p) => cilPolozky(p)));

  const skupiny = [];
  for (const s of [...(mapa?.skupiny ?? [])].sort((a, b) => (a.poradi ?? 0) - (b.poradi ?? 0))) {
    const vlastni = polozky.filter((p) => p.skupina === s.id);
    const r = {
      id: s.id,
      nazev: s.nazev ?? s.id,
      zdroj: {
        celkem: vlastni.filter((p) => p.akce !== 'ponechat').length,
        prevest: vlastni.filter((p) => p.akce === 'prevest' || p.akce === 'sloucit').length,
        vynechat: vlastni.filter((p) => p.akce === 'vynechat').map((p) => ({ id: p.id, nazev: p.nazev, proc: p.proc })),
        doplnit: vlastni.filter((p) => p.akce === 'doplnit').map((p) => ({ id: p.id, nazev: p.nazev, zdroj: p.zdroj })),
      },
      hotovo: [],
      chybi: [],
      bezZdroje: [],
      nesedi: [],
      navic: [],
      problemy: [],
    };
    const slozky = new Set();
    for (const p of vlastni) {
      if (!DO_REPA.has(p.akce)) continue;
      const cil = cilPolozky(p);
      if (cil?.startsWith('kampan/')) slozky.add(cil.split('/')[1]);
      if (!cil) continue;
      const d = await hlavicka(path.join(koren, ...cil.split('/')));
      if (!d) {
        if (p.akce !== 'ponechat') r.chybi.push({ id: p.id, nazev: p.nazev, cil });
        continue;
      }
      if (p.akce === 'ponechat') continue;
      if (d.chybaHlavicky) {
        r.nesedi.push({ id: p.id, cil, zprava: d.chybaHlavicky });
        continue;
      }
      // Sloučení do existujícího souboru je hotové, až soubor nese odkaz na kartu.
      const nZdroj = idNotionu(p.zdroj);
      const maZdroj = nZdroj ? [d.zdroj].flat().some((z) => idNotionu(z) === nZdroj) : Boolean(d.zdroj);
      if (p.akce === 'sloucit' && !maZdroj) {
        r.chybi.push({ id: p.id, nazev: p.nazev, cil, sloucit: true });
        continue;
      }
      r.hotovo.push({ id: p.id, cil });
      if (!maZdroj) r.bezZdroje.push({ id: p.id, cil });
      if (String(d.id) !== String(p.id) && p.akce !== 'sloucit' && cil.startsWith('kampan/')) r.nesedi.push({ id: p.id, cil, zprava: `id v souboru je „${d.id}“` });
      if (d.typ !== p.typ && cil.startsWith('kampan/')) r.nesedi.push({ id: p.id, cil, zprava: `typ v souboru je „${d.typ}“, mapa čeká „${p.typ}“` });
      for (const pr of problemyPodleSouboru.get(cil) ?? []) r.problemy.push({ id: p.id, ...pr });
    }
    for (const slozka of slozky) {
      for (const soubor of await souboryEntit(koren, slozka)) if (!vMape.has(soubor)) r.navic.push(soubor);
    }
    const chybyKontroly = r.problemy.filter((p) => p.uroven === 'chyba').length;
    if (!r.hotovo.length && r.zdroj.prevest) r.stav = 'nezačato';
    else if (!r.chybi.length && !r.bezZdroje.length && !r.nesedi.length && !chybyKontroly) r.stav = 'hotovo';
    else r.stav = 'rozpracováno';
    skupiny.push(r);
  }
  return { mapa: overeni, skupiny };
}
