// Rozložení mapy kánonu podle os (⚠ návrhy 134–141). Síť (silová simulace) je v sit.js; tady jsou
// rozložení, která polohu uzlu spočítají z dat: tabulky Kdy a kde a Kdo a kdy, kruhy blízkosti
// k družině, osa postoje, co družina ví a zapomenutá vlákna. Bez DOM, aby šla testovat.
//
// Každé rozložení vrací { pozice: Map id → {x, y}, udalosti: Map 'u:<id>' → {x, y},
// dekorace: [{druh: 'cara'|'text'|'kruh'|'pas'|'cesta', ...}], bezHran, tlumene: Set }.

/** Rozložení, která polohy počítají z dat (ne silová síť). */
export const ROZLOZENI = Object.freeze([
  { id: 'sit', nazev: 'Síť', popis: 'Vazby přitahují, typy mají své čtvrti' },
  { id: 'cas', nazev: 'Čas', popis: 'Pod sítí události z Kalendáře, hráčský kánon nad svou událostí' },
  { id: 'cas-mista', nazev: 'Čas a místa', popis: 'Dole události, nahoře místa v pořadí, jak jimi družina prošla' },
  { id: 'kdy-kde', nazev: 'Kdy a kde', popis: 'Tabulka: události vodorovně, místa svisle, hráčský kánon v buňkách' },
  { id: 'kdo-kdy', nazev: 'Kdo a kdy', popis: 'Tabulka: události vodorovně, postavy hráčů svisle' },
  { id: 'blizkost', nazev: 'Blízkost k družině', popis: 'Postavy hráčů uprostřed, kolem kruhy po krocích vazeb' },
  { id: 'postoj', nazev: 'Spojenci a nepřátelé', popis: 'Vodorovně postoj vztahů k postavám hráčů, −3 až +3' },
  { id: 'znalost', nazev: 'Co družina ví', popis: 'Svisle, kolik z karty družina zná; sloupce podle typu', jenDm: true },
  { id: 'vlakna', nazev: 'Zapomenutá vlákna', popis: 'Vodorovně poslední událost, u které karta byla; vlevo zapomenuté' },
  { id: 'mosty', nazev: 'Mosty', popis: 'Síť, velikost uzlu podle toho, jak moc spojuje jinak oddělené části' },
]);

/** Rozložení s polohami spočítanými tady (ostatní jsou silová síť v panelu). */
export const POCITANA = new Set(['kdy-kde', 'kdo-kdy', 'blizkost', 'postoj', 'znalost', 'vlakna']);

const radek = (x) => Math.round(x);

/**
 * U kterých událostí entita byla: přímo ve vazbách události, nebo ve vazbách hráčského kánonu,
 * který na události visí (a kánon sám). Ids jdou přes `zast` (sbalená podmísta).
 * @param {Array<{vazby: string[]}>} udalosti seřazené podle času
 * @param {(id: string) => object|undefined} najit entita podle id (i neviditelné)
 * @param {(id: string) => string} zast
 * @returns {Map<string, number[]>} id → indexy událostí
 */
export function ucastNaUdalostech(udalosti, najit, zast = (x) => x) {
  const ucast = new Map();
  const pridat = (id, i) => {
    const z = zast(id);
    const pole = ucast.get(z) ?? [];
    if (pole.at(-1) !== i) pole.push(i);
    ucast.set(z, pole);
  };
  udalosti.forEach((u, i) => {
    for (const id of u.vazby) {
      pridat(id, i);
      const e = najit(id);
      if (e?.typ === 'kanon') for (const v of e.vazby ?? []) pridat(v, i);
    }
  });
  return ucast;
}

/** Postavy hráčů, kterých se událost týká (přímo, přes kánon, `kdo` kánonu; „parta“ = všechny). */
function postavyUdalosti(u, najit, postavy) {
  const vysledek = new Set();
  const pridat = (id) => {
    if (postavy.includes(id)) vysledek.add(id);
  };
  for (const id of u.vazby) {
    pridat(id);
    const e = najit(id);
    if (e?.typ !== 'kanon') continue;
    for (const v of e.vazby ?? []) pridat(v);
    for (const k of e.kdo ?? []) {
      if (k === 'parta' || k === 'druzina') postavy.forEach((p) => vysledek.add(p));
      else pridat(k);
    }
  }
  return vysledek;
}

