// Návrh změn kánonu po sezení (⚠ bod 153): čisté funkce bez disku a bez Node.js.
//
// Přepisový nástroj a Claude z nahrávky sezení navrhnou soubor `hub/.stav/navrhy/sNN.yaml`: seznam
// operací (nová karta, doplnit kartu, změnit pole, vazba, hráčský kánon, událost, zápis sezení,
// rozpor). Každá nese důkaz (čas v přepisu). DM operace v Hubu schválí, upraví, nebo zamítne a Hub
// zapíše jen schválené. Tenhle modul říká, jak vypadá platná operace a co přesně s textem karty udělá;
// používá ho server (kontrola a zápis) i testy.
import { idZOdkazu, nastavitSurove, nahraditTelo, teloKarty, upravitKartu } from './hlavicka.js';
import {
  SLUG, ODDIL_DRUZINY, ZNACKA_ZNA, jeOddilDm, pridatBlok, nacistEntitu, zmenyKarty,
} from './karta-kanonu.js';
import { ODKAZOVA_POLE, POLE_TYPU, TYPY_SLOZEK, vlozitOddil } from './typy-karet.js';

export const OPERACE = Object.freeze(['nova_karta', 'doplnit', 'pole', 'vazba', 'kanon', 'udalost', 'sezeni', 'rozpor']);
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
  const dukaz = (Array.isArray(op.dukaz) ? op.dukaz : []).map((d) => String(d?.cas ?? '')).filter(Boolean);
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

/**
 * Použije operace `doplnit`, `pole` a `vazba` na text jedné existující karty. Každá se počítá nad
 * výsledkem předchozí, takže pořadí v návrhu platí.
 * @param {string} text celý soubor karty
 * @param {object[]} operace
 * @param {{slozka: string, soubor: string, slozkaEntity: boolean}} um
 * @param {(id: string) => object|undefined} najit entita podle id (kvůli kontrole cílů)
 */
export function upravitExistujici(text, operace, um, najit) {
  let aktualni = text;
  for (const op of operace) {
    const e = nacistEntitu(aktualni, um);
    if (op.op === 'doplnit') {
      aktualni = nahraditTelo(aktualni, doplnitTelo(teloKarty(aktualni), op, e.typ));
    } else if (op.op === 'pole') {
      const nove = norm(Array.isArray(op.nove) ? op.nove.join(',') : op.nove);
      const ted = norm(Array.isArray(e.pole[op.pole]) ? e.pole[op.pole].join(',') : e.pole[op.pole]);
      if (op.puvodni !== undefined && norm(Array.isArray(op.puvodni) ? op.puvodni.join(',') : op.puvodni) !== ted) {
        throw chyba(`Pole ${op.pole} karty ${e.id} má teď „${ted}“, návrh počítal s „${norm(op.puvodni)}“. Karta se mezitím změnila.`, 409);
      }
      const hodnota = op.pole === 'kdo' ? (Array.isArray(op.nove) ? op.nove : String(op.nove).split(',')) : (op.pole === 'doresit' ? op.nove === true : op.nove);
      const zmeny = zmenyKarty(e, { [op.pole]: hodnota }, najit);
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
    } else {
      throw chyba(`Operace ${op.op} se na existující kartu nepoužije.`);
    }
  }
  return aktualni;
}

// ---------------------------------------------------------------------------
// Kontrola návrhu
// ---------------------------------------------------------------------------

/** Návrh z YAML: zkontroluje tvar na nejvyšší úrovni a vrátí `{ sezeni, zdroj, operace }`. */
export function normalizujNavrh(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw chyba('Návrh musí být YAML mapa.');
  if (data.schema !== 1) throw chyba('Návrh má neznámou verzi schématu (čekám schema: 1).');
  if (!Array.isArray(data.operace)) throw chyba('Návrh nemá seznam operace.');
  if (data.operace.length > 400) throw chyba('Návrh má víc než 400 operací.');
  return { sezeni: String(data.sezeni ?? ''), zdroj: String(data.zdroj ?? ''), operace: data.operace.map((o) => (o && typeof o === 'object' ? o : {})) };
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
    case 'rozpor': return `Rozpor: ${op.otazka ?? ''}`;
    default: return String(op.op ?? '?');
  }
}

/**
 * Strojová kontrola operací proti stavu repa. Nic nezapisuje.
 * @param {ReturnType<typeof normalizujNavrh>} navrh
 * @param {{najit: (id: string) => object|undefined, cislo: string, overDatum?: (d: object) => boolean, existujeId?: (id: string) => boolean}} ctx
 * @returns {Array<{id: string, op: string, popis: string, problemy: string[], varovani: string[]}>}
 */
export function overitNavrh(navrh, ctx) {
  const nove = new Map(); // id → typ karet, které založí tenhle návrh
  const najit = (id) => ctx.najit(id) ?? (nove.has(id) ? { id, typ: nove.get(id), pole: {}, nazev: id } : undefined);
  const videno = new Set();
  const vysledek = [];

  for (const op of navrh.operace) {
    const problemy = [];
    const varovani = [];
    const id = String(op.id ?? '');
    if (!id) problemy.push('operace nemá id');
    else if (videno.has(id)) problemy.push(`id operace „${id}“ je v souboru dvakrát`);
    videno.add(id);
    if (!OPERACE.includes(op.op)) problemy.push(`neznámá operace „${op.op}“ (platné: ${OPERACE.join(', ')})`);

    const dukaz = Array.isArray(op.dukaz) ? op.dukaz : [];
    if (!dukaz.length) problemy.push('chybí důkaz (čas v přepisu)');
    for (const d of dukaz) if (!CAS_DUKAZU.test(String(d?.cas ?? ''))) problemy.push(`neplatný čas důkazu „${d?.cas}“ (čekám tvar d1 0:42:02)`);
    if (op.jistota !== undefined && !JISTOTY.includes(op.jistota)) problemy.push(`jistota je ${JISTOTY.join(' nebo ')}`);
    if (op.jistota === undefined) varovani.push('chybí jistota (bere se nutno_potvrdit)');

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
          const povolena = new Set([...(e ? POLE_TYPU[e.typ] ?? [] : []), 'kdo', 'doresit']);
          if (e && !povolena.has(op.pole)) problemy.push(`pole „${op.pole}“ karta typu ${e.typ} nemá`);
          if (op.nove === undefined) problemy.push('chybí nove');
          if (op.puvodni === undefined) varovani.push('chybí puvodni, změna se nedá zkontrolovat proti stavu karty');
          if (e && povolena.has(op.pole) && op.puvodni !== undefined) {
            const ted = norm(Array.isArray(e.pole?.[op.pole]) ? e.pole[op.pole].join(',') : e.pole?.[op.pole]);
            if (norm(Array.isArray(op.puvodni) ? op.puvodni.join(',') : op.puvodni) !== ted && !nove.has(e.id)) {
              problemy.push(`karta má teď „${ted}“, návrh počítal s „${norm(op.puvodni)}“`);
            }
          }
          if (e && povolena.has(op.pole) && op.nove !== undefined && e.pole && !nove.has(e.id)) {
            try {
              const hodnota = op.pole === 'kdo' ? (Array.isArray(op.nove) ? op.nove : String(op.nove).split(',')) : (op.pole === 'doresit' ? op.nove === true : op.nove);
              zmenyKarty(e, { [op.pole]: hodnota }, najit);
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
