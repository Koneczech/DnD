// Čtecí verze kánonu pro GitHub Pages (Blok 3, rozhodnutí 3): statické stránky z kampan/.
//
// Wiki a mapa jsou tentýž kód jako v Hubu (panel/kanon*.js); místo serveru čtou JSON, který
// tady vznikne z modulu Kánon pro oba pohledy (DM a družina). Obrázky karet se zkopírují vedle.
// Repo je veřejné (rozhodnutí 2), čtecí verze ukazuje totéž co repo; pohled družiny je filtr, ne ochrana.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { HUB_DIR } from './cesty.js';
import { Zapisovac } from './zapis.js';
import { DataKampane } from './data.js';
import { Kalendar } from './kalendar.js';
import { Kanon } from './kanon-modul.js';

const POHLEDY = ['dm', 'druzina'];
const OBRAZEK = /^\/[^/].*\.(png|jpe?g|webp)$/i;
/** Soubory panelu, které wiki a mapa potřebují. */
const SOUBORY_PANELU = ['kanon.js', 'kanon-spolecne.js', 'kanon-wiki.js', 'kanon-editor.js', 'styly.css', 'ikona.svg'];

/** Vyřízne z HTML prvek od `<tag id="…"` po jeho konec (stejně odsazený uzavírací tag). */
export function vyriznout(html, tag, id) {
  const zacatek = html.search(new RegExp(`^([ \\t]*)<${tag} id="${id}"`, 'm'));
  if (zacatek === -1) throw new Error(`V panel/index.html chybí <${tag} id="${id}">.`);
  const odsazeni = /^[ \t]*/.exec(html.slice(zacatek))[0];
  const konecTagu = `\n${odsazeni}</${tag}>`;
  const konec = html.indexOf(konecTagu, zacatek);
  if (konec === -1) throw new Error(`V panel/index.html chybí konec <${tag} id="${id}">.`);
  return html.slice(zacatek, konec + konecTagu.length);
}

/**
 * Projde data a obrázky z repa (`/kampan/…`, `/Alba.png`) přepíše na relativní adresy;
 * jejich cesty posbírá do `obrazky`. Odkaz do Obsidianu na webu nemá smysl, zahodí ho.
 */
export function prepsatAdresy(hodnota, obrazky) {
  if (typeof hodnota === 'string') {
    if (!OBRAZEK.test(hodnota)) return hodnota;
    obrazky.add(hodnota);
    return hodnota.slice(1);
  }
  if (Array.isArray(hodnota)) return hodnota.map((x) => prepsatAdresy(x, obrazky));
  if (hodnota && typeof hodnota === 'object') {
    const vysledek = {};
    for (const [k, v] of Object.entries(hodnota)) vysledek[k] = k === 'obsidian' ? null : prepsatAdresy(v, obrazky);
    return vysledek;
  }
  return hodnota;
}

async function zapsatJson(cil, data) {
  await fs.mkdir(path.dirname(cil), { recursive: true });
  await fs.writeFile(cil, JSON.stringify(data));
}

async function kopirovatSlozku(z, kam, filtr = () => true) {
  await fs.mkdir(kam, { recursive: true });
  for (const polozka of await fs.readdir(z, { withFileTypes: true })) {
    if (polozka.isFile() && filtr(polozka.name)) await fs.copyFile(path.join(z, polozka.name), path.join(kam, polozka.name));
  }
}

/**
 * Sestaví čtecí verzi do složky `cil` (smaže její obsah).
 * @param {object} volby
 * @param {object} volby.cesty cesty repa (cesty.js)
 * @param {string} volby.cil výstupní složka
 * @param {Date} [volby.cas] čas sestavení (do lišty)
 * @returns {Promise<{entity:number, druzina:number, obrazky:number, chybiObrazky:string[]}>}
 */
