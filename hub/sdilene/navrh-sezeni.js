// Návrh změn kánonu po sezení (⚠ body 153 a 157, rozhodnutí 77 a 80): čisté funkce bez disku a bez
// Node.js. Smlouva s přepisovým nástrojem je reference/prepis-kanon.md.
//
// Přepisový nástroj a Claude z nahrávky sezení navrhnou soubor `hub/.stav/navrhy/sNN.yaml` (schéma 2):
// seznam operací (nová karta, doplnit kartu, změnit pole, vazba, hráčský kánon, událost, zápis sezení,
// rozpor, vyřadit, smazat). Každá nese důkaz (místo v nahrávce nebo rozhodnutí DM). DM operace v Hubu
// schválí, upraví, nebo zamítne a Hub zapíše jen schválené. Neplatný text se nemaže: `vyradit` ho
// přesune do oddílu Neplatné na konci karty. Tenhle modul říká, jak vypadá platná operace a co přesně
// s textem karty udělá; používá ho server (kontrola a zápis) i testy.
import { idZOdkazu, nastavitSurove, nahraditTelo, teloKarty, upravitKartu } from './hlavicka.js';
import {
  SLUG, ODDIL_DRUZINY, ZNACKA_ZNA, jeOddilDm, pridatBlok, nacistEntitu, zmenyKarty,
} from './karta-kanonu.js';
import { ODKAZOVA_POLE, POLE_TYPU, TYPY_SLOZEK, vlozitOddil } from './typy-karet.js';
import { ODDIL_NEPLATNE, jeNadpisNeplatne } from './oddil-dm.js';
import { DRUHY_ROZPORU, MAX_SLOV_CITATU, cisloR, datumCesky, sezeniSlovy, POSLEDNI_R_PREVODU } from './rozpory.js';

export const OPERACE = Object.freeze(['nova_karta', 'doplnit', 'pole', 'vazba', 'kanon', 'udalost', 'sezeni', 'rozpor', 'vyradit', 'smazat']);
/** Operace, které smí revize kánonu mimo sezení (revize-<datum>.yaml, prepis-kanon.md § 4). */
export const OPERACE_REVIZE = Object.freeze(['doplnit', 'pole', 'vyradit', 'smazat']);
export const STAVY_NAVRHU = Object.freeze(['predbezny', 'finalni']);
/** Platná jména návrhů: sNN (sezení) a revize-RRRR-MM-DD (revize kánonu mimo sezení). */
export const JMENO_NAVRHU = /^(s\d{2,3}|revize-\d{4}-\d{2}-\d{2})$/;
export const TYPY_BLOKU = Object.freeze(['odrazka', 'odstavec', 'cast']);
export const TYPY_NOVE_KARTY = Object.freeze(['postava', 'npc', 'padouch', 'frakce', 'misto', 'predmet', 'bytost']);
export const JISTOTY = Object.freeze(['jista', 'nutno_potvrdit']);
/** Oddíly karty sezení v pořadí, v jakém je dává šablona `sablony/sezeni.md`. */
export const SEKCE_SEZENI = Object.freeze({
  shrnuti: 'Shrnutí',
  tajemstvi: 'Tajemství a stopy',
  poklady: 'Poklady',
  fungovalo: 'Co fungovalo a co opravit',
  otevrene_nitky: 'Otevřené nitky',
});
const PORADI_SEKCI = ['Poznámky ze stolu', ...Object.values(SEKCE_SEZENI)];
/** Karty, které jsou jeden soubor (záznam), ne složka entity. */
const ZAZNAMY = new Set(['rozhodnuti', 'kanon', 'sezeni']);
const SLOZKA_TYPU = Object.freeze(Object.fromEntries(Object.entries(TYPY_SLOZEK).map(([slozka, typ]) => [typ, slozka])));
const CAS_DUKAZU = /^d\d{1,2} \d{1,2}:\d{2}:\d{2}$/;
const DATUM = /^\d{4}-\d{2}-\d{2}$/;
const BLOK = /^[A-Za-z0-9_-]{4,64}$/;
const MESICE = ['Hammer', 'Alturiak', 'Ches', 'Tarsakh', 'Mirtul', 'Kythorn', 'Flamerule', 'Eleasis', 'Eleint', 'Marpenoth', 'Uktar', 'Nightal'];

const chyba = (zprava, status = 400) => Object.assign(new Error(zprava), { status });
const bezDiakritiky = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const ZNACKA_ZNA_RE = /[ \t]*%%\s*zn[aá]\s*%%/gi;

/** Text operace: sjednocené konce řádků, bez značky %%zná%% (tu přidává Hub podle `zna`), oříznutý. */
export function ocistitText(t, max = 20000, { znacky = false } = {}) {
  const sjednoceny = String(t ?? '').replace(/\r\n?/g, '\n');
  // Tělo nové karty si značky %%zná%% nese samo (odrážky Co ví družina); jinde je dává Hub podle `zna`.
  const text = (znacky ? sjednoceny : sjednoceny.replace(ZNACKA_ZNA_RE, '')).trim();
  if (text.length > max) throw chyba(`Text je příliš dlouhý (nejvýš ${max} znaků).`);
  return text;
}

// ---------------------------------------------------------------------------
// Oddíly v těle karty
// ---------------------------------------------------------------------------

