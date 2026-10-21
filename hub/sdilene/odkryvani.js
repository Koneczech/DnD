// Odkrývání textu karty (rozhodnutí 75, DM 21. 10. 2026): kromě oddílu Co ví družina jde
// družině odkrýt i kterýkoli odstavec, odrážku nebo citaci z ostatního textu karty, třeba
// z Příběhu postavy, bez přepisování. Značka je stejná jako v Co ví družina: %%zná%% na konci
// prvního řádku bloku. DM oddíly, oddíl Co ví družina (má vlastní bloky), nadpisy, tabulky
// a bloky kódu se odkrýt nedají. Jedno místo pro server (zápis, pohled družiny) i panel (oko).

const NADPIS = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const ODRAZKA = /^ ?([-*+]|\d+[.)])\s+/;
const CITACE = /^\s*>/;
const TABULKA = /^\s*\|/;
const PLOT = /^\s*(```|~~~)/;
const ZNACKA = /[ \t]*%%\s*zn[aá]\s*%%/gi;
const ZNACKA_ZNA = '%%zná%%';
/** Značka bloku pro vykreslení: \u0005N\u0005 na začátku prvního řádku (naHtml ji převede na data-blok). */
export const ZNACKA_BLOKU = '\u0005';

const jeDm = (t) => /^DM(\b|\s|—|-|:|$)/.test(String(t ?? '').trim());
const bezDiakritiky = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const jeDruzina = (t) => bezDiakritiky(t) === 'co vi druzina';
const ma = (text) => /%%\s*zn[aá]\s*%%/i.test(text);
const bezKomentaru = (text) => String(text ?? '').replace(/%%[\s\S]*?%%/g, '');

/** První řádek bloku bez značky a bez mezer na koncích: podle něj panel blok pozná. */
const klicRadku = (r) => String(r ?? '').replace(ZNACKA, '').trim();

/**
 * Bloky textu karty, které jde odkrýt.
 * @returns {Array<{index: number, od: number, do: number, druh: 'odstavec'|'odrazka'|'citace', zna: boolean, prvni: string, poradi: number, nadpisy: number[]}>}
 *   od/do = řádky v těle, prvni = první řádek bez značky, poradi = kolikátý blok se stejným prvním
 *   řádkem (0, 1…), nadpisy = řádky nadpisů nad blokem (od nejvyššího)
 */
export function blokyTextu(telo) {
  const radky = String(telo ?? '').replace(/\r\n?/g, '\n').split('\n');
  const bloky = [];
  const zasobnik = []; // { uroven, radek, dm, druzina }
  let blok = null;
  let vKodu = false;
  const zakazano = () => zasobnik.some((n) => n.dm || n.druzina);
  const ukoncit = (i) => {
    if (!blok) return;
    blok.do = i;
    const text = radky.slice(blok.od, i).join('\n');
    if (bezKomentaru(text).replace(ZNACKA, '').trim()) {
      blok.zna = ma(radky[blok.od]);
      blok.prvni = klicRadku(radky[blok.od]);
      bloky.push(blok);
    }
    blok = null;
  };
  for (let i = 0; i < radky.length; i++) {
    const r = radky[i];
    if (PLOT.test(r)) {
      ukoncit(i);
      vKodu = !vKodu;
      continue;
    }
    if (vKodu) continue;
    const n = NADPIS.exec(r);
    if (n) {
      ukoncit(i);
      const uroven = n[1].length;
      while (zasobnik.length && zasobnik.at(-1).uroven >= uroven) zasobnik.pop();
      zasobnik.push({ uroven, radek: i, dm: jeDm(n[2]), druzina: jeDruzina(n[2]) });
      continue;
    }
    if (!r.trim()) {
      ukoncit(i);
      continue;
    }
    if (zakazano() || TABULKA.test(r)) {
      ukoncit(i);
      continue;
    }
    const druh = ODRAZKA.test(r) ? 'odrazka' : CITACE.test(r) ? 'citace' : 'odstavec';
    if (blok) {
      // Pokračování: odsazený řádek nebo vnořená odrážka zůstává v odrážce, další řádek citace
      // v citaci, další řádek odstavce v odstavci. Jinak začíná nový blok.
      if (blok.druh === 'odrazka' && /^\s{2,}\S/.test(r)) continue;
      if (blok.druh === 'citace' && druh === 'citace') continue;
      if (blok.druh === 'odstavec' && druh === 'odstavec') continue;
    }
    ukoncit(i);
    // Nadpis # je název karty, ten nad blok nepatří.
    blok = { od: i, druh, nadpisy: zasobnik.filter((x) => x.uroven > 1).map((x) => x.radek) };
  }
  ukoncit(radky.length);
  const pocty = new Map();
  bloky.forEach((b, index) => {
    b.index = index;
    b.poradi = pocty.get(b.prvni) ?? 0;
    pocty.set(b.prvni, b.poradi + 1);
  });
  return bloky;
}

/**
 * Odkryje nebo skryje blok textu, který panel určí prvním řádkem a pořadím (karta se mezitím
 * mohla změnit, proto ne číslem). Vrátí nové tělo; chyba, když blok v kartě není.
 */
export function prepnoutBlokTextu(telo, { prvni, poradi = 0 }, zna) {
  const blok = blokyTextu(telo).find((b) => b.prvni === klicRadku(prvni) && b.poradi === poradi);
  if (!blok) return null;
  const radky = String(telo).split('\n');
  for (let i = blok.od; i < blok.do; i++) radky[i] = radky[i].replace(ZNACKA, '');
  if (zna) radky[blok.od] = `${radky[blok.od].replace(/\s+$/, '')} ${ZNACKA_ZNA}`;
  return radky.join('\n');
}

/**
 * Text karty, který smí vidět družina, kromě oddílu Co ví družina: odkryté bloky v pořadí karty
 * a nad nimi nadpisy, pod kterými leží (každý jednou). Komentáře Obsidianu se vynechají.
 */
export function textDruziny(telo) {
  const radky = String(telo ?? '').replace(/\r\n?/g, '\n').split('\n');
  const vystup = [];
  const vypsane = new Set();
  for (const b of blokyTextu(telo).filter((x) => x.zna)) {
    for (const n of b.nadpisy) {
      if (vypsane.has(n)) continue;
      vypsane.add(n);
      vystup.push('', radky[n]);
    }
    vystup.push('', bezKomentaru(radky.slice(b.od, b.do).join('\n')).replace(/[ \t]+$/gm, ''));
  }
  return vystup.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Text pro vykreslení v pohledu DM: na začátek obsahu prvního řádku každého bloku vloží
 * \u0005N\u0005 (za odrážku nebo >), naHtml z ní udělá data-blok="N" u odstavce, položky
 * nebo citace. Panel k těm prvkům přidá oko.
 */
export function oznacitBloky(telo, bloky = blokyTextu(telo)) {
  const radky = String(telo ?? '').replace(/\r\n?/g, '\n').split('\n');
  for (const b of bloky) {
    const r = radky[b.od];
    const m = /^(\s*(?:>\s?)*\s*(?:(?:[-*+]|\d+[.)])\s+)?(?:\[[ xX]\]\s+)?)/.exec(r);
    const pred = m ? m[1] : '';
    radky[b.od] = `${pred}${ZNACKA_BLOKU}${b.index}${ZNACKA_BLOKU}${r.slice(pred.length)}`;
  }
  return radky.join('\n');
}
