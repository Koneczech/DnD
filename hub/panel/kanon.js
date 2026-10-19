// Modul Kánon v panelu (Blok 3, rozhodnutí 69–71, bod 102): síť entit vlevo, karta vpravo.
// Kreslí se ze souborů v kampan/ přes /api/kanon, bez knihoven a bez internetu.
import { rozlozit, polomer, hledat, proHledani } from '/sdilene/sit.js';
import { naHtml, escapovat } from '/sdilene/markdown.js';

const $ = (sel, koren = document) => koren.querySelector(sel);

export const TYPY = {
  postava: { mn: 'Postavy', j: 'postava' },
  padouch: { mn: 'Padouši', j: 'padouch' },
  frakce: { mn: 'Frakce', j: 'frakce' },
  npc: { mn: 'NPC', j: 'NPC' },
  misto: { mn: 'Místa', j: 'místo' },
  predmet: { mn: 'Předměty', j: 'předmět' },
  bytost: { mn: 'Bytosti', j: 'bytost' },
  sezeni: { mn: 'Sezení', j: 'sezení' },
  kanon: { mn: 'Hráčský kánon', j: 'hráčský kánon' },
  rozhodnuti: { mn: 'Rozhodnutí', j: 'rozhodnutí' },
};
const POSTOJE = { '-3': 'nepřítel', '-2': 'nepřátelský', '-1': 'chladný', 0: 'neutrální', 1: 'vlídný', 2: 'přátelský', 3: 'blízký' };
const UDAJE = { hrac: 'Hráč', druh: 'Druh', povolani: 'Povolání', stav: 'Stav', oblast: 'Oblast', zaznamenano: 'Zaznamenáno', sezeni: 'Sezení', cislo: 'Číslo', kdo: 'Kdo', doresit: 'Dořešit' };
const STAVY = { otevrene: 'otevřené', rozhodnuto: 'rozhodnuto', zavrzeno: 'zavrženo' };
const barvaTypu = (t) => `var(--t-${TYPY[t] ? t : 'npc'})`;
const barvaPostoje = (p) => (Number.isInteger(p) ? `var(--postoj-${p < 0 ? `m${-p}` : p})` : null);
const postojText = (p) => (Number.isInteger(p) ? `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)} ${POSTOJE[p]}` : '');
const SVG = 'http://www.w3.org/2000/svg';

function el(tag, vlastnosti = {}, ...deti) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(vlastnosti)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'style') e.setAttribute('style', v);
    else if (k.startsWith('data-') || k.startsWith('aria-') || k === 'role' || k === 'for') e.setAttribute(k, v === true ? '' : v);
    else e[k] = v;
  }
  e.append(...deti.flat().filter((d) => d !== null && d !== undefined && d !== false));
  return e;
}
/** replaceChildren bez prázdných hodnot (null by se vypsalo jako text „null“). */
const nahradit = (kam, ...deti) => kam.replaceChildren(...deti.flat().filter((d) => d !== null && d !== undefined && d !== false));
function svg(tag, atributy = {}) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(atributy)) if (v !== undefined && v !== null) e.setAttribute(k, v);
  return e;
}

/**
 * Výřez hlavy z portrétu postavy. Portréty jsou celé figury na průhledném plátně 1080 × 1500
 * a různě vysoké (malý hobit, velký medvěd), proto se hlava hledá podle průhlednosti obrázku.
 * @returns {Promise<{x: number, y: number, s: number, pomer: number}|null>} x a s ve zlomcích šířky, y ve zlomcích výšky
 */
const vyrezy = new Map();
function vyrezHlavy(url) {
  if (!vyrezy.has(url)) {
    vyrezy.set(url, new Promise((hotovo) => {
      const obr = new Image();
      obr.onload = () => {
        try {
          const pomer = obr.naturalHeight / obr.naturalWidth;
          const w = 72;
          const h = Math.max(1, Math.round(w * pomer));
          const platno = document.createElement('canvas');
          platno.width = w;
          platno.height = h;
          const g = platno.getContext('2d', { willReadFrequently: true });
          g.drawImage(obr, 0, 0, w, h);
          const d = g.getImageData(0, 0, w, h).data;
          const plny = (x, y) => d[(y * w + x) * 4 + 3] > 40;
          if (plny(0, 0) && plny(w - 1, 0)) return hotovo(null); // bez průhlednosti: obyčejný obrázek
          let nahore = -1;
          let dole = -1;
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              if (!plny(x, y)) continue;
              if (nahore < 0) nahore = y;
              dole = y;
              break;
            }
          }
          if (nahore < 0) return hotovo(null);
          const strana = Math.min(w, Math.max((dole - nahore + 1) * 0.42, w * 0.22));
          let soucet = 0;
          let pocet = 0;
          for (let y = nahore; y < Math.min(h, nahore + strana * 0.7); y++) {
            for (let x = 0; x < w; x++) {
              if (plny(x, y)) {
                soucet += x;
                pocet++;
              }
            }
          }
          const stred = pocet ? soucet / pocet : w / 2;
          hotovo({ x: (stred - strana / 2) / w, y: (nahore - strana * 0.1) / h, s: strana / w, pomer });
        } catch {
          hotovo(null);
        }
      };
      obr.onerror = () => hotovo(null);
      obr.src = url;
    }));
  }
  return vyrezy.get(url);
}

/** Výřez hlavy na <img> uvnitř čtvercového rámečku s overflow: hidden. */
function oriznoutPortret(img, url) {
  vyrezHlavy(url).then((v) => {
    if (!v) return;
    img.classList.add('vyrez');
    img.style.width = `${100 / v.s}%`;
    img.style.left = `${(-v.x / v.s) * 100}%`;
    img.style.top = `${((-v.y * v.pomer) / v.s) * 100}%`;
  });
  return img;
}

/** Uložené volby mapy v prohlížeči (filtry, pohled). Bez localStorage to funguje taky. */
const ULOZENI = 'dmhub-kanon';
function nacistVolby() {
  try {
    return JSON.parse(localStorage.getItem(ULOZENI)) ?? {};
  } catch {
    return {};
  }
}
function ulozitVolby(v) {
  try {
    localStorage.setItem(ULOZENI, JSON.stringify(v));
  } catch {
    /* soukromé okno */
  }
}

/**
 * @param {{api: Function, toast: Function, otevritPoznamku: (text?: string) => void}} zavislosti
 */
