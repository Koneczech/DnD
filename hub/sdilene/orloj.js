// Kreslení orloje kalendáře (SVG). Převzato z Apps/Calendar/kalendar.html beze změny vzhledu;
// data přicházejí jako { dnes, zacatek, udalosti } z Hubu místo z kalendar-data.js.
import { Harptos, RIMSKE, udalostiDne, aktivniLhuty, indexZacatku } from './harptos.js';

/* ---------- Kreslení ---------- */
const NS = "http://www.w3.org/2000/svg";
export function el(tag, attrs, rodic) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (rodic) rodic.appendChild(e);
  return e;
}
export function text(rodic, x, y, velikost, trida, kotva, styl) {
  const t = el("text", { x, y, "text-anchor": kotva || "middle", class: trida }, rodic);
  t.style.fontSize = velikost + "px";
  if (styl) Object.assign(t.style, styl);
  return t;
}
// Zmenší písmo, dokud se text nevejde; když nestačí, zkrátí ho výpustkou.
export function vejdiSe(t, max, min) {
  try {
    let fs = parseFloat(t.style.fontSize);
    while (t.getComputedTextLength() > max && fs > min) { fs -= 1; t.style.fontSize = fs + "px"; }
    let s = t.textContent;
    while (s.length > 1 && t.getComputedTextLength() > max) { s = s.slice(0, -1); t.textContent = s.trimEnd() + "…"; }
  } catch (e) { /* prvek není vykreslený */ }
}

