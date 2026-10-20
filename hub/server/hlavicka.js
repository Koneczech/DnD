// Přesné úpravy hlavičky karty kánonu (Blok 3, rozhodnutí 69).
//
// Hub smí na kartě měnit jen vazby, vztahy, přezdívky, štítek `aktualni` a `verejne`. Zbytek
// souboru zůstane bajt po bajtu, jak ho DM napsal v Obsidianu: přepíše se jen text hodnoty
// měněného klíče, ne celá hlavička. `git diff` pak ukáže jediný změněný řádek (u vztahů jen
// změněné řádky). Celkové přeformátování přes YAML.stringify by změnilo mezery v [ ] u všech
// polí (akceptační kritérium Bloku 3).
import YAML from 'yaml';

const OTEVRENI = /^(﻿)?---\r?\n/;

/** Pořadí klíčů, podle kterého se chybějící klíč vloží na rozumné místo (jako v šablonách). */
const PORADI = [
  'schema', 'id', 'typ', 'nazev', 'verejne', 'ikona', 'hrac', 'druh', 'povolani', 'stav', 'oblast',
  'zaznamenano', 'sezeni', 'kdo', 'doresit', 'aliases', 'vazby', 'vztahy', 'tags', 'ilustrace', 'zdroj',
];

const JEDNODUCHY_STITEK = /^[\p{L}\p{N}_-]+$/u;

/** Odkaz [[id]] ve tvaru, jaký mají převedené karty. */
export const odkaz = (id) => `[[${id}]]`;

/** Id z odkazu "[[id]]", "[[id|popisek]]" nebo z holého id. */
export function idZOdkazu(text) {
  const t = String(text ?? '').trim();
  const m = /^\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/.exec(t);
  return (m ? m[1] : t).trim();
}