/**
 * Obecná tabulka: sloupce = události, řádky = cokoli. Položky se v buňce řadí pod sebe,
 * řádek je tak vysoký, jak to nejplnější buňka potřebuje.
 * @param {{udalosti: object[], radky: Array<{id: string, nazev: string, uzel?: string}>,
 *   polozky: Array<{id: string, sloupec: number, radek: string}>, znacky?: Array<{sloupec: number, radek: string, trida?: string}>}} v
 */
export function tabulka({ udalosti, radky, polozky, znacky = [] }) {
  const SX = 210;
  const KROK = 44;
  const X0 = 0;
  const pozice = new Map();
  const dekorace = [];
  const vBunce = new Map();
  for (const p of polozky) {
    const k = `${p.radek} ${p.sloupec}`;
    vBunce.set(k, [...(vBunce.get(k) ?? []), p]);
  }
  const vysky = new Map(radky.map((r) => [r.id, Math.max(1, ...udalosti.map((_, i) => vBunce.get(`${r.id} ${i}`)?.length ?? 0))]));
  const poziceUdalosti = new Map();
  const yHlavy = -110;
  udalosti.forEach((u, i) => poziceUdalosti.set(`u:${u.id}`, { x: X0 + i * SX, y: yHlavy }));
  let y = 0;
  const xKonec = X0 + Math.max(0, udalosti.length - 1) * SX + SX / 2;
  radky.forEach((r, ri) => {
    const vyska = vysky.get(r.id) * KROK + 26;
    if (ri % 2 === 0) dekorace.push({ druh: 'pas', x: X0 - 330, y: y - 22, w: xKonec - X0 + 330, h: vyska, trida: 'pas-radku' });
    const stred = y + (vysky.get(r.id) - 1) * KROK / 2;
    if (r.uzel) pozice.set(r.uzel, { x: X0 - 250, y: radek(stred) });
    else dekorace.push({ druh: 'text', x: X0 - 250, y: radek(stred) + 4, text: r.nazev, trida: 'nadpis-radku', kotva: 'middle' });
    udalosti.forEach((_, i) => {
      (vBunce.get(`${r.id} ${i}`) ?? []).forEach((p, j) => pozice.set(p.id, { x: X0 + i * SX, y: radek(y + j * KROK) }));
    });
    for (const z of znacky.filter((x) => x.radek === r.id)) {
      if (vBunce.get(`${r.id} ${z.sloupec}`)?.length) continue;
      dekorace.push({ druh: 'kruh', x: X0 + z.sloupec * SX, y: radek(stred), r: 5, trida: z.trida ?? 'znacka' });
    }
    r.y = radek(stred);
    y += vyska;
  });
  udalosti.forEach((_, i) => dekorace.push({ druh: 'cara', x1: X0 + i * SX, y1: yHlavy + 12, x2: X0 + i * SX, y2: y - 22, trida: 'cara-sloupce' }));
  return { pozice, udalosti: poziceUdalosti, dekorace, bezHran: true, tlumene: new Set() };
}

/**
 * Kdy a kde: řádky = místa v pořadí, jak je družina poprvé navštívila, buňky = hráčský kánon
 * u své první události v prvním místě, které má ve vazbách (jinak místo události, jinak Bez místa).
 * @param {{udalosti: object[], viditelne: Set<string>, najit: Function, zast: Function}} v
 */
