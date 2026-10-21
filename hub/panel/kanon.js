// Modul Kánon v panelu (Blok 3). Hlavní pohled je wiki (kanon-wiki.js, rozhodnutí DM
// 20. 10. 2026), mapa sítě entit je druhá záložka (rozhodnutí 69, bod 102): síť vlevo, karta vpravo.
// Kreslí se ze souborů v kampan/ přes /api/kanon, bez knihoven a bez internetu.
import { rozlozit, polomer, hledat, proHledani, doKruhu, doMrizky, vObdelniku } from '/sdilene/sit.js';
import { escapovat } from '/sdilene/markdown.js';
import { Harptos } from '/sdilene/harptos.js';
import { ROZLOZENI, POCITANA, kdyAKde, kdoAKdy, kruhyBlizkosti, osaPostoje, znalost, vlakna, prostrednost, ucastNaUdalostech } from '/sdilene/rozlozeni.js';
import { $, TYPY, barvaTypu, barvaPostoje, postojText, el, nahradit, svg, vyrezHlavy, oriznoutPortret, obrazekEntity, stitekTypu, STAVY, castiKarty, stromMist } from '/panel/kanon-spolecne.js';
import { vytvoritWiki } from '/panel/kanon-wiki.js';

export { TYPY };
/**
 * Ručně posunuté uzly celé mapy (bez nástěnky) si pamatuje prohlížeč, zvlášť pro pohled DM
 * a družiny. Nástěnky se ukládají do repa tlačítkem, tohle je jen pohodlí jednoho prohlížeče.
 */