export async function sestavitStranky({ cesty: c, cil, cas = new Date() }) {
  const docasna = await fs.mkdtemp(path.join(os.tmpdir(), 'dmhub-stranky-'));
  try {
    const zapisovac = new Zapisovac({ zurnal: path.join(docasna, 'zurnal') });
    const data = new DataKampane({ cesty: c, zapisovac });
    await data.nacist();
    const kalendar = new Kalendar({ cesty: c, data, zapisovac });
    await kalendar.nacist();
    const kanon = new Kanon({ cesty: c, zapisovac, kalendar });
    await kanon.nacist();

    await fs.rm(cil, { recursive: true, force: true });
    await fs.mkdir(cil, { recursive: true });
    const obrazky = new Set();
    const pocty = {};
    for (const pohled of POHLEDY) {
      const seznam = kanon.seznam(pohled);
      pocty[pohled] = seznam.entity.length;
      await zapsatJson(path.join(cil, 'data', `kanon-${pohled}.json`), prepsatAdresy(seznam, obrazky));
      for (const e of seznam.entity) {
        await zapsatJson(path.join(cil, 'data', 'entita', pohled, `${e.id}.json`), prepsatAdresy(kanon.karta(e.id, pohled), obrazky));
      }
    }
    for (const n of kanon.seznam('dm').nastenky) {
      await zapsatJson(path.join(cil, 'data', 'nastenky', `${n.id}.json`), prepsatAdresy(kanon.nastenka(n.id), obrazky));
    }

    // Obrázky karet (portréty, ilustrace míst) ze stejných cest jako v repu.
    const chybiObrazky = [];
    for (const adresa of obrazky) {
      const relativni = decodeURIComponent(adresa).slice(1).split('/');
      if (relativni.some((cast) => cast === '..' || cast === '')) continue;
      const zdroj = path.join(c.koren, ...relativni);
      const kam = path.join(cil, ...relativni);
      try {
        await fs.mkdir(path.dirname(kam), { recursive: true });
        await fs.copyFile(zdroj, kam);
      } catch {
        chybiObrazky.push(adresa);
      }
    }

    // Kód: moduly Kánonu z panelu, sdílené moduly a obal čtecí verze.
    const panel = path.join(HUB_DIR, 'panel');
    await kopirovatSlozku(panel, path.join(cil, 'panel'), (jmeno) => SOUBORY_PANELU.includes(jmeno));
    await kopirovatSlozku(path.join(HUB_DIR, 'sdilene'), path.join(cil, 'sdilene'), (jmeno) => jmeno.endsWith('.js'));
    await fs.copyFile(path.join(HUB_DIR, 'stranky', 'app.js'), path.join(cil, 'app.js'));

    const indexPanelu = await fs.readFile(path.join(panel, 'index.html'), 'utf8');
    const kampan = YAML.parse(await fs.readFile(path.join(c.kampan, 'kampan.yaml'), 'utf8').catch(() => '')) ?? {};
    const nazev = String(kampan.nazev ?? 'Kampaň').replace(/[&<>"]/g, (z) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[z]);
    const stav = cas.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'Europe/Prague' });
    const sablona = await fs.readFile(path.join(HUB_DIR, 'stranky', 'index.html'), 'utf8');
    const html = sablona
      .replaceAll('{{NAZEV}}', nazev)
      .replaceAll('{{STAV}}', stav)
      .replace('<!-- KANON -->', vyriznout(indexPanelu, 'section', 'obrazovka-kanon'))
      .replace('<!-- DIALOGY -->', ['dialog-nova-karta', 'dialog-nastenka'].map((id) => vyriznout(indexPanelu, 'dialog', id)).join('\n\n'));
    await fs.writeFile(path.join(cil, 'index.html'), html);
    // GitHub Pages bez Jekyllu (jinak by vynechal soubory začínající podtržítkem).
    await fs.writeFile(path.join(cil, '.nojekyll'), '');

    return { entity: pocty.dm, druzina: pocty.druzina, obrazky: obrazky.size - chybiObrazky.length, chybiObrazky };
  } finally {
    await fs.rm(docasna, { recursive: true, force: true }).catch(() => {});
  }
}
