// Karta sezení ve wiki (⚠ bod 158): z čeho se skládá a jak daleko je zápis sezení do kánonu.
// Sdílí ji server (dopočítané údaje karty) a panel (rozdělení textu na oddíly stránky), proto
// nesmí importovat nic, co v prohlížeči nejde (karta-kanonu.js čte YAML).
import { jeNadpisDm as jeOddilDm } from './oddil-dm.js';

const bezDiakritiky = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Oddíl, který Hub píše sám během hry (Poznámka F2, Další den, Zahájit a Ukončit sezení). */
export const ODDIL_POZNAMEK = 'Poznámky ze stolu';
export const jeOddilPoznamek = (nadpis) => bezDiakritiky(nadpis) === bezDiakritiky(ODDIL_POZNAMEK);
export const jeOddilShrnuti = (nadpis) => bezDiakritiky(nadpis) === 'shrnuti';

/**
 * Text karty sezení po částech stránky. Oddíl = nadpis ## i s vnořenými ### pod ním.
 * - uvod: text před prvním ## (i s nadpisem # karty)
 * - shrnuti: oddíl Shrnutí
 * - ostatni: ostatní oddíly v pořadí souboru (Tajemství a stopy, Poklady, Otevřené nitky, Scény…)
 * - dm: oddíly DM a Neplatné (stránka je ukáže dole)
 * - poznamky: oddíl Poznámky ze stolu (deník ze hry)
 * @returns {{uvod: string, shrnuti: string, ostatni: string, dm: string, poznamky: string}}
 */
export function castiSezeni(telo) {
  // Skupiny podle nadpisů # a ##; ### a hlubší zůstávají ve svém oddílu. Bloky kódu se nedělí.
  const skupiny = [{ nadpis: null, uroven: 0, text: [] }];
  let vKodu = false;
  for (const radek of String(telo ?? '').split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(radek)) vKodu = !vKodu;
    const m = !vKodu && /^(#{1,2})\s+(.*?)\s*#*\s*$/.exec(radek);
    if (m && m[1].length === 2) skupiny.push({ nadpis: m[2], uroven: 2, text: [radek] });
    else if (m) skupiny.push({ nadpis: null, uroven: 1, text: [radek] });
    else skupiny[skupiny.length - 1].text.push(radek);
  }
  const casti = { uvod: [], shrnuti: [], ostatni: [], dm: [], poznamky: [] };
  for (const s of skupiny) {
    const text = s.text.join('\n');
    if (!text.trim()) continue;
    if (s.nadpis === null) casti.uvod.push(text);
    else if (jeOddilDm(s.nadpis)) casti.dm.push(text);
    else if (jeOddilPoznamek(s.nadpis)) casti.poznamky.push(text);
    else if (jeOddilShrnuti(s.nadpis)) casti.shrnuti.push(text);
    else casti.ostatni.push(text);
  }
  return Object.fromEntries(Object.entries(casti).map(([k, v]) => [k, v.join('\n\n').trim()]));
}

/** Má oddíl obsah kromě nadpisu a komentářů %%…%%? */
export function maObsah(text) {
  return String(text ?? '').replace(/%%[\s\S]*?%%/g, '').replace(/^#{1,6}\s.*$/gm, '').trim().length > 0;
}

/** Počet řádků v oddílu Poznámky ze stolu (odrážky). */
export function pocetPoznamek(telo) {
  return castiSezeni(telo).poznamky.split('\n').filter((r) => /^\s*[-*+]\s+\S/.test(r)).length;
}

/**
 * Jak daleko je zápis sezení do kánonu.
 * - zapsano: sezení má shrnutí nebo aspoň jeden záznam hráčského kánonu
 * - bezi: poslední sezení bez konce (běží nebo se chystá)
 * - ceka: odehrané a ještě nezapsané; návrh po sezení může být předběžný, finální, nebo žádný
 * @param {{zapsano: boolean, konec: boolean, posledni: boolean}} s
 * @returns {'zapsano'|'bezi'|'ceka'}
 */
export function stavZapisu({ zapsano, konec, posledni }) {
  if (zapsano) return 'zapsano';
  if (!konec && posledni) return 'bezi';
  return 'ceka';
}

/** Délka sezení v minutách ze začátku a konce v hlavičce (`2026-10-24T12:20`), jinak null. */
export function delkaMinut(zacatek, konec) {
  const z = new Date(String(zacatek ?? ''));
  const k = new Date(String(konec ?? ''));
  if (Number.isNaN(z.getTime()) || Number.isNaN(k.getTime()) || k < z) return null;
  return Math.round((k - z) / 60000);
}

/** „4 h 25 min“, „45 min“. */
export function delkaText(minut) {
  if (!Number.isFinite(minut)) return '';
  const h = Math.floor(minut / 60);
  const m = minut % 60;
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}

/** „24. 10. 2026“ z `2026-10-24`. */
export function datumCesky(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(text ?? ''));
  return m ? `${Number(m[3])}. ${Number(m[2])}. ${m[1]}` : '';
}

/** „12:20“ z `2026-10-24T12:20`. */
export function casText(text) {
  const m = /T(\d{2}):(\d{2})/.exec(String(text ?? ''));
  return m ? `${m[1]}:${m[2]}` : '';
}

/** Tělo karty bez oddílu Poznámky ze stolu (deník ze hry se nekontroluje jako text karty). */
export function bezPoznamekZeStolu(telo) {
  const vysledek = [];
  let vPoznamkach = false;
  let vKodu = false;
  for (const radek of String(telo ?? '').split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(radek)) vKodu = !vKodu;
    const m = !vKodu && /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(radek);
    if (m && m[1].length <= 2) vPoznamkach = m[1].length === 2 && jeOddilPoznamek(m[2]);
    if (!vPoznamkach) vysledek.push(radek);
  }
  return vysledek.join('\n');
}
