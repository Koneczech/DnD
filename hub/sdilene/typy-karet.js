// Typové stránky wiki (rozhodnutí 74, DM 20. 10. 2026): která pole hlavičky má který typ karty,
// jak se jmenují v bočním panelu a jaké oddíly šablona doporučuje. Jedno místo pro server
// (kontrola a zápis), panel (boční panel, editor) i šablony v sablony/.

/** Osud postavy z příběhu (NPC, padouch). Živý je výchozí a v bočním panelu se neukazuje. */
/** Složky entit v kampan/ a typ, který k nim patří (Datový model v ZADANI.md). */
export const TYPY_SLOZEK = Object.freeze({
  postavy: 'postava',
  npc: 'npc',
  padouchove: 'padouch',
  frakce: 'frakce',
  mista: 'misto',
  predmety: 'predmet',
  bytosti: 'bytost',
  sezeni: 'sezeni',
  rozhodnuti: 'rozhodnuti',
  kanon: 'kanon',
});

/** Stavy karty rozhodnutí. */
export const STAVY_ROZHODNUTI = Object.freeze(['otevrene', 'rozhodnuto', 'zavrzeno']);

export const OSUDY = Object.freeze({ zije: 'živý', mrtvy: 'mrtvý', nezvestny: 'nezvěstný' });

/**
 * Pole, která odkazují na jinou kartu (`kde: "[[longsaddle]]"`). Jako `lezi_v` nemusí být
 * ve `vazby`: Obsidian odkaz v hlavičce ukáže v grafu sám.
 * cil = typy karet, na které smí vést
 */
export const ODKAZOVA_POLE = Object.freeze({
  kde: { cil: ['misto'] },
  frakce: { cil: ['frakce'] },
  sidlo: { cil: ['misto'] },
  u_koho: { cil: ['postava', 'npc', 'padouch', 'frakce', 'misto'] },
});

/** Pole hlavičky podle typu karty, v pořadí, jak je ukazuje boční panel a editor. */
export const POLE_TYPU = Object.freeze({
  postava: ['hrac', 'druh', 'povolani'],
  npc: ['druh', 'role', 'frakce', 'osud', 'kde'],
  padouch: ['druh', 'role', 'frakce', 'osud', 'kde'],
  frakce: ['druh', 'sidlo'],
  misto: ['druh'],
  predmet: ['druh', 'u_koho'],
  rozhodnuti: ['stav', 'oblast', 'zaznamenano'],
  kanon: ['sezeni', 'kdo', 'doresit'],
});

const POPISKY = {
  hrac: 'Hráč', druh: 'Druh', povolani: 'Povolání', role: 'Role', osud: 'Osud', kde: 'Kde ho najít', frakce: 'Patří k',
  sidlo: 'Sídlo', u_koho: 'U koho je', stav: 'Stav', oblast: 'Oblast', zaznamenano: 'Zaznamenáno',
  sezeni: 'Sezení', cislo: 'Číslo', kdo: 'Kdo', doresit: 'Dořešit',
};
const POPISKY_TYPU = {
  misto: { druh: 'Druh místa' },
};
/**
 * Co ukáže boční panel cílové karty podle pole, které na ni odkazuje (Hub dopočítá):
 * NPC s kde → u místa Kdo tu je; NPC s frakce → u frakce Členové …
 */
export const ZPETNE_POLE = Object.freeze({
  kde: 'Kdo tu je',
  frakce: 'Členové',
  sidlo: 'Sídlí tu',
  u_koho: { misto: 'Předměty tady', vychozi: 'Má u sebe' },
});
export const nadpisZpetnehoPole = (pole, typCile) => {
  const n = ZPETNE_POLE[pole];
  return typeof n === 'string' ? n : n?.[typCile] ?? n?.vychozi ?? pole;
};

/** Nápověda do editoru (placeholder). */
export const NAPOVEDA = Object.freeze({
  druh: { postava: 'ork', npc: 'trpaslík', padouch: 'člověk', misto: 'město, hostinec, divočina', frakce: 'žoldnéřská rota, rod, kruh', predmet: 'prsten, dopis, zbraň' },
  role: 'čím je ve světě: hostinský, kapitán stráže',
});