export function vytvoritKanon({ api, toast, otevritPoznamku }) {
  const ulozene = nacistVolby();
  const s = {
    pohled: ulozene.pohled === 'druzina' ? 'druzina' : 'dm',
    typy: new Set(Array.isArray(ulozene.typy) ? ulozene.typy : Object.keys(TYPY).filter((t) => t !== 'rozhodnuti')),
    jenVeHre: ulozene.jenVeHre === true,
    data: null, // odpověď /api/kanon
    podleId: new Map(),
    stupen: new Map(),
    pozice: new Map(), // aktuální rozložení
    pevne: new Map(), // ručně posunuté a z nástěnky
    nastenka: null, // { id, nazev, pohled, jen_tyto, entity }
    vybrane: null,
    karta: null,
    uprava: null, // { cil } rozepsaný vztah v kartě
    pridavani: false,
    dotaz: '',
    zoom: { k: 1, x: 0, y: 0 },
    nacita: null,
    viditelna: false,
    prvniPriblizeni: true,
  };
  const platno = $('#kanon-platno');
  const plocha = $('#kanon-svg');
  const vrstva = svg('g', { class: 'vrstva' });
  const gHrany = svg('g', { class: 'hrany' });
  const gUzly = svg('g', { class: 'uzly' });
  const gDocasna = svg('g');
  const defs = svg('defs');
  vrstva.append(gHrany, gUzly, gDocasna);
  plocha.append(defs, vrstva);
  const kartaEl = $('#kanon-karta');

  const ulozit = () => ulozitVolby({ pohled: s.pohled, typy: [...s.typy], jenVeHre: s.jenVeHre });

  /* ---------- Data ---------- */

  async function nacist() {
    if (s.nacita) return s.nacita;
    s.nacita = (async () => {
      try {
        const data = await api(`/api/kanon?pohled=${s.pohled}`);
        prijmout(data);
      } catch (e) {
        toast(`Kánon se nenačetl: ${e.message}`, { chyba: true });
      } finally {
        s.nacita = null;
      }
    })();
    return s.nacita;
  }

  function prijmout(data) {
    s.data = data;
    s.podleId = new Map(data.entity.map((e) => [e.id, e]));
    s.stupen = new Map(data.entity.map((e) => [e.id, 0]));
    for (const [a, b] of vsechnyDvojice()) {
      s.stupen.set(a, s.stupen.get(a) + 1);
      s.stupen.set(b, s.stupen.get(b) + 1);
    }
    for (const e of data.entity) e.stupen = s.stupen.get(e.id);
    if (s.nastenka && !data.nastenky.some((n) => n.id === s.nastenka.id)) zrusitNastenku(false);
    if (s.vybrane && !s.podleId.has(s.vybrane)) {
      s.vybrane = null;
      s.karta = null;
    }
    vykresliFiltry();
    vykresliNastenky();
    prepocitat();
    if (s.vybrane) nacistKartu(s.vybrane);
    else vykresliKartu();
  }

  /** Neuspořádané dvojice entit, mezi kterými vede vazba nebo vztah (jen existující cíle). */
  function vsechnyDvojice() {
    const videno = new Set();
    const vysledek = [];
    for (const e of s.data?.entity ?? []) {
      for (const cil of new Set([...e.vazby, ...e.vztahy.map((v) => v.s)])) {
        if (!s.podleId.has(cil) || cil === e.id) continue;
        const klic = e.id < cil ? `${e.id} ${cil}` : `${cil} ${e.id}`;
        if (videno.has(klic)) continue;
        videno.add(klic);
        vysledek.push([e.id, cil]);
      }
    }
    return vysledek;
  }

  const viditelny = (e) => Boolean(e) && s.typy.has(e.typ) && (!s.jenVeHre || e.aktualni || e.id === s.vybrane) && (!s.nastenka?.jen_tyto || s.nastenka.entity.some((x) => x.id === e.id) || e.id === s.vybrane);

  /** Rozložení viditelných uzlů. Co už pozici mělo, zůstane zhruba na místě. */
  function prepocitat() {
    if (!s.data) return;
    const uzly = s.data.entity.filter(viditelny).map((e) => ({ id: e.id, typ: e.typ, obrazek: e.obrazek, r: polomer(e, e.stupen) }));
    const ids = new Set(uzly.map((u) => u.id));
    const hrany = vsechnyDvojice().filter(([a, b]) => ids.has(a) && ids.has(b));
    const pevne = new Map([...s.pevne].filter(([id]) => ids.has(id)));
    const start = new Map([...s.pozice].filter(([id]) => ids.has(id)));
    s.pozice = rozlozit(uzly, hrany, { pevne, start });
    vykreslit();
    if (s.prvniPriblizeni && s.viditelna) {
      s.prvniPriblizeni = false;
      priblizitNa(null, false);
    }
  }

  /* ---------- Kreslení sítě ---------- */

  function hranyKVykresleni() {
    const vysledek = [];
    const smery = new Set();
    for (const e of s.data.entity) for (const v of e.vztahy) smery.add(`${e.id}>${v.s}`);
    for (const e of s.data.entity) {
      if (!s.pozice.has(e.id)) continue;
      for (const v of e.vztahy) {
        if (!s.pozice.has(v.s)) continue;
        vysledek.push({ a: e.id, b: v.s, vztah: v, obousmerny: smery.has(`${v.s}>${e.id}`) });
      }
    }
    for (const [a, b] of vsechnyDvojice()) {
      if (!s.pozice.has(a) || !s.pozice.has(b)) continue;
      if (smery.has(`${a}>${b}`) || smery.has(`${b}>${a}`)) continue;
      vysledek.push({ a, b, vztah: null, obousmerny: false });
    }
    return vysledek;
  }

  function cestaHrany(h) {
    const p = s.pozice.get(h.a);
    const q = s.pozice.get(h.b);
    if (!h.vztah || !h.obousmerny) return `M${p.x},${p.y} L${q.x},${q.y}`;
    // Dva vztahy proti sobě: každý ohnutý na svou stranu, ať jsou vidět oba.
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    const o = 12;
    const cx = (p.x + q.x) / 2 + (-dy / d) * o;
    const cy = (p.y + q.y) / 2 + (dx / d) * o;
    return `M${p.x},${p.y} Q${cx},${cy} ${q.x},${q.y}`;
  }

  function popisHrany(h) {
    const a = s.podleId.get(h.a)?.nazev ?? h.a;
    const b = s.podleId.get(h.b)?.nazev ?? h.b;
    if (!h.vztah) return `${a} — ${b} (vazba bez popisu)`;
    const v = h.vztah;
    return `${a} → ${b}: ${v.popis}${Number.isInteger(v.postoj) ? ` · postoj ${postojText(v.postoj)}` : ''}${s.pohled === 'dm' ? (v.verejne ? ' · družina zná' : ' · družina nezná') : ''}`;
  }

  function vykreslit() {
    if (!s.data) return;
    const hrany = hranyKVykresleni();
    gHrany.replaceChildren(
      ...hrany.map((h) => {
        const g = svg('g', { class: `hrana${h.vztah ? ' vztah' : ''}${h.vztah && !Number.isInteger(h.vztah.postoj) ? ' bez-postoje' : ''}`, 'data-a': h.a, 'data-b': h.b });
        const d = cestaHrany(h);
        const cara = svg('path', { d, class: 'cara' });
        const barva = h.vztah ? barvaPostoje(h.vztah.postoj) : null;
        if (barva) cara.style.stroke = barva;
        // Široký neviditelný tah, ať jde na čáru najet myší a ukázat popis.
        const zachyt = svg('path', { d, class: 'zachyt' });
        const titul = svg('title');
        titul.textContent = popisHrany(h);
        g.append(cara, zachyt, titul);
        return g;
      }),
    );
    defs.replaceChildren();
    const uzly = [];
    for (const e of s.data.entity) {
      const p = s.pozice.get(e.id);
      if (!p) continue;
      const r = polomer(e, e.stupen);
      const velky = e.typ === 'postava' || e.typ === 'padouch' || e.stupen >= 7;
      const g = svg('g', {
        class: `uzel${velky ? ' velky' : ''}${e.aktualni ? ' ve-hre' : ''}${s.pohled === 'dm' && !e.verejne ? ' neverejny' : ''}`,
        transform: `translate(${p.x},${p.y})`,
        tabindex: 0,
        role: 'button',
        'data-id': e.id,
        'aria-label': `${e.nazev} (${TYPY[e.typ]?.j ?? e.typ})`,
      });
      g.style.setProperty('--c', barvaTypu(e.typ));
      if (e.aktualni) g.append(svg('circle', { r: r + 5, class: 'kruh-ve-hre' }));
      g.append(svg('circle', { r, class: 'telo' }));
      if (e.obrazek) {
        const id = `kl-${e.id}`;
        const clip = svg('clipPath', { id });
        clip.append(svg('circle', { r }));
        defs.append(clip);
        const obraz = svg('image', { href: e.obrazek, x: -r, y: -r, width: 2 * r, height: 2 * r, preserveAspectRatio: 'xMidYMid slice', 'clip-path': `url(#${id})` });
        // Portrét postavy je celá figura: do kroužku se přiblíží hlava a ramena.
        if (e.portret) {
          vyrezHlavy(e.obrazek).then((v) => {
            if (!v) return;
            const sirka = (2 * r) / v.s;
            const vyska = sirka * v.pomer;
            obraz.setAttribute('width', sirka);
            obraz.setAttribute('height', vyska);
            obraz.setAttribute('x', -r - v.x * sirka);
            obraz.setAttribute('y', -r - v.y * vyska);
            obraz.setAttribute('preserveAspectRatio', 'none');
          });
        }
        g.append(obraz);
        g.append(svg('circle', { r, class: 'ram' }));
      } else if (e.ikona) {
        const t = svg('text', { class: 'ikona-uzlu', 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': Math.max(9, r * 1.05) });
        t.textContent = e.ikona;
        g.append(t);
      }
      const popisek = svg('text', { class: 'popisek', dy: r + 13, 'text-anchor': 'middle' });
      popisek.textContent = e.nazev.length > 30 ? `${e.nazev.slice(0, 28)}…` : e.nazev;
      g.append(popisek);
      const titul = svg('title');
      titul.textContent = `${e.nazev} · ${TYPY[e.typ]?.j ?? e.typ}${e.aktualni ? ' · ve hře' : ''}`;
      g.append(titul);
      uzly.push(g);
    }
    gUzly.replaceChildren(...uzly);
    // Málo uzlů (pohled družiny, nástěnka): popisky u všech.
    plocha.classList.toggle('malo-uzlu', uzly.length <= 40);
    zvyraznit();
    vykreslitZoom();
  }

  /** Vybraná entita ztlumí vše kromě okolí; hledání v liště zvýrazní nalezené uzly. */
  function zvyraznit() {
    const okoli = new Set();
    if (s.vybrane) {
      okoli.add(s.vybrane);
      for (const [a, b] of vsechnyDvojice()) {
        if (a === s.vybrane) okoli.add(b);
        if (b === s.vybrane) okoli.add(a);
      }
    }
    const nalezy = new Set(s.dotaz ? hledat(s.data?.entity ?? [], s.dotaz, 50).map((e) => e.id) : []);
    const tlumit = Boolean(s.vybrane) || nalezy.size > 0 || Boolean(s.dotaz);
    vrstva.classList.toggle('ztlumeno', tlumit);
    for (const g of gUzly.children) {
      const id = g.dataset.id;
      g.classList.toggle('vybrany', id === s.vybrane);
      g.classList.toggle('okoli', okoli.has(id));
      g.classList.toggle('nalez', nalezy.has(id));
    }
    for (const g of gHrany.children) {
      const sv = s.vybrane && (g.dataset.a === s.vybrane || g.dataset.b === s.vybrane);
      g.classList.toggle('okoli', Boolean(sv));
    }
  }

  /* ---------- Přiblížení a posun ---------- */

  function vykreslitZoom() {
    vrstva.setAttribute('transform', `translate(${s.zoom.x},${s.zoom.y}) scale(${s.zoom.k})`);
    // Popisky rostou s přiblížením jen zvolna, ať se při detailu nepřekrývají.
    vrstva.style.setProperty('--pismo-uzlu', `${(12 / Math.max(0.8, Math.min(s.zoom.k, 3)) ** 0.65).toFixed(2)}px`);
    plocha.classList.toggle('zoom-blizko', s.zoom.k > 1.35);
  }

  function rozmer() {
    const r = plocha.getBoundingClientRect();
    return [r.width || 800, r.height || 600];
  }

  /** Přiblíží mapu na uzly (null = všechny viditelné). */
  function priblizitNa(ids, animace = true) {
    const body = [...(ids ?? s.pozice.keys())].map((id) => s.pozice.get(id)).filter(Boolean);
    if (!body.length) return;
    const [w, h] = rozmer();
    const x0 = Math.min(...body.map((p) => p.x)) - 70;
    const x1 = Math.max(...body.map((p) => p.x)) + 70;
    const y0 = Math.min(...body.map((p) => p.y)) - 50;
    const y1 = Math.max(...body.map((p) => p.y)) + 70;
    const k = Math.min(2.2, 0.95 / Math.max((x1 - x0) / w, (y1 - y0) / h));
    const cil = { k, x: w / 2 - ((x0 + x1) / 2) * k, y: h / 2 - ((y0 + y1) / 2) * k };
    animovatZoom(cil, animace);
  }

  let animace = null;
  function animovatZoom(cil, plynule = true) {
    cancelAnimationFrame(animace);
    if (!plynule || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      s.zoom = cil;
      vykreslitZoom();
      return;
    }
    const z = { ...s.zoom };
    const zacatek = performance.now();
    const krok = (t) => {
      const u = Math.min(1, (t - zacatek) / 350);
      const e = 1 - (1 - u) ** 3;
      s.zoom = { k: z.k + (cil.k - z.k) * e, x: z.x + (cil.x - z.x) * e, y: z.y + (cil.y - z.y) * e };
      vykreslitZoom();
      if (u < 1) animace = requestAnimationFrame(krok);
    };
    animace = requestAnimationFrame(krok);
  }

  function zoomKolem(faktor, cx, cy) {
    const k = Math.max(0.2, Math.min(4, s.zoom.k * faktor));
    const f = k / s.zoom.k;
    s.zoom = { k, x: cx - (cx - s.zoom.x) * f, y: cy - (cy - s.zoom.y) * f };
    vykreslitZoom();
  }

  const doMapy = (klientX, klientY) => {
    const r = plocha.getBoundingClientRect();
    return { x: (klientX - r.left - s.zoom.x) / s.zoom.k, y: (klientY - r.top - s.zoom.y) / s.zoom.k };
  };

  plocha.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = plocha.getBoundingClientRect();
      zoomKolem(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    },
    { passive: false },
  );
  $('#kanon-plus').addEventListener('click', () => {
    const [w, h] = rozmer();
    zoomKolem(1.35, w / 2, h / 2);
  });
  $('#kanon-minus').addEventListener('click', () => {
    const [w, h] = rozmer();
    zoomKolem(1 / 1.35, w / 2, h / 2);
  });
  $('#kanon-cele').addEventListener('click', () => priblizitNa(null));

  // Tažení: pozadí posouvá mapu, uzel posouvá uzel, Alt + uzel natahuje novou vazbu (bod 102).
  let tah = null;
  plocha.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const uzel = e.target.closest('.uzel');
    plocha.setPointerCapture(e.pointerId);
    if (uzel && e.altKey && s.pohled === 'dm') {
      e.preventDefault();
      tah = { druh: 'vazba', id: uzel.dataset.id, x0: e.clientX, y0: e.clientY };
      const p = s.pozice.get(tah.id);
      tah.cara = svg('line', { class: 'nova-vazba', x1: p.x, y1: p.y, x2: p.x, y2: p.y });
      gDocasna.replaceChildren(tah.cara);
    } else if (uzel) {
      tah = { druh: 'uzel', id: uzel.dataset.id, x0: e.clientX, y0: e.clientY, posunuto: false, g: uzel };
    } else {
      tah = { druh: 'plocha', x0: e.clientX, y0: e.clientY, z: { ...s.zoom }, posunuto: false };
    }
  });
  plocha.addEventListener('pointermove', (e) => {
    if (!tah) return;
    const dx = e.clientX - tah.x0;
    const dy = e.clientY - tah.y0;
    if (Math.hypot(dx, dy) > 3) tah.posunuto = true;
    if (tah.druh === 'plocha' && tah.posunuto) {
      s.zoom = { ...tah.z, x: tah.z.x + dx, y: tah.z.y + dy };
      vykreslitZoom();
    } else if (tah.druh === 'uzel' && tah.posunuto) {
      const p = doMapy(e.clientX, e.clientY);
      s.pozice.set(tah.id, p);
      s.pevne.set(tah.id, p);
      vykreslit();
    } else if (tah.druh === 'vazba') {
      const p = doMapy(e.clientX, e.clientY);
      tah.cara.setAttribute('x2', p.x);
      tah.cara.setAttribute('y2', p.y);
      const pod = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.uzel');
      for (const g of gUzly.children) g.classList.toggle('cil-vazby', g === pod && g.dataset.id !== tah.id);
    }
  });
  const konecTahu = (e) => {
    if (!tah) return;
    const t = tah;
    tah = null;
    if (t.druh === 'vazba') {
      gDocasna.replaceChildren();
      for (const g of gUzly.children) g.classList.remove('cil-vazby');
      const pod = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.uzel');
      if (pod && pod.dataset.id !== t.id) zalozitVazbu(t.id, pod.dataset.id);
      return;
    }
    if (!t.posunuto) {
      if (t.druh === 'uzel') vybrat(t.id === s.vybrane ? null : t.id);
      else vybrat(null);
    }
  };
  plocha.addEventListener('pointerup', konecTahu);
  plocha.addEventListener('pointercancel', () => {
    tah = null;
    gDocasna.replaceChildren();
  });
  plocha.addEventListener('keydown', (e) => {
    const uzel = e.target.closest?.('.uzel');
    if (uzel && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      vybrat(uzel.dataset.id);
    }
  });

  async function zalozitVazbu(od, k) {
    const a = s.podleId.get(od);
    const b = s.podleId.get(k);
    const uzMa = a?.vazby.includes(k);
    try {
      const r = await api(`/api/kanon/entita/${encodeURIComponent(od)}/vazby`, { metoda: 'POST', telo: { cil: k } });
      hlasitZapis(r, uzMa ? `${a?.nazev ?? od} už má vazbu na ${b?.nazev ?? k}: uprav popis vztahu.` : `Vazba ${a?.nazev ?? od} → ${b?.nazev ?? k} založena. Doplň popis vztahu, nebo ji nech bez něj.`);
      s.uprava = { cil: k, nova: true };
      s.vybrane = od;
      s.karta = r.karta;
      vykresliKartu();
      zvyraznit();
    } catch (chyba) {
      toast(chyba.message, { chyba: true });
    }
  }

  /* ---------- Filtry, pohled, nástěnky ---------- */

  function vykresliFiltry() {
    const kam = $('#kanon-filtry');
    const pocty = {};
    for (const e of s.data?.entity ?? []) pocty[e.typ] = (pocty[e.typ] ?? 0) + 1;
    const tlacitka = Object.entries(TYPY)
      .filter(([t]) => pocty[t])
      .map(([t, d]) => {
        const b = el('button', { type: 'button', className: 'cip', 'aria-pressed': String(s.typy.has(t)) }, el('span', { className: 'tecka' }), d.mn, el('span', { className: 'pocet-cipu', textContent: pocty[t] }));
        b.style.setProperty('--c', barvaTypu(t));
        b.addEventListener('click', () => {
          if (s.typy.has(t)) s.typy.delete(t);
          else s.typy.add(t);
          ulozit();
          vykresliFiltry();
          prepocitat();
        });
        return b;
      });
    const veHre = (s.data?.entity ?? []).filter((e) => e.aktualni).length;
    if (s.pohled === 'dm') {
      const b = el('button', { type: 'button', className: 'cip cip-ve-hre', 'aria-pressed': String(s.jenVeHre), title: 'Jen entity se štítkem aktualni (Ve hře)' }, el('span', { className: 'tecka' }), 'Jen ve hře', el('span', { className: 'pocet-cipu', textContent: veHre }));
      b.addEventListener('click', () => {
        s.jenVeHre = !s.jenVeHre;
        ulozit();
        vykresliFiltry();
        prepocitat();
        priblizitNa(null);
      });
      tlacitka.push(b);
    }
    kam.replaceChildren(...tlacitka);
    for (const b of document.querySelectorAll('#kanon-pohled button')) b.setAttribute('aria-pressed', String(b.dataset.pohled === s.pohled));
    $('#obrazovka-kanon').classList.toggle('pohled-druziny', s.pohled === 'druzina');
  }

  for (const b of document.querySelectorAll('#kanon-pohled button')) {
    b.addEventListener('click', () => prepnoutPohled(b.dataset.pohled));
  }
  function prepnoutPohled(pohled) {
    if (pohled === s.pohled) return;
    s.pohled = pohled === 'druzina' ? 'druzina' : 'dm';
    s.uprava = null;
    s.pridavani = false;
    if (s.nastenka && s.nastenka.pohled !== s.pohled) zrusitNastenku(false);
    ulozit();
    s.prvniPriblizeni = true;
    nacist();
  }

  function vykresliNastenky() {
    const vyber = $('#kanon-nastenka');
    const nastenky = s.data?.nastenky ?? [];
    vyber.replaceChildren(new Option('Celá mapa (automaticky)', ''), ...nastenky.map((n) => new Option(`${n.nazev}${n.pohled === 'druzina' ? ' · družina' : ''}`, n.id)));
    vyber.value = s.nastenka?.id ?? '';
  }

  $('#kanon-nastenka').addEventListener('change', async (e) => {
    const id = e.target.value;
    if (!id) return zrusitNastenku(true);
    try {
      const n = await api(`/api/kanon/nastenky/${encodeURIComponent(id)}`);
      s.nastenka = n;
      s.pevne = new Map(n.entity.map((x) => [x.id, { x: x.x, y: x.y }]));
      s.pozice = new Map(s.pevne);
      if (n.pohled !== s.pohled) {
        s.pohled = n.pohled;
        ulozit();
        await nacist();
      } else prepocitat();
      priblizitNa(null);
    } catch (chyba) {
      toast(chyba.message, { chyba: true });
      vykresliNastenky();
    }
  });

  function zrusitNastenku(prekreslit) {
    s.nastenka = null;
    s.pevne = new Map();
    if (prekreslit) {
      s.pozice = new Map();
      prepocitat();
      priblizitNa(null);
    }
    vykresliNastenky();
  }

  $('#kanon-ulozit').addEventListener('click', () => {
    const d = $('#dialog-nastenka');
    $('#nastenka-nazev').value = s.nastenka?.nazev ?? '';
    $('#nastenka-jen').checked = s.nastenka ? s.nastenka.jen_tyto : false;
    $('#nastenka-prepsat').hidden = !s.nastenka;
    $('#nastenka-prepsat').textContent = s.nastenka ? `Uložit do „${s.nastenka.nazev}“` : '';
    $('#nastenka-smazat').hidden = !s.nastenka;
    $('#nastenka-nova').className = s.nastenka ? '' : 'hlavni';
    $('#nastenka-chyba').textContent = '';
    $('#nastenka-popis').textContent = `Uloží pozice ${s.pozice.size} entit na mapě v pohledu ${s.pohled === 'druzina' ? 'družiny' : 'DM'}. Nové entity, které nástěnka nezná, mapa rozmístí sama.`;
    d.showModal();
    $('#nastenka-nazev').focus();
  });

  $('#formular-nastenka').addEventListener('submit', async (e) => {
    const akce = e.submitter?.value;
    if (akce === 'zrusit') return;
    e.preventDefault();
    const chybaEl = $('#nastenka-chyba');
    try {
      if (akce === 'smazat') {
        await api(`/api/kanon/nastenky/${encodeURIComponent(s.nastenka.id)}`, { metoda: 'DELETE' });
        toast(`Nástěnka ${s.nastenka.nazev} smazána.`);
        $('#dialog-nastenka').close();
        zrusitNastenku(false);
        return;
      }
      const telo = {
        nazev: $('#nastenka-nazev').value,
        pohled: s.pohled,
        jen_tyto: $('#nastenka-jen').checked,
        entity: [...s.pozice].map(([id, p]) => ({ id, x: Math.round(p.x), y: Math.round(p.y) })),
      };
      const r = akce === 'prepsat' && s.nastenka
        ? await api(`/api/kanon/nastenky/${encodeURIComponent(s.nastenka.id)}`, { metoda: 'PUT', telo })
        : await api('/api/kanon/nastenky', { metoda: 'POST', telo });
      s.nastenka = r.nastenka;
      s.pevne = new Map(r.nastenka.entity.map((x) => [x.id, { x: x.x, y: x.y }]));
      $('#dialog-nastenka').close();
      toast(`Rozložení uloženo do nástěnky ${r.nastenka.nazev}.`);
      vykresliNastenky();
    } catch (chyba) {
      chybaEl.textContent = chyba.message;
    }
  });

  /* ---------- Výběr a karta ---------- */

  function vybrat(id, { priblizit = true } = {}) {
    if (id && !s.podleId.has(id)) {
      toast(s.pohled === 'druzina' ? 'Tuhle entitu družina nezná.' : 'Entita v kánonu není.', { chyba: true });
      return;
    }
    s.vybrane = id;
    s.uprava = null;
    s.pridavani = false;
    if (id) {
      const e = s.podleId.get(id);
      let zmena = false;
      if (!s.typy.has(e.typ)) {
        s.typy.add(e.typ);
        ulozit();
        zmena = true;
      }
      if (zmena || !s.pozice.has(id)) {
        vykresliFiltry();
        prepocitat();
      }
      zvyraznit();
      s.karta = null;
      vykresliKartu();
      nacistKartu(id);
      if (priblizit) {
        const okoli = [id, ...vsechnyDvojice().filter(([a, b]) => a === id || b === id).map(([a, b]) => (a === id ? b : a))];
        priblizitNa(okoli);
      }
    } else {
      s.karta = null;
      zvyraznit();
      vykresliKartu();
    }
    const hash = id ? `#kanon/${encodeURIComponent(id)}` : '#kanon';
    if (location.hash !== hash) history.replaceState(null, '', hash);
  }

  async function nacistKartu(id) {
    try {
      const k = await api(`/api/kanon/entita/${encodeURIComponent(id)}?pohled=${s.pohled}`);
      if (s.vybrane !== id) return;
      s.karta = k;
      vykresliKartu();
    } catch (chyba) {
      if (s.vybrane === id) toast(chyba.message, { chyba: true });
    }
  }

  function hlasitZapis(r, text) {
    if (r?.vysledek === 'odlozeno') toast('Soubor karty je otevřený jinde (Obsidian?). Změna se zapíše, až se uvolní.');
    else if (text) toast(text);
  }

  async function upravit(cesta, metoda, telo, text) {
    try {
      const r = await api(cesta, { metoda, telo });
      hlasitZapis(r, text);
      if (r.karta && r.karta.id === s.vybrane) s.karta = r.karta;
      vykresliKartu();
      return r;
    } catch (chyba) {
      toast(chyba.message, { chyba: true });
      return null;
    }
  }

  const odkazNaEntitu = (id, text) => {
    const e = s.podleId.get(id);
    const b = el('button', { type: 'button', className: 'odkaz-entity', textContent: text ?? e?.nazev ?? id });
    if (e) b.style.setProperty('--c', barvaTypu(e.typ));
    b.addEventListener('click', () => vybrat(id));
    return b;
  };

  function prehledKarty() {
    const entity = s.data?.entity ?? [];
    const pocty = Object.entries(TYPY)
      .map(([t, d]) => [t, d, entity.filter((e) => e.typ === t).length])
      .filter(([, , n]) => n)
      .map(([t, d, n]) => {
        const r = el('div', {}, el('span', { textContent: d.mn }), el('span', { textContent: n }));
        r.style.setProperty('--c', barvaTypu(t));
        return r;
      });
    const postavy = entity.filter((e) => e.typ === 'postava').map((e) => {
      const b = el('button', { type: 'button', className: 'postava-prehled' }, e.obrazek ? el('span', { className: 'avatar vyrez-portretu' }, e.portret ? oriznoutPortret(el('img', { src: e.obrazek, alt: '' }), e.obrazek) : el('img', { src: e.obrazek, alt: '' })) : el('span', { className: 'ikona-mini', textContent: e.ikona || '·' }), el('span', {}, e.nazev, el('small', { textContent: [e.udaje?.hrac, `${e.stupen} vazeb`].filter(Boolean).join(' · ') })));
      b.addEventListener('click', () => vybrat(e.id));
      return b;
    });
    const druzina = s.pohled === 'druzina';
    nahradit(kartaEl, 
      el('h2', { className: 'karta-nazev', textContent: druzina ? 'Co ví družina' : 'Kánon kampaně' }),
      el('p', { className: 'uvod', textContent: druzina
        ? `${entity.length} entit, které družina zná (verejne: true), a jen vztahy, které zná. Karty ukazují jen oddíl Co ví družina. Slouží k rekapitulaci; repo je dál veřejné.`
        : `${entity.length} entit a ${vsechnyDvojice().length} vazeb ze složky kampan/. Barva uzlu je typ, barva čáry postoj vztahu. Text karet se píše v Obsidianu.` }),
      postavy.length ? el('h3', { textContent: 'Postavy hráčů' }) : null,
      postavy.length ? el('div', { className: 'postavy-prehled' }, postavy) : null,
      el('h3', { textContent: 'Počty' }),
      el('div', { className: 'pocty-kanonu' }, pocty),
      el('h3', { textContent: 'Ovládání' }),
      el('ul', { className: 'napoveda-kanonu' },
        el('li', { textContent: 'Klik na uzel vybere entitu, Esc výběr zruší.' }),
        el('li', { textContent: 'Tažením posuneš uzel nebo celou mapu, kolečkem přiblížíš.' }),
        druzina ? null : el('li', {}, el('kbd', { textContent: 'Alt' }), ' + tažení z uzlu na uzel založí vazbu a otevře popis vztahu.'),
        el('li', {}, 'Hledání je v horní liště (', el('kbd', { textContent: 'Ctrl+K' }), ').'),
      ),
      s.data?.chyby?.length ? el('h3', { textContent: 'Karty, které se nenačetly' }) : null,
      s.data?.chyby?.length ? el('ul', { className: 'chyby-kanonu' }, s.data.chyby.map((c) => el('li', {}, el('code', { textContent: c.soubor }), ` ${c.chyba}`))) : null,
    );
  }

  function prepinac(text, zapnuto, popis, zmena) {
    const vstup = el('input', { type: 'checkbox', role: 'switch', checked: zapnuto });
    vstup.addEventListener('change', () => zmena(vstup.checked));
    return el('label', { className: 'prepinac-zap', title: popis }, vstup, el('span', { textContent: text }));
  }

  function formularVztahu(e, cil, vztah, nova) {
    const c = s.podleId.get(cil);
    const popis = el('input', { type: 'text', value: vztah?.popis ?? '', placeholder: 'např. adoptivní otec, dluží mu', maxLength: 200, 'aria-label': 'Popis vztahu' });
    const postoj = el('select', { 'aria-label': 'Postoj' }, new Option('bez postoje', ''), ...[3, 2, 1, 0, -1, -2, -3].map((p) => new Option(postojText(p), String(p))));
    postoj.value = Number.isInteger(vztah?.postoj) ? String(vztah.postoj) : '';
    const druzina = el('input', { type: 'checkbox', checked: vztah?.verejne === true });
    const ulozitBtn = el('button', { type: 'submit', className: 'hlavni', textContent: 'Uložit vztah' });
    const zrusitBtn = el('button', { type: 'button', textContent: nova ? 'Nechat bez popisu' : 'Zrušit' });
    const odebratBtn = vztah ? el('button', { type: 'button', className: 'tiche', textContent: 'Odebrat popis', title: 'Vztah zmizí, vazba (čára) zůstane' }) : null;
    const f = el('form', { className: 'formular-vztahu' },
      el('p', { className: 'formular-vztahu-nadpis' }, `${e.nazev} → `, el('strong', { textContent: c?.nazev ?? cil })),
      el('label', {}, 'Kým je pro ni/něj', popis),
      el('div', { className: 'radek-vztahu' }, el('label', {}, 'Postoj', postoj), el('label', { className: 'zaskrtavaci' }, druzina, ' Družina zná')),
      el('div', { className: 'tlacitka' }, ulozitBtn, zrusitBtn, odebratBtn),
    );
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!popis.value.trim()) {
        popis.focus();
        return toast('Napiš popis vztahu, nebo zvol Nechat bez popisu.', { chyba: true });
      }
      const r = await upravit(`/api/kanon/entita/${encodeURIComponent(e.id)}/vztahy/${encodeURIComponent(cil)}`, 'PUT', { popis: popis.value, postoj: postoj.value === '' ? null : Number(postoj.value), verejne: druzina.checked }, 'Vztah uložen.');
      if (r) {
        s.uprava = null;
        vykresliKartu();
      }
    });
    zrusitBtn.addEventListener('click', () => {
      s.uprava = null;
      vykresliKartu();
    });
    odebratBtn?.addEventListener('click', async () => {
      if (await upravit(`/api/kanon/entita/${encodeURIComponent(e.id)}/vztahy/${encodeURIComponent(cil)}`, 'DELETE', undefined, 'Popis vztahu odebrán, vazba zůstala.')) {
        s.uprava = null;
        vykresliKartu();
      }
    });
    queueMicrotask(() => {
      f.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      popis.focus({ preventScroll: true });
    });
    return f;
  }

  function seznamVztahu(k) {
    const dm = s.pohled === 'dm';
    const cile = [...new Set([...k.vztahy.map((v) => v.s), ...k.vazby])];
    const radky = cile.map((cil) => {
      const v = k.vztahy.find((x) => x.s === cil) ?? null;
      if (s.uprava?.cil === cil && dm) return el('li', { className: 'vztah-radek upravuje' }, formularVztahu(k, cil, v, s.uprava.nova));
      const existuje = s.podleId.has(cil);
      const tecka = el('span', { className: 'tecka-postoje', title: v && Number.isInteger(v.postoj) ? `Postoj ${postojText(v.postoj)}` : v ? 'Bez postoje' : 'Vazba bez popisu' });
      const barva = v ? barvaPostoje(v.postoj) : null;
      if (barva) tecka.style.background = barva;
      if (!v) tecka.classList.add('jen-vazba');
      const akce = dm
        ? el('span', { className: 'akce-vztahu' },
          el('button', { type: 'button', className: 'mala', textContent: v ? 'Upravit' : '+ popis', title: v ? 'Upravit popis, postoj a jestli ho zná družina' : 'Doplnit popis vztahu', onclick: () => { s.uprava = { cil }; vykresliKartu(); } }),
          el('button', { type: 'button', className: 'mala tiche', textContent: '×', title: 'Odebrat vazbu i vztah', 'aria-label': `Odebrat vazbu na ${s.podleId.get(cil)?.nazev ?? cil}`, onclick: () => odebratVazbu(k, cil) }))
        : null;
      return el('li', { className: 'vztah-radek' },
        tecka,
        el('span', { className: 'vztah-text' },
          existuje ? odkazNaEntitu(cil) : el('span', { className: 'odkaz-chybi', textContent: `[[${cil}]]`, title: 'Cíl neexistuje (Kontrola dat)' }),
          v ? el('span', { className: 'vztah-popis', textContent: ` — ${v.popis}` }) : null,
          v && dm && v.verejne ? el('span', { className: 'stitek-maly', textContent: 'družina zná' }) : null),
        akce);
    });
    if (s.uprava && !cile.includes(s.uprava.cil) && dm) radky.push(el('li', { className: 'vztah-radek upravuje' }, formularVztahu(k, s.uprava.cil, null, true)));
    return radky;
  }

  async function odebratVazbu(k, cil) {
    const nazev = s.podleId.get(cil)?.nazev ?? cil;
    const maVztah = k.vztahy.some((v) => v.s === cil);
    if (!confirm(`Odebrat vazbu ${k.nazev} → ${nazev}${maVztah ? ' i s popisem vztahu' : ''}?`)) return;
    await upravit(`/api/kanon/entita/${encodeURIComponent(k.id)}/vazby/${encodeURIComponent(cil)}`, 'DELETE', undefined, 'Vazba odebrána.');
  }

  function pridatVazbuUI(k) {
    if (!s.pridavani) {
      return el('button', { type: 'button', className: 'mala', textContent: '+ Přidat vazbu', onclick: () => { s.pridavani = true; vykresliKartu(); } });
    }
    const vstup = el('input', { type: 'search', placeholder: 'Hledat entitu…', autocomplete: 'off', 'aria-label': 'Entita pro novou vazbu' });
    const vysledky = el('ul', { className: 'vysledky-vazby' });
    const ukaz = () => {
      const nalez = hledat(s.data.entity.filter((e) => e.id !== k.id && !k.vazby.includes(e.id)), vstup.value, 8);
      vysledky.replaceChildren(...nalez.map((e) => {
        const b = el('button', { type: 'button', className: 'polozka-hledani' }, el('span', { className: 'tecka' }), e.nazev, el('small', { textContent: ` ${TYPY[e.typ]?.j ?? e.typ}` }));
        b.style.setProperty('--c', barvaTypu(e.typ));
        b.addEventListener('click', async () => {
          s.pridavani = false;
          const r = await upravit(`/api/kanon/entita/${encodeURIComponent(k.id)}/vazby`, 'POST', { cil: e.id }, `Vazba na ${e.nazev} založena.`);
          if (r) {
            s.uprava = { cil: e.id, nova: true };
            vykresliKartu();
          }
        });
        return el('li', {}, b);
      }));
    };
    vstup.addEventListener('input', ukaz);
    vstup.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        s.pridavani = false;
        vykresliKartu();
      }
      if (ev.key === 'Enter') {
        ev.preventDefault();
        vysledky.querySelector('button')?.click();
      }
    });
    queueMicrotask(() => vstup.focus());
    return el('div', { className: 'pridat-vazbu' }, vstup, vysledky, el('button', { type: 'button', className: 'mala tiche', textContent: 'Zrušit', onclick: () => { s.pridavani = false; vykresliKartu(); } }));
  }

  function prezdivky(k) {
    const dm = s.pohled === 'dm';
    const cipy = k.aliases.map((a) => el('span', { className: 'prezdivka' }, a, dm ? el('button', { type: 'button', className: 'odebrat-prezdivku', textContent: '×', 'aria-label': `Odebrat přezdívku ${a}`, onclick: () => upravit(`/api/kanon/entita/${encodeURIComponent(k.id)}`, 'PUT', { aliases: k.aliases.filter((x) => x !== a) }, 'Přezdívka odebrána.') }) : null));
    if (!dm) return cipy.length ? el('div', { className: 'prezdivky' }, cipy) : null;
    const vstup = el('input', { type: 'text', placeholder: '+ přezdívka', maxLength: 80, 'aria-label': 'Nová přezdívka', className: 'nova-prezdivka' });
    vstup.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' || !vstup.value.trim()) return;
      ev.preventDefault();
      upravit(`/api/kanon/entita/${encodeURIComponent(k.id)}`, 'PUT', { aliases: [...k.aliases, vstup.value.trim()] }, 'Přezdívka přidána.');
    });
    return el('div', { className: 'prezdivky' }, cipy, vstup);
  }

  function obrazkyKarty(k) {
    const obr = k.obrazky.filter((o) => s.pohled === 'dm' || !o.skryta);
    if (!obr.length) return null;
    const portrety = obr.filter((o) => o.ucel === 'portret');
    const sceny = obr.filter((o) => o.ucel !== 'portret');
    return el('div', {},
      portrety.length ? el('div', { className: 'portrety-karty' }, portrety.map((o) => el('a', { href: o.url, target: '_blank', rel: 'noopener', title: o.varianta ? `Podoba: ${o.varianta}` : 'Portrét' }, el('img', { src: o.url, alt: `${k.nazev}${o.varianta ? `: ${o.varianta}` : ''}`, loading: 'lazy' })))) : null,
      sceny.length ? el('div', { className: 'sceny-karty' }, sceny.slice(0, 6).map((o) => el('a', { href: o.url, target: '_blank', rel: 'noopener', className: o.skryta ? 'skryta' : '', title: [o.soubor, o.varianta, o.stav, o.skryta ? 'skrytá (jen DM)' : null].filter(Boolean).join(' · ') }, el('img', { src: o.url, alt: o.soubor, loading: 'lazy' })))) : null,
    );
  }

  function vykresliKartu() {
    if (!s.vybrane) return prehledKarty();
    const e = s.podleId.get(s.vybrane);
    const k = s.karta;
    if (!e) return prehledKarty();
    const dm = s.pohled === 'dm';
    const ikona = e.obrazek ? el('div', { className: 'ikona-karty s-obrazem vyrez-portretu' }, e.portret ? oriznoutPortret(el('img', { src: e.obrazek, alt: '' }), e.obrazek) : el('img', { src: e.obrazek, alt: '' })) : el('div', { className: 'ikona-karty', textContent: e.ikona || '·' });
    ikona.style.setProperty('--c', barvaTypu(e.typ));
    const typ = el('span', { className: 'stitek-typu', textContent: TYPY[e.typ]?.j ?? e.typ });
    typ.style.setProperty('--c', barvaTypu(e.typ));
    const stitky = [typ];
    if (e.udaje?.stav) stitky.push(el('span', { className: `stitek-stavu ${e.udaje.stav}`, textContent: STAVY[e.udaje.stav] ?? e.udaje.stav }));
    const casti = [
      el('button', { type: 'button', className: 'zpet', textContent: '← Přehled', onclick: () => vybrat(null) }),
      el('div', { className: 'hlava-karty' }, ikona, el('div', {}, el('h2', { className: 'karta-nazev', textContent: e.nazev }), el('div', { className: 'stitky-karty' }, stitky))),
    ];
    if (dm) {
      casti.push(el('div', { className: 'prepinace-karty' },
        prepinac('Ve hře', e.aktualni, 'Štítek aktualni: entita právě hraje roli', (v) => upravit(`/api/kanon/entita/${encodeURIComponent(e.id)}`, 'PUT', { aktualni: v }, v ? 'Označeno: ve hře.' : 'Štítek Ve hře odebrán.')),
        prepinac('Družina zná', e.verejne, 'verejne: true — entita se ukáže v pohledu družiny a na hráčské stránce', (v) => upravit(`/api/kanon/entita/${encodeURIComponent(e.id)}`, 'PUT', { verejne: v }, v ? 'Družina entitu zná (pohled družiny ji ukáže).' : 'Entita je jen pro DM.'))));
      const udaje = Object.entries(e.udaje ?? {}).filter(([kl]) => kl !== 'stav').map(([kl, v]) => el('div', {}, el('dt', { textContent: UDAJE[kl] ?? kl }), el('dd', { textContent: kl === 'oblast' && s.podleId.has(v) ? s.podleId.get(v).nazev : v })));
      if (udaje.length) casti.push(el('dl', { className: 'udaje-karty' }, udaje));
    }
    const akce = [];
    if (dm && k?.obsidian) akce.push(el('a', { className: 'tlacitko', href: k.obsidian, textContent: 'Otevřít v Obsidianu', title: k.soubor }));
    if (dm) akce.push(el('button', { type: 'button', textContent: 'Poznámka', title: `Poznámka F2 s odkazem [[${e.id}]]`, onclick: () => otevritPoznamku(`[[${e.id}]] `) }));
    if (dm && e.typ === 'misto' && e.obrazky.some((o) => o.ucel === 'scena' && !o.skryta)) {
      akce.push(el('button', { type: 'button', textContent: 'Ukázat v OBS', title: 'Přepne scénu Místo v OBS na toto místo', onclick: async () => {
        try {
          const r = await api('/api/scena/zobrazit', { metoda: 'POST', telo: { misto: e.id, prepnout: true } });
          toast(r.chybaObs ?? `V OBS je ${e.nazev}.`, { chyba: Boolean(r.chybaObs) });
        } catch (chyba) {
          toast(chyba.message, { chyba: true });
        }
      } }));
    }
    if (akce.length) casti.push(el('div', { className: 'akce-karty' }, akce));
    const pz = prezdivky(e);
    if (pz) casti.push(el('h3', { textContent: 'Přezdívky' }), pz);

    if (!k) {
      casti.push(el('p', { className: 'uvod', textContent: 'Načítám kartu…' }));
      nahradit(kartaEl, ...casti);
      return;
    }
    const pocet = new Set([...k.vztahy.map((v) => v.s), ...k.vazby]).size;
    casti.push(el('div', { className: 'sekce-hlava' }, el('h3', { textContent: `Vztahy a vazby (${pocet})` }), dm ? pridatVazbuUI(k) : null));
    const radky = seznamVztahu(k);
    casti.push(radky.length ? el('ul', { className: 'vztahy-karty' }, radky) : el('p', { className: 'poznamka', textContent: dm ? 'Zatím bez vazeb. Přidej ji tlačítkem, nebo Alt + tažením na mapě.' : 'Družina o žádném vztahu neví.' }));
    const zpetne = k.odkazujici.filter((o) => !k.vazby.includes(o.id));
    if (zpetne.length) {
      casti.push(el('h3', { textContent: `Odkazují sem (${zpetne.length})` }));
      casti.push(el('ul', { className: 'vztahy-karty zpetne' }, zpetne.map((o) => {
        const tecka = el('span', { className: `tecka-postoje${o.vztah ? '' : ' jen-vazba'}` });
        const b = o.vztah ? barvaPostoje(o.vztah.postoj) : null;
        if (b) tecka.style.background = b;
        return el('li', { className: 'vztah-radek' }, tecka, el('span', { className: 'vztah-text' }, odkazNaEntitu(o.id), o.vztah ? el('span', { className: 'vztah-popis', textContent: ` — ${e.nazev} je pro ni/něj: ${o.vztah.popis}` }) : null));
      })));
    }
    const obr = obrazkyKarty(k);
    if (obr) casti.push(el('h3', { textContent: 'Ilustrace' }), obr);
    casti.push(el('h3', { textContent: dm ? 'Karta' : 'Co ví družina' }));
    if (k.telo.trim()) {
      const text = el('div', { className: 'text-karty' });
      text.innerHTML = naHtml(k.telo, { existuje: (id) => s.podleId.has(id), vynechatNadpis: e.nazev, oznacitDm: dm });
      casti.push(text);
    } else {
      casti.push(el('p', { className: 'poznamka', textContent: dm ? 'Karta nemá text.' : `Družina o ${e.nazev} zatím nic nezapsala. Oddíl „## Co ví družina“ se doplňuje v Obsidianu.` }));
    }
    nahradit(kartaEl, ...casti);
  }

  kartaEl.addEventListener('click', (ev) => {
    const a = ev.target.closest?.('a.odkaz-entity');
    if (!a) return;
    ev.preventDefault();
    vybrat(a.dataset.id);
  });

  /* ---------- Veřejné rozhraní pro app.js ---------- */

  return {
    /** Obrazovka Kánon se ukázala (případně s vybranou entitou z adresy #kanon/<id>). */
    async ukazat(id) {
      s.viditelna = true;
      if (!s.data) await nacist();
      if (s.prvniPriblizeni && s.data) {
        s.prvniPriblizeni = false;
        requestAnimationFrame(() => priblizitNa(null, false));
      }
      if (id !== undefined && id !== s.vybrane) vybrat(id || null);
    },
    skryt() {
      s.viditelna = false;
    },
    /** Živá změna ze serveru (událost „kanon“). */
    zmena(data) {
      if (!s.data || data?.verze === s.data.verze) return;
      nacist();
    },
    /** Hledání v liště: zvýrazní uzly, vrátí výsledky. */
    async hledat(dotaz) {
      if (!s.data) await nacist();
      s.dotaz = dotaz;
      if (s.data) zvyraznit();
      return s.data ? hledat(s.data.entity, dotaz, 8).map((e) => ({ ...e, typText: TYPY[e.typ]?.j ?? e.typ, barva: barvaTypu(e.typ) })) : [];
    },
    vybrat,
    /** Esc na obrazovce Kánon. */
    zrusitVyber() {
      if (s.uprava || s.pridavani) {
        s.uprava = null;
        s.pridavani = false;
        vykresliKartu();
      } else if (s.vybrane) vybrat(null);
    },
    /** Text pro F2 poznámku, když je vybraná entita (odkaz [[id]]). */
    odkazProPoznamku() {
      return s.viditelna && s.vybrane && s.pohled === 'dm' ? `[[${s.vybrane}]] ` : '';
    },
    escapovat,
    proHledani,
  };
}