class Kotouc {
  constructor(svg, cx, cy, geo) {
    this.cx = cx; this.cy = cy; this.geo = geo;
    this.g = el("g", { class: "o-kotouc" }, svg);
    this.g.style.transformBox = "view-box";
    this.g.style.transformOrigin = cx + "px " + cy + "px";
    this.rok = null; this.rot = null;
  }
  bod(r, uhel) {
    const a = (uhel - 90) * Math.PI / 180;
    return [this.cx + r * Math.cos(a), this.cy + r * Math.sin(a)];
  }
  oblouk(r, a1, a2) {
    const p = this.bod(r, a1), q = this.bod(r, a2);
    return "M" + p[0] + " " + p[1] + "A" + r + " " + r + " 0 " + (a2 - a1 > 180 ? 1 : 0) + " 1 " + q[0] + " " + q[1];
  }
  vysec(r1, r2, a1, a2) {
    const p = this.bod(r2, a1), q = this.bod(r2, a2), u = this.bod(r1, a2), v = this.bod(r1, a1), l = a2 - a1 > 180 ? 1 : 0;
    return "M" + p[0] + " " + p[1] + "A" + r2 + " " + r2 + " 0 " + l + " 1 " + q[0] + " " + q[1] +
      "L" + u[0] + " " + u[1] + "A" + r1 + " " + r1 + " 0 " + l + " 0 " + v[0] + " " + v[1] + "Z";
  }
  sestav(rok) {
    const G = this.geo, dny = Harptos.dny(rok);
    this.rok = rok; this.rot = null;
    this.krok = 360 / dny.length;
    while (this.g.firstChild) this.g.removeChild(this.g.firstChild);
    this.zvyr = el("path", { class: "o-zvyrazneni" }, this.g);
    this.obl = G.rOblouk ? el("path", { class: "o-oblouk", "stroke-width": 3, "stroke-linecap": "round" }, this.g) : null;
    G.kruhy.forEach(([r, w]) => el("circle", { cx: this.cx, cy: this.cy, r, class: "o-linka", "stroke-width": w }, this.g));
    dny.forEach((d, i) => {
      const u = i * this.krok;
      let r1 = G.rDen, w = G.wDen, trida = "o-linka-tmava";
      if (d.svatek || d.den === 1) { r1 = G.rMesic; w = 1; trida = "o-linka"; }
      else if (d.den === 11 || d.den === 21) { r1 = G.rDekada; w = 0.75; trida = "o-linka"; }
      const p = this.bod(r1, u), q = this.bod(G.rVnejsi, u);
      el("line", { x1: p[0], y1: p[1], x2: q[0], y2: q[1], class: trida, "stroke-width": w }, this.g);
      if (d.svatek) {
        const c = (i + 0.5) * this.krok, k = this.bod(G.rKlenot, c), s = G.klenot;
        el("rect", { x: k[0] - s / 2, y: k[1] - s / 2, width: s, height: s, class: "o-klenot",
          transform: "rotate(" + (c + 45) + " " + k[0] + " " + k[1] + ")" }, this.g);
      }
      if (d.den === 16) {
        const rot = "rotate(" + u + " " + this.cx + " " + this.cy + ")";
        if (G.rJmena) { const t = text(this.g, this.cx, this.cy - G.rJmena, G.pismoJmena, "o-text"); t.setAttribute("transform", rot); t.textContent = d.mesic; }
        if (G.rRimske) { const t = text(this.g, this.cx, this.cy - G.rRimske, G.pismoRimske, "o-text-bronz"); t.setAttribute("transform", rot); t.textContent = RIMSKE[d.mi]; }
      }
    });
  }
  nastav(dnes, zacIdx, animovat) {
    if (this.rok !== dnes.rok) { this.sestav(dnes.rok); animovat = false; }
    const G = this.geo, k = this.krok, i = Harptos.index(dnes), x = Harptos.dny(this.rok)[i];
    const s = x.svatek ? i : i - (x.den - 1), e = x.svatek ? i + 1 : s + 30;
    this.zvyr.setAttribute("d", this.vysec(G.pasmo[0], G.pasmo[1], s * k, e * k));
    if (this.obl) this.obl.setAttribute("d", zacIdx == null ? "" : this.oblouk(G.rOblouk, zacIdx * k, Math.min((i + 1) * k, zacIdx * k + 359.9)));
    const cil = -(i + 0.5) * k;
    if (this.rot === null || !animovat) {
      this.rot = cil;
      this.g.style.transition = "none";
      this.g.style.transform = "rotate(" + cil + "deg)";
      void this.g.getBoundingClientRect();
      this.g.style.transition = "";
    } else {
      this.rot += (((cil - this.rot) % 360) + 540) % 360 - 180;
      this.g.style.transform = "rotate(" + this.rot + "deg)";
    }
  }
  /** Plynulé natočení bez CSS přechodu: zlomek 0–1 = jak daleko je kotouč za dneškem (rekapitulace). */
  nastavPlynule(dnes, zacIdx, zlomek) {
    if (this.rok !== dnes.rok) this.sestav(dnes.rok);
    const G = this.geo, k = this.krok, i = Harptos.index(dnes), x = Harptos.dny(this.rok)[i];
    if (this.plynulyDen !== i) {
      this.plynulyDen = i;
      const s = x.svatek ? i : i - (x.den - 1), e = x.svatek ? i + 1 : s + 30;
      this.zvyr.setAttribute("d", this.vysec(G.pasmo[0], G.pasmo[1], s * k, e * k));
    }
    if (this.obl) this.obl.setAttribute("d", zacIdx == null ? "" : this.oblouk(G.rOblouk, zacIdx * k, Math.min((i + 1 + zlomek) * k, zacIdx * k + 359.9)));
    this.rot = -(i + 0.5 + zlomek) * k;
    this.g.style.transition = "none";
    this.g.style.transform = "rotate(" + this.rot + "deg)";
  }
}

