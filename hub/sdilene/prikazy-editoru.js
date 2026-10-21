// Příkazy „/“ v editoru karty (⚠ bod 149): napíšeš / na začátku řádku nebo po mezeře, nabídka
// ukáže prvky, které jde vložit (nadpis, odrážka, odkaz, tabulka, oddíl podle typu karty …).
// Psaní za lomítkem nabídku zúží, Enter nebo Tab prvek vloží. Čisté funkce bez DOM: editor
// v Hubu i na webu je jen volá.
import { chybejiciOddily, vlozitOddil } from './typy-karet.js';

/** Místo kurzoru v šabloně příkazu. */
const KURZOR = '¦';

const bezDiakritiky = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Pevné příkazy. `blok`: patří na vlastní řádek (uprostřed řádku začne nový). `vlozit`: text
 * s ¦ na místě kurzoru. `odkaz`: po vložení se otevře našeptávání karet.
 */
export const PRIKAZY = Object.freeze([
  { id: 'nadpis', nazev: 'Nadpis oddílu', klice: ['h2', 'oddil'], ukazka: '##', blok: true, vlozit: '## ¦' },
  { id: 'podnadpis', nazev: 'Podnadpis', klice: ['h3'], ukazka: '###', blok: true, vlozit: '### ¦' },
  { id: 'odrazka', nazev: 'Odrážka', klice: ['seznam', 'bod', 'list'], ukazka: '-', blok: true, vlozit: '- ¦' },
  { id: 'cislovany', nazev: 'Číslovaný seznam', klice: ['cisla', 'poradi'], ukazka: '1.', blok: true, vlozit: '1. ¦' },
  { id: 'druzina-vi', nazev: 'Odrážka, kterou družina ví', klice: ['zna', 'odkryta', 'druzina'], ukazka: '%%zná%%', blok: true, vlozit: '- ¦ %%zná%%' },
  { id: 'citace', nazev: 'Citace', klice: ['quote', 'uvozovky'], ukazka: '>', blok: true, vlozit: '> ¦' },
  { id: 'odkaz', nazev: 'Odkaz na kartu', klice: ['karta', 'link', 'wiki'], ukazka: '[[ ]]', vlozit: '[[¦', odkaz: true },
  { id: 'tucne', nazev: 'Tučně', klice: ['bold', 'silne'], ukazka: '**', vlozit: '**¦**' },
  { id: 'kurziva', nazev: 'Kurzíva', klice: ['italic'], ukazka: '*', vlozit: '*¦*' },
  { id: 'poznamka', nazev: 'Skrytá poznámka', klice: ['komentar', 'tajne', 'dm'], ukazka: '%% %%', vlozit: '%% ¦ %%' },
  { id: 'tabulka', nazev: 'Tabulka', klice: ['table', 'sloupce'], ukazka: '| |', blok: true, vlozit: '| ¦ |  |\n| --- | --- |\n|  |  |' },
  { id: 'oddelovac', nazev: 'Oddělovač', klice: ['cara', 'hr'], ukazka: '---', blok: true, vlozit: '---\n¦' },
]);

/**
 * Příkazy pro kartu daného typu: pevné a k nim oddíly, které karta podle šablony ještě nemá
 * (vloží se na své místo v pořadí, ne ke kurzoru).
 */
export function prikazyKarty(typ, telo) {
  const oddily = chybejiciOddily(typ, telo).map((nadpis) => ({
    id: `oddil:${nadpis}`, nazev: `Oddíl ${nadpis}`, klice: ['oddil', 'sekce'], ukazka: 'oddíl', oddil: nadpis,
  }));
  return [...PRIKAZY, ...oddily];
}

/**
 * Lomítko před kurzorem: `/dotaz` na začátku řádku nebo po mezeře (ne v adrese typu a/b).
 * @returns {{od: number, dotaz: string} | null} od = pozice lomítka
 */
export function najitLomitko(text, kurzor) {
  const pred = String(text).slice(0, kurzor);
  const m = /(^|[\s(])\/([\p{L}\d-]{0,24})$/u.exec(pred);
  if (!m) return null;
  return { od: kurzor - m[2].length - 1, dotaz: m[2] };
}

/** Příkazy, které odpovídají dotazu: nejdřív začátek slova v názvu, pak klíče, pak kdekoli. */
export function filtrovatPrikazy(prikazy, dotaz) {
  const q = bezDiakritiky(dotaz).trim();
  if (!q) return [...prikazy];
  const skore = (p) => {
    const slova = bezDiakritiky(p.nazev).split(/\s+/);
    if (slova[0].startsWith(q)) return 0;
    if (slova.some((s) => s.startsWith(q))) return 1;
    if (p.klice.some((k) => bezDiakritiky(k).startsWith(q))) return 2;
    if (bezDiakritiky(p.nazev).includes(q)) return 3;
    return null;
  };
  return prikazy
    .map((p, i) => ({ p, i, s: skore(p) }))
    .filter((x) => x.s !== null)
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.p);
}

/**
 * Provede příkaz: smaže `/dotaz` (od … kurzor) a vloží prvek.
 * @returns {{text: string, kurzor: number, odkaz: boolean}} nový text a kam dát kurzor
 */
export function provestPrikaz(text, od, kurzor, prikaz, typ) {
  const bez = String(text).slice(0, od) + String(text).slice(kurzor);
  if (prikaz.oddil) {
    const novy = vlozitOddil(typ, bez, prikaz.oddil);
    const nadpis = `## ${prikaz.oddil}\n`;
    const kde = novy.indexOf(nadpis);
    // Kurzor pod nadpis nového oddílu (vlozitOddil za něj dává prázdný řádek).
    return { text: novy, kurzor: kde === -1 ? novy.length : Math.min(novy.length, kde + nadpis.length + 1), odkaz: false };
  }
  let pred = bez.slice(0, od);
  const za = bez.slice(od);
  let vlozit = prikaz.vlozit;
  if (prikaz.blok) {
    const zacatekRadku = pred.lastIndexOf('\n') + 1;
    if (pred.slice(zacatekRadku).trim()) vlozit = `\n${vlozit}`; // uprostřed řádku: blok na novém řádku
    else pred = pred.slice(0, zacatekRadku); // jen mezery před lomítkem: blok od kraje
    // Víceřádkový blok (tabulka) nesmí slepit zbytek řádku se svým posledním řádkem.
    if (vlozit.includes('\n') && za && !za.startsWith('\n')) vlozit = `${vlozit}\n`;
  }
  return dokoncit(pred, vlozit, za, prikaz.odkaz);
}

function dokoncit(pred, vlozit, za, odkaz = false) {
  const i = vlozit.indexOf(KURZOR);
  const cisty = vlozit.replace(KURZOR, '');
  return { text: pred + cisty + za, kurzor: pred.length + (i === -1 ? cisty.length : i), odkaz: Boolean(odkaz) };
}