/** Řádky oddílu s daným nadpisem (## …): { od (nadpis), do (první řádek za oddílem), uroven }, nebo null. */
export function najitOddil(radky, nadpis) {
  const hledany = bezDiakritiky(nadpis);
  let od = -1;
  let uroven = 0;
  let vKodu = false;
  for (let i = 0; i < radky.length; i++) {
    if (/^\s*(```|~~~)/.test(radky[i])) vKodu = !vKodu;
    const m = !vKodu && /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(radky[i]);
    if (!m) continue;
    if (od >= 0 && m[1].length <= uroven) return { od, do: i, uroven };
    if (od < 0 && bezDiakritiky(m[2]) === hledany) {
      od = i;
      uroven = m[1].length;
    }
  }
  return od >= 0 ? { od, do: radky.length, uroven } : null;
}

const JE_ODRAZKA = /^( ?)([-*+]|\d+[.)])\s+/;
const JE_NADPIS = /^(#{1,6})\s+/;

/** Vloží řádky na konec hlavní části oddílu (před první pododdíl), za poslední neprázdný řádek. */
function vlozitDoOddilu(radky, oddil, bloky) {
  let kam = oddil.do;
  for (let i = oddil.od + 1; i < oddil.do; i++) {
    if (JE_NADPIS.test(radky[i])) {
      kam = i;
      break;
    }
  }
  while (kam > oddil.od + 1 && !radky[kam - 1].trim()) kam--;
  const predchozi = radky[kam - 1] ?? '';
  const navazuje = JE_ODRAZKA.test(bloky[0]) && (JE_ODRAZKA.test(predchozi) || /^\s{2,}\S/.test(predchozi)) && kam > oddil.od + 1;
  const vlozit = navazuje ? bloky : ['', ...bloky];
  // Před pododdílem nechat prázdný řádek.
  if (kam < oddil.do && radky[kam]?.trim()) vlozit.push('');
  radky.splice(kam, 0, ...vlozit);
}

const sKoncem = (radky) => `${radky.join('\n').replace(/\s+$/, '')}\n`;

/**
 * Doplní oddíl karty. Existující text se nemění, jen se přidá blok na konec hlavní části oddílu
 * (oddíl se založí na správném místě, když chybí).
 * @param {string} telo tělo karty
 * @param {{oddil: string, typ_bloku: 'odrazka'|'odstavec'|'cast', text: string, zna?: boolean}} op
 * @param {string} typ typ karty (kvůli pořadí oddílů)
 */
export function doplnitTelo(telo, op, typ) {
  const nadpis = String(op.oddil ?? '').replace(/\s+/g, ' ').trim();
  if (!nadpis || nadpis.length > 80) throw chyba('Operace doplnit potřebuje název oddílu.');
  if (!TYPY_BLOKU.includes(op.typ_bloku)) throw chyba(`typ_bloku je ${TYPY_BLOKU.join(', ')}.`);
  const text = ocistitText(op.text, 4000);
  if (!text) throw chyba('Operace doplnit potřebuje text.');
  const druziny = bezDiakritiky(nadpis) === bezDiakritiky(ODDIL_DRUZINY);
  if (jeOddilDm(nadpis) && op.zna === true) throw chyba('Oddíl DM nejde odkrýt družině.');
  if (druziny && op.typ_bloku === 'odrazka') return pridatBlok(String(telo ?? ''), text, op.zna === true);

  let radky = String(telo ?? '').replace(/\r\n?/g, '\n').split('\n');
  let oddil = najitOddil(radky, nadpis);
  if (!oddil) {
    radky = vlozitOddil(typ, telo, nadpis).split('\n');
    oddil = najitOddil(radky, nadpis);
  }
  const zna = druziny && op.zna === true ? ` ${ZNACKA_ZNA}` : '';
  let bloky;
  if (op.typ_bloku === 'odrazka') bloky = [`- ${text.replace(/\s+/g, ' ')}${zna}`];
  else if (op.typ_bloku === 'odstavec') bloky = [`${text.replace(/\s+/g, ' ')}${zna}`];
  else {
    bloky = text.split('\n');
    bloky[0] += zna;
  }
  vlozitDoOddilu(radky, oddil, bloky);
  return sKoncem(radky);
}

/** Doplní oddíl karty sezení (Shrnutí, Tajemství a stopy …); oddíl, který chybí, založí v pořadí šablony. */
export function zapsatSezeni(telo, sekce, obsah) {
  const nadpis = SEKCE_SEZENI[sekce];
  if (!nadpis) throw chyba(`sekce je ${Object.keys(SEKCE_SEZENI).join(', ')}.`);
  const text = ocistitText(obsah, 20000);
  if (!text) throw chyba('Zápis sezení potřebuje obsah.');
  let radky = String(telo ?? '').replace(/\r\n?/g, '\n').split('\n');
  let oddil = najitOddil(radky, nadpis);
  if (!oddil) {
    const poradi = PORADI_SEKCI.map(bezDiakritiky);
    const moje = poradi.indexOf(bezDiakritiky(nadpis));
    let kam = radky.length;
    for (let i = 0; i < radky.length; i++) {
      const m = /^##\s+(.*?)\s*#*\s*$/.exec(radky[i]);
      if (m && poradi.indexOf(bezDiakritiky(m[1])) > moje) {
        kam = i;
        break;
      }
    }
    if (kam === radky.length) {
      radky = String(telo ?? '').replace(/\s+$/, '').split('\n');
      radky.push('', `## ${nadpis}`);
    } else {
      radky.splice(kam, 0, `## ${nadpis}`, '');
    }
    oddil = najitOddil(radky, nadpis);
  }
  let kam = oddil.do;
  while (kam > oddil.od + 1 && !radky[kam - 1].trim()) kam--;
  const nove = ['', ...text.split('\n')];
  // Za vloženým textem následuje další oddíl: oddělit ho prázdným řádkem.
  if (radky[kam]?.trim()) nove.push('');
  radky.splice(kam, 0, ...nove);
  return sKoncem(radky);
}

// ---------------------------------------------------------------------------
// Vyřazení a smazání textu (rozhodnutí 77)
// ---------------------------------------------------------------------------

const escRegex = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Rozsah znaků oddílu v těle (bez nadpisu) a rozsah oddílu Neplatné, který se nikdy neprohledává. */
function rozsahy(telo, nadpis) {
  const radky = telo.split('\n');
  const zacatky = [];
  let pozice = 0;
  for (const r of radky) {
    zacatky.push(pozice);
    pozice += r.length + 1;
  }
  const naZnaky = (o) => ({ od: zacatky[o.od + 1] ?? telo.length, do: o.do < radky.length ? zacatky[o.do] : telo.length });
  const neplatne = najitOddil(radky, ODDIL_NEPLATNE);
  const vyjmout = neplatne ? { od: zacatky[neplatne.od], do: neplatne.do < radky.length ? zacatky[neplatne.do] : telo.length } : null;
  if (!nadpis) return { oblast: { od: 0, do: telo.length }, vyjmout };
  if (jeNadpisNeplatne(nadpis)) throw chyba('Z oddílu Neplatné se nevyřazuje ani nemaže.');
  const oddil = najitOddil(radky, nadpis);
  if (!oddil) throw chyba(`Karta nemá oddíl „${nadpis}“.`);
  return { oblast: naZnaky(oddil), vyjmout };
}

/**
 * Najde text `najdi` v oddílu karty (bez oddílu Neplatné). Musí tam být právě jednou. Když přesná
 * shoda není, zkusí ji s libovolnými mezerami a zalomeními (návrh píše text na jeden řádek).
 * @returns {{od: number, do: number}} rozsah znaků v těle
 */
export function najitText(telo, oddil, najdi) {
  const t = String(telo ?? '').replace(/\r\n?/g, '\n');
  const hledany = String(najdi ?? '').replace(/\r\n?/g, '\n').trim();
  if (!hledany) throw chyba('Chybí text najdi (přesný text z karty).');
  if (hledany.length > 4000) throw chyba('Text najdi je příliš dlouhý (nejvýš 4000 znaků).');
  const nadpis = String(oddil ?? '').replace(/\s+/g, ' ').trim();
  const { oblast, vyjmout } = rozsahy(t, nadpis);
  const nalezy = (vzor) => {
    const vysledek = [];
    for (const m of t.matchAll(vzor)) {
      const od = m.index;
      const konec = od + m[0].length;
      if (od < oblast.od || konec > oblast.do) continue;
      if (vyjmout && od < vyjmout.do && konec > vyjmout.od) continue;
      vysledek.push({ od, do: konec });
    }
    return vysledek;
  };
  let n = nalezy(new RegExp(escRegex(hledany), 'g'));
  if (!n.length) n = nalezy(new RegExp(hledany.split(/\s+/).map(escRegex).join('\\s+'), 'g'));
  const kde = nadpis ? `v oddílu „${nadpis}“` : 'v kartě';
  if (!n.length) throw chyba(`Text „${zkratit(hledany)}“ ${kde} není. Karta se mezitím změnila, nebo se text liší.`, 409);
  if (n.length > 1) throw chyba(`Text „${zkratit(hledany)}“ je ${kde} ${n.length}×. Návrh musí vybrat jedno místo (delší najdi).`, 409);
  return n[0];
}

const zkratit = (t, max = 60) => {
  const r = String(t).replace(/\s+/g, ' ').trim();
  return r.length > max ? `${r.slice(0, max - 1)}…` : r;
};

/** Řádek je po vyjmutí prázdný: nic, jen značka odrážky, %%zná%% nebo komentář. */
const prazdnyRadek = (r) => !bezKomentaruRadku(r).replace(/^\s*([-*+]|\d+[.)])?\s*(\[[ xX]\]\s*)?/, '').trim();
const bezKomentaruRadku = (r) => String(r).replace(/%%[^%]*%%/g, '');