/* Velký orloj: celá obrazovka na začátku sezení */
export function velkyOrloj(kontejner) {
  const svg = el("svg", { viewBox: "0 0 600 600", role: "img", "aria-label": "Orloj kalendáře Harptos" }, kontejner);
  el("circle", { cx: 300, cy: 300, r: 294, class: "o-disk", "stroke-width": 2 }, svg);
  const kotouc = new Kotouc(svg, 300, 300, {
    kruhy: [[285, 1], [262, 0.5], [225, 1]], pasmo: [225, 285],
    rVnejsi: 285, rDen: 276, rDekada: 262, rMesic: 150, wDen: 0.5,
    rKlenot: 244, klenot: 10, rJmena: 237, pismoJmena: 17, rRimske: 200, pismoRimske: 12, rOblouk: 180
  });
  el("circle", { cx: 300, cy: 300, r: 150, class: "o-disk", "stroke-width": 1.5 }, svg);
  el("circle", { cx: 300, cy: 300, r: 141, class: "o-linka-tmava", "stroke-width": 0.75 }, svg);
  el("path", { d: "M287 2 L313 2 L300 32 Z", class: "o-ukazatel" }, svg);
  const rok = text(svg, 300, 222, 18, "o-text-zlaty", "middle", { letterSpacing: "3px" });
  const den = text(svg, 300, 336, 110, "o-text");
  const mesic = text(svg, 300, 386, 32, "o-text");
  const svatek = text(svg, 300, 312, 26, "o-text");
  const svatekPo = text(svg, 300, 345, 15, "o-text-zlaty");
  function popisky(d) {
    rok.textContent = d.rok + " DR";
    if (d.svatek) {
      den.textContent = ""; mesic.textContent = "";
      svatek.style.fontSize = "26px"; svatek.textContent = d.svatek; vejdiSe(svatek, 250, 16);
      svatekPo.textContent = Harptos.popisSvatku(d);
    } else {
      den.textContent = d.den; mesic.textContent = d.mesic;
      svatek.textContent = ""; svatekPo.textContent = "";
    }
  }
  return {
    /** Plynulý pohyb (rekapitulace): data.dnes je den, zlomek 0–1 posun k dalšímu dni. */
    plynule(data, zlomek) {
      const d = data.dnes;
      kotouc.nastavPlynule(d, data.zacatek ? indexZacatku(data.zacatek, d) : null, zlomek);
      if (Harptos.klic(d) !== this.posledni) { this.posledni = Harptos.klic(d); popisky(d); }
    },
    obnov(data, animovat) {
      const d = data.dnes;
      this.posledni = null;
      kotouc.plynulyDen = null;
      kotouc.nastav(d, data.zacatek ? indexZacatku(data.zacatek, d) : null, animovat);
      rok.textContent = d.rok + " DR";
      if (d.svatek) {
        den.textContent = ""; mesic.textContent = "";
        svatek.style.fontSize = "26px"; svatek.textContent = d.svatek; vejdiSe(svatek, 250, 16);
        svatekPo.textContent = Harptos.popisSvatku(d);
      } else {
        den.textContent = d.den; mesic.textContent = d.mesic;
        svatek.textContent = ""; svatekPo.textContent = "";
      }
    }
  };
}

