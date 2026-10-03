// Kalendář Harptos (Forgotten Realms). Sdílený modul: používá ho server (Další den, ověření dat)
// i výstupy v prohlížeči. Převzato z Apps/Calendar/kalendar.html (blok HARPTOS-START … HARPTOS-END)
// beze změny výpočtů; pole „odpocet“ u události se v Hubu jmenuje „lhuta“ (rozhodnutí 22).

export const MESICE = ['Hammer', 'Alturiak', 'Ches', 'Tarsakh', 'Mirtul', 'Kythorn',
  'Flamerule', 'Eleasis', 'Eleint', 'Marpenoth', 'Uktar', 'Nightal'];
// Svátky stojí mimo měsíce, vždy po měsíci s daným indexem. Shieldmeet jen v přestupném roce.
export const SVATKY = { 0: ['Midwinter'], 3: ['Greengrass'], 6: ['Midsummer', 'Shieldmeet'], 8: ['Highharvestide'], 10: ['Feast of the Moon'] };
export const RIMSKE = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
export const MAX_LHUTA = 999;

const cache = new Map();

export const Harptos = {
  jePrestupny(rok) { return rok % 4 === 0; },
  dny(rok) {
    if (cache.has(rok)) return cache.get(rok);
    const out = [];
    MESICE.forEach((mesic, mi) => {
      for (let den = 1; den <= 30; den++) out.push({ rok, mesic, den, mi });
      (SVATKY[mi] || []).forEach((svatek) => {
        if (svatek === 'Shieldmeet' && !this.jePrestupny(rok)) return;
        out.push({ rok, svatek, po: mi });
      });
    });
    cache.set(rok, out);
    return out;
  },
  klic(d) { return d.svatek ? `${d.rok}|${d.svatek}` : `${d.rok}|${d.mesic}|${d.den}`; },
  index(d) { const k = this.klic(d); return this.dny(d.rok).findIndex((x) => this.klic(x) === k); },
  cisty(x) { return x.svatek ? { rok: x.rok, svatek: x.svatek } : { rok: x.rok, mesic: x.mesic, den: x.den }; },
  posun(d, n) {
    let rok = d.rok;
    let i = this.index(d) + n;
    while (i < 0) { rok--; i += this.dny(rok).length; }
    while (i >= this.dny(rok).length) { i -= this.dny(rok).length; rok++; }
    return this.cisty(this.dny(rok)[i]);
  },
  /** Platné datum, nebo null. Přijímá {rok, mesic, den} i {rok, svatek}. */
  normalizuj(x) {
    if (!x || !Number.isInteger(x.rok) || x.rok < 1) return null;
    if (x.svatek) return this.dny(x.rok).some((d) => d.svatek === x.svatek) ? { rok: x.rok, svatek: x.svatek } : null;
    if (MESICE.indexOf(x.mesic) < 0 || !Number.isInteger(x.den) || x.den < 1 || x.den > 30) return null;
    return { rok: x.rok, mesic: x.mesic, den: x.den };
  },
  // Pořadové číslo dne od počátku letopočtu; rozdíl dvou dat = počet dní mezi nimi.
  absolutni(d) { return 365 * (d.rok - 1) + Math.floor((d.rok - 1) / 4) + this.index(d); },
  rozdil(od, do_) { return this.absolutni(do_) - this.absolutni(od); },
  stejne(a, b) { return Boolean(a && b) && this.klic(a) === this.klic(b); },
  kratce(d) { return d.svatek ? d.svatek : `${d.den}. ${d.mesic}`; },
  // „12.–15. Eleint 1491 DR“, „28. Eleint – 3. Marpenoth 1491 DR“, přes rok celé datum na obou stranách
  formatRozsah(a, b) {
    if (!b) return this.format(a);
    if (a.rok !== b.rok) return `${this.format(a)} – ${this.format(b)}`;
    if (!a.svatek && !b.svatek && a.mesic === b.mesic) return `${a.den}.–${b.den}. ${a.mesic} ${a.rok} DR`;
    return `${this.kratce(a)} – ${this.kratce(b)} ${a.rok} DR`;
  },
  format(d) { return d.svatek ? `${d.svatek} ${d.rok} DR` : `${d.den}. ${d.mesic} ${d.rok} DR`; },
  popisSvatku(d) {
    const x = this.dny(d.rok)[this.index(d)];
    return x.svatek === 'Shieldmeet' ? 'po svátku Midsummer' : `po měsíci ${MESICE[x.po]}`;
  },
  /**
   * Rozebere text „19. Eleint 1491“, „19. Eleint 1491 DR“ nebo „Highharvestide 1491 DR“.
   * Slouží k převodu staršího textového data ve stav.md. Vrací datum, nebo null.
   */
  zTextu(text) {
    const t = String(text ?? '').trim().replace(/\s+DR$/i, '');
    let m = /^(\d{1,2})\.\s*([A-Za-z]+)\s+(\d{1,4})$/.exec(t);
    if (m) {
      const mesic = MESICE.find((x) => x.toLowerCase() === m[2].toLowerCase());
      return this.normalizuj({ rok: Number(m[3]), mesic, den: Number(m[1]) });
    }
    m = /^(.+?)\s+(\d{1,4})$/.exec(t);
    if (m) {
      const vsechny = Object.values(SVATKY).flat();
      const svatek = vsechny.find((x) => x.toLowerCase() === m[1].trim().toLowerCase());
      return svatek ? this.normalizuj({ rok: Number(m[2]), svatek }) : null;
    }
    return null;
  },
};