/** Textová pole hlavičky, která jde upravit v editoru karty (Blok 3, plný editor). */
export const TEXTOVA_POLE = Object.freeze(['nazev', 'ikona', 'hrac', 'druh', 'povolani', 'stav', 'oblast', 'zaznamenano', 'sezeni']);
const PROSTY_TEXT = /^[\p{L}\p{N}\p{Extended_Pictographic}][\p{L}\p{N}\p{Extended_Pictographic}\uFE0F\u200D ()'.,–—-]*$/u;
const ZVLASTNI = /^(true|false|null|yes|no|on|off|y|n|~|[-+]?[\d.]+(e[-+]?\d+)?)$/i;

/** Text bez uvozovek, když to YAML dovolí (hrac: Martin), jinak v uvozovkách. */
function vykreslitText(hodnota, vzdyUvozovky = false) {
  const t = String(hodnota ?? '');
  if (!vzdyUvozovky && t && t === t.trim() && PROSTY_TEXT.test(t) && !ZVLASTNI.test(t)) return t;
  return JSON.stringify(t);
}

/** Text hodnoty v domácím stylu karet. */
function vykreslit(klic, hodnota, puvodniUvozovky = false) {
  if (TEXTOVA_POLE.includes(klic)) return vykreslitText(hodnota, puvodniUvozovky || klic === 'nazev');
  if (klic === 'doresit') return hodnota ? 'true' : 'false';
  if (klic === 'kdo') return `[${hodnota.map((t) => (JEDNODUCHY_STITEK.test(t) ? t : JSON.stringify(t))).join(', ')}]`;
  if (klic === 'verejne') return hodnota ? 'true' : 'false';
  if (klic === 'tags') return `[${hodnota.map((t) => (JEDNODUCHY_STITEK.test(t) ? t : JSON.stringify(t))).join(', ')}]`;
  if (klic === 'aliases') return `[${hodnota.map((a) => JSON.stringify(a)).join(', ')}]`;
  if (klic === 'vazby') return `[${hodnota.map((id) => JSON.stringify(odkaz(id))).join(', ')}]`;
  throw new Error(`Klíč ${klic} se takto zapsat nedá`);
}

/** Jeden vztah jako mapa na jeden řádek: { s: "[[id]]", popis: "…", postoj: 2, verejne: true } */
export function vykreslitVztah(v) {
  const casti = [`s: ${JSON.stringify(odkaz(v.s))}`, `popis: ${JSON.stringify(v.popis)}`];
  if (Number.isInteger(v.postoj)) casti.push(`postoj: ${v.postoj}`);
  if (v.verejne === true) casti.push('verejne: true');
  return `{ ${casti.join(', ')} }`;
}

/** Vztah z hlavičky v jednotném tvaru (pro porovnání, jestli se změnil). */
export function normalizujVztah(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const s = idZOdkazu(v.s);
  if (!s) return null;
  return {
    s,
    popis: typeof v.popis === 'string' ? v.popis : '',
    postoj: Number.isInteger(v.postoj) ? v.postoj : null,
    verejne: v.verejne === true,
  };
}

const stejnyVztah = (a, b) => a && b && a.s === b.s && a.popis === b.popis && a.postoj === b.postoj && a.verejne === b.verejne;

function rozdelit(text) {
  const m = OTEVRENI.exec(text);
  if (!m) throw new Error('Soubor nemá hlavičku YAML');
  const zacatek = m[0].length;
  const zbytek = text.slice(zacatek);
  const konec = zbytek.search(/^---[ \t]*(\r?\n|$)/m);
  if (konec === -1) throw new Error('Hlavička nemá ukončovací řádek ---');
  return { pred: text.slice(0, zacatek), yaml: zbytek.slice(0, konec), za: zbytek.slice(konec) };
}

function parovat(yaml) {
  const dokument = YAML.parseDocument(yaml);
  if (dokument.errors.length) throw new Error(`Chyba v YAML: ${dokument.errors[0].message.split('\n')[0]}`);
  if (!YAML.isMap(dokument.contents)) throw new Error('Hlavička musí být mapa klíč: hodnota');
  return dokument;
}

const najitPar = (dokument, klic) => dokument.contents.items.find((p) => YAML.isScalar(p.key) && p.key.value === klic) ?? null;

/** Kam vložit chybějící klíč: za poslední existující klíč, který mu v PORADI předchází. */
function mistoVlozeni(yaml, dokument, klic) {
  const index = PORADI.indexOf(klic);
  let za = null;
  for (const p of dokument.contents.items) {
    const i = PORADI.indexOf(p.key?.value);
    if (i !== -1 && i < index) za = p;
  }
  if (!za) return yaml.length;
  const konecHodnoty = za.value?.range?.[2] ?? za.key.range[2];
  const radek = yaml.indexOf('\n', Math.max(0, konecHodnoty - 1));
  return radek === -1 ? yaml.length : radek + 1;
}

function vlozitRadek(yaml, pozice, radek) {
  const pred = yaml.slice(0, pozice);
  const oddelovac = pred && !pred.endsWith('\n') ? '\n' : '';
  return `${pred}${oddelovac}${radek}\n${yaml.slice(pozice)}`;
}

/** Nahradí hodnotu jednoduchého klíče (skalár nebo seznam na jeden řádek). */
function nahraditHodnotu(yaml, dokument, klic, text) {
  const par = najitPar(dokument, klic);
  if (!par) return vlozitRadek(yaml, mistoVlozeni(yaml, dokument, klic), `${klic}: ${text}`);
  if (!par.value) {
    // „klic:“ bez hodnoty
    const konec = par.key.range[1];
    const dvojtecka = yaml.indexOf(':', konec);
    return `${yaml.slice(0, dvojtecka + 1)} ${text}${yaml.slice(dvojtecka + 1)}`;
  }
  const [od, do_] = par.value.range;
  if (YAML.isCollection(par.value) && !par.value.flow) {
    // Blokový seznam (víc řádků): nahradí se od dvojtečky po konec seznamu.
    const dvojtecka = yaml.indexOf(':', par.key.range[1]);
    const konec = yaml[do_ - 1] === '\n' ? do_ - 1 : do_;
    // Komentář za dvojtečkou („vztahy: # …“) zůstane na řádku klíče.
    const zbytekRadku = yaml.slice(dvojtecka + 1, yaml.indexOf('\n', dvojtecka));
    const komentar = /^\s*#/.test(zbytekRadku) ? zbytekRadku : '';
    return `${yaml.slice(0, dvojtecka + 1)} ${text}${komentar}${yaml.slice(konec)}`;
  }
  return `${yaml.slice(0, od)}${text}${yaml.slice(do_)}`;
}

/** Nahradí seznam vztahů. Nezměněné položky si nechají přesně svůj původní text. */
function nahraditVztahy(yaml, dokument, vztahy) {
  const par = najitPar(dokument, 'vztahy');
  const puvodni = [];
  if (par?.value && YAML.isSeq(par.value)) {
    for (const polozka of par.value.items) {
      const [od, do_] = polozka.range;
      puvodni.push({ data: normalizujVztah(polozka.toJSON?.() ?? null), text: yaml.slice(od, do_).trimEnd() });
    }
  }
  const pouzite = new Set();
  const texty = vztahy.map((v) => {
    const i = puvodni.findIndex((p, j) => !pouzite.has(j) && stejnyVztah(p.data, v));
    if (i !== -1) {
      pouzite.add(i);
      return puvodni[i].text;
    }
    return vykreslitVztah(v);
  });

  if (!par) {
    if (!texty.length) return yaml;
    const radky = ['vztahy:', ...texty.map((t) => `  - ${t}`)].join('\n');
    return vlozitRadek(yaml, mistoVlozeni(yaml, dokument, 'vztahy'), radky);
  }
  if (par.value && YAML.isSeq(par.value) && !par.value.flow && texty.length) {
    // Blokový seznam zůstane blokový se stejným odsazením.
    const od = par.value.range[0];
    const posledni = par.value.items.at(-1);
    const konec = posledni ? posledni.range[1] : par.value.range[1];
    const konecTextu = yaml.slice(0, konec).trimEnd().length;
    const zacatekRadku = yaml.lastIndexOf('\n', od - 1) + 1;
    const odsazeni = yaml.slice(zacatekRadku, od);
    const novy = texty.map((t, i) => `${i ? `\n${odsazeni}` : ''}- ${t}`).join('');
    return `${yaml.slice(0, od)}${novy}${yaml.slice(konecTextu)}`;
  }
  if (!texty.length) return nahraditHodnotu(yaml, dokument, 'vztahy', '[]');
  // Prázdné „vztahy: []“ (šablona) nebo hodnota chybí: blokový seznam, komentář za [] zůstane na řádku klíče.
  const blok = texty.map((t) => `\n  - ${t}`).join('');
  if (!par.value) {
    const dvojtecka = yaml.indexOf(':', par.key.range[1]);
    const konecRadku = yaml.indexOf('\n', dvojtecka);
    const kde = konecRadku === -1 ? yaml.length : konecRadku;
    return `${yaml.slice(0, kde)}${blok}${yaml.slice(kde)}`;
  }
  const [od, do_] = par.value.range;
  const konecRadku = yaml.indexOf('\n', do_);
  const kde = konecRadku === -1 ? yaml.length : konecRadku;
  return `${yaml.slice(0, od).trimEnd()}${yaml.slice(do_, kde)}${blok}${yaml.slice(kde)}`;
}

/** Přidá obrázek do seznamu ilustrace (na jeden řádek), ostatní položky zůstanou. */
function pridatIlustraci(yaml, dokument, zaznam) {
  const casti = [`soubor: ${vykreslitText(zaznam.soubor)}`, `ucel: ${zaznam.ucel ?? 'portret'}`];
  const radek = `{ ${casti.join(', ')} }`;
  const par = najitPar(dokument, 'ilustrace');
  if (!par) return vlozitRadek(yaml, mistoVlozeni(yaml, dokument, 'ilustrace'), `ilustrace:\n  - ${radek}`);
  if (par.value && YAML.isSeq(par.value) && !par.value.flow && par.value.items.length) {
    const prvni = par.value.items[0].range[0];
    const zacatekRadku = yaml.lastIndexOf('\n', prvni - 1) + 1;
    const odsazeni = yaml.slice(zacatekRadku, prvni).replace(/-\s*$/, '');
    const posledni = par.value.items.at(-1);
    const konec = yaml.slice(0, posledni.range[1]).trimEnd().length;
    return `${yaml.slice(0, konec)}\n${odsazeni}- ${radek}${yaml.slice(konec)}`;
  }
  if (par.value && YAML.isSeq(par.value) && par.value.flow && par.value.items.length) {
    // ilustrace: [ … ] na jednom řádku: připojí se na konec.
    const [od, do_] = par.value.range;
    const vnitrek = yaml.slice(od + 1, do_ - 1).trim();
    return `${yaml.slice(0, od)}[${vnitrek}, ${radek}]${yaml.slice(do_)}`;
  }
  // Prázdné „ilustrace: []“ nebo bez hodnoty: blokový seznam, komentář zůstane na řádku klíče.
  const dvojtecka = yaml.indexOf(':', par.key.range[1]);
  const konecRadku = yaml.indexOf('\n', dvojtecka);
  const kde = konecRadku === -1 ? yaml.length : konecRadku;
  const zbytek = yaml.slice(dvojtecka + 1, kde).replace(/^\s*\[\s*\]/, '');
  return `${yaml.slice(0, dvojtecka + 1)}${zbytek}\n  - ${radek}${yaml.slice(kde)}`;
}

/** Tělo karty (vše pod hlavičkou). */
export function teloKarty(text) {
  const { za } = rozdelit(text);
  return za.replace(/^---[ \t]*\r?\n?/, '');
}

/** Nahradí tělo karty, hlavička zůstane bajt po bajtu. */
export function nahraditTelo(text, telo) {
  const { pred, yaml, za } = rozdelit(text);
  const uzaver = /^---[ \t]*\r?\n?/.exec(za)[0];
  const novy = String(telo).replace(/\r\n?/g, '\n');
  return `${pred}${yaml}${uzaver.endsWith('\n') ? uzaver : `${uzaver}\n`}${novy}`;
}

/**
 * Upraví vybrané klíče hlavičky a zbytek souboru nechá beze změny.
 * @param {string} text celý soubor karty
 * @param {{verejne?: boolean, tags?: string[], aliases?: string[], vazby?: string[], vztahy?: Array<{s:string, popis:string, postoj?:number|null, verejne?:boolean}>}} zmeny
 *   vazby a vztahy[].s jsou id bez [[ ]]
 */
export function upravitKartu(text, zmeny) {
  const { pred, yaml: puvodniYaml, za } = rozdelit(text);
  let yaml = puvodniYaml;
  for (const klic of [...TEXTOVA_POLE, 'verejne', 'doresit', 'kdo', 'aliases', 'vazby', 'tags']) {
    if (!(klic in zmeny)) continue;
    const dokument = parovat(yaml);
    const par = najitPar(dokument, klic);
    const uvozovky = Boolean(par?.value && YAML.isScalar(par.value) && par.value.type === 'QUOTE_DOUBLE');
    yaml = nahraditHodnotu(yaml, dokument, klic, vykreslit(klic, zmeny[klic], uvozovky));
  }
  if (zmeny.ilustrace) yaml = pridatIlustraci(yaml, parovat(yaml), zmeny.ilustrace);
  if ('vztahy' in zmeny) yaml = nahraditVztahy(yaml, parovat(yaml), zmeny.vztahy);
  parovat(yaml); // pojistka: výsledek musí jít přečíst
  return `${pred}${yaml}${za}`;
}
