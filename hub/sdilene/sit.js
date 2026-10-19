// Rozložení sítě kánonu (Blok 3, modul Kánon): jednoduchá silová simulace bez knihoven, aby mapa
// fungovala bez internetu. Pro ~200 uzlů stačí přímý výpočet odpuzování každý s každým.
//
// Každý typ má svou čtvrť (kotvu), postavy jsou uprostřed. Vazby uzly přitahují k sobě, uzly se
// odpuzují a nepřekrývají. Výchozí pozice se odvozují z id, takže stejná data dají stejnou mapu.

/** Kde leží čtvrť typu (jako mapa kánonu z 19. 10. 2026). */
export const KOTVY = Object.freeze({
  postava: [0, 0],
  padouch: [0, -330],
  frakce: [-320, -260],
  npc: [-380, 90],
  misto: [380, 40],
  predmet: [40, 340],
  sezeni: [320, -290],
  kanon: [420, 330],
  rozhodnuti: [-60, 580],
  bytost: [-380, 400],
});

/** Deterministické „náhodné“ číslo 0–1 z textu (FNV-1a). */
export function hashCislo(text, sul = 0) {
  let h = 2166136261 ^ sul;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** Poloměr uzlu podle typu a počtu vazeb. */
export function polomer(uzel, stupen = 0) {
  if (uzel.typ === 'postava') return 22;
  if (uzel.typ === 'padouch') return 16;
  const zaklad = uzel.obrazek ? 12 : 6;
  return Math.max(zaklad, Math.min(15, 6 + Math.sqrt(stupen) * 1.9));
}

/**
 * Spočítá pozice uzlů.
 * @param {Array<{id: string, typ: string, r?: number}>} uzly
 * @param {Array<[string, string]>} hrany dvojice id
 * @param {{pevne?: Map<string, {x: number, y: number}>, start?: Map<string, {x: number, y: number}>, iterace?: number}} [volby]
 *   pevne: uzly, které se nehýbou (uložená nástěnka, ručně posunuté)
 *   start: výchozí pozice (předchozí rozložení), ostatní se rozmístí u kotvy nebo u sousedů
 * @returns {Map<string, {x: number, y: number}>}
 */
export function rozlozit(uzly, hrany, { pevne = new Map(), start = new Map(), iterace = 320 } = {}) {
  const index = new Map(uzly.map((u, i) => [u.id, i]));
  const n = uzly.length;
  const sousede = uzly.map(() => []);
  const spoje = [];
  for (const [a, b] of hrany) {
    const ia = index.get(a);
    const ib = index.get(b);
    if (ia === undefined || ib === undefined || ia === ib) continue;
    spoje.push([ia, ib]);
    sousede[ia].push(ib);
    sousede[ib].push(ia);
  }
  const r = uzly.map((u, i) => u.r ?? polomer(u, sousede[i].length));
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  const pevny = new Uint8Array(n);
  const umisteny = new Uint8Array(n);

  uzly.forEach((u, i) => {
    const p = pevne.get(u.id) ?? start.get(u.id);
    if (p) {
      x[i] = p.x;
      y[i] = p.y;
      umisteny[i] = 1;
      if (pevne.has(u.id)) pevny[i] = 1;
    }
  });
  // Nové uzly: k už umístěným sousedům, jinak do čtvrti svého typu.
  uzly.forEach((u, i) => {
    if (umisteny[i]) return;
    const uhel = hashCislo(u.id) * Math.PI * 2;
    const vzdal = 30 + hashCislo(u.id, 7) * 70;
    const znami = sousede[i].filter((j) => umisteny[j]);
    let cx;
    let cy;
    if (znami.length) {
      cx = znami.reduce((s, j) => s + x[j], 0) / znami.length;
      cy = znami.reduce((s, j) => s + y[j], 0) / znami.length;
    } else {
      [cx, cy] = KOTVY[u.typ] ?? [0, 0];
    }
    x[i] = cx + Math.cos(uhel) * vzdal;
    y[i] = cy + Math.sin(uhel) * vzdal;
  });

  // Když skoro všechno už pozici má (živá změna, nástěnka), stačí pár kroků na dorovnání nových.
  const novych = n - [...umisteny].filter(Boolean).length;
  const kroku = start.size || pevne.size ? Math.min(iterace, 60 + novych * 15) : iterace;
  let alfa = start.size || pevne.size ? 0.35 : 1;
  const pokles = 1 - Math.pow(0.001, 1 / Math.max(1, kroku));
  for (let k = 0; k < kroku; k++) {
    // Odpuzování a srážky
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = x[j] - x[i];
        let dy = y[j] - y[i];
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          dx = (hashCislo(uzly[i].id + uzly[j].id) - 0.5) * 0.1;
          dy = 0.05;
          d2 = dx * dx + dy * dy;
        }
        // Odpuzování jako náboj (−230), slábne se čtvercem vzdálenosti.
        const k = (-230 * alfa) / Math.max(d2, 100);
        vx[i] += dx * k;
        vy[i] += dy * k;
        vx[j] -= dx * k;
        vy[j] -= dy * k;
        // Srážka: uzly se nepřekrývají ani s popiskem pod sebou.
        const d = Math.sqrt(d2);
        const min = r[i] + r[j] + 6;
        if (d < min) {
          const c = ((min - d) / d) * 0.5;
          vx[i] -= dx * c;
          vy[i] -= dy * c;
          vx[j] += dx * c;
          vy[j] += dy * c;
        }
      }
    }
    // Vazby jako pružiny
    for (const [a, b] of spoje) {
      const dx = x[b] - x[a];
      const dy = y[b] - y[a];
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const delka = 46 + r[a] + r[b];
      const l = ((d - delka) / d) * 0.25 * alfa;
      vx[a] += dx * l * 0.5;
      vy[a] += dy * l * 0.5;
      vx[b] -= dx * l * 0.5;
      vy[b] -= dy * l * 0.5;
    }
    // Čtvrti typů
    for (let i = 0; i < n; i++) {
      const [kx, ky] = KOTVY[uzly[i].typ] ?? [0, 0];
      vx[i] += (kx - x[i]) * 0.07 * alfa;
      vy[i] += (ky - y[i]) * 0.07 * alfa;
    }
    for (let i = 0; i < n; i++) {
      if (pevny[i]) {
        vx[i] = 0;
        vy[i] = 0;
        continue;
      }
      vx[i] *= 0.6;
      vy[i] *= 0.6;
      // Omezení kroku: rozbitá data nesmí uzel vystřelit do nekonečna.
      const v = Math.hypot(vx[i], vy[i]);
      if (v > 40) {
        vx[i] *= 40 / v;
        vy[i] *= 40 / v;
      }
      x[i] += vx[i];
      y[i] += vy[i];
    }
    alfa *= 1 - pokles;
  }
  const vysledek = new Map();
  uzly.forEach((u, i) => vysledek.set(u.id, { x: Math.round(x[i] * 10) / 10, y: Math.round(y[i] * 10) / 10 }));
  return vysledek;
}

/** Text bez diakritiky a velkých písmen pro hledání („krkavci“ najde Krkavčí prapor). */
export const proHledani = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Hledání podle názvu a přezdívek. Nejdřív začátky slov, pak podle počtu vazeb.
 * @param {Array<{id, nazev, aliases?, stupen?}>} entity
 */
export function hledat(entity, dotaz, limit = 10) {
  const q = proHledani(dotaz).trim();
  if (!q) return [];
  const skore = (e) => {
    const texty = [e.nazev, ...(e.aliases ?? [])].map(proHledani);
    if (texty.some((t) => t.startsWith(q))) return 0;
    if (texty.some((t) => t.split(/[\s„“"'(),.-]+/).some((slovo) => slovo.startsWith(q)))) return 1;
    if (texty.some((t) => t.includes(q))) return 2;
    return null;
  };
  return entity
    .map((e) => ({ e, s: skore(e) }))
    .filter((x) => x.s !== null)
    .sort((a, b) => a.s - b.s || (b.e.stupen ?? 0) - (a.e.stupen ?? 0) || a.e.nazev.localeCompare(b.e.nazev, 'cs'))
    .slice(0, limit)
    .map((x) => x.e);
}