export function kdyAKde({ udalosti, viditelne, najit, zast }) {
  const jeMisto = (id) => viditelne.has(id) && najit(id)?.typ === 'misto';
  const ucast = ucastNaUdalostech(udalosti, najit, zast);
  const mista = [...viditelne].filter((id) => jeMisto(id) && ucast.has(id))
    .sort((a, b) => ucast.get(a)[0] - ucast.get(b)[0] || najit(a).nazev.localeCompare(najit(b).nazev, 'cs'));
  const polozky = [];
  const umisteny = new Set();
  udalosti.forEach((u, i) => {
    const mistaUdalosti = u.vazby.map(zast).filter(jeMisto);
    for (const id of u.vazby) {
      const e = najit(id);
      if (e?.typ !== 'kanon' || !viditelne.has(id) || umisteny.has(id)) continue;
      umisteny.add(id);
      const misto = (e.vazby ?? []).map(zast).find(jeMisto) ?? mistaUdalosti[0] ?? '_bez';
      polozky.push({ id, sloupec: i, radek: misto });
    }
  });
  const radky = mista.map((id) => ({ id, nazev: najit(id).nazev, uzel: id }));
  if (polozky.some((p) => p.radek === '_bez')) radky.push({ id: '_bez', nazev: 'Bez místa' });
  // Značka: místo bylo u události, ale žádný kánon tam nestojí.
  const znacky = [];
  for (const id of mista) for (const i of ucast.get(id)) znacky.push({ sloupec: i, radek: id });
  const v = tabulka({ udalosti, radky, polozky, znacky });
  // Trasa družiny: první návštěvy míst po sobě.
  const body = mista.map((id) => ({ x: ucast.get(id)[0] * 210, y: radky.find((r) => r.id === id).y }));
  if (body.length > 1) v.dekorace.push({ druh: 'cesta', body, trida: 'trasa' });
  return v;
}

/**
 * Kdo a kdy: řádky = Celá družina a každá postava hráče. Kánon jde do řádku své postavy, týká-li
 * se jedné, jinak do Celá družina. Značky ukazují, kdo u události byl; čára spojí jeho účast.
 */
export function kdoAKdy({ udalosti, viditelne, najit }) {
  const postavy = [...viditelne].filter((id) => najit(id)?.typ === 'postava').sort((a, b) => najit(a).nazev.localeCompare(najit(b).nazev, 'cs'));
  const polozky = [];
  const umisteny = new Set();
  const znacky = [];
  const ucast = new Map(postavy.map((p) => [p, []]));
  udalosti.forEach((u, i) => {
    for (const p of postavyUdalosti(u, najit, postavy)) {
      znacky.push({ sloupec: i, radek: p, trida: 'znacka znacka-postavy' });
      ucast.get(p).push(i);
    }
    for (const id of u.vazby) {
      const e = najit(id);
      if (e?.typ !== 'kanon' || !viditelne.has(id) || umisteny.has(id)) continue;
      umisteny.add(id);
      const jeho = postavyUdalosti({ vazby: [id] }, najit, postavy);
      polozky.push({ id, sloupec: i, radek: jeho.size === 1 ? [...jeho][0] : '_druzina' });
    }
  });
  const radky = [{ id: '_druzina', nazev: 'Celá družina' }, ...postavy.map((id) => ({ id, nazev: najit(id).nazev, uzel: id }))];
  const v = tabulka({ udalosti, radky, polozky, znacky });
  for (const p of postavy) {
    const u = ucast.get(p);
    const r = radky.find((x) => x.id === p);
    if (u.length > 1) v.dekorace.unshift({ druh: 'cara', x1: u[0] * 210, y1: r.y, x2: u.at(-1) * 210, y2: r.y, trida: 'cara-ucasti' });
  }
  return v;
}

/**
 * Vzdálenost od zdrojů v počtu vazeb (BFS). Nedosažitelné nemají záznam.
 * @param {string[]} ids
 * @param {Array<[string, string]>} dvojice
 * @param {string[]} zdroje
 */
export function vzdalenosti(ids, dvojice, zdroje) {
  const sousede = new Map(ids.map((id) => [id, []]));
  for (const [a, b] of dvojice) {
    if (!sousede.has(a) || !sousede.has(b)) continue;
    sousede.get(a).push(b);
    sousede.get(b).push(a);
  }
  const d = new Map();
  const fronta = [];
  for (const z of zdroje) if (sousede.has(z)) {
    d.set(z, 0);
    fronta.push(z);
  }
  while (fronta.length) {
    const x = fronta.shift();
    for (const y of sousede.get(x)) if (!d.has(y)) {
      d.set(y, d.get(x) + 1);
      fronta.push(y);
    }
  }
  return { d, sousede };
}