export function noveId() {
  return `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Jedna událost v jednotném tvaru, nebo null. Starší pole „odpocet“ se převede na „lhuta“. */
export function normalizujUdalost(u) {
  const datum = Harptos.normalizuj(u?.datum);
  const text = String(u?.text ?? '').trim();
  if (!datum || !text) return null;
  const zaznam = { id: String(u.id || noveId()), datum, text, verejna: u.verejna !== false };
  const konec = Harptos.normalizuj(u.konec);
  if (konec && Harptos.rozdil(datum, konec) >= 1) zaznam.konec = konec;
  const lhuta = u.lhuta ?? u.odpocet;
  if (Number.isInteger(lhuta) && lhuta >= 1 && lhuta <= MAX_LHUTA) zaznam.lhuta = lhuta;
  return zaznam;
}

/** Události seřazené podle data (stabilně, při shodě podle pořadí zápisu). */
export function seradit(udalosti) {
  return udalosti
    .map((u, i) => ({ u, i }))
    .sort((a, b) => Harptos.absolutni(a.u.datum) - Harptos.absolutni(b.u.datum) || a.i - b.i)
    .map((x) => x.u);
}

// Veřejné události s lhůtou, které se mají dnes ukázat: 1 až N dní před událostí, nejbližší první.
export function aktivniLhuty(dnes, udalosti) {
  return udalosti
    .filter((u) => u.verejna && u.lhuta)
    .map((u) => ({ u, zbyva: Harptos.rozdil(dnes, u.datum) }))
    .filter((x) => x.zbyva >= 1 && x.zbyva <= x.u.lhuta)
    .sort((a, b) => a.zbyva - b.zbyva);
}

// Veřejné události, které dnes probíhají: nejdřív ty, co dnes začínají (v pořadí zápisu), pak vícedenní rozběhnuté dřív.
export function udalostiDne(dnes, udalosti, { jenVerejne = true } = {}) {
  const d = Harptos.absolutni(dnes);
  const zacinaji = [];
  const probihaji = [];
  udalosti.forEach((u) => {
    if (jenVerejne && !u.verejna) return;
    const z = Harptos.absolutni(u.datum);
    const k = u.konec ? Harptos.absolutni(u.konec) : z;
    if (d < z || d > k) return;
    const x = { u, den: d - z + 1, celkem: k - z + 1 };
    (z === d ? zacinaji : probihaji).push(x);
  });
  probihaji.sort((a, b) => Harptos.absolutni(a.u.datum) - Harptos.absolutni(b.u.datum));
  return zacinaji.concat(probihaji);
}

/** Pořadí dne v roce pro začátek oblouku „cesty“ na velkém orloji (null = nekreslit). */
export function indexZacatku(zacatek, dnes) {
  if (!zacatek || zacatek.rok > dnes.rok) return null;
  if (zacatek.rok < dnes.rok) return 0;
  const zi = Harptos.index(zacatek);
  return zi <= Harptos.index(dnes) ? zi : null;
}

export function dnyText(n) { return n === 1 ? '1 den' : n + (n >= 2 && n <= 4 ? ' dny' : ' dní'); }
export function zbyvaText(n) { return n === 1 ? 'zítra' : `za ${n}${n >= 2 && n <= 4 ? ' dny' : ' dní'}`; }
