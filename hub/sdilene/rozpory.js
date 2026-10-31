// Rozpory a registr rozhodnutí R (rozhodnutí 77, reference/prepis-kanon.md § 6): čisté funkce bez
// disku. Rozpor = u stolu zaznělo něco jiného, než říká karta. Hub ho nikdy nerozhodne sám: DM vybere
// Platí stůl, Platí karta, Jinak, nebo Odložit. Každé rozhodnutí, které mění kánon nebo zůstává
// otevřené, dostane číslo R a záznam v `kampan/rozpory.yaml`. Čísla navazují na R1–R16 z převodu
// Notionu (`reference/kanon-mapa.yaml`), takže první nové je R17.

/** Nejvyšší číslo R z převodu Notionu (R1–R16 jsou v reference/kanon-mapa.yaml). */
export const POSLEDNI_R_PREVODU = 16;
export const SOUBOR_ROZPORU = 'rozpory.yaml';
export const STAVY_ROZPORU = Object.freeze(['otevrene', 'rozhodnuto']);

/**
 * Druhy rozporů a výchozí řešení (předvolba, DM 28. 10. 2026: „většinou ano“). `bezR`: když platí
 * karta, nic se v kánonu nemění a zapíše se jen řádek do zápisu sezení, bez čísla R.
 */
export const DRUHY_ROZPORU = Object.freeze({
  stul_vs_karta: { nazev: 'Stůl proti kartě', vychozi: 'stul', bezR: false },
  prereknuti: { nazev: 'Přeřeknutí DM', vychozi: 'karta', bezR: true },
  pamet_hracu: { nazev: 'Paměť hráčů', vychozi: 'karta', bezR: true },
  priprava_vs_hra: { nazev: 'Příprava proti hře', vychozi: 'stul', bezR: false },
  novy_fakt: { nazev: 'Nový fakt o minulosti', vychozi: null, bezR: false },
});

/** Volby DM u rozporu (tlačítka Platí stůl, Platí karta, Jinak, Odložit). */
export const VOLBY_ROZPORU = Object.freeze({
  stul: 'Platí stůl.',
  karta: 'Platí karta.',
  jinak: null, // vlastní znění
  odlozit: null, // zůstane otevřený
});

const R = /^R([1-9]\d{0,3})$/;
/** Značka R v textu karty: *(R17)* nebo (R17). Zástupce R? doplní Hub číslem při zápisu. */
export const ZASTUPCE_R = /\bR\?(?![\p{L}\p{N}])/gu;

export const cisloR = (id) => {
  const m = R.exec(String(id ?? '').trim());
  return m ? Number(m[1]) : null;
};

const chyba = (zprava, status = 400) => Object.assign(new Error(zprava), { status });
const text = (x) => String(x ?? '').replace(/\s+/g, ' ').trim();

/**
 * Registr z YAML (seznam záznamů). Vrátí záznamy a seznam problémů (pro Kontrolu dat).
 * @returns {{zaznamy: object[], problemy: string[]}}
 */
export function normalizujRegistr(data) {
  const problemy = [];
  if (data === null || data === undefined) return { zaznamy: [], problemy };
  if (!Array.isArray(data)) return { zaznamy: [], problemy: ['Registr rozporů musí být seznam záznamů (- id: R17 …).'] };
  const zaznamy = [];
  const videno = new Set();
  data.forEach((z, i) => {
    const kde = `záznam ${i + 1}`;
    if (!z || typeof z !== 'object' || Array.isArray(z)) {
      problemy.push(`${kde}: není mapa`);
      return;
    }
    const id = String(z.id ?? '');
    const n = cisloR(id);
    if (!n) problemy.push(`${kde}: id „${id}“ má tvar R17`);
    else if (n <= POSLEDNI_R_PREVODU) problemy.push(`${id}: R1–R${POSLEDNI_R_PREVODU} patří převodu Notionu (reference/kanon-mapa.yaml), nová čísla začínají R${POSLEDNI_R_PREVODU + 1}`);
    if (videno.has(id)) problemy.push(`${id} je v registru dvakrát`);
    videno.add(id);
    if (!STAVY_ROZPORU.includes(z.stav)) problemy.push(`${id || kde}: stav je ${STAVY_ROZPORU.join(' nebo ')}`);
    if (z.druh !== undefined && !DRUHY_ROZPORU[z.druh]) problemy.push(`${id || kde}: neznámý druh „${z.druh}“ (${Object.keys(DRUHY_ROZPORU).join(', ')})`);
    if (z.stav === 'rozhodnuto' && !text(z.rozhodnuti)) problemy.push(`${id || kde}: rozhodnutý rozpor potřebuje text rozhodnuti`);
    if (z.kdy !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(z.kdy))) problemy.push(`${id || kde}: kdy je datum RRRR-MM-DD`);
    zaznamy.push(z);
  });
  return { zaznamy, problemy };
}