/**
 * Kruhy blízkosti: postavy hráčů uprostřed, kruh k = k kroků vazeb od nejbližší postavy.
 * Úhel uzlu je průměr úhlů jeho sousedů v kruhu blíž středu, ať příbuzné leží u sebe.
 */
export function kruhyBlizkosti({ viditelne, dvojice, najit }) {
  const ids = [...viditelne].sort();
  const postavy = ids.filter((id) => najit(id)?.typ === 'postava');
  const { d, sousede } = vzdalenosti(ids, dvojice, postavy);
  const max = Math.max(0, ...d.values());
  const kruhy = Array.from({ length: max + 2 }, () => []);
  for (const id of ids) kruhy[d.has(id) ? d.get(id) : max + 1].push(id);
  const pozice = new Map();
  const uhly = new Map();
  const dekorace = [];
  let polomer = 0;
  kruhy.forEach((kruh, k) => {
    if (!kruh.length) return;
    if (k === 0) {
      polomer = kruh.length === 1 ? 0 : Math.max(50, (kruh.length * 70) / (2 * Math.PI));
    } else {
      polomer = Math.max(polomer + 160, (kruh.length * 52) / (2 * Math.PI));
    }
    const prumer = (id) => {
      const u = sousede.get(id).filter((x) => uhly.has(x)).map((x) => uhly.get(x));
      if (!u.length) return Number.POSITIVE_INFINITY;
      return Math.atan2(u.reduce((s, a) => s + Math.sin(a), 0), u.reduce((s, a) => s + Math.cos(a), 0));
    };
    const serazene = k === 0 ? [...kruh].sort((a, b) => najit(a).nazev.localeCompare(najit(b).nazev, 'cs')) : [...kruh].sort((a, b) => prumer(a) - prumer(b) || a.localeCompare(b));
    // Řídký kruh: uzel co nejblíž úhlu svých sousedů (s rozestupem); plný kruh: rovnoměrně dokola.
    const mezera = 56 / Math.max(polomer, 1);
    const prani = serazene.map(prumer);
    const ridky = k > 0 && prani.every(Number.isFinite) && serazene.length * mezera < Math.PI;
    let predchozi = Number.NEGATIVE_INFINITY;
    serazene.forEach((id, i) => {
      let uhel = -Math.PI / 2 + (i / serazene.length) * 2 * Math.PI;
      if (ridky) {
        uhel = Math.max(prani[i], predchozi + mezera);
        predchozi = uhel;
      }
      uhly.set(id, uhel);
      pozice.set(id, { x: radek(Math.cos(uhel) * polomer), y: radek(Math.sin(uhel) * polomer) });
    });
    if (k > 0) {
      const mimo = k === max + 1;
      dekorace.push({ druh: 'kruh', x: 0, y: 0, r: radek(polomer), trida: mimo ? 'kruh-blizkosti mimo' : 'kruh-blizkosti' });
      dekorace.push({ druh: 'text', x: 0, y: radek(-polomer - 14), text: mimo ? 'bez spojení s družinou' : k === 1 ? '1 krok' : k < 5 ? `${k} kroky` : `${k} kroků`, trida: 'popisek-osy-mapy', kotva: 'middle' });
    }
  });
  return { pozice, udalosti: new Map(), dekorace, bezHran: false, tlumene: new Set(kruhy[max + 1]) };
}

/**
 * Položky do sloupců (a v nich do mřížky): sloupec = číslo, v buňce pod sebe, nejvýš `vRade` vedle sebe.
 * @param {Array<{id: string, sloupec: number}>} polozky seřazené, jak mají jít
 */