/** Vymění text v rozsahu a uklidí, co zbylo: prázdnou odrážku, zdvojený prázdný řádek. */
function vymenit(telo, rozsah, nahradit) {
  const pred = telo.slice(0, rozsah.od);
  const za = telo.slice(rozsah.do);
  const novy = `${pred}${nahradit}${za}`;
  const radky = novy.split('\n');
  // Řádky, kterých se změna týká.
  const prvni = pred.split('\n').length - 1;
  const posledni = prvni + nahradit.split('\n').length - 1;
  for (let i = posledni; i >= prvni; i--) {
    if (radky[i] !== undefined && radky[i].trim() && prazdnyRadek(radky[i])) radky.splice(i, 1);
    else if (radky[i] !== undefined && !radky[i].trim() && nahradit === '' && i === prvni) {
      // Vyjmutý celý odstavec: zbyl prázdný řádek navíc.
      if ((radky[i - 1] === undefined || !radky[i - 1].trim()) || (radky[i + 1] !== undefined && !radky[i + 1].trim())) radky.splice(i, 1);
    }
  }
  // Mezery na konci upraveného řádku pryč, dva prázdné řádky po sobě v místě změny sloučit.
  for (let i = Math.min(posledni, radky.length - 1); i >= Math.max(0, prvni - 1); i--) {
    if (radky[i] !== undefined && radky[i].trim()) radky[i] = radky[i].replace(/[ \t]+$/, '');
    if (i > 0 && radky[i] !== undefined && !radky[i].trim() && !radky[i - 1].trim()) radky.splice(i, 1);
  }
  return radky.join('\n');
}

/**
 * Řádek oddílu Neplatné: „- **R17** (28. 10. 2026, sezení 3, z oddílu Poslední rozhovor): „starý text“ — důvod.“
 * @param {{r?: string|null, datum: string, sezeni?: string|null, oddil?: string, stary?: string, duvod?: string, celaKarta?: boolean}} z
 */
export function radekNeplatne(z) {
  const okolnosti = [datumCesky(z.datum), sezeniSlovy(z.sezeni), z.oddil ? `z oddílu ${String(z.oddil).replace(/\s+/g, ' ').trim()}` : null].filter(Boolean).join(', ');
  const stary = z.celaKarta ? 'celá karta' : `„${bezKomentaruRadku(String(z.stary ?? '')).replace(/\s+/g, ' ').trim()}“`;
  const duvod = String(z.duvod ?? '').replace(/\s+/g, ' ').trim().replace(/[.!?…]*$/, '');
  return `- ${z.r ? `**${z.r}** ` : ''}(${okolnosti}): ${stary}${duvod ? ` — ${duvod}.` : ''}`;
}

/** Přidá řádek do oddílu Neplatné na konci karty (oddíl založí). */
export function pridatNeplatne(telo, radek) {
  let radky = String(telo ?? '').replace(/\r\n?/g, '\n').replace(/\s+$/, '').split('\n');
  let oddil = najitOddil(radky, ODDIL_NEPLATNE);
  if (!oddil) {
    radky = [...radky, '', `## ${ODDIL_NEPLATNE}`];
    oddil = najitOddil(radky, ODDIL_NEPLATNE);
  }
  vlozitDoOddilu(radky, oddil, [radek]);
  return sKoncem(radky);
}

/**
 * Operace `vyradit` nad tělem karty: vyjme text `najdi` z oddílu (na jeho místo dá `nahradit`) a starý
 * text zapíše do oddílu Neplatné s datem, číslem R a důvodem. Nic se neztratí.
 * @param {{datum: string, sezeni?: string|null}} ctx
 */
