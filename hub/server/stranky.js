// Čtecí verze kánonu pro GitHub Pages (Blok 3, rozhodnutí 3): statické stránky z kampan/.
//
// Wiki a mapa jsou tentýž kód jako v Hubu (panel/kanon*.js); místo serveru čtou JSON, který
// tady vznikne z modulu Kánon. Pohled družiny je otevřený, pohled DM je zašifrovaný heslem
// (STRANKY_HESLO, ⚠ bod 124): bez hesla se vůbec nepublikuje. Obrázky se zkopírují jen ty,
// které zná družina; obrázky jen pro DM čte pohled DM z repa na GitHubu (repo je veřejné,
// rozhodnutí 2, heslo tedy brání nahlédnutí na webu, ne čtení repa).
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import YAML from 'yaml';
import { HUB_DIR } from './cesty.js';
import { Zapisovac } from './zapis.js';
import { DataKampane } from './data.js';
import { Kalendar } from './kalendar.js';
import { Kanon } from './kanon-modul.js';

const require = createRequire(import.meta.url);

/** PBKDF2 pro heslo DM: stejné parametry čte prohlížeč z hlavičky souboru. */
export const ITERACE_HESLA = 600000;
/** Sůl je stálá, aby klíč zapamatovaný v prohlížeči platil i po dalším sestavení. */
const SUL_HESLA = 'dm-hub:stranky:dm:v1';
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
 * Projde data a obrázky z repa (`/kampan/…`, `/Alba.png`) přepíše funkcí `prevest`
 * (relativní adresa, nebo adresa v repu na GitHubu). Odkaz do Obsidianu na webu nemá smysl, zahodí ho.
 */
export function prepsatAdresy(hodnota, prevest) {
  if (typeof hodnota === 'string') return OBRAZEK.test(hodnota) ? prevest(hodnota) : hodnota;
  if (Array.isArray(hodnota)) return hodnota.map((x) => prepsatAdresy(x, prevest));
  if (hodnota && typeof hodnota === 'object') {
    const vysledek = {};
    for (const [k, v] of Object.entries(hodnota)) vysledek[k] = k === 'obsidian' ? null : prepsatAdresy(v, prevest);
    return vysledek;
  }
  return hodnota;
}

/**
 * Zašifruje data pohledu DM: gzip a AES-256-GCM s klíčem z hesla (PBKDF2-SHA256).
 * Prohlížeč je rozšifruje přes Web Crypto (data = šifrový text + značka, jak to čeká AES-GCM).
 */
export function zasifrovat(data, heslo) {
  const sul = Buffer.from(SUL_HESLA, 'utf8');
  const klic = crypto.pbkdf2Sync(String(heslo).normalize('NFC'), sul, ITERACE_HESLA, 32, 'sha256');
  const iv = crypto.randomBytes(12);
  const sifra = crypto.createCipheriv('aes-256-gcm', klic, iv);
  const telo = Buffer.concat([sifra.update(zlib.gzipSync(Buffer.from(JSON.stringify(data), 'utf8'))), sifra.final(), sifra.getAuthTag()]);
  return { verze: 1, iterace: ITERACE_HESLA, sul: sul.toString('base64'), iv: iv.toString('base64'), data: telo.toString('base64') };
}