function doSloupcu(polozky, { x0 = 0, y0 = 0, sirka = 200, vRade = 3, krokX = 62, krokY = 46, nahoru = false } = {}) {
  const pozice = new Map();
  const pocty = new Map();
  for (const p of polozky) {
    const n = pocty.get(p.sloupec) ?? 0;
    pocty.set(p.sloupec, n + 1);
    const sl = n % vRade;
    const rad = Math.floor(n / vRade);
    const posun = (sl - (vRade - 1) / 2) * krokX;
    pozice.set(p.id, { x: radek(x0 + p.sloupec * sirka + posun), y: radek(y0 + (nahoru ? -1 : 1) * rad * krokY) });
  }
  return { pozice, pocty };
}

/** Průměrný postoj vztahů mezi entitou a postavami hráčů (oba směry), nebo null. */
export function postojKDruzine(e, postavy, najit) {
  const hodnoty = [];
  for (const v of e.vztahy ?? []) if (postavy.includes(v.s) && Number.isInteger(v.postoj)) hodnoty.push(v.postoj);
  for (const p of postavy) for (const v of najit(p)?.vztahy ?? []) if (v.s === e.id && Number.isInteger(v.postoj)) hodnoty.push(v.postoj);
  return hodnoty.length ? hodnoty.reduce((s, x) => s + x, 0) / hodnoty.length : null;
}

const POPISY_POSTOJE = { '-3': 'nepřítel', '-2': 'nepřátelský', '-1': 'chladný', 0: 'neutrální', 1: 'vlídný', 2: 'přátelský', 3: 'blízký' };

/** Spojenci a nepřátelé: vodorovně postoj k družině po půl bodech, nahoře postavy hráčů, dole bez postoje. */
export function osaPostoje({ viditelne, najit, poradiTypu }) {
  const ids = [...viditelne];
  const postavy = ids.filter((id) => najit(id)?.typ === 'postava');
  const serad = (a, b) => poradiTypu.indexOf(najit(a).typ) - poradiTypu.indexOf(najit(b).typ) || najit(a).nazev.localeCompare(najit(b).nazev, 'cs');
  const sPostojem = [];
  const bez = [];
  for (const id of ids.filter((x) => !postavy.includes(x)).sort(serad)) {
    const p = postojKDruzine(najit(id), postavy, najit);
    if (p === null) bez.push(id);
    else sPostojem.push({ id, sloupec: Math.round(p * 2) });
  }
  const SIRKA = 105;
  const { pozice } = doSloupcu(sPostojem, { sirka: SIRKA, vRade: 1, krokY: 46 });
  const dekorace = [{ druh: 'cara', x1: -6.6 * SIRKA, y1: -60, x2: 6.6 * SIRKA, y2: -60, trida: 'cara-osy-mapy' }];
  for (let p = -3; p <= 3; p++) {
    dekorace.push({ druh: 'cara', x1: p * 2 * SIRKA, y1: -66, x2: p * 2 * SIRKA, y2: -54, trida: 'cara-osy-mapy' });
    dekorace.push({ druh: 'text', x: p * 2 * SIRKA, y: -76, text: `${p > 0 ? '+' : ''}${p} ${POPISY_POSTOJE[p]}`, trida: 'popisek-osy-mapy', kotva: 'middle' });
  }
  postavy.sort((a, b) => najit(a).nazev.localeCompare(najit(b).nazev, 'cs')).forEach((id, i) => pozice.set(id, { x: radek((i - (postavy.length - 1) / 2) * 120), y: -190 }));
  const hloubka = Math.max(0, ...sPostojem.map((p) => [...pozice].filter(([, q]) => q.x === pozice.get(p.id).x).length)) * 46;
  const yBez = hloubka + 120;
  dekorace.push({ druh: 'text', x: -6.6 * SIRKA, y: yBez - 30, text: `Bez postoje k družině (${bez.length})`, trida: 'nadpis-radku', kotva: 'start' });
  const vRade = 10;
  bez.forEach((id, i) => pozice.set(id, { x: radek(-6.6 * SIRKA + 20 + (i % vRade) * 145), y: radek(yBez + Math.floor(i / vRade) * 50) }));
  return { pozice, udalosti: new Map(), dekorace, bezHran: true, tlumene: new Set(bez) };
}