/* Malý orloj: medailon uprostřed, vpravo události dne, vlevo odpočty (zrcadlo = strany prohozené) */
export function malyOrloj(kontejner, zrcadlo) {
  const W = 1000, mx = 500, cy = 135;
  const svg = el("svg", { viewBox: "0 0 " + W + " 270", role: "img", "aria-label": "Dnešní datum, události a odpočty" }, kontejner);
  const stranaUdalosti = zrcadlo ? -1 : 1, stranaOdpoctu = -stranaUdalosti;
  function stitek(strana) {
    const x = strana > 0 ? mx - 15 : 8, w = strana > 0 ? (W - 8) - (mx - 15) : (mx + 15) - 8;
    return { strana, ram: el("rect", { x, y: cy, width: w, height: 0, rx: 6, class: "o-disk", "stroke-width": 1.5 }, svg), radky: null };
  }
  const stUd = stitek(stranaUdalosti), stOd = stitek(stranaOdpoctu);
  stUd.radky = el("g", {}, svg); stOd.radky = el("g", {}, svg);
  el("circle", { cx: mx, cy, r: 130, class: "o-disk", "stroke-width": 2 }, svg);
  const kotouc = new Kotouc(svg, mx, cy, {
    kruhy: [[124, 1], [106, 1]], pasmo: [106, 124],
    rVnejsi: 124, rDen: 119, rDekada: 110, rMesic: 80, wDen: 0.4,
    rKlenot: 115, klenot: 7, rJmena: null, rRimske: 89, pismoRimske: 11, rOblouk: null
  });
  el("circle", { cx: mx, cy, r: 80, class: "o-disk", "stroke-width": 1.25 }, svg);
  el("path", { d: "M" + (mx - 8) + " 1 L" + (mx + 8) + " 1 L" + mx + " 20 Z", class: "o-ukazatel" }, svg);
  const rok = text(svg, mx, 96, 12, "o-text-zlaty", "middle", { letterSpacing: "2px" });
  const den = text(svg, mx, 152, 58, "o-text");
  const mesic = text(svg, mx, 180, 19, "o-text");
  const svatek = text(svg, mx, 140, 16, "o-text");
  const svatekPo = text(svg, mx, 160, 11, "o-text-zlaty");

  // Vykreslí jeden štítek. Položka: { text, pocet? }. pocet = { typ: "odpocet", n } nebo { typ: "rozsah", den, celkem };
  // stojí u vnějšího okraje. Odpočet má dutý kosočtverec, událost dne plný.
  // Šířka štítku se řídí nejdelším řádkem, aby u krátkých textů nezůstávala prázdná plocha.
  function sirkaTextu(t, nahradni) { try { return t.getComputedTextLength() || nahradni; } catch (e) { return nahradni; } }
  function vykresli(st, polozky) {
    const g = st.radky, s = st.strana;
    while (g.firstChild) g.removeChild(g.firstChild);
    if (!polozky.length) { st.ram.style.display = "none"; return; }
    st.ram.style.display = "";
    const h = polozky.length * 46 + 22, horni = cy - h / 2;
    st.ram.setAttribute("y", horni); st.ram.setAttribute("height", h);
    const vnitrni = mx + s * 171, jx = mx + s * 157;
    const maxObsah = (s > 0 ? W - 26 : 26) * s - vnitrni * s;   // nejvíc místa pro text a počet dní
    const MEZERA = 16, MIN_OBSAH = 110, OKRAJ = 20;
    const radky = polozky.map((p, i) => {
      const b = horni + 11 + 46 * i, odpocet = !!(p.pocet && p.pocet.typ === "odpocet");
      el("rect", { x: jx - 4, y: b + 17, width: 8, height: 8, transform: "rotate(45 " + jx + " " + (b + 21) + ")",
        class: odpocet ? "o-klenot-duty" : "o-klenot", "stroke-width": 1.25 }, g);
      let pocet = null, sirkaPoctu = 0;
      if (p.pocet) {
        pocet = el("text", { x: vnitrni, y: b + 30, "text-anchor": s > 0 ? "end" : "start", class: "o-text-zlaty" }, g);
        const kus = (t, px) => { const e = el("tspan", {}, pocet); e.style.fontSize = px + "px"; e.textContent = t; };
        if (p.pocet.typ === "odpocet" && p.pocet.n === 1) kus("zítra", 19);
        else if (p.pocet.typ === "odpocet") { kus("za ", 14); kus(p.pocet.n, 24); kus(p.pocet.n <= 4 ? " dny" : " dní", 14); }
        else { kus("den ", 14); kus(p.pocet.den, 24); kus("/" + p.pocet.celkem, 14); }
        sirkaPoctu = sirkaTextu(pocet, 80);
      }
      const t = text(g, vnitrni, b + 30, 19, "o-text", s > 0 ? "start" : "end");
      t.textContent = p.text;
      const volno = maxObsah - (pocet ? sirkaPoctu + MEZERA : 0);
      vejdiSe(t, volno, 15);
      return { b, pocet, potreba: Math.min(volno, sirkaTextu(t, volno)) + (pocet ? sirkaPoctu + MEZERA : 0) };
    });
    const obsah = Math.max(MIN_OBSAH, ...radky.map(r => r.potreba));
    const vnejsiText = vnitrni + s * obsah;          // kde končí nejdelší řádek
    const hranaRamu = vnejsiText + s * OKRAJ;        // vnější hrana štítku
    radky.forEach((r, i) => {
      if (r.pocet) r.pocet.setAttribute("x", vnejsiText);
      if (i > 0) el("line", { x1: mx + s * 155, y1: r.b, x2: vnejsiText + s * 6, y2: r.b, class: "o-linka-tmava", "stroke-width": 0.5 }, g);
    });
    if (s > 0) { st.ram.setAttribute("x", mx - 15); st.ram.setAttribute("width", hranaRamu - (mx - 15)); }
    else { st.ram.setAttribute("x", hranaRamu); st.ram.setAttribute("width", (mx + 15) - hranaRamu); }
  }

  return {
    obnov(data, animovat) {
      const d = data.dnes;
      kotouc.nastav(d, null, animovat);
      rok.textContent = d.rok + " DR";
      if (d.svatek) {
        den.textContent = ""; mesic.textContent = "";
        svatek.style.fontSize = "16px"; svatek.textContent = d.svatek; vejdiSe(svatek, 140, 11);
        svatekPo.textContent = Harptos.popisSvatku(d);
      } else {
        den.textContent = d.den; mesic.textContent = d.mesic;
        svatek.textContent = ""; svatekPo.textContent = "";
      }
      vykresli(stUd, udalostiDne(d, data.udalosti).slice(0, 3).map(x => ({ text: x.u.text, pocet: x.celkem > 1 ? { typ: "rozsah", den: x.den, celkem: x.celkem } : null })));
      vykresli(stOd, aktivniLhuty(d, data.udalosti).slice(0, 3).map(x => ({ text: x.u.text, pocet: { typ: "odpocet", n: x.zbyva } })));
    }
  };
}