export function vyraditTelo(telo, op, ctx) {
  const { telo: novy, radek } = vyjmoutTelo(telo, op, ctx);
  return pridatNeplatne(novy, radek);
}

/** První polovina `vyradit`: tělo s vyjmutým (nahrazeným) textem a řádek pro oddíl Neplatné. */
export function vyjmoutTelo(telo, op, ctx) {
  const t = String(telo ?? '').replace(/\r\n?/g, '\n');
  const rozsah = najitText(t, op.oddil, op.najdi);
  const nahradit = op.nahradit === undefined || op.nahradit === null ? '' : ocistitText(op.nahradit, 4000).replace(/\s*\n\s*/g, ' ');
  const stary = t.slice(rozsah.od, rozsah.do);
  return {
    telo: vymenit(t, rozsah, nahradit),
    radek: radekNeplatne({ r: op.r ?? null, datum: op.kdy ?? ctx.datum, sezeni: ctx.sezeni, oddil: op.oddil, stary, duvod: op.duvod }),
  };
}

/** Operace `smazat`: smaže chybu zápisu (věc, která u stolu nikdy nezazněla). Bez stopy v kartě, jen v Gitu. */
export function smazatTelo(telo, op) {
  const t = String(telo ?? '').replace(/\r\n?/g, '\n');
  return vymenit(t, najitText(t, op.oddil, op.najdi), '');
}

// ---------------------------------------------------------------------------
// Nová karta
// ---------------------------------------------------------------------------

/** Cesta a příznak entity pro novou kartu: { slozka, soubor, slozkaEntity } (soubor je relativní od kořene repa). */
export function umisteniKarty(typ, id) {
  const slozka = SLOZKA_TYPU[typ];
  if (!slozka) throw chyba(`Neznámý typ karty „${typ}“.`);
  const zaznam = ZAZNAMY.has(typ);
  return { slozka, slozkaEntity: !zaznam, soubor: zaznam ? `kampan/${slozka}/${id}.md` : `kampan/${slozka}/${id}/${id}.md` };
}

const ZALOZNI_SABLONA = (typ) => `---\nschema: 1\nid:\ntyp: ${typ}\nnazev: "{{title}}"\nverejne: false\naliases: []\nvazby: []\ntags: []\n---\n# {{title}}\n\n## ${ODDIL_DRUZINY}\n`;

const ids = (seznam) => [...new Set((Array.isArray(seznam) ? seznam : []).map(idZOdkazu).filter(Boolean))];

/** Tělo hráčského kánonu z polí operace `kanon`. */
export function teloKanonu(op) {
  const co = ocistitText(op.co_se_stalo, 8000);
  const dusledek = ocistitText(op.dusledek, 8000);
  if (!co) throw chyba('Záznam kánonu potřebuje „Co se stalo“.');
  return `## Co se stalo\n\n${co}\n\n## Důsledek\n\n${dusledek}\n`.replace(/\n\n$/, '\n');
}

/**
 * Text nové karty podle operace `nova_karta` nebo `kanon`: ze šablony, hlavička podle typu,
 * zdroj a důkaz, tělo z návrhu. Hlavičku skládá `upravitKartu`, takže má domácí podobu karet.
 * @param {object} op
 * @param {{sablona?: string|null, dnes: string, zdroj?: string, cislo?: string}} ctx
 */
export function textNoveKarty(op, ctx) {
  const typ = op.op === 'kanon' ? 'kanon' : String(op.typ ?? '');
  const id = String(op.karta_id ?? '');
  if (!SLUG.test(id)) throw chyba(`id „${id}“ není slug.`);
  const nazev = String(op.nazev ?? '').replace(/\s+/g, ' ').trim();
  if (!nazev || nazev.length > 120) throw chyba('Karta potřebuje název (nejvýš 120 znaků).');
  const um = umisteniKarty(typ, id);
  let text = (ctx.sablona || ZALOZNI_SABLONA(typ))
    .replace(/^nazev: "\{\{title\}\}"/m, () => `nazev: ${JSON.stringify(nazev)}`)
    .replace(/\{\{title\}\}/g, () => nazev)
    .replace(/\{\{date(:[^}]*)?\}\}/g, ctx.dnes);
  text = text.replace(/^id:[^\n]*$/m, () => `id: ${id}`);

  const zmeny = {};
  const hl = op.hlavicka && typeof op.hlavicka === 'object' ? op.hlavicka : {};
  const povolena = new Set([...(POLE_TYPU[typ] ?? []), 'aliases', 'tags']);
  for (const [k, v] of Object.entries(hl)) {
    if (!povolena.has(k)) throw chyba(`Pole „${k}“ karta typu ${typ} nemá.`);
    zmeny[k] = k in ODKAZOVA_POLE ? idZOdkazu(v) : v;
  }
  if (typ === 'kanon') {
    zmeny.sezeni = ctx.cislo ?? hl.sezeni ?? '';
    zmeny.kdo = Array.isArray(op.kdo) ? op.kdo.map(String) : [];
    zmeny.doresit = op.doresit === true;
    zmeny.verejne = true;
  } else if (typeof op.verejne === 'boolean') zmeny.verejne = op.verejne;
  const vazby = ids(op.vazby);
  if (vazby.length) zmeny.vazby = vazby;
  text = upravitKartu(text, zmeny);
  if (ctx.zdroj) text = nastavitSurove(text, 'zdroj', JSON.stringify(ctx.zdroj));
  const dukaz = (Array.isArray(op.dukaz) ? op.dukaz : []).map((d) => (d?.cas ? String(d.cas) : d?.dm ? `DM ${d.dm}` : '')).filter(Boolean);
  if (dukaz.length) text = nastavitSurove(text, 'dukaz', JSON.stringify(dukaz));
  let telo = op.op === 'kanon' ? teloKanonu(op) : (op.telo === undefined ? null : ocistitText(op.telo, 20000, { znacky: true }));
  // Karty začínají nadpisem s názvem (jako šablony); návrh ho psát nemusí.
  if (telo !== null && op.op !== 'kanon' && !/^#\s/.test(telo)) telo = `# ${nazev}\n\n${telo}`;
  if (telo !== null) text = nahraditTelo(text, `${telo.replace(/\s+$/, '')}\n`);
  nacistEntitu(text, um); // pojistka: výsledek musí dát platnou kartu
  return { text, ...um, typ, id };
}