/** Opak k zasifrovat (testy a kontrola po sestavení). */
export function rozsifrovat(soubor, heslo) {
  const klic = crypto.pbkdf2Sync(String(heslo).normalize('NFC'), Buffer.from(soubor.sul, 'base64'), soubor.iterace, 32, 'sha256');
  const telo = Buffer.from(soubor.data, 'base64');
  const desifra = crypto.createDecipheriv('aes-256-gcm', klic, Buffer.from(soubor.iv, 'base64'));
  desifra.setAuthTag(telo.subarray(telo.length - 16));
  const gz = Buffer.concat([desifra.update(telo.subarray(0, telo.length - 16)), desifra.final()]);
  return JSON.parse(zlib.gunzipSync(gz).toString('utf8'));
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
 * @param {string} [volby.heslo] heslo k pohledu DM; bez něj se pohled DM nepublikuje
 * @param {string} [volby.repo] repo na GitHubu (obrázky jen pro DM), např. Koneczech/DnD
 * @param {string} [volby.vetev] větev repa
 * @returns {Promise<{entity:number, druzina:number, dm:boolean, obrazky:number, chybiObrazky:string[]}>}
 */
export async function sestavitStranky({ cesty: c, cil, cas = new Date(), heslo = '', repo = 'Koneczech/DnD', vetev = 'main' }) {
  const surovy = `https://raw.githubusercontent.com/${repo}/${vetev}/`;
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

    // Pohled družiny: otevřená data a obrázky, které družina zná.
    const obrazky = new Set();
    const relativne = (adresa) => {
      obrazky.add(adresa);
      return adresa.slice(1);
    };
    const druzina = kanon.seznam('druzina');
    const znaDruzina = new Set(druzina.entity.map((e) => e.id));
    druzina.nastenky = druzina.nastenky.filter((n) => n.pohled === 'druzina');
    await zapsatJson(path.join(cil, 'data', 'kanon-druzina.json'), prepsatAdresy(druzina, relativne));
    for (const e of druzina.entity) {
      await zapsatJson(path.join(cil, 'data', 'entita', 'druzina', `${e.id}.json`), prepsatAdresy(kanon.karta(e.id, 'druzina'), relativne));
    }
    for (const n of druzina.nastenky) {
      const nastenka = kanon.nastenka(n.id);
      await zapsatJson(path.join(cil, 'data', 'nastenky', `${n.id}.json`), { ...nastenka, entity: nastenka.entity.filter((x) => znaDruzina.has(x.id)) });
    }

    // Pohled DM: jen zašifrovaný. Obrázky, které zná družina, sdílí; ostatní bere z repa na GitHubu.
    const dm = kanon.seznam('dm');
    if (heslo) {
      const vRepu = (adresa) => (obrazky.has(adresa) ? adresa.slice(1) : `${surovy}${adresa.slice(1)}`);
      const balik = { seznam: prepsatAdresy(dm, vRepu), karty: {}, nastenky: {} };
      for (const e of dm.entity) balik.karty[e.id] = prepsatAdresy(kanon.karta(e.id, 'dm'), vRepu);
      for (const n of dm.nastenky) balik.nastenky[n.id] = kanon.nastenka(n.id);
      await zapsatJson(path.join(cil, 'data', 'dm.json'), zasifrovat(balik, heslo));
    }
    // `sestaveno` pozná otevřená stránka, že vyšla nová verze, a načte se znovu.
    // `upravy`: adresa editoru GitHubu (tlačítko Na GitHubu, ⚠ bod 144). `zapis`: kam pohled DM
    // ukládá úpravy přes GitHub API (⚠ bod 146). Obojí jen s pohledem DM.
    await zapsatJson(path.join(cil, 'data', 'stranky.json'), {
      dm: Boolean(heslo),
      sestaveno: cas.toISOString(),
      upravy: heslo ? `https://github.com/${repo}/edit/${vetev}/` : null,
      zapis: heslo ? { repo, vetev } : null,
    });

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
    // Knihovna yaml pro prohlížeč (hlavička karet při úpravách na webu); import map v index.html.
    await fs.cp(path.join(path.dirname(require.resolve('yaml/package.json')), 'browser'), path.join(cil, 'vendor', 'yaml'), { recursive: true });
    await fs.copyFile(path.join(path.dirname(require.resolve('yaml/package.json')), 'LICENSE'), path.join(cil, 'vendor', 'yaml', 'LICENSE'));
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

    return { entity: dm.entity.length, druzina: druzina.entity.length, dm: Boolean(heslo), obrazky: obrazky.size - chybiObrazky.length, chybiObrazky };
  } finally {
    await fs.rm(docasna, { recursive: true, force: true }).catch(() => {});
  }
}