/** Úroveň znalosti karty pro rozložení Co družina ví. */
export function urovenZnalosti(e) {
  if (!e.verejne) return 0;
  const o = e.odkryto ?? { zna: 0, celkem: 0 };
  if (!o.celkem || !o.zna) return 1;
  const podil = o.zna / o.celkem;
  if (podil >= 1) return 5;
  if (podil > 2 / 3) return 4;
  if (podil > 1 / 3) return 3;
  return 2;
}
const UROVNE = ['Družina kartu nezná', 'Zná kartu, nic odkrytého', 'Odkryto do třetiny', 'Odkryto do dvou třetin', 'Odkryto skoro vše', 'Odkryto vše'];

/** Co družina ví: řádky podle odkryté části (nahoře vše), sloupce podle typu. */
export function znalost({ viditelne, najit, poradiTypu, nazvyTypu }) {
  const ids = [...viditelne];
  const typy = poradiTypu.filter((t) => ids.some((id) => najit(id).typ === t));
  const SX = 330;
  const vRade = 4;
  const KROK = 50;
  const vBunce = new Map();
  for (const id of ids.sort((a, b) => najit(a).nazev.localeCompare(najit(b).nazev, 'cs'))) {
    const k = `${urovenZnalosti(najit(id))} ${najit(id).typ}`;
    vBunce.set(k, [...(vBunce.get(k) ?? []), id]);
  }
  const pozice = new Map();
  const dekorace = [];
  let y = 0;
  for (let u = 5; u >= 0; u--) {
    const radu = Math.max(1, ...typy.map((t) => Math.ceil((vBunce.get(`${u} ${t}`)?.length ?? 0) / vRade)));
    const vyska = radu * KROK + 30;
    if (u % 2 === 1) dekorace.push({ druh: 'pas', x: -SX * 0.9, y: y - 24, w: typy.length * SX + SX * 0.4, h: vyska, trida: 'pas-radku' });
    dekorace.push({ druh: 'text', x: -SX * 0.85, y: y + 4, text: UROVNE[u], trida: 'nadpis-radku', kotva: 'start' });
    typy.forEach((t, ti) => {
      (vBunce.get(`${u} ${t}`) ?? []).forEach((id, i) => pozice.set(id, { x: radek(ti * SX + SX * 0.12 + (i % vRade) * 72), y: radek(y + Math.floor(i / vRade) * KROK) }));
    });
    y += vyska;
  }
  typy.forEach((t, ti) => dekorace.push({ druh: 'text', x: ti * SX + SX * 0.12 + 108, y: -50, text: nazvyTypu[t] ?? t, trida: 'nadpis-sloupce', kotva: 'middle' }));
  return { pozice, udalosti: new Map(), dekorace, bezHran: true, tlumene: new Set(ids.filter((id) => urovenZnalosti(najit(id)) === 0)) };
}

/** Otevřené vlákno: rozhodnutí ve stavu otevřené nebo kánon s Dořešit. */
export const jeOtevrene = (e) => (e?.typ === 'rozhodnuti' && e.udaje?.stav === 'otevrene') || e?.udaje?.doresit === 'ano';