// ---------------------------------------------------------------------------
// Úprava existující karty
// ---------------------------------------------------------------------------

const norm = (x) => String(x ?? '').replace(/\s+/g, ' ').trim();
/** Hodnota operace `pole` pro zmenyKarty: kdo je seznam, doresit a verejne (karta viditelná družině) ano/ne. */
const hodnotaZmeny = (op) => {
  if (op.pole === 'kdo') return Array.isArray(op.nove) ? op.nove : String(op.nove).split(',');
  if (op.pole === 'doresit' || op.pole === 'verejne') return op.nove === true || op.nove === 'true';
  return op.nove;
};
/** Hodnota pole k porovnání s `puvodni`: seznam jako text, odkazové pole jako id ([[x]] = x). */
const hodnotaPole = (pole, x) => {
  const t = norm(Array.isArray(x) ? x.join(',') : x);
  return pole in ODKAZOVA_POLE ? idZOdkazu(t) : t;
};

/**
 * Použije operace `doplnit`, `pole` a `vazba` na text jedné existující karty. Každá se počítá nad
 * výsledkem předchozí, takže pořadí v návrhu platí.
 * @param {string} text celý soubor karty
 * @param {object[]} operace
 * @param {{slozka: string, soubor: string, slozkaEntity: boolean}} um
 * @param {(id: string) => object|undefined} najit entita podle id (kvůli kontrole cílů)
 * @param {{datum?: string, sezeni?: string|null}} [ctx] datum zápisu a sezení (řádek oddílu Neplatné)
 */
export function upravitExistujici(text, operace, um, najit, ctx = {}) {
  const kontext = { datum: ctx.datum ?? new Date().toISOString().slice(0, 10), sezeni: ctx.sezeni ?? null };
  let aktualni = text;
  for (const op of operace) {
    const e = nacistEntitu(aktualni, um);
    if (op.op === 'doplnit') {
      aktualni = nahraditTelo(aktualni, doplnitTelo(teloKarty(aktualni), op, e.typ));
    } else if (op.op === 'pole') {
      const nove = norm(Array.isArray(op.nove) ? op.nove.join(',') : op.nove);
      const ted = hodnotaPole(op.pole, op.pole === 'verejne' ? e.verejne : e.pole[op.pole]);
      if (op.puvodni !== undefined && hodnotaPole(op.pole, op.puvodni) !== ted) {
        throw chyba(`Pole ${op.pole} karty ${e.id} má teď „${ted}“, návrh počítal s „${norm(op.puvodni)}“. Karta se mezitím změnila.`, 409);
      }
      const zmeny = zmenyKarty(e, { [op.pole]: hodnotaZmeny(op) }, najit);
      if (zmeny) aktualni = upravitKartu(aktualni, zmeny);
    } else if (op.op === 'vazba') {
      const cil = idZOdkazu(op.cil);
      const z = {};
      if (!e.vazby.includes(cil)) z.vazby = [...e.vazby, cil];
      if (norm(op.popis)) {
        const postoj = op.postoj === undefined || op.postoj === null || op.postoj === '' ? null : Number(op.postoj);
        const i = e.vztahy.findIndex((v) => v.s === cil);
        const novy = { s: cil, popis: norm(op.popis), postoj, verejne: typeof op.verejne === 'boolean' ? op.verejne : (e.vztahy[i]?.verejne ?? false) };
        const vztahy = [...e.vztahy];
        if (i === -1) vztahy.push(novy);
        else vztahy[i] = novy;
        z.vztahy = vztahy;
      }
      if (Object.keys(z).length) aktualni = upravitKartu(aktualni, z);
    } else if (op.op === 'vyradit' && op.cela_karta === true) {
      if (e.hlavicka?.platnost === 'vyrazeno') throw chyba(`Karta ${e.id} už je vyřazená.`, 409);
      aktualni = nastavitSurove(aktualni, 'platnost', 'vyrazeno');
      if (op.r) aktualni = nastavitSurove(aktualni, 'vyrazeno', String(op.r));
      const radek = radekNeplatne({ r: op.r ?? null, datum: op.kdy ?? kontext.datum, sezeni: kontext.sezeni, celaKarta: true, duvod: op.duvod });
      aktualni = nahraditTelo(aktualni, pridatNeplatne(teloKarty(aktualni), radek));
    } else if (op.op === 'vyradit') {
      aktualni = nahraditTelo(aktualni, vyraditTelo(teloKarty(aktualni), op, kontext));
    } else if (op.op === 'smazat') {
      aktualni = nahraditTelo(aktualni, smazatTelo(teloKarty(aktualni), op));
    } else {
      throw chyba(`Operace ${op.op} se na existující kartu nepoužije.`);
    }
  }
  return aktualni;
}

// ---------------------------------------------------------------------------
// Kontrola návrhu
// ---------------------------------------------------------------------------

/**
 * Návrh z YAML: zkontroluje tvar na nejvyšší úrovni a vrátí
 * `{ schema, sezeni, stav, scenar_verze, zdroj, operace, varovani }`.
 *
 * Brána (prepis-kanon.md § 3): zapsat jde jen schéma 2 se `stav: finalni`, které vzniklo ze
 * schváleného scénáře. Předběžný návrh (a starší schéma 1) Hub ukáže a DM ho může procházet, ale
 * nezapíše ho.
 */