/** Popisek pole v bočním panelu a v editoru. */
export const popisekPole = (pole, typ) => POPISKY_TYPU[typ]?.[pole] ?? POPISKY[pole] ?? pole;

/**
 * Doporučené oddíly (## nadpisy) podle typu, v doporučeném pořadí. Úvod je text před prvním
 * nadpisem. Vlastní nadpisy jsou dál povolené; editor jen nabídne ty, které karta nemá.
 * DM oddíly wiki vždy ukáže dole (rozhodnutí 74), v souboru můžou být kdekoli.
 */
export const ODDILY_TYPU = Object.freeze({
  postava: ['Co ví družina', 'Příběh', 'Výchozí stav (před sezením 1)', 'DM — co postava neví', 'Dotazník'],
  npc: ['Co ví družina', 'Jak ho hrát', 'Příběh', 'DM'],
  padouch: ['Co ví družina', 'Co chce a jeho plán', 'Jak bojuje', 'Když prohraje', 'DM'],
  frakce: ['Co ví družina', 'Jak jednají', 'DM'],
  misto: ['Co ví družina', 'Co tu najdou', 'DM'],
  predmet: ['Co ví družina', 'Historie', 'DM'],
  bytost: ['Statblok', 'Jak ji hrát', 'Co ví družina'],
  rozhodnuti: ['Kontext', 'Dopad'],
  kanon: ['Co se stalo', 'Důsledek'],
});

const bezDiakritiky = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const jeDm = (t) => /^DM(\b|\s|—|-|:|$)/.test(String(t ?? '').trim());

/** Nadpisy ## a ### v textu karty (mimo bloky kódu). */
export function nadpisyTextu(telo) {
  const vysledek = [];
  let vKodu = false;
  for (const r of String(telo ?? '').split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(r)) vKodu = !vKodu;
    const m = !vKodu && /^(#{2,6})\s+(.*?)\s*#*\s*$/.exec(r);
    if (m) vysledek.push({ uroven: m[1].length, text: m[2] });
  }
  return vysledek;
}

/**
 * Doporučené oddíly, které karta nemá. DM oddíl se počítá jako přítomný, když karta má
 * jakýkoli nadpis začínající DM (např. „DM — co Dorn ví“).
 */
export function chybejiciOddily(typ, telo) {
  const nadpisy = nadpisyTextu(telo).map((n) => bezDiakritiky(n.text));
  const maDm = nadpisyTextu(telo).some((n) => jeDm(n.text));
  return (ODDILY_TYPU[typ] ?? []).filter((o) => (jeDm(o) ? !maDm : !nadpisy.includes(bezDiakritiky(o))));
}

/**
 * Kam vložit nový doporučený oddíl: před první existující oddíl, který má v doporučeném
 * pořadí být až za ním; jinak před první DM oddíl; jinak na konec. Vrátí nové tělo.
 */
export function vlozitOddil(typ, telo, nadpis) {
  const radky = String(telo ?? '').replace(/\s+$/, '').split('\n');
  const poradi = (ODDILY_TYPU[typ] ?? []).map(bezDiakritiky);
  const moje = poradi.indexOf(bezDiakritiky(nadpis));
  let kam = -1;
  let vKodu = false;
  for (let i = 0; i < radky.length; i++) {
    if (/^\s*(```|~~~)/.test(radky[i])) vKodu = !vKodu;
    const m = !vKodu && /^##\s+(.*?)\s*#*\s*$/.exec(radky[i]);
    if (!m) continue;
    const jeho = jeDm(m[1]) ? poradi.findIndex((p) => jeDm(p)) : poradi.indexOf(bezDiakritiky(m[1]));
    if ((moje !== -1 && jeho > moje) || (!jeDm(nadpis) && jeDm(m[1]))) {
      kam = i;
      break;
    }
  }
  const blok = [`## ${nadpis}`, ''];
  if (kam === -1) {
    const zaklad = radky.join('\n');
    return `${zaklad}${zaklad.trim() ? '\n\n' : ''}${blok.join('\n')}\n`;
  }
  radky.splice(kam, 0, ...blok);
  return `${radky.join('\n')}\n`;
}