/** Zapomenutá vlákna: sloupec = poslední událost, u které karta byla (vlevo Nikdy), otevřená nahoře. */
export function vlakna({ udalosti, viditelne, najit, zast, poradiTypu }) {
  const ucast = ucastNaUdalostech(udalosti, najit, zast);
  const SIRKA = 240;
  const polozky = [...viditelne]
    .map((id) => ({ id, sloupec: ucast.has(id) ? ucast.get(id).at(-1) + 1 : 0 }))
    .sort((a, b) => Number(jeOtevrene(najit(b.id))) - Number(jeOtevrene(najit(a.id))) || poradiTypu.indexOf(najit(a.id).typ) - poradiTypu.indexOf(najit(b.id).typ) || najit(a.id).nazev.localeCompare(najit(b.id).nazev, 'cs'));
  // Sloupec Nikdy bývá plný: dostane víc místa vedle sebe.
  const nikdy = polozky.filter((p) => p.sloupec === 0);
  const ostatni = polozky.filter((p) => p.sloupec > 0);
  const vRadeNikdy = Math.max(3, Math.ceil(Math.sqrt(nikdy.length * 0.8)));
  const sirkaNikdy = vRadeNikdy * 82 + 60;
  const { pozice } = doSloupcu(ostatni.map((p) => ({ ...p, sloupec: p.sloupec - 1 })), { x0: sirkaNikdy / 2 + SIRKA / 2 + 40, sirka: SIRKA, vRade: 3, krokX: 78, krokY: 50 });
  for (const [id, p] of doSloupcu(nikdy.map((p) => ({ ...p, sloupec: 0 })), { x0: 0, vRade: vRadeNikdy, krokX: 82, krokY: 50 }).pozice) pozice.set(id, p);
  const dno = Math.max(0, ...[...pozice.values()].map((p) => p.y)) + 40;
  const dekorace = [{ druh: 'text', x: 0, y: -60, text: `Nikdy u události (${nikdy.length})`, trida: 'nadpis-sloupce', kotva: 'middle' }];
  udalosti.forEach((u, i) => {
    const x = sirkaNikdy / 2 + SIRKA / 2 + 40 + i * SIRKA;
    dekorace.push({ druh: 'text', x, y: -74, text: u.datumKratce ?? '', trida: 'datum-osy-mapy', kotva: 'middle' });
    dekorace.push({ druh: 'text', x, y: -56, text: u.text.length > 30 ? `${u.text.slice(0, 28)}…` : u.text, trida: 'nadpis-sloupce', kotva: 'middle' });
    dekorace.push({ druh: 'cara', x1: x - SIRKA / 2, y1: -90, x2: x - SIRKA / 2, y2: dno, trida: 'cara-sloupce' });
  });
  dekorace.push({ druh: 'text', x: sirkaNikdy / 2 + 40 + (udalosti.length * SIRKA) / 2, y: -108, text: 'naposledy u události →', trida: 'popisek-osy-mapy', kotva: 'middle' });
  return { pozice, udalosti: new Map(), dekorace, bezHran: true, tlumene: new Set(), zvyraznene: new Set(polozky.filter((p) => jeOtevrene(najit(p.id))).map((p) => p.id)) };
}

/**
 * Prostřednost (betweenness, Brandes): jak často uzel leží na nejkratší cestě mezi dvěma jinými.
 * @returns {Map<string, number>} 0–1 (1 = nejvíc spojující uzel)
 */
export function prostrednost(ids, dvojice) {
  const { sousede } = vzdalenosti(ids, dvojice, []);
  const cb = new Map(ids.map((id) => [id, 0]));
  for (const s of ids) {
    const zasobnik = [];
    const predchudci = new Map(ids.map((id) => [id, []]));
    const sigma = new Map(ids.map((id) => [id, 0]));
    const dist = new Map();
    sigma.set(s, 1);
    dist.set(s, 0);
    const fronta = [s];
    while (fronta.length) {
      const v = fronta.shift();
      zasobnik.push(v);
      for (const w of sousede.get(v)) {
        if (!dist.has(w)) {
          dist.set(w, dist.get(v) + 1);
          fronta.push(w);
        }
        if (dist.get(w) === dist.get(v) + 1) {
          sigma.set(w, sigma.get(w) + sigma.get(v));
          predchudci.get(w).push(v);
        }
      }
    }
    const delta = new Map(ids.map((id) => [id, 0]));
    while (zasobnik.length) {
      const w = zasobnik.pop();
      for (const v of predchudci.get(w)) delta.set(v, delta.get(v) + (sigma.get(v) / sigma.get(w)) * (1 + delta.get(w)));
      if (w !== s) cb.set(w, cb.get(w) + delta.get(w));
    }
  }
  const max = Math.max(0, ...cb.values());
  return new Map([...cb].map(([id, x]) => [id, max ? x / max : 0]));
}