export function normalizujNavrh(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw chyba('Návrh musí být YAML mapa.');
  if (data.schema !== 1 && data.schema !== 2) throw chyba('Návrh má neznámou verzi schématu (čekám schema: 2).');
  if (!Array.isArray(data.operace)) throw chyba('Návrh nemá seznam operace.');
  if (data.operace.length > 400) throw chyba('Návrh má víc než 400 operací.');
  const varovani = [];
  let stav = 'predbezny';
  if (data.schema === 1) {
    varovani.push('Návrh má starý tvar (schema: 1). Dá se procházet, zapsat jde až návrh ve schématu 2 se stav: finalni.');
  } else if (data.stav === undefined) {
    varovani.push('Návrh nemá stav, bere se jako předběžný.');
  } else if (!STAVY_NAVRHU.includes(data.stav)) {
    throw chyba(`stav návrhu je ${STAVY_NAVRHU.join(' nebo ')}.`);
  } else stav = data.stav;
  const verze = data.scenar_verze;
  if (data.schema === 2 && verze !== undefined && !(Number.isInteger(verze) && verze >= 0)) varovani.push('scenar_verze má být celé číslo (verze scénáře v přepisovém nástroji).');
  return {
    schema: data.schema,
    sezeni: String(data.sezeni ?? ''),
    stav,
    scenar_verze: Number.isInteger(verze) ? verze : null,
    zdroj: String(data.zdroj ?? ''),
    operace: data.operace.map((o) => (o && typeof o === 'object' ? o : {})),
    varovani,
  };
}

/** Platný důkaz: { cas, blok?, citat? } z nahrávky, nebo { dm: RRRR-MM-DD, citat? } (rozhodnutí DM mimo nahrávku). */
export function overitDukaz(d) {
  const problemy = [];
  const varovani = [];
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { problemy: ['důkaz je { cas, blok, citat } nebo { dm, citat }'], varovani };
  if (d.dm !== undefined) {
    if (!DATUM.test(String(d.dm))) problemy.push(`důkaz dm „${d.dm}“ je datum RRRR-MM-DD`);
  } else if (!CAS_DUKAZU.test(String(d.cas ?? ''))) {
    problemy.push(`neplatný čas důkazu „${d.cas ?? ''}“ (čekám tvar d1 0:42:02)`);
  }
  if (d.blok !== undefined && !BLOK.test(String(d.blok))) problemy.push(`blok důkazu „${d.blok}“ není id bloku scénáře`);
  const slov = String(d.citat ?? '').split(/\s+/).filter(Boolean).length;
  if (slov > MAX_SLOV_CITATU) varovani.push(`citace má ${slov} slov; repo je veřejné, do karty a registru jde zkrácená na ${MAX_SLOV_CITATU}`);
  return { problemy, varovani };
}

/** Člověku čitelný popis operace. */
export function popisOperace(op, najit = () => undefined) {
  const nazev = (id) => najit(idZOdkazu(id))?.nazev ?? idZOdkazu(id);
  switch (op.op) {
    case 'nova_karta': return `Nová karta (${op.typ}): ${op.nazev ?? op.karta_id}`;
    case 'doplnit': return `Doplnit kartu ${nazev(op.karta_id)} — oddíl „${op.oddil}“ (${({ odrazka: 'odrážka', odstavec: 'odstavec', cast: 'část' })[op.typ_bloku] ?? op.typ_bloku})`;
    case 'pole': return `Změnit pole ${op.pole} u ${nazev(op.karta_id)}: ${op.puvodni ?? '—'} → ${op.nove}`;
    case 'vazba': return `Vazba ${nazev(op.karta_id)} → ${nazev(op.cil)}${op.popis ? ` (${op.popis})` : ''}`;
    case 'kanon': return `Hráčský kánon: ${op.nazev}`;
    case 'udalost': return `Událost v kalendáři: ${op.text}`;
    case 'sezeni': return `Zápis sezení — ${SEKCE_SEZENI[op.sekce] ?? op.sekce}`;
    case 'rozpor': return `Rozpor${op.karta_id ? ` u ${nazev(op.karta_id)}` : ''}: ${op.otazka ?? DRUHY_ROZPORU[op.druh]?.nazev ?? ''}`;
    case 'vyradit': return op.cela_karta === true ? `Vyřadit celou kartu ${nazev(op.karta_id)}` : `Vyřadit z karty ${nazev(op.karta_id)}${op.oddil ? ` — oddíl „${op.oddil}“` : ''}${op.nahradit ? ' (s náhradou)' : ''}`;
    case 'smazat': return `Smazat chybu zápisu v kartě ${nazev(op.karta_id)}${op.oddil ? ` — oddíl „${op.oddil}“` : ''}`;
    default: return String(op.op ?? '?');
  }
}

/**
 * Strojová kontrola operací proti stavu repa. Nic nezapisuje.
 * @param {ReturnType<typeof normalizujNavrh>} navrh
 * @param {{najit: (id: string) => object|undefined, cislo: string, overDatum?: (d: object) => boolean, existujeId?: (id: string) => boolean,
 *   revize?: boolean, rozpory?: Map<string, object>}} ctx
 *   revize = revize kánonu mimo sezení (jen OPERACE_REVIZE), rozpory = registr kampan/rozpory.yaml podle id
 * @returns {Array<{id: string, op: string, popis: string, problemy: string[], varovani: string[]}>}
 */