/** Styly orloje (sdílené výstupy kalendáře). Převzato z kalendar.html. */
export const STYL_ORLOJE = `
:root {
  --kamen: #2C2C2A; --kamen-svetly: #444441; --kamen-hluboky: #1E1E1C;
  --bronz: #BA7517; --bronz-tmavy: #854F0B; --zlato: #EF9F27; --zlato-svetle: #FAC775;
  --pergamen: #EDE6D6; --pergamen-tlumeny: #B9B1A0;
  --pismo: "Alegreya", Georgia, "Times New Roman", serif;
  --animace: 1.2s;
}
svg text { font-family: var(--pismo); font-variant-numeric: lining-nums; }
.o-disk { fill: var(--kamen); stroke: var(--bronz); }
.o-linka { fill: none; stroke: var(--bronz); }
.o-linka-tmava { fill: none; stroke: var(--bronz-tmavy); }
.o-zvyrazneni { fill: var(--kamen-svetly); }
.o-klenot, .o-ukazatel { fill: var(--zlato); }
.o-klenot-duty { fill: none; stroke: var(--zlato); }
.o-oblouk { fill: none; stroke: var(--zlato); }
.o-text { fill: var(--zlato-svetle); }
.o-text-zlaty { fill: var(--zlato); }
.o-text-bronz { fill: var(--bronz); }
.o-kotouc { transition: transform var(--animace) cubic-bezier(0.4, 0, 0.2, 1); }
@media (prefers-reduced-motion: reduce) { .o-kotouc { transition: none; } }
`;

/**
 * Připojení výstupu ke kalendáři v Hubu: první data přes /api/kalendar/verejne, pak živé změny
 * přes SSE. Při výpadku Hubu drží poslední stav a sám se znovu připojí.
 */
export function sledovatKalendar(priZmene) {
  fetch('/api/kalendar/verejne').then((r) => r.json()).then((d) => priZmene(d, false)).catch(() => {});
  function pripojit() {
    const zdroj = new EventSource('/api/udalosti');
    zdroj.addEventListener('kalendar', (e) => priZmene(JSON.parse(e.data), true));
    zdroj.addEventListener('error', () => {
      if (zdroj.readyState === EventSource.CLOSED) setTimeout(pripojit, 1000);
    });
  }
  pripojit();
}