/** Další volné číslo R (nejméně R17), když jsou obsazená čísla `obsazena`. */
export function dalsiR(obsazena) {
  let max = POSLEDNI_R_PREVODU;
  for (const id of obsazena) max = Math.max(max, cisloR(id) ?? 0);
  return `R${max + 1}`;
}

/**
 * Potřebuje rozhodnutí číslo R? Ne, když platí karta u přeřeknutí nebo paměti hráčů: kánon se
 * nemění a do zápisu sezení jde jen řádek.
 */
export function potrebujeR(druh, volba) {
  return !(volba === 'karta' && DRUHY_ROZPORU[druh]?.bezR);
}

/** Text rozhodnutí do registru podle volby DM. */
export function textRozhodnuti(volba, vlastni) {
  if (volba === 'jinak') {
    const t = text(vlastni);
    if (!t) throw chyba('U volby Jinak napiš, jak to je.');
    return t;
  }
  return VOLBY_ROZPORU[volba] ?? '';
}

/**
 * Záznam do registru z operace `rozpor` a rozhodnutí DM.
 * @param {object} op operace rozpor z návrhu
 * @param {{volba: string, text?: string, kdy: string}} reseni
 * @param {{id: string, sezeni: string|null}} ctx
 */
export function zaznamRegistru(op, reseni, ctx) {
  const z = {
    id: ctx.id,
    kdy: reseni.kdy,
    ...(ctx.sezeni ? { sezeni: ctx.sezeni } : {}),
    druh: DRUHY_ROZPORU[op.druh] ? op.druh : 'stul_vs_karta',
    ...(op.karta_id ? { karta: String(op.karta_id) } : {}),
    karta_tvrzeni: text(op.karta_tvrzeni),
    prepis_tvrzeni: text(op.prepis_tvrzeni),
    dukaz: (Array.isArray(op.dukaz) ? op.dukaz : []).map(dukazDoRegistru).filter(Boolean),
    stav: reseni.volba === 'odlozit' ? 'otevrene' : 'rozhodnuto',
  };
  if (reseni.volba !== 'odlozit') z.rozhodnuti = textRozhodnuti(reseni.volba, reseni.text);
  if (text(op.otazka)) z.otazka = text(op.otazka);
  return z;
}

/** Důkaz do veřejného registru: jen místo a krátká citace (pár slov), nikdy celé repliky. */
export function dukazDoRegistru(d) {
  if (!d || typeof d !== 'object') return null;
  const citat = zkratitCitat(d.citat);
  if (d.dm) return { dm: String(d.dm), ...(citat ? { citat } : {}) };
  if (!d.cas) return null;
  return { cas: String(d.cas), ...(d.blok ? { blok: String(d.blok) } : {}), ...(citat ? { citat } : {}) };
}

/** Repo je veřejné a přepis soukromý: citace v kartách a registru nejvýš 12 slov. */
export const MAX_SLOV_CITATU = 12;
export function zkratitCitat(t) {
  const slova = text(t).split(' ').filter(Boolean);
  if (!slova.length) return '';
  return slova.length > MAX_SLOV_CITATU ? `${slova.slice(0, MAX_SLOV_CITATU).join(' ')}…` : slova.join(' ');
}

/** Datum RRRR-MM-DD česky (28. 10. 2026). */
export function datumCesky(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m ? `${Number(m[3])}. ${Number(m[2])}. ${m[1]}` : String(iso ?? '');
}

/** „s03“ → „sezení 3“; jiný identifikátor (revize) → null. */
export function sezeniSlovy(cislo) {
  const m = /^s(\d{2,3})$/.exec(String(cislo ?? ''));
  return m ? `sezení ${Number(m[1])}` : null;
}