export function overitNavrh(navrh, ctx) {
  const nove = new Map(); // id → typ karet, které založí tenhle návrh
  const najit = (id) => ctx.najit(id) ?? (nove.has(id) ? { id, typ: nove.get(id), pole: {}, nazev: id } : undefined);
  const videno = new Set();
  const vysledek = [];
  const registr = ctx.rozpory ?? new Map();
  // Rozpory v návrhu (kvůli z_rozporu) a čísla R, která si návrh zabral.
  const rozporyNavrhu = new Map(navrh.operace.filter((o) => o.op === 'rozpor' && o.id).map((o) => [String(o.id), o]));
  const zabranaR = new Map();
  for (const o of rozporyNavrhu.values()) if (o.r) zabranaR.set(String(o.r), [...(zabranaR.get(String(o.r)) ?? []), String(o.id)]);
  const povolene = ctx.revize ? OPERACE_REVIZE : OPERACE;

  for (const op of navrh.operace) {
    const problemy = [];
    const varovani = [];
    const id = String(op.id ?? '');
    if (!id) problemy.push('operace nemá id');
    else if (videno.has(id)) problemy.push(`id operace „${id}“ je v souboru dvakrát`);
    videno.add(id);
    if (!OPERACE.includes(op.op)) problemy.push(`neznámá operace „${op.op}“ (platné: ${OPERACE.join(', ')})`);
    else if (!povolene.includes(op.op)) problemy.push(`revize kánonu mimo sezení umí jen ${OPERACE_REVIZE.join(', ')}`);

    const dukaz = Array.isArray(op.dukaz) ? op.dukaz : [];
    if (!dukaz.length) problemy.push('chybí důkaz (místo v nahrávce nebo rozhodnutí DM)');
    for (const d of dukaz) {
      const v = overitDukaz(d);
      problemy.push(...v.problemy);
      varovani.push(...v.varovani);
    }
    if (op.jistota !== undefined && !JISTOTY.includes(op.jistota)) problemy.push(`jistota je ${JISTOTY.join(' nebo ')}`);
    if (op.jistota === undefined && op.op !== 'rozpor') varovani.push('chybí jistota (bere se nutno_potvrdit)');
    if (op.z_rozporu !== undefined) {
      const r = rozporyNavrhu.get(String(op.z_rozporu));
      if (!r) problemy.push(`z_rozporu: v návrhu není rozpor „${op.z_rozporu}“`);
      else if (op.r && r.r && String(op.r) !== String(r.r)) problemy.push(`r ${op.r} nesedí s rozporem ${r.id} (${r.r})`);
    }
    const overitR = (r) => {
      if (r === undefined || r === null || r === '') return;
      const n = cisloR(r);
      if (!n) problemy.push(`r „${r}“ má tvar R17`);
      else if (n <= POSLEDNI_R_PREVODU) problemy.push(`R1–R${POSLEDNI_R_PREVODU} patří převodu Notionu, nová rozhodnutí začínají R${POSLEDNI_R_PREVODU + 1}`);
    };

    const kartaExistuje = (x) => {
      const cil = idZOdkazu(x);
      if (!SLUG.test(cil)) {
        problemy.push(`„${x}“ není platné id karty`);
        return null;
      }
      const e = najit(cil);
      if (!e) problemy.push(`karta „${cil}“ neexistuje`);
      return e ?? null;
    };
    const cileOdkazu = (seznam, jmeno) => {
      for (const v of Array.isArray(seznam) ? seznam : []) {
        const cil = idZOdkazu(v);
        if (!SLUG.test(cil) || (!najit(cil) && cil !== ctx.cislo)) problemy.push(`${jmeno}: karta „${cil}“ neexistuje`);
      }
    };

    try {
      switch (op.op) {
        case 'nova_karta': {
          const typ = String(op.typ ?? '');
          if (!TYPY_NOVE_KARTY.includes(typ)) problemy.push(`typ nové karty je ${TYPY_NOVE_KARTY.join(', ')}`);
          const kid = String(op.karta_id ?? '');
          if (!SLUG.test(kid)) problemy.push(`karta_id „${kid}“ není slug`);
          else if (najit(kid) || (ctx.existujeId?.(kid) ?? false)) problemy.push(`karta „${kid}“ už existuje`);
          if (!norm(op.nazev)) problemy.push('chybí název');
          const povolena = new Set([...(POLE_TYPU[typ] ?? []), 'aliases', 'tags']);
          for (const [k, v] of Object.entries(op.hlavicka ?? {})) {
            if (!povolena.has(k)) {
              problemy.push(`pole „${k}“ karta typu ${typ} nemá`);
              continue;
            }
            if (k in ODKAZOVA_POLE) {
              const cil = najit(idZOdkazu(v));
              if (!cil) problemy.push(`pole ${k}: karta „${idZOdkazu(v)}“ neexistuje`);
              else if (!ODKAZOVA_POLE[k].cil.includes(cil.typ)) problemy.push(`pole ${k}: ${cil.nazev} sem nepatří`);
            }
          }
          cileOdkazu(op.vazby, 'vazby');
          if (op.telo !== undefined) ocistitText(op.telo);
          if (SLUG.test(kid) && TYPY_NOVE_KARTY.includes(typ)) nove.set(kid, typ);
          break;
        }
        case 'doplnit': {
          const e = kartaExistuje(op.karta_id);
          if (!norm(op.oddil)) problemy.push('chybí oddíl');
          if (!TYPY_BLOKU.includes(op.typ_bloku)) problemy.push(`typ_bloku je ${TYPY_BLOKU.join(', ')}`);
          const text = ocistitText(op.text, 4000);
          if (!text) problemy.push('chybí text');
          const druziny = bezDiakritiky(op.oddil) === bezDiakritiky(ODDIL_DRUZINY);
          if (druziny && op.typ_bloku === 'odrazka' && text.replace(/\s+/g, ' ').length > 600) problemy.push('odrážka v Co ví družina je delší než 600 znaků');
          if (op.zna !== undefined && typeof op.zna !== 'boolean') problemy.push('zna musí být true nebo false');
          if (op.zna === true && !druziny) problemy.push('zna: true jde jen v oddílu Co ví družina');
          if (op.zna === undefined && druziny) varovani.push('chybí zna, blok zůstane skrytý před družinou');
          if (e && e.typ === 'kanon') varovani.push('doplňuje se hráčský kánon');
          break;
        }
        case 'pole': {
          const e = kartaExistuje(op.karta_id);
          const povolena = new Set([...(e ? POLE_TYPU[e.typ] ?? [] : []), 'kdo', 'doresit', 'verejne']);
          if (op.pole === 'verejne' && ![true, false, 'true', 'false'].includes(op.nove)) problemy.push('verejne je true nebo false');
          if (e && !povolena.has(op.pole)) problemy.push(`pole „${op.pole}“ karta typu ${e.typ} nemá`);
          if (op.nove === undefined) problemy.push('chybí nove');
          if (op.puvodni === undefined) varovani.push('chybí puvodni, změna se nedá zkontrolovat proti stavu karty');
          if (e && povolena.has(op.pole) && op.puvodni !== undefined) {
            const ted = hodnotaPole(op.pole, op.pole === 'verejne' ? e.verejne : e.pole?.[op.pole]);
            if (hodnotaPole(op.pole, op.puvodni) !== ted && !nove.has(e.id)) {
              problemy.push(`karta má teď „${ted}“, návrh počítal s „${norm(op.puvodni)}“`);
            }
          }
          if (e && povolena.has(op.pole) && op.nove !== undefined && e.pole && !nove.has(e.id)) {
            try {
              zmenyKarty(e, { [op.pole]: hodnotaZmeny(op) }, najit);
            } catch (err) {
              if (!/Není co změnit/.test(err.message)) problemy.push(err.message);
            }
          }
          break;
        }
        case 'vazba': {
          const e = kartaExistuje(op.karta_id);
          const cil = kartaExistuje(op.cil);
          if (e && cil && e.id === cil.id) problemy.push('karta nemůže mít vazbu sama na sebe');
          if (norm(op.popis).length > 200) problemy.push('popis vztahu je delší než 200 znaků');
          if (op.postoj !== undefined && op.postoj !== null && !(Number.isInteger(op.postoj) && op.postoj >= -3 && op.postoj <= 3)) problemy.push('postoj je celé číslo −3 až +3');
          if (op.verejne !== undefined && typeof op.verejne !== 'boolean') problemy.push('verejne musí být true nebo false');
          if ((op.postoj !== undefined || op.verejne !== undefined) && !norm(op.popis)) varovani.push('postoj a verejne se zapíšou jen s popisem vztahu');
          break;
        }
        case 'kanon': {
          const kid = String(op.karta_id ?? '');
          if (!SLUG.test(kid)) problemy.push(`karta_id „${kid}“ není slug`);
          else if (!kid.startsWith(`${ctx.cislo}-`)) problemy.push(`id hráčského kánonu má začínat „${ctx.cislo}-“`);
          else if (najit(kid) || (ctx.existujeId?.(kid) ?? false)) problemy.push(`karta „${kid}“ už existuje`);
          if (!norm(op.nazev)) problemy.push('chybí název');
          const kdo = Array.isArray(op.kdo) ? op.kdo : [];
          if (!kdo.length) problemy.push('chybí kdo (id postav, nebo parta)');
          for (const k of kdo) if (k !== 'parta' && najit(String(k))?.typ !== 'postava') problemy.push(`kdo: „${k}“ není postava (ani parta)`);
          if (op.doresit !== undefined && typeof op.doresit !== 'boolean') problemy.push('doresit musí být true nebo false');
          teloKanonu(op);
          cileOdkazu(op.vazby, 'vazby');
          if (SLUG.test(kid)) nove.set(kid, 'kanon');
          break;
        }
        case 'udalost': {
          const d = op.datum;
          const platne = d && typeof d === 'object' && (ctx.overDatum
            ? ctx.overDatum(d)
            : MESICE.includes(d.mesic) && Number.isInteger(d.den) && Number.isInteger(d.rok));
          if (!platne) problemy.push('datum události je { rok, mesic, den } a musí být platné datum Harptosu');
          const t = norm(op.text);
          if (!t) problemy.push('chybí text události');
          else if (t.length > 200) problemy.push('text události je delší než 200 znaků');
          cileOdkazu(op.vazby, 'vazby');
          break;
        }
        case 'sezeni': {
          if (!SEKCE_SEZENI[op.sekce]) problemy.push(`sekce je ${Object.keys(SEKCE_SEZENI).join(', ')}`);
          if (!ocistitText(op.obsah, 20000)) problemy.push('chybí obsah');
          if (!najit(ctx.cislo)) problemy.push(`karta sezení „${ctx.cislo}“ v Hubu neexistuje`);
          break;
        }
        case 'rozpor': {
          if (!norm(op.karta_tvrzeni) || !norm(op.prepis_tvrzeni)) problemy.push('rozpor potřebuje karta_tvrzeni a prepis_tvrzeni');
          if (op.karta_id) kartaExistuje(op.karta_id);
          if (op.druh === undefined) varovani.push('chybí druh rozporu (bere se stul_vs_karta)');
          else if (!DRUHY_ROZPORU[op.druh]) problemy.push(`druh rozporu je ${Object.keys(DRUHY_ROZPORU).join(', ')}`);
          overitR(op.r);
          if (op.r) {
            if ((zabranaR.get(String(op.r)) ?? []).length > 1) problemy.push(`${op.r} má v návrhu víc rozporů (${zabranaR.get(String(op.r)).join(', ')})`);
            const v = registr.get(String(op.r));
            if (v && (String(v.sezeni ?? '') !== String(ctx.cislo ?? '') || String(v.karta ?? '') !== String(op.karta_id ?? ''))) {
              problemy.push(`${op.r} už je v registru rozporů pro jiný rozpor (${v.karta ?? '?'}, ${v.sezeni ?? '?'})`);
            }
          }
          break;
        }
        case 'vyradit':
        case 'smazat': {
          const e = kartaExistuje(op.karta_id);
          if (op.op === 'vyradit') overitR(op.r);
          if (op.op === 'vyradit' && op.cela_karta === true) {
            if (op.najdi !== undefined || op.nahradit !== undefined) problemy.push('vyřazení celé karty nemá najdi ani nahradit');
            if (e?.hlavicka?.platnost === 'vyrazeno') problemy.push('karta už je vyřazená');
          } else {
            if (op.cela_karta !== undefined && op.cela_karta !== false) problemy.push('cela_karta musí být true nebo false');
            if (!norm(op.najdi)) problemy.push('chybí najdi (přesný text z karty)');
            else if (e && !nove.has(e.id) && typeof e.telo === 'string') {
              try {
                najitText(e.telo, op.oddil, op.najdi);
              } catch (err) {
                problemy.push(err.message);
              }
            }
            if (!norm(op.oddil)) varovani.push('chybí oddíl, text se hledá v celé kartě');
            if (op.op === 'smazat' && op.nahradit !== undefined) problemy.push('smazat nemá nahradit (náhrada je vyradit)');
            if (op.nahradit !== undefined) ocistitText(op.nahradit, 4000);
          }
          if (op.op === 'vyradit' && !norm(op.duvod)) varovani.push('chybí důvod (v oddílu Neplatné bude jen starý text)');
          if (op.op === 'vyradit' && !op.r && op.z_rozporu === undefined) varovani.push('vyřazení bez čísla rozhodnutí R');
          if (op.op === 'smazat') varovani.push('smazat je jen pro chybu zápisu: text zmizí bez stopy v kartě (zůstane jen v Gitu)');
          break;
        }
        default:
          break;
      }
    } catch (err) {
      problemy.push(err.message);
    }
    vysledek.push({ id: id || '?', op: String(op.op ?? '?'), popis: popisOperace(op, najit), problemy, varovani });
  }
  return vysledek;
}