const KLIC_POZIC = (pohled) => `dmhub-kanon-pozice-${pohled}`;
function nacistPozice(pohled) {
  try {
    const d = JSON.parse(localStorage.getItem(KLIC_POZIC(pohled))) ?? {};
    return new Map(Object.entries(d).filter(([, p]) => Number.isFinite(p?.x) && Number.isFinite(p?.y)).map(([id, p]) => [id, { x: p.x, y: p.y }]));
  } catch {
    return new Map();
  }
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
// Strom míst je ve společném modulu; panel (app.js) ho bere odsud.
export { stromMist };

/**
 * @param {object} volby
 * @param {boolean} [volby.jenCteni] čtecí verze (GitHub Pages): bez úprav, poznámek a OBS
 * @param {(soubor: string) => string} [volby.upravitNaGitHubu] čtecí verze: adresa souboru karty v editoru GitHubu
 * @param {boolean} [volby.webUpravy] čtecí verze: text karty, přepínače, přezdívky a Co ví družina jde upravit (přes GitHub)
 */
export function vytvoritKanon({ api, toast, otevritPoznamku, jenCteni = false, upravitNaGitHubu = null, webUpravy = false }) {
  const ulozene = nacistVolby();
  const s = {
    jenCteni,
    upravitNaGitHubu,
    webUpravy: jenCteni && webUpravy,
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
    rezim: 'wiki', // wiki (hlavní pohled) nebo mapa
    mapaZastarala: true,
    oznacene: new Set(), // výběr víc uzlů (Shift), nezávislý na kartě vpravo
    fokus: null, // { ids: Set, okoli: Set } „jen výběr a okolí“
    historie: [], // přesuny uzlů pro Ctrl+Z
    zmenyNastenky: false, // v nástěnce se posunulo a ještě neuložilo
    ulozitJen: null, // Nástěnka z výběru: jen tyto id
    rozbalena: new Set(Array.isArray(ulozene.rozbalena) ? ulozene.rozbalena : []), // místa s ukázanými podmísty
    zastupci: new Map(), // id → uzel, který ho na mapě zastupuje (sbalené podmísto → nadřazené místo)
    // Rozložit podle (⚠ návrhy 134–141): síť, čas, tabulky, kruhy, osy. Dřívější přepínač Časová osa = 'cas'.
    rozlozeni: ROZLOZENI.some((r) => r.id === ulozene.rozlozeni) ? ulozene.rozlozeni : ulozene.osa === true ? 'cas' : 'sit',
    poziceSite: new Map(), // poslední silové rozložení (výchozí bod, když se z jiného rozložení vrátíš do sítě)
    dekorace: [], // mřížka, kruhy a popisky os pod uzly
    bezHran: false,
    tlumene: new Set(), // uzly mimo osu (bez postoje, bez spojení…)
    zvyraznene: new Set(), // otevřená vlákna
    polomery: new Map(), // Mosty: velikost uzlu podle prostřednosti
    vzdyPopisek: new Set(), // uzly, které mají popisek vždy
    poziceOsy: new Map(), // 'u:<id>' → {x, y}
    naOse: new Set(), // hráčský kánon, který na časové ose stojí nad svou událostí
    udalostMapy: null, // vybraná událost na ose (karta vpravo)
  };
  s.pevne = nacistPozice(s.pohled);
  const platno = $('#kanon-platno');
  const plocha = $('#kanon-svg');
  const vrstva = svg('g', { class: 'vrstva' });
  const gHrany = svg('g', { class: 'hrany' });
  const gOsa = svg('g', { class: 'osa' });
  const gMrizka = svg('g', { class: 'mrizka' });
  const gUzly = svg('g', { class: 'uzly' });
  const gDocasna = svg('g');
  const defs = svg('defs');
  vrstva.append(gMrizka, gHrany, gOsa, gUzly, gDocasna);
  plocha.append(defs, vrstva);
  const kartaEl = $('#kanon-karta');

  // Společné části karty a wiki. prekreslit překreslí to, co je právě vidět.
  const ctx = {
    s,
    api,
    toast,
    otevritPoznamku,
    prekreslit: () => (s.rezim === 'mapa' ? vykresliKartu() : wiki.prekreslit()),
    otevrit: (id) => otevritEntitu(id),
    nacist: () => nacist(),
    nacistKartu: (id) => nacistKartu(id),
  };
  const karta = castiKarty(ctx);
  const wiki = vytvoritWiki(ctx, karta);

  /** Odkaz na entitu: na mapě ji vybere, ve wiki otevře její stránku. */
  function otevritEntitu(id) {
    if (s.rezim === 'mapa') vybrat(id);
    else location.hash = `kanon/${encodeURIComponent(id)}`;
  }

  function prepnoutRezim(rezim) {
    s.rezim = rezim === 'mapa' ? 'mapa' : 'wiki';
    const obr = $('#obrazovka-kanon');
    obr.classList.toggle('rezim-mapa', s.rezim === 'mapa');
    obr.classList.toggle('rezim-wiki', s.rezim === 'wiki');
    for (const b of document.querySelectorAll('#kanon-rezim button')) b.setAttribute('aria-pressed', String(b.dataset.rezim === s.rezim));
    if (s.rezim === 'mapa' && s.data) {
      if (s.mapaZastarala) prepocitat();
      if (s.prvniPriblizeni) {
        s.prvniPriblizeni = false;
        requestAnimationFrame(() => priblizitNa(null, false));
      }
    }
  }
  for (const b of document.querySelectorAll('#kanon-rezim button')) {
    b.addEventListener('click', () => {
      if (b.dataset.rezim === 'mapa') location.hash = s.vybrane ? `kanon/mapa/${encodeURIComponent(s.vybrane)}` : 'kanon/mapa';
      else location.hash = s.vybrane ? `kanon/${encodeURIComponent(s.vybrane)}` : 'kanon';
    });
  }

  const ulozit = () => ulozitVolby({ pohled: s.pohled, typy: [...s.typy], jenVeHre: s.jenVeHre, rozbalena: [...s.rozbalena], rozlozeni: s.rozlozeni });

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
    s.mapaZastarala = true;
    s.klicSite = null;
    if (s.rezim === 'mapa') prepocitat();
    if (s.vybrane) nacistKartu(s.vybrane);
    else ctx.prekreslit();
  }

  /** Je `a` místo, které leží v `b` (nebo naopak)? Taková dvojice má na mapě čáru Leží v (⚠ bod 116). */
  const jeLeziV = (a, b) => s.podleId.get(a)?.leziV === b || s.podleId.get(b)?.leziV === a;

  /** Neuspořádané dvojice entit, mezi kterými vede vazba, vztah nebo Leží v (jen existující cíle). */
  function vsechnyDvojice() {
    const videno = new Set();
    const vysledek = [];
    for (const e of s.data?.entity ?? []) {
      for (const cil of new Set([...(e.leziV ? [e.leziV] : []), ...e.vazby, ...e.vztahy.map((v) => v.s)])) {
        if (!s.podleId.has(cil) || cil === e.id) continue;
        const klic = e.id < cil ? `${e.id} ${cil}` : `${cil} ${e.id}`;
        if (videno.has(klic)) continue;
        videno.add(klic);
        vysledek.push([e.id, cil]);
      }
    }
    return vysledek;
  }

  /* ---------- Sbalená podmísta (⚠ návrh): místo uvnitř místa se schová do nadřazeného ---------- */

  /** Nadřazená místa od nejbližšího ke kořeni (jen ta, která pohled zná). */
  function predkove(id) {
    const vysledek = [];
    const videno = new Set([id]);
    for (let m = s.podleId.get(id); m?.leziV && s.podleId.has(m.leziV) && !videno.has(m.leziV); m = s.podleId.get(m.leziV)) {
      videno.add(m.leziV);
      vysledek.push(m.leziV);
    }
    return vysledek;
  }

  /** Sbaluje se jen na celé mapě; nástěnka a „jen okolí“ ukazují přesně to, co mají. */
  const sbalovat = () => !s.fokus && !s.nastenka;

  /** Kdo uzel na mapě zastupuje: on sám, nebo nejvyšší sbalené místo nad ním. */
  function spocitatZastupce() {
    s.zastupci = new Map();
    for (const e of s.data?.entity ?? []) {
      let z = e.id;
      if (sbalovat()) {
        const p = predkove(e.id);
        for (let i = p.length - 1; i >= 0; i--) {
          if (!s.rozbalena.has(p[i])) {
            z = p[i];
            break;
          }
        }
      }
      s.zastupci.set(e.id, z);
    }
  }
  const zast = (id) => s.zastupci.get(id) ?? id;

  /** Podmísta v pohledu: id místa → id míst přímo v něm. */
  function detiMist() {
    const deti = new Map();
    for (const e of s.data?.entity ?? []) if (e.leziV && s.podleId.has(e.leziV)) deti.set(e.leziV, [...(deti.get(e.leziV) ?? []), e.id]);
    return deti;
  }
  function potomku(id, deti) {
    let n = 0;
    const fronta = [...(deti.get(id) ?? [])];
    const videno = new Set();
    while (fronta.length) {
      const d = fronta.shift();
      if (videno.has(d)) continue;
      videno.add(d);
      n++;
      fronta.push(...(deti.get(d) ?? []));
    }
    return n;
  }

  /**
   * Dvojice uzlů na mapě: vazby schovaných podmíst vedou k místu, které je zastupuje.
   * @returns {Array<{a: string, b: string, leziV: boolean, souhrn: Array<[string, string]>|null}>}
   */
  function dvojiceNaMape() {
    const podleKlice = new Map();
    for (const [a, b] of vsechnyDvojice()) {
      const za = zast(a);
      const zb = zast(b);
      if (za === zb) continue;
      const klic = za < zb ? `${za} ${zb}` : `${zb} ${za}`;
      let d = podleKlice.get(klic);
      if (!d) {
        d = { a: za, b: zb, leziV: false, souhrn: null };
        podleKlice.set(klic, d);
      }
      if (za === a && zb === b) {
        if (jeLeziV(a, b)) d.leziV = true;
        d.prima = true;
      } else {
        d.souhrn = [...(d.souhrn ?? []), [a, b]];
      }
    }
    // Přímá dvojice (i se schovanými navíc) se kreslí jako obyčejná čára.
    return [...podleKlice.values()].map((d) => (d.prima ? { ...d, souhrn: null } : d));
  }

  function prepnoutPodmista(id) {
    if (s.rozbalena.has(id)) {
      s.rozbalena.delete(id);
      if (s.vybrane && predkove(s.vybrane).includes(id)) s.vybrane = id;
    } else s.rozbalena.add(id);
    ulozit();
    prepocitat();
    if (s.vybrane) vybrat(s.vybrane, { priblizit: false });
  }

  /** Vybraná entita musí být vidět: rozbalí místa nad ní. */
  function odkrytPredky(id) {
    let zmena = false;
    for (const p of predkove(id)) {
      if (!s.rozbalena.has(p)) {
        s.rozbalena.add(p);
        zmena = true;
      }
    }
    if (zmena) ulozit();
    return zmena;
  }

  /** Rozložení, která v tomto pohledu dávají smysl (Co družina ví jen DM, časová jen s událostmi). */
  const dostupnaRozlozeni = () => ROZLOZENI.filter((r) => (!r.jenDm || s.pohled === 'dm') && ((s.data?.udalosti ?? []).length || !['cas', 'cas-mista', 'kdy-kde', 'kdo-kdy', 'vlakna'].includes(r.id)));

  function vykresliPrepinace() {
    const vyber = $('#kanon-rozlozeni');
    const moznosti = dostupnaRozlozeni();
    if (vyber.options.length !== moznosti.length || [...vyber.options].some((o, i) => o.value !== moznosti[i].id)) {
      vyber.replaceChildren(...moznosti.map((r) => Object.assign(new Option(r.nazev, r.id), { title: r.popis })));
    }
    vyber.value = s.rozlozeni;
    vyber.title = ROZLOZENI.find((r) => r.id === s.rozlozeni)?.popis ?? '';
    const pod = $('#kanon-podmista');
    const maPodmista = (s.data?.entity ?? []).some((e) => e.leziV && s.podleId.has(e.leziV));
    pod.hidden = !maPodmista;
    pod.disabled = !sbalovat();
    pod.textContent = s.rozbalena.size ? 'Sbalit místa' : 'Rozbalit místa';
    pod.title = !sbalovat() ? 'V nástěnce a v Jen okolí se místa nesbalují' : s.rozbalena.size ? 'Schovat místa uvnitř jiných míst do nadřazeného místa' : 'Ukázat všechna místa uvnitř jiných míst';
  }
  $('#kanon-podmista').addEventListener('click', () => {
    if (s.rozbalena.size) s.rozbalena.clear();
    else for (const [id] of detiMist()) s.rozbalena.add(id);
    if (s.vybrane) odkrytPredky(s.vybrane);
    ulozit();
    prepocitat();
    priblizitNa(null);
  });
  function nastavitRozlozeni(id) {
    if (!dostupnaRozlozeni().some((r) => r.id === id)) id = 'sit';
    s.rozlozeni = id;
    // Uzly, které stály na ose nebo v tabulce, se do sítě vrátí od posledního silového rozložení.
    s.pozice = new Map(s.poziceSite);
    if (!udalostiOsy().some((u) => u.id === s.udalostMapy)) s.udalostMapy = null;
    ulozit();
    prepocitat();
    priblizitNa(null);
    vykresliKartu();
  }
  $('#kanon-rozlozeni').addEventListener('change', (e) => nastavitRozlozeni(e.target.value));

  /* ---------- Časová osa (⚠ návrh): události z Kalendáře v řadě podle data ---------- */

  const S_UDALOSTMI = new Set(['cas', 'cas-mista', 'kdy-kde', 'kdo-kdy']);
  const udalostiOsy = () => (S_UDALOSTMI.has(s.rozlozeni) ? s.data?.udalosti ?? [] : []);
  const jeCas = () => s.rozlozeni === 'cas' || s.rozlozeni === 'cas-mista';
  const poz = (id) => s.pozice.get(id) ?? s.poziceOsy.get(id);

  /** Hráčský kánon na ose: id → [událost, pořadí nad ní]. Každý záznam jen u první své události. */
  function kanonNaOse(viditelne) {
    const vysledek = new Map();
    if (!jeCas()) return vysledek;
    for (const u of udalostiOsy()) {
      let j = 0;
      for (const id of u.vazby) {
        if (vysledek.has(id) || !viditelne.has(id) || s.podleId.get(id)?.typ !== 'kanon') continue;
        vysledek.set(id, [u.id, j++]);
      }
    }
    return vysledek;
  }

  /**
   * Pás časové osy pod sítí: události v řadě podle data, nad každou její hráčský kánon.
   * Síť se kvůli ose nepřeskupí, osa se jen přiloží pod ni.
   */
  function spocitatOsu(naOse) {
    const ud = jeCas() ? udalostiOsy() : [];
    s.poziceOsy = new Map();
    if (!ud.length) return;
    const body = [...s.pozice.values()];
    const x0 = body.length ? Math.min(...body.map((p) => p.x)) : -400;
    const x1 = body.length ? Math.max(...body.map((p) => p.x)) : 400;
    const yMax = body.length ? Math.max(...body.map((p) => p.y)) : 0;
    const vyska = Math.max(0, ...[...naOse.values()].map(([, j]) => j + 1));
    const y = Math.round(yMax + 150 + vyska * 46);
    const rozestup = Math.max(240, (x1 - x0) / Math.max(1, ud.length - 1));
    const stred = (x0 + x1) / 2;
    ud.forEach((u, i) => s.poziceOsy.set(`u:${u.id}`, { x: Math.round(stred + (i - (ud.length - 1) / 2) * rozestup), y }));
    for (const [id, [uid, j]] of naOse) {
      const p = s.poziceOsy.get(`u:${uid}`);
      s.pozice.set(id, { x: p.x, y: p.y - 58 - j * 46 });
    }
  }

  /** Čáry od události k tomu, co je k ní navázané (jen uzly na mapě; schovaná podmísta přes zástupce). */
  function hranyOsy() {
    const vysledek = [];
    for (const u of udalostiOsy()) {
      const cile = new Set(u.vazby.map(zast).filter((id) => s.pozice.has(id)));
      for (const id of cile) vysledek.push({ a: `u:${u.id}`, b: id, udalost: u });
    }
    return vysledek;
  }

  function vykresliOsu() {
    const ud = udalostiOsy().filter((u) => s.poziceOsy.has(`u:${u.id}`));
    if (!ud.length) {
      gOsa.replaceChildren();
      return;
    }
    const prvni = s.poziceOsy.get(`u:${ud[0].id}`);
    const posledni = s.poziceOsy.get(`u:${ud.at(-1).id}`);
    const casti = [svg('path', { class: 'cara-osy', d: `M${prvni.x - 80},${prvni.y} L${posledni.x + 80},${prvni.y}` })];
    ud.forEach((u, i) => {
      const p = s.poziceOsy.get(`u:${u.id}`);
      const g = svg('g', { class: `uzel-udalosti${u.verejna ? '' : ' skryta'}`, transform: `translate(${p.x},${p.y})`, tabindex: 0, role: 'button', 'data-id': `u:${u.id}`, 'aria-label': `Událost ${u.text}, ${u.datumText}` });
      g.append(svg('circle', { r: 9, class: 'telo-udalosti' }));
      // Datum jen u první události dne, pořadí v dni před textem.
      if (u.vDni === 1) {
        const datum = svg('text', { class: 'datum-osy', dy: -15, 'text-anchor': 'middle' });
        datum.textContent = u.konec ? `${Harptos.kratce(u.datum)} – ${Harptos.kratce(u.konec)}` : Harptos.kratce(u.datum);
        g.append(datum);
      }
      const text = `${u.vDniPocet > 1 ? `${u.vDni}. ` : ''}${u.text}`;
      const popisek = svg('text', { class: 'popisek-osy', dy: i % 2 ? 42 : 25, 'text-anchor': 'middle' });
      popisek.textContent = text.length > 28 ? `${text.slice(0, 26)}…` : text;
      const titul = svg('title');
      titul.textContent = `${u.text} · ${u.konecText ? `${u.datumText} – ${u.konecText}` : u.datumText}${u.vDniPocet > 1 ? ` · ${u.vDni}. z ${u.vDniPocet} toho dne` : ''}`;
      g.append(popisek, titul);
      casti.push(g);
    });
    gOsa.replaceChildren(...casti);
  }

  function vybratUdalost(id) {
    s.vybrane = null;
    s.karta = null;
    s.udalostMapy = id;
    zvyraznit();
    vykresliKartu();
    if (location.hash !== '#kanon/mapa') history.replaceState(null, '', '#kanon/mapa');
    const u = udalostiOsy().find((x) => x.id === id);
    if (u) priblizitNa([`u:${id}`, ...u.vazby.map(zast).filter((x) => s.pozice.has(x))]);
  }

  const viditelny = (e) => Boolean(e) && (!sbalovat() || zast(e.id) === e.id) && (s.fokus ? s.fokus.ids.has(e.id) || (s.fokus.okoli.has(e.id) && s.typy.has(e.typ)) : s.typy.has(e.typ) && (!s.jenVeHre || e.aktualni || e.id === s.vybrane) && (!s.nastenka?.jen_tyto || s.nastenka.entity.some((x) => x.id === e.id) || e.id === s.vybrane));

  /** Rozložení viditelných uzlů. Co už pozici mělo, zůstane zhruba na místě. */
  /**
   * Čas a místa: místa v řadě nad sítí, nejdřív v pořadí, jak jimi družina prošla (první událost,
   * u které místo bylo), pak ostatní podle názvu. Síť se mezi místy nahoře a osou dole dorovná.
   */
  function rozlozitMistaNahore(uzly, hrany, pevne) {
    const mista = uzly.filter((u) => u.typ === 'misto').map((u) => u.id);
    if (!mista.length) return;
    const ucast = ucastNaUdalostech(s.data.udalosti ?? [], (id) => s.podleId.get(id), zast);
    const nazev = (id) => s.podleId.get(id)?.nazev ?? id;
    const navstivena = mista.filter((id) => ucast.has(id)).sort((a, b) => ucast.get(a)[0] - ucast.get(b)[0] || nazev(a).localeCompare(nazev(b), 'cs'));
    const ostatni = mista.filter((id) => !ucast.has(id)).sort((a, b) => nazev(a).localeCompare(nazev(b), 'cs'));
    const rada = [...navstivena, ...ostatni];
    const body = [...s.pozice.values()];
    const x0 = Math.min(...body.map((p) => p.x));
    const x1 = Math.max(...body.map((p) => p.x));
    const y = Math.round(Math.min(...body.map((p) => p.y)) - 170);
    const rozestup = Math.max(130, (x1 - x0) / Math.max(1, rada.length - 1));
    const stred = (x0 + x1) / 2;
    const nahore = new Map(rada.map((id, i) => [id, { x: Math.round(stred + (i - (rada.length - 1) / 2) * rozestup), y }]));
    s.pozice = rozlozit(uzly, hrany, { pevne: new Map([...pevne, ...nahore]), start: s.pozice, iterace: 200 });
    for (const id of rada) {
      s.naOse.add(id);
      s.vzdyPopisek.add(id);
    }
    s.dekorace.push({ druh: 'cara', x1: nahore.get(rada[0]).x - 80, y1: y, x2: nahore.get(rada.at(-1)).x + 80, y2: y, trida: 'cara-osy-mapy' });
    if (navstivena.length > 1) s.dekorace.push({ druh: 'cesta', body: navstivena.map((id) => ({ x: nahore.get(id).x, y: y - 26 })), trida: 'trasa' });
    if (navstivena.length) s.dekorace.push({ druh: 'text', x: nahore.get(navstivena[0]).x, y: y - 40, text: 'trasa družiny →', trida: 'popisek-osy-mapy', kotva: 'start' });
    if (ostatni.length) s.dekorace.push({ druh: 'text', x: nahore.get(ostatni[0]).x, y: y - 40, text: 'zatím nenavštívená', trida: 'popisek-osy-mapy', kotva: 'start' });
  }

  /** Vstup pro rozložení spočítaná z dat (sdilene/rozlozeni.js). */
  function vstupRozlozeni(viditelne) {
    const najit = (id) => s.podleId.get(id);
    return {
      udalosti: (s.data.udalosti ?? []).map((u) => ({ ...u, datumKratce: u.konec ? `${Harptos.kratce(u.datum)} – ${Harptos.kratce(u.konec)}` : Harptos.kratce(u.datum) })),
      viditelne,
      najit,
      zast,
      dvojice: dvojiceNaMape().filter((d) => viditelne.has(d.a) && viditelne.has(d.b)).map((d) => [d.a, d.b]),
      poradiTypu: Object.keys(TYPY),
      nazvyTypu: Object.fromEntries(Object.entries(TYPY).map(([t, d]) => [t, d.mn])),
    };
  }

  const POCITAT = { 'kdy-kde': kdyAKde, 'kdo-kdy': kdoAKdy, blizkost: kruhyBlizkosti, postoj: osaPostoje, znalost, vlakna };

  function prepocitat() {
    if (!s.data) return;
    spocitatZastupce();
    if (!dostupnaRozlozeni().some((r) => r.id === s.rozlozeni)) s.rozlozeni = 'sit';
    const vsechnyUzly = s.data.entity.filter(viditelny);
    s.dekorace = [];
    s.bezHran = false;
    s.tlumene = new Set();
    s.zvyraznene = new Set();
    s.polomery = new Map();
    s.vzdyPopisek = new Set();
    if (POCITANA.has(s.rozlozeni)) {
      // Polohy z dat: nic se nesimuluje ani nepamatuje, tažení je jen dočasné.
      const v = POCITAT[s.rozlozeni](vstupRozlozeni(new Set(vsechnyUzly.map((e) => e.id))));
      s.pozice = v.pozice;
      s.poziceOsy = v.udalosti ?? new Map();
      s.dekorace = v.dekorace ?? [];
      s.bezHran = Boolean(v.bezHran);
      s.tlumene = v.tlumene ?? new Set();
      s.zvyraznene = v.zvyraznene ?? new Set();
      s.naOse = new Set(s.pozice.keys());
      s.mapaZastarala = false;
      vykreslit();
      if (s.prvniPriblizeni && s.viditelna) {
        s.prvniPriblizeni = false;
        priblizitNa(null, false);
      }
      return;
    }
    const naOse = kanonNaOse(new Set(vsechnyUzly.map((e) => e.id)));
    s.naOse = new Set(naOse.keys());
    const uzly = vsechnyUzly.filter((e) => !naOse.has(e.id)).map((e) => ({ id: e.id, typ: e.typ, obrazek: e.obrazek, r: polomer(e, e.stupen) }));
    const ids = new Set(uzly.map((u) => u.id));
    const hrany = dvojiceNaMape().filter((d) => ids.has(d.a) && ids.has(d.b)).map((d) => (d.leziV ? [d.a, d.b, 'lezi_v'] : [d.a, d.b]));
    if (s.rozlozeni === 'mosty') {
      // Velikost uzlu podle prostřednosti; nejvíc spojující mají popisek vždy.
      const p = prostrednost([...ids], hrany.map(([a, b]) => [a, b]));
      for (const u of uzly) {
        const x = p.get(u.id) ?? 0;
        u.r = Math.round(Math.max(5, u.r * 0.6) + x * 24);
        s.polomery.set(u.id, u.r);
      }
      for (const [id] of [...p].filter(([, x]) => x > 0.08).sort((a, b) => b[1] - a[1]).slice(0, 8)) s.vzdyPopisek.add(id);
    }
    const pevne = new Map([...s.pevne].filter(([id]) => ids.has(id)));
    // Stejné uzly jako minule (návrat z jiného rozložení): síť se nepřepočítá, ať se nic nepohne.
    const klic = `${s.rozlozeni === 'mosty'} ${[...ids].sort().join(' ')}`;
    if (klic === s.klicSite && [...ids].every((id) => s.poziceSite.has(id))) {
      s.pozice = new Map([...ids].map((id) => [id, pevne.get(id) ?? s.poziceSite.get(id)]));
    } else {
      const start = new Map([...(s.poziceSite.size ? s.poziceSite : s.pozice)].filter(([id]) => ids.has(id)));
      s.pozice = rozlozit(uzly, hrany, { pevne, start });
      s.klicSite = klic;
    }
    s.poziceSite = new Map(s.pozice);
    if (s.rozlozeni === 'cas-mista') rozlozitMistaNahore(uzly, hrany, pevne);
    spocitatOsu(naOse);
    s.mapaZastarala = false;
    vykreslit();
    if (s.prvniPriblizeni && s.viditelna) {
      s.prvniPriblizeni = false;
      priblizitNa(null, false);
    }
  }

  /* ---------- Kreslení sítě ---------- */

  function hranyKVykresleni() {
    const vysledek = [];
    if (s.bezHran) return vysledek;
    const smery = new Set();
    for (const e of s.data.entity) for (const v of e.vztahy) smery.add(`${e.id}>${v.s}`);
    for (const e of s.data.entity) {
      if (!s.pozice.has(e.id)) continue;
      for (const v of e.vztahy) {
        if (!s.pozice.has(v.s)) continue;
        vysledek.push({ a: e.id, b: v.s, vztah: v, obousmerny: smery.has(`${v.s}>${e.id}`) });
      }
    }
    for (const { a, b, leziV, souhrn } of dvojiceNaMape()) {
      if (!s.pozice.has(a) || !s.pozice.has(b)) continue;
      // Místo v místě: vlastní čára (ta nahradí i holou vazbu mezi nimi), vztahy zůstávají.
      if (leziV) {
        const dite = s.podleId.get(a)?.leziV === b ? a : b;
        vysledek.push({ a: dite, b: dite === a ? b : a, vztah: null, leziV: true, obousmerny: false });
        continue;
      }
      if (smery.has(`${a}>${b}`) || smery.has(`${b}>${a}`)) continue;
      vysledek.push({ a, b, vztah: null, obousmerny: false, souhrn });
    }
    vysledek.push(...hranyOsy().map((h) => ({ ...h, vztah: null, obousmerny: false })));
    return vysledek;
  }

  function cestaHrany(h) {
    const p = poz(h.a);
    const q = poz(h.b);
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
    if (h.leziV) return `${a} leží v ${b}`;
    if (h.udalost) return `${h.udalost.text} (${h.udalost.datumText}) — ${b}`;
    if (h.souhrn) return `Přes místa uvnitř:\n${h.souhrn.map(([x, y]) => `${s.podleId.get(x)?.nazev ?? x} — ${s.podleId.get(y)?.nazev ?? y}`).join('\n')}`;
    if (!h.vztah) return `${a} — ${b} (vazba bez popisu)`;
    const v = h.vztah;
    return `${a} → ${b}: ${v.popis}${Number.isInteger(v.postoj) ? ` · postoj ${postojText(v.postoj)}` : ''}${s.pohled === 'dm' ? (v.verejne ? ' · družina zná' : ' · družina nezná') : ''}`;
  }

  /** Mřížka, kruhy a popisky os pod uzly (z rozložení). */
  function vykresliDekorace() {
    gMrizka.replaceChildren(...s.dekorace.map((d) => {
      if (d.druh === 'cara') return svg('line', { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2, class: d.trida });
      if (d.druh === 'kruh') return svg('circle', { cx: d.x, cy: d.y, r: d.r, class: d.trida });
      if (d.druh === 'pas') return svg('rect', { x: d.x, y: d.y, width: d.w, height: d.h, rx: 6, class: d.trida });
      if (d.druh === 'cesta') return svg('path', { d: d.body.map((b, i) => `${i ? 'L' : 'M'}${b.x},${b.y}`).join(' '), class: d.trida });
      const t = svg('text', { x: d.x, y: d.y, class: d.trida, 'text-anchor': d.kotva ?? 'middle' });
      t.textContent = d.text;
      return t;
    }));
  }

  function vykreslit() {
    if (!s.data) return;
    vykresliDekorace();
    plocha.classList.toggle('popisky-vse', POCITANA.has(s.rozlozeni));
    const hrany = hranyKVykresleni();
    gHrany.replaceChildren(
      ...hrany.map((h) => {
        const g = svg('g', { class: `hrana${h.leziV ? ' lezi-v' : ''}${h.souhrn ? ' souhrn' : ''}${h.udalost ? ' hrana-udalosti' : ''}${h.vztah ? ' vztah' : ''}${h.vztah && !Number.isInteger(h.vztah.postoj) ? ' bez-postoje' : ''}`, 'data-a': h.a, 'data-b': h.b });
        const d = cestaHrany(h);
        const cara = svg('path', { d, class: 'cara' });
        const barva = h.vztah ? barvaPostoje(h.vztah.postoj) : null;
        if (barva) cara.style.stroke = barva;
        // Široký neviditelný tah, ať jde na čáru najet myší a ukázat popis.
        const zachyt = svg('path', { d, class: 'zachyt' });
        const titul = svg('title');
        titul.textContent = popisHrany(h);
        g.append(cara, zachyt, titul);
        g.__h = h;
        return g;
      }),
    );
    defs.replaceChildren();
    const uzly = [];
    const deti = sbalovat() ? detiMist() : new Map();
    for (const e of s.data.entity) {
      const p = s.pozice.get(e.id);
      if (!p) continue;
      const r = s.polomery.get(e.id) ?? polomer(e, e.stupen);
      const velky = e.typ === 'postava' || e.typ === 'padouch' || e.stupen >= 7;
      const g = svg('g', {
        class: `uzel${velky ? ' velky' : ''}${e.aktualni ? ' ve-hre' : ''}${s.pohled === 'dm' && !e.verejne ? ' neverejny' : ''}${s.tlumene.has(e.id) ? ' mimo-osu' : ''}${s.zvyraznene.has(e.id) ? ' otevrene-vlakno' : ''}${s.vzdyPopisek.has(e.id) ? ' vzdy-popisek' : ''}`,
        transform: `translate(${p.x},${p.y})`,
        tabindex: 0,
        role: 'button',
        'data-id': e.id,
        'aria-label': `${e.nazev} (${TYPY[e.typ]?.j ?? e.typ})`,
      });
      g.style.setProperty('--c', barvaTypu(e.typ));
      g.append(svg('circle', { r: r + 9, class: 'kruh-oznaceni' }));
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
      const schovano = deti.has(e.id) && !s.rozbalena.has(e.id) ? potomku(e.id, deti) : 0;
      titul.textContent = `${e.nazev} · ${TYPY[e.typ]?.j ?? e.typ}${e.aktualni ? ' · ve hře' : ''}${schovano ? ` · uvnitř ${schovano} ${schovano === 1 ? 'místo' : schovano < 5 ? 'místa' : 'míst'}` : ''}`;
      g.append(titul);
      // Odznak podmíst: +N = sbalené (klik rozbalí), − = rozbalené (klik sbalí).
      if (deti.has(e.id)) {
        const o = svg('g', { class: `odznak-podmist${schovano ? '' : ' rozbalene'}`, transform: `translate(${Math.round(r * 0.8)},${-Math.round(r * 0.8)})`, role: 'button', 'aria-label': schovano ? `Rozbalit místa v ${e.nazev}` : `Sbalit místa v ${e.nazev}` });
        o.append(svg('circle', { r: 8 }));
        const t = svg('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' });
        t.textContent = schovano ? `+${schovano}` : '−';
        const ot = svg('title');
        ot.textContent = schovano ? `Rozbalit: ${schovano} ${schovano === 1 ? 'místo' : schovano < 5 ? 'místa' : 'míst'} uvnitř` : 'Sbalit místa uvnitř';
        o.append(t, ot);
        g.append(o);
      }
      uzly.push(g);
    }
    gUzly.replaceChildren(...uzly);
    vykresliOsu();
    vykresliPrepinace();
    // Málo uzlů (pohled družiny, nástěnka): popisky u všech.
    plocha.classList.toggle('malo-uzlu', uzly.length <= 40);
    for (const id of [...s.oznacene]) if (!s.pozice.has(id)) s.oznacene.delete(id);
    zvyraznit();
    vykreslitZoom();
    vykresliVyber();
    vykresliFokus();
  }

  /** Při tažení se jen posunou uzly a čáry, DOM se nestaví znovu. */
  function aktualizovatPozice() {
    for (const g of gUzly.children) {
      const p = s.pozice.get(g.dataset.id);
      if (p) g.setAttribute('transform', `translate(${p.x},${p.y})`);
    }
    for (const g of gHrany.children) {
      if (!g.__h) continue;
      const d = cestaHrany(g.__h);
      for (const cesta of g.querySelectorAll('path')) cesta.setAttribute('d', d);
    }
  }

  /* ---------- Výběr víc uzlů, přesun skupiny, Ctrl+Z ---------- */

  /** Zapamatuje si polohy uzlů před přesunem (Ctrl+Z je vrátí). */
  function zaznamenat(ids, druh = 'presun') {
    s.historie.push({ druh, cas: Date.now(), polozky: ids.map((id) => [id, s.pozice.has(id) ? { ...s.pozice.get(id) } : null, s.pevne.has(id) ? { ...s.pevne.get(id) } : null]) });
    if (s.historie.length > 40) s.historie.shift();
  }

  function vratit() {
    const krok = s.historie.pop();
    if (!krok) return toast('Není co vrátit.');
    for (const [id, poz, pev] of krok.polozky) {
      if (poz) s.pozice.set(id, poz);
      if (pev) s.pevne.set(id, pev);
      else s.pevne.delete(id);
    }
    aktualizovatPozice();
    ulozitPozice();
    toast('Přesun vrácen.');
  }

  /** Ručně posunuté uzly: celá mapa do prohlížeče, nástěnka čeká na Uložit rozložení. */
  function ulozitPozice() {
    if (s.nastenka) {
      if (!s.zmenyNastenky) {
        s.zmenyNastenky = true;
        vykresliNastenky();
      }
      return;
    }
    try {
      localStorage.setItem(KLIC_POZIC(s.pohled), JSON.stringify(Object.fromEntries([...s.pevne].map(([id, p]) => [id, { x: Math.round(p.x), y: Math.round(p.y) }]))));
    } catch {
      /* bez úložiště se rozložení jen nepamatuje */
    }
  }

  /** Nové polohy (Map id → {x, y}) a připnutí uzlů na ně. */
  function presunout(nove) {
    for (const [id, p] of nove) {
      s.pozice.set(id, p);
      if (!s.naOse.has(id)) s.pevne.set(id, p);
    }
    aktualizovatPozice();
    ulozitPozice();
  }

  /** Vybrané uzly seřazené podle typu a názvu (pro kruh a mřížku). */
  const serazeneOznacene = () => [...s.oznacene].filter((id) => s.pozice.has(id)).sort((a, b) => {
    const ea = s.podleId.get(a);
    const eb = s.podleId.get(b);
    const ta = Object.keys(TYPY).indexOf(ea?.typ);
    const tb = Object.keys(TYPY).indexOf(eb?.typ);
    return ta - tb || (ea?.nazev ?? a).localeCompare(eb?.nazev ?? b, 'cs');
  });

  /** Vybrané uzly rozmístí síla vazeb, ostatní zůstanou na místě. */
  function rozmistitVybrane() {
    const ids = serazeneOznacene();
    if (!ids.length) return;
    zaznamenat(ids);
    const vyber = new Set(ids);
    const uzly = s.data.entity.filter((e) => s.pozice.has(e.id)).map((e) => ({ id: e.id, typ: e.typ, obrazek: e.obrazek, r: polomer(e, e.stupen) }));
    const hrany = vsechnyDvojice().filter(([a, b]) => s.pozice.has(a) && s.pozice.has(b)).map(([a, b]) => (jeLeziV(a, b) ? [a, b, 'lezi_v'] : [a, b]));
    const ostatni = new Map([...s.pozice].filter(([id]) => !vyber.has(id)));
    const vysledek = rozlozit(uzly, hrany, { pevne: ostatni, start: ostatni, iterace: 200 });
    presunout(new Map(ids.map((id) => [id, vysledek.get(id)])));
  }

  function uvolnitVybrane() {
    const ids = [...s.oznacene];
    zaznamenat(ids);
    for (const id of ids) s.pevne.delete(id);
    ulozitPozice();
    s.klicSite = null;
    prepocitat();
    toast('Vybrané uzly jsou volné, mapa je rozmístí sama.');
  }

  function nastavitFokus(ids) {
    if (!ids?.size) {
      s.fokus = null;
    } else {
      const okoli = new Set();
      for (const [a, b] of vsechnyDvojice()) {
        if (ids.has(a)) okoli.add(b);
        if (ids.has(b)) okoli.add(a);
      }
      s.fokus = { ids: new Set(ids), okoli };
    }
    prepocitat();
    priblizitNa(null);
  }

  function vykresliFokus() {
    const kam = $('#kanon-fokus');
    if (!s.fokus) {
      kam.hidden = true;
      return;
    }
    kam.hidden = false;
    const jmena = [...s.fokus.ids].map((id) => s.podleId.get(id)?.nazev).filter(Boolean);
    nahradit(kam,
      el('span', { textContent: `Jen ${jmena.length === 1 ? jmena[0] : `${jmena.length} vybraných`} a okolí · ${s.pozice.size} na mapě` }),
      el('button', { type: 'button', className: 'mala', textContent: 'Celá mapa', onclick: () => nastavitFokus(null) }));
  }

  async function hromadne(zmena, popis) {
    const ids = [...s.oznacene];
    if (zmena.verejne === true && !confirm(`Družina bude znát ${ids.length} karet (uvidí jejich název, obrázek, odkryté odrážky Co ví družina a známé vztahy). Pokračovat?`)) return;
    try {
      const r = await api('/api/kanon/hromadne', { metoda: 'POST', telo: { ids, ...zmena } });
      const zbytek = ids.length - r.zmeneno - r.chyby.length;
      toast(`${popis}: změněno ${r.zmeneno}${zbytek > 0 ? `, ${zbytek} už to mělo` : ''}${r.odlozeno ? `, ${r.odlozeno} čeká na zápis` : ''}${r.chyby.length ? `, chyby: ${r.chyby.map((c) => c.id).join(', ')}` : ''}.`, { chyba: r.chyby.length > 0 });
      await nacist();
    } catch (chyba) {
      toast(chyba.message, { chyba: true });
    }
  }

  function zrusitOznaceni() {
    s.oznacene.clear();
    zvyraznit();
    vykresliVyber();
  }

  /** Lišta nad mapou, když je vybraný aspoň jeden uzel (Shift). */
  function vykresliVyber() {
    const kam = $('#kanon-vyber');
    const n = s.oznacene.size;
    if (!n) {
      kam.hidden = true;
      return;
    }
    kam.hidden = false;
    const tl = (text, titul, akce, trida = 'mala') => el('button', { type: 'button', className: trida, textContent: text, title: titul, onclick: akce });
    const upravy = s.pohled === 'dm' && !s.jenCteni;
    nahradit(kam,
      el('strong', { textContent: n === 1 ? '1 vybraný' : n < 5 ? `${n} vybrané` : `${n} vybraných` }),
      el('span', { className: 'skupina-vyberu' },
        tl('Kruh', 'Rozmístit vybrané do kruhu', () => {
          const ids = serazeneOznacene();
          zaznamenat(ids);
          presunout(doKruhu(ids, s.pozice));
        }),
        tl('Mřížka', 'Seřadit vybrané do mřížky (podle typu a názvu)', () => {
          const ids = serazeneOznacene();
          zaznamenat(ids);
          presunout(doMrizky(ids, s.pozice));
        }),
        tl('Rozmístit', 'Vybrané rozmístí podle vazeb, ostatní zůstanou na místě', rozmistitVybrane),
        tl('Uvolnit', 'Zapomenout ruční polohu vybraných, mapa je rozmístí sama', uvolnitVybrane)),
      el('span', { className: 'skupina-vyberu' },
        tl('Jen tyto a okolí', 'Ukázat jen vybrané a to, co s nimi souvisí', () => nastavitFokus(new Set(s.oznacene))),
        s.jenCteni ? null : tl('Nástěnka z výběru', 'Uložit vybrané jako nástěnku jen s nimi', () => otevritNastenku(new Set(s.oznacene)))),
      upravy ? el('span', { className: 'skupina-vyberu' },
        el('span', { className: 'popisek-vyberu', textContent: 'Ve hře' }),
        tl('✓', 'Označit vybrané jako Ve hře', () => hromadne({ aktualni: true }, 'Ve hře')),
        tl('✗', 'Odebrat vybraným Ve hře', () => hromadne({ aktualni: false }, 'Ve hře odebráno')),
        el('span', { className: 'popisek-vyberu', textContent: 'Družina zná' }),
        tl('✓', 'Družina zná vybrané karty', () => hromadne({ verejne: true }, 'Družina zná')),
        tl('✗', 'Vybrané karty jen pro DM', () => hromadne({ verejne: false }, 'Jen pro DM'))) : null,
      tl('×', 'Zrušit výběr (Esc)', zrusitOznaceni, 'mala tiche'));
  }

  /** Vybraná entita ztlumí vše kromě okolí; hledání v liště zvýrazní nalezené uzly. */
  function zvyraznit() {
    const okoli = new Set();
    const aktivni = s.vybrane ?? (s.udalostMapy ? `u:${s.udalostMapy}` : null);
    if (s.vybrane) {
      okoli.add(s.vybrane);
      for (const { a, b } of dvojiceNaMape()) {
        if (a === s.vybrane) okoli.add(b);
        if (b === s.vybrane) okoli.add(a);
      }
    }
    for (const h of hranyOsy()) {
      if (h.b === s.vybrane) okoli.add(h.a);
      if (h.a === aktivni) okoli.add(h.b);
    }
    const nalezy = new Set(s.dotaz ? hledat(s.data?.entity ?? [], s.dotaz, 50).map((e) => zast(e.id)) : []);
    const tlumit = Boolean(aktivni) || nalezy.size > 0 || Boolean(s.dotaz);
    vrstva.classList.toggle('ztlumeno', tlumit);
    for (const g of gUzly.children) {
      const id = g.dataset.id;
      g.classList.toggle('vybrany', id === s.vybrane);
      g.classList.toggle('okoli', okoli.has(id));
      g.classList.toggle('nalez', nalezy.has(id));
      g.classList.toggle('oznaceny', s.oznacene.has(id));
    }
    for (const g of gOsa.querySelectorAll('.uzel-udalosti')) {
      g.classList.toggle('vybrany', g.dataset.id === aktivni);
      g.classList.toggle('okoli', okoli.has(g.dataset.id));
    }
    for (const g of gHrany.children) {
      const sv = aktivni && (g.dataset.a === aktivni || g.dataset.b === aktivni);
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
    const body = [...(ids ?? [...s.pozice.keys(), ...s.poziceOsy.keys()])].map(poz).filter(Boolean);
    // Celá mapa: i popisky řádků, sloupců a kruhy rozložení.
    if (!ids) {
      for (const d of s.dekorace) {
        if (d.druh === 'text') body.push({ x: d.x - (d.kotva === 'start' ? -60 : 0), y: d.y });
        else if (d.druh === 'kruh' && d.r > 10) body.push({ x: d.x - d.r, y: d.y - d.r }, { x: d.x + d.r, y: d.y + d.r });
        else if (d.druh === 'pas') body.push({ x: d.x, y: d.y }, { x: d.x + d.w, y: d.y + d.h });
      }
    }
    if (!body.length) return;
    const [w, h] = rozmer();
    const x0 = Math.min(...body.map((p) => p.x)) - 70;
    const x1 = Math.max(...body.map((p) => p.x)) + 70;
    const y0 = Math.min(...body.map((p) => p.y)) - 50;
    // Pod časovou osou jsou popisky událostí a přes spodek plátna legenda.
    const y1 = Math.max(...body.map((p) => p.y)) + (s.poziceOsy.size ? 110 : 70);
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
  $('#kanon-znovu').addEventListener('click', () => {
    if (s.pevne.size && !confirm(`Zapomenout ručně posunuté uzly (${s.pevne.size}) a rozmístit mapu znovu? Ctrl+Z to vrátí.`)) return;
    zaznamenat([...s.pevne.keys()]);
    s.pevne = new Map();
    s.pozice = new Map();
    s.poziceSite = new Map();
    ulozitPozice();
    prepocitat();
    priblizitNa(null);
  });

  // Tažení: pozadí posouvá mapu, uzel posouvá uzel (vybraný uzel celou skupinu), Shift + pozadí
  // vybírá obdélníkem, Shift + klik přidá nebo odebere uzel z výběru, Alt + uzel natahuje vazbu.
  let tah = null;
  plocha.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const odznak = e.target.closest('.odznak-podmist');
    if (odznak) {
      e.preventDefault();
      prepnoutPodmista(odznak.closest('.uzel').dataset.id);
      return;
    }
    const uzel = e.target.closest('.uzel');
    plocha.setPointerCapture(e.pointerId);
    const udalost = e.target.closest('.uzel-udalosti');
    if (udalost && !e.shiftKey) {
      tah = { druh: 'plocha', x0: e.clientX, y0: e.clientY, z: { ...s.zoom }, posunuto: false, udalost: udalost.dataset.id.slice(2) };
      return;
    }
    if (uzel && e.altKey && s.pohled === 'dm' && !s.jenCteni) {
      e.preventDefault();
      tah = { druh: 'vazba', id: uzel.dataset.id, x0: e.clientX, y0: e.clientY };
      const p = s.pozice.get(tah.id);
      tah.cara = svg('line', { class: 'nova-vazba', x1: p.x, y1: p.y, x2: p.x, y2: p.y });
      gDocasna.replaceChildren(tah.cara);
    } else if (uzel) {
      const id = uzel.dataset.id;
      let pridan = false;
      if (e.shiftKey && !s.oznacene.has(id)) {
        // Shift na prvním uzlu: do výběru i uzel, jehož karta je otevřená.
        if (!s.oznacene.size && s.vybrane && s.vybrane !== id && s.pozice.has(s.vybrane)) s.oznacene.add(s.vybrane);
        s.oznacene.add(id);
        pridan = true;
        zvyraznit();
        vykresliVyber();
      }
      const skupina = s.oznacene.has(id) && s.oznacene.size > 1 ? [...s.oznacene].filter((x) => s.pozice.has(x)) : [id];
      tah = { druh: 'uzel', id, skupina, start: new Map(skupina.map((x) => [x, { ...s.pozice.get(x) }])), m0: doMapy(e.clientX, e.clientY), x0: e.clientX, y0: e.clientY, posunuto: false, shift: e.shiftKey, pridan };
    } else if (e.shiftKey) {
      tah = { druh: 'obdelnik', m0: doMapy(e.clientX, e.clientY), x0: e.clientX, y0: e.clientY, posunuto: false, rect: svg('rect', { class: 'vyber-obdelnik' }) };
      gDocasna.replaceChildren(tah.rect);
    } else {
      tah = { druh: 'plocha', x0: e.clientX, y0: e.clientY, z: { ...s.zoom }, posunuto: false };
    }
  });
  plocha.addEventListener('pointermove', (e) => {
    if (!tah) return;
    const dx = e.clientX - tah.x0;
    const dy = e.clientY - tah.y0;
    if (!tah.posunuto && Math.hypot(dx, dy) > 3) {
      tah.posunuto = true;
      if (tah.druh === 'uzel') zaznamenat(tah.skupina);
    }
    if (tah.druh === 'plocha' && tah.posunuto) {
      s.zoom = { ...tah.z, x: tah.z.x + dx, y: tah.z.y + dy };
      vykreslitZoom();
    } else if (tah.druh === 'uzel' && tah.posunuto) {
      const m = doMapy(e.clientX, e.clientY);
      const ox = m.x - tah.m0.x;
      const oy = m.y - tah.m0.y;
      for (const [id, p] of tah.start) {
        const nova = { x: p.x + ox, y: p.y + oy };
        s.pozice.set(id, nova);
        // Hráčský kánon na časové ose patří ke své události, jeho poloha se nepamatuje.
        if (!s.naOse.has(id)) s.pevne.set(id, nova);
      }
      aktualizovatPozice();
    } else if (tah.druh === 'obdelnik') {
      const m = doMapy(e.clientX, e.clientY);
      tah.rect.setAttribute('x', Math.min(m.x, tah.m0.x));
      tah.rect.setAttribute('y', Math.min(m.y, tah.m0.y));
      tah.rect.setAttribute('width', Math.abs(m.x - tah.m0.x));
      tah.rect.setAttribute('height', Math.abs(m.y - tah.m0.y));
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
    if (t.druh === 'obdelnik') {
      gDocasna.replaceChildren();
      if (t.posunuto) {
        for (const id of vObdelniku(s.pozice, t.m0, doMapy(e.clientX, e.clientY))) s.oznacene.add(id);
        zvyraznit();
        vykresliVyber();
      }
      return;
    }
    if (t.druh === 'uzel' && t.posunuto) {
      ulozitPozice();
      return;
    }
    if (t.posunuto) return;
    if (t.druh === 'uzel' && t.shift) {
      if (!t.pridan) s.oznacene.delete(t.id);
      zvyraznit();
      vykresliVyber();
      return;
    }
    if (s.oznacene.size) zrusitOznaceni();
    if (t.udalost) vybratUdalost(t.udalost === s.udalostMapy ? null : t.udalost);
    else if (t.druh === 'uzel') vybrat(t.id === s.vybrane ? null : t.id);
    else vybrat(null);
  };
  plocha.addEventListener('pointerup', konecTahu);
  plocha.addEventListener('pointercancel', () => {
    tah = null;
    gDocasna.replaceChildren();
  });

  // Klávesy na mapě: Ctrl+A vybere vše, Ctrl+Z vrátí přesun, šipky posunou výběr.
  document.addEventListener('keydown', (e) => {
    if (!s.viditelna || s.rezim !== 'mapa' || document.querySelector('dialog[open]')) return;
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t?.isContentEditable) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      for (const id of s.pozice.keys()) s.oznacene.add(id);
      zvyraznit();
      vykresliVyber();
    } else if (ctrl && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      vratit();
    } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && !ctrl) {
      const ids = s.oznacene.size ? [...s.oznacene] : s.vybrane && s.pozice.has(s.vybrane) ? [s.vybrane] : [];
      if (!ids.length) return;
      e.preventDefault();
      const krok = (e.shiftKey ? 40 : 8) / s.zoom.k;
      const dx = e.key === 'ArrowLeft' ? -krok : e.key === 'ArrowRight' ? krok : 0;
      const dy = e.key === 'ArrowUp' ? -krok : e.key === 'ArrowDown' ? krok : 0;
      // Opakované šipky během 1 s jsou pro Ctrl+Z jeden krok.
      const posledni = s.historie.at(-1);
      if (!(posledni?.druh === 'sipky' && Date.now() - posledni.cas < 1000)) zaznamenat(ids, 'sipky');
      else posledni.cas = Date.now();
      presunout(new Map(ids.map((id) => [id, { x: s.pozice.get(id).x + dx, y: s.pozice.get(id).y + dy }])));
    }
  });

  plocha.addEventListener('keydown', (e) => {
    const uzel = e.target.closest?.('.uzel');
    if (uzel && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      vybrat(uzel.dataset.id);
    }
    const udalost = e.target.closest?.('.uzel-udalosti');
    if (udalost && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      vybratUdalost(udalost.dataset.id.slice(2));
    }
  });

  async function zalozitVazbu(od, k) {
    const a = s.podleId.get(od);
    const b = s.podleId.get(k);
    const uzMa = a?.vazby.includes(k);
    try {
      const r = await api(`/api/kanon/entita/${encodeURIComponent(od)}/vazby`, { metoda: 'POST', telo: { cil: k } });
      karta.hlasitZapis(r, uzMa ? `${a?.nazev ?? od} už má vazbu na ${b?.nazev ?? k}: uprav popis vztahu.` : `Vazba ${a?.nazev ?? od} → ${b?.nazev ?? k} založena. Doplň popis vztahu, nebo ji nech bez něj.`);
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
    if (!s.nastenka) {
      s.pevne = nacistPozice(s.pohled);
      s.pozice = new Map();
      s.poziceSite = new Map();
    }
    s.oznacene.clear();
    s.fokus = null;
    s.historie = [];
    ulozit();
    s.prvniPriblizeni = true;
    nacist();
  }

  function vykresliNastenky() {
    const vyber = $('#kanon-nastenka');
    const nastenky = s.data?.nastenky ?? [];
    vyber.replaceChildren(new Option('Celá mapa (automaticky)', ''), ...nastenky.map((n) => new Option(`${n.nazev}${n.pohled === 'druzina' ? ' · družina' : ''}`, n.id)));
    vyber.value = s.nastenka?.id ?? '';
    const tlacitko = $('#kanon-ulozit');
    tlacitko.textContent = s.zmenyNastenky ? 'Uložit rozložení •' : 'Uložit rozložení';
    tlacitko.title = s.zmenyNastenky ? `V nástěnce ${s.nastenka?.nazev ?? ''} jsou neuložené přesuny` : 'Uloží pozice uzlů jako nástěnku v kampan/nastenky/';
  }

  $('#kanon-nastenka').addEventListener('change', async (e) => {
    const id = e.target.value;
    if (!id) return zrusitNastenku(true);
    try {
      const n = await api(`/api/kanon/nastenky/${encodeURIComponent(id)}`);
      s.nastenka = n;
      s.zmenyNastenky = false;
      s.historie = [];
      s.pevne = new Map(n.entity.map((x) => [x.id, { x: x.x, y: x.y }]));
      s.pozice = new Map(s.pevne);
      s.poziceSite = new Map(s.pevne);
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
    s.zmenyNastenky = false;
    s.historie = [];
    s.pevne = nacistPozice(s.pohled);
    if (prekreslit) {
      s.pozice = new Map();
      s.poziceSite = new Map();
      prepocitat();
      priblizitNa(null);
    }
    vykresliNastenky();
  }

  if (jenCteni) $('#kanon-ulozit').hidden = true;
  $('#kanon-ulozit').addEventListener('click', () => otevritNastenku(null));
  /** Dialog Uložit rozložení; jen = Set id (Nástěnka z výběru) nebo null (vše na mapě). */
  function otevritNastenku(jen) {
    s.ulozitJen = jen;
    const d = $('#dialog-nastenka');
    $('#nastenka-nazev').value = jen ? '' : s.nastenka?.nazev ?? '';
    $('#nastenka-jen').checked = jen ? true : s.nastenka ? s.nastenka.jen_tyto : false;
    $('#nastenka-prepsat').hidden = !s.nastenka || Boolean(jen);
    $('#nastenka-prepsat').textContent = s.nastenka ? `Uložit do „${s.nastenka.nazev}“` : '';
    $('#nastenka-chyba').textContent = '';
    $('#nastenka-smazat').hidden = !s.nastenka || Boolean(jen);
    $('#nastenka-nova').className = s.nastenka && !jen ? '' : 'hlavni';
    $('#nastenka-popis').textContent = jen
      ? `Uloží jen ${jen.size} vybraných entit a jejich pozice v pohledu ${s.pohled === 'druzina' ? 'družiny' : 'DM'}.`
      : `Uloží pozice ${s.pozice.size} entit na mapě v pohledu ${s.pohled === 'druzina' ? 'družiny' : 'DM'}. Nové entity, které nástěnka nezná, mapa rozmístí sama.`;
    d.showModal();
    $('#nastenka-nazev').focus();
  }

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
        entity: [...s.pozice].filter(([id]) => !s.ulozitJen || s.ulozitJen.has(id)).map(([id, p]) => ({ id, x: Math.round(p.x), y: Math.round(p.y) })),
      };
      const r = akce === 'prepsat' && s.nastenka
        ? await api(`/api/kanon/nastenky/${encodeURIComponent(s.nastenka.id)}`, { metoda: 'PUT', telo })
        : await api('/api/kanon/nastenky', { metoda: 'POST', telo });
      s.nastenka = r.nastenka;
      s.zmenyNastenky = false;
      s.ulozitJen = null;
      s.fokus = null;
      s.pevne = new Map(r.nastenka.entity.map((x) => [x.id, { x: x.x, y: x.y }]));
      if (r.nastenka.jen_tyto) prepocitat();
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
    s.udalostMapy = null;
    s.uprava = null;
    s.pridavani = false;
    if (id) {
      const e = s.podleId.get(id);
      let zmena = sbalovat() && odkrytPredky(id);
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
      if (s.karta?.id !== id) s.karta = null;
      vykresliKartu();
      nacistKartu(id);
      if (priblizit) {
        const okoli = [id, ...dvojiceNaMape().filter((d) => d.a === id || d.b === id).map((d) => (d.a === id ? d.b : d.a))];
        priblizitNa(okoli);
      }
    } else {
      s.karta = null;
      zvyraznit();
      vykresliKartu();
    }
    const hash = id ? `#kanon/mapa/${encodeURIComponent(id)}` : '#kanon/mapa';
    if (location.hash !== hash) history.replaceState(null, '', hash);
  }

  async function nacistKartu(id) {
    try {
      const k = await api(`/api/kanon/entita/${encodeURIComponent(id)}?pohled=${s.pohled}`);
      if (s.vybrane !== id) return;
      s.karta = k;
      ctx.prekreslit();
    } catch (chyba) {
      if (s.vybrane === id) toast(chyba.message, { chyba: true });
    }
  }

  /* ---------- Karta na mapě: přehled entity, vztahy, odkaz do wiki ---------- */

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
    const druzina = s.pohled === 'druzina';
    nahradit(kartaEl,
      el('h2', { className: 'karta-nazev', textContent: druzina ? 'Co ví družina' : 'Mapa kánonu' }),
      el('p', { className: 'uvod', textContent: druzina
        ? `${entity.length} entit, které družina zná, a jen vztahy, které zná.`
        : `${entity.length} entit a ${vsechnyDvojice().length} vazeb. Barva uzlu je typ, barva čáry postoj vztahu.` }),
      el('h3', { textContent: 'Počty' }),
      el('div', { className: 'pocty-kanonu' }, pocty),
      el('h3', { textContent: 'Ovládání' }),
      el('ul', { className: 'napoveda-kanonu' },
        el('li', { textContent: 'Klik na uzel vybere entitu, Esc výběr zruší.' }),
        el('li', { textContent: 'Tažením posuneš uzel nebo celou mapu, kolečkem přiblížíš.' }),
        el('li', {}, el('kbd', { textContent: 'Shift' }), ' + klik přidá uzel do výběru, ', el('kbd', { textContent: 'Shift' }), ' + tažení po ploše vybere obdélníkem, ', el('kbd', { textContent: 'Ctrl+A' }), ' vše. Tažením vybraného uzlu posuneš celý výběr, šipky ho posunou o kousek, ', el('kbd', { textContent: 'Ctrl+Z' }), ' vrátí přesun.'),
        el('li', { textContent: 'Ručně posunuté uzly si mapa pamatuje; Rozmístit znovu je zapomene.' }),
        el('li', { textContent: 'Místa uvnitř jiných míst jsou schovaná v nadřazeném místě: odznak +N na uzlu je rozbalí, − zase sbalí. Čárkovaná čára vede přes schovaná místa.' }),
        el('li', { textContent: 'Rozložit podle mění, co určuje polohu uzlů: síť vazeb, čas (s místy nahoře), tabulky Kdy a kde a Kdo a kdy, kruhy blízkosti k družině, postoj, co družina ví, zapomenutá vlákna nebo mosty. Mimo síť a čas se tažení nepamatuje.' }),
        druzina || s.jenCteni ? null : el('li', {}, el('kbd', { textContent: 'Alt' }), ' + tažení z uzlu na uzel založí vazbu a otevře popis vztahu.'),
        el('li', { textContent: 'Celou kartu s textem otevře Wiki.' }),
      ),
    );
  }

  /** Karta vybrané události na časové ose. */
  function kartaUdalosti() {
    const u = udalostiOsy().find((x) => x.id === s.udalostMapy);
    if (!u) return prehledKarty();
    const vazby = u.vazby.map((id) => s.podleId.get(id)).filter(Boolean);
    const polozka = (e) => {
      const li = el('li', {}, el('span', { className: 'tecka' }), el('button', { type: 'button', className: 'odkaz-entity-mapa', textContent: e.nazev, onclick: () => vybrat(e.id) }), el('small', { textContent: TYPY[e.typ]?.j ?? e.typ }));
      li.style.setProperty('--c', barvaTypu(e.typ));
      return li;
    };
    const rozhodnuto = vazby.filter((e) => e.typ === 'kanon');
    const ostatni = vazby.filter((e) => e.typ !== 'kanon');
    nahradit(kartaEl,
      el('button', { type: 'button', className: 'zpet', textContent: '← Přehled', onclick: () => vybratUdalost(null) }),
      el('h2', { className: 'karta-nazev', textContent: u.text }),
      el('p', { className: 'udalost-meta' }, el('span', { className: 'udalost-datum', textContent: `${u.konecText ? `${u.datumText} – ${u.konecText}` : u.datumText}${u.vDniPocet > 1 ? ` · ${u.vDni}. z ${u.vDniPocet}` : ''}` })),
      el('div', { className: 'akce-karty' }, el('a', { className: 'tlacitko hlavni', href: `#kanon/udalost/${encodeURIComponent(u.id)}`, textContent: 'Otevřít událost' })),
      el('h3', { textContent: 'Co se stalo a rozhodlo' }),
      rozhodnuto.length ? el('ul', { className: 'seznam-udalosti-mapy' }, rozhodnuto.map(polozka)) : el('p', { className: 'poznamka', textContent: 'Zatím nic.' }),
      el('h3', { textContent: 'Kdo a kde' }),
      ostatni.length ? el('ul', { className: 'seznam-udalosti-mapy' }, ostatni.map(polozka)) : el('p', { className: 'poznamka', textContent: 'Zatím nic.' }));
  }

  function vykresliKartu() {
    if (!s.vybrane && s.udalostMapy) return kartaUdalosti();
    if (!s.vybrane) return prehledKarty();
    const e = s.podleId.get(s.vybrane);
    const k = s.karta;
    if (!e) return prehledKarty();
    const dm = s.pohled === 'dm';
    const stitky = [stitekTypu(e.typ)];
    if (e.udaje?.stav) stitky.push(el('span', { className: `stitek-stavu ${e.udaje.stav}`, textContent: STAVY[e.udaje.stav] ?? e.udaje.stav }));
    const casti = [
      el('button', { type: 'button', className: 'zpet', textContent: '← Přehled', onclick: () => vybrat(null) }),
      karta.cestaMista(e),
      el('div', { className: 'hlava-karty' }, obrazekEntity(e), el('div', {}, el('h2', { className: 'karta-nazev', textContent: e.nazev }), el('div', { className: 'stitky-karty' }, stitky))),
      e.popis ? el('p', { className: 'popis-karty', textContent: e.popis }) : null,
      el('div', { className: 'akce-karty' },
        el('a', { className: 'tlacitko hlavni', href: `#kanon/${encodeURIComponent(e.id)}`, textContent: 'Otevřít kartu' }),
        el('button', { type: 'button', textContent: 'Jen okolí', title: 'Ukázat na mapě jen tuto entitu a to, co s ní souvisí', onclick: () => nastavitFokus(new Set([e.id])) }),
        sbalovat() && detiMist().has(e.id) ? el('button', { type: 'button', textContent: s.rozbalena.has(e.id) ? 'Sbalit místa uvnitř' : 'Rozbalit místa uvnitř', onclick: () => prepnoutPodmista(e.id) }) : null,
        karta.tlacitkoPoznamky(e),
        karta.tlacitkoObs(e)),
      dm && (!s.jenCteni || s.webUpravy) ? karta.prepinace(e) : null,
    ];
    if (!k) {
      casti.push(el('p', { className: 'uvod', textContent: 'Načítám kartu…' }));
      nahradit(kartaEl, ...casti);
      return;
    }
    if (e.typ === 'misto') casti.push(...karta.sekceMista(e));
    const pocet = new Set([...k.vztahy.map((v) => v.s), ...k.vazby]).size;
    casti.push(el('div', { className: 'sekce-hlava' }, el('h3', { textContent: `Vztahy a vazby (${pocet})` }), dm && !s.jenCteni ? karta.pridatVazbuUI(k) : null));
    const radky = karta.seznamVztahu(k);
    casti.push(radky.length ? el('ul', { className: 'vztahy-karty' }, radky) : el('p', { className: 'poznamka', textContent: !dm ? 'Družina o žádném vztahu neví.' : s.jenCteni ? 'Zatím bez vazeb.' : 'Zatím bez vazeb. Přidej ji tlačítkem, nebo Alt + tažením na mapě.' }));
    casti.push(karta.zpetneOdkazy(k, e.nazev));
    nahradit(kartaEl, ...casti);
  }

  /* ---------- Veřejné rozhraní pro app.js ---------- */

  const dekodovat = (x) => {
    try {
      return decodeURIComponent(x);
    } catch {
      return '';
    }
  };

  return {
    /**
     * Obrazovka Kánon se ukázala. cesta je část adresy za #kanon/:
     * '' přehled wiki, '<id>' stránka entity, '<id>/upravit' editor, '<id>/list' List postavy, 'typ/<typ>', 'udalosti',
     * 'udalost/<id>', 'mapa' nebo 'mapa/<id>'.
     */
    async ukazat(cesta = '') {
      s.viditelna = true;
      if (!s.data) await nacist();
      const casti = String(cesta).split('/').filter((x, i) => x || i === 0).map(dekodovat);
      if (casti[0] === 'mapa') {
        await wiki.opustit();
        prepnoutRezim('mapa');
        const id = casti[1] || null;
        if (id !== s.vybrane || !s.karta) vybrat(id, { priblizit: Boolean(id) });
        else vykresliKartu();
        return;
      }
      prepnoutRezim('wiki');
      await wiki.ukazat(casti);
    },
    async skryt() {
      s.viditelna = false;
      await wiki.opustit();
    },
    /** Živá změna ze serveru (událost „kanon“). */
    zmena(data) {
      if (!s.data || data?.verze === s.data.verze) return;
      if (wiki.upravuje()) return; // editor si změny pohlídá sám (kontrola souběžné úpravy)
      nacist();
    },
    /** Je otevřený editor karty? (čtecí verze kvůli němu odloží načtení nové verze) */
    upravuje: () => wiki.upravuje(),
    /** Hledání v liště: na mapě zvýrazní uzly, vrátí výsledky. */
    async hledat(dotaz) {
      if (!s.data) await nacist();
      s.dotaz = dotaz;
      if (s.data && s.rezim === 'mapa') zvyraznit();
      return s.data ? hledat(s.data.entity, dotaz, 8).map((e) => ({ ...e, typText: TYPY[e.typ]?.j ?? e.typ, barva: barvaTypu(e.typ) })) : [];
    },
    /** Adresa entity: na mapě zůstane mapa, jinak stránka wiki. */
    adresa(id) {
      return s.viditelna && s.rezim === 'mapa' ? `kanon/mapa/${encodeURIComponent(id)}` : `kanon/${encodeURIComponent(id)}`;
    },
    vybrat: (id) => otevritEntitu(id),
    /** Esc na obrazovce Kánon. */
    zrusitVyber() {
      if (s.uprava || s.pridavani) {
        s.uprava = null;
        s.pridavani = false;
        ctx.prekreslit();
      } else if (s.rezim === 'mapa' && s.oznacene.size) zrusitOznaceni();
      else if (s.rezim === 'mapa' && s.vybrane) vybrat(null);
      else if (s.rezim === 'mapa' && s.udalostMapy) vybratUdalost(null);
    },
    /** Text pro F2 poznámku, když je vybraná entita (odkaz [[id]]). */
    odkazProPoznamku() {
      return s.viditelna && s.vybrane && s.pohled === 'dm' ? `[[${s.vybrane}]] ` : '';
    },
    escapovat,
    proHledani,
  };
}
