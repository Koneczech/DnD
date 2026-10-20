// Společné části modulu Kánon: typy, barvy, tvorba prvků a části karty (vztahy, přezdívky,
// přepínače, ilustrace), které používá wiki i karta na mapě.
import { hledat } from '/sdilene/sit.js';

export const $ = (sel, koren = document) => koren.querySelector(sel);

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
export const POSTOJE = { '-3': 'nepřítel', '-2': 'nepřátelský', '-1': 'chladný', 0: 'neutrální', 1: 'vlídný', 2: 'přátelský', 3: 'blízký' };
export const UDAJE = { hrac: 'Hráč', druh: 'Druh', povolani: 'Povolání', stav: 'Stav', oblast: 'Oblast', zaznamenano: 'Zaznamenáno', sezeni: 'Sezení', cislo: 'Číslo', kdo: 'Kdo', doresit: 'Dořešit' };
export const STAVY = { otevrene: 'otevřené', rozhodnuto: 'rozhodnuto', zavrzeno: 'zavrženo' };
export const barvaTypu = (t) => `var(--t-${TYPY[t] ? t : 'npc'})`;
export const barvaPostoje = (p) => (Number.isInteger(p) ? `var(--postoj-${p < 0 ? `m${-p}` : p})` : null);
export const postojText = (p) => (Number.isInteger(p) ? `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)} ${POSTOJE[p]}` : '');
const SVG = 'http://www.w3.org/2000/svg';

export function el(tag, vlastnosti = {}, ...deti) {
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
export const nahradit = (kam, ...deti) => kam.replaceChildren(...deti.flat().filter((d) => d !== null && d !== undefined && d !== false));
export function svg(tag, atributy = {}) {
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
export function vyrezHlavy(url) {
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
      // Čtecí verze bere obrázky jen pro DM z raw.githubusercontent.com: bez CORS by plátno nešlo číst.
      obr.crossOrigin = 'anonymous';
      obr.src = url;
    }));
  }
  return vyrezy.get(url);
}

/** Výřez hlavy na <img> uvnitř čtvercového rámečku s overflow: hidden. */
export function oriznoutPortret(img, url) {
  vyrezHlavy(url).then((v) => {
    if (!v) return;
    img.classList.add('vyrez');
    img.style.width = `${100 / v.s}%`;
    img.style.left = `${(-v.x / v.s) * 100}%`;
    img.style.top = `${((-v.y * v.pomer) / v.s) * 100}%`;
  });
  return img;
}

/** Čtvercový obrázek entity (portrét oříznutý na hlavu), nebo ikona. */
export function obrazekEntity(e, trida = 'ikona-karty') {
  const ram = e.obrazek
    ? el('div', { className: `${trida} s-obrazem vyrez-portretu` }, e.portret ? oriznoutPortret(el('img', { src: e.obrazek, alt: '', loading: 'lazy' }), e.obrazek) : el('img', { src: e.obrazek, alt: '', loading: 'lazy' }))
    : el('div', { className: trida, textContent: e.ikona || '·' });
  ram.style.setProperty('--c', barvaTypu(e.typ));
  return ram;
}

export function stitekTypu(typ) {
  const t = el('span', { className: 'stitek-typu', textContent: TYPY[typ]?.j ?? typ });
  t.style.setProperty('--c', barvaTypu(typ));
  return t;
}

/**
 * Místa jako strom pro výběry: nadřazené místo, pod ním jeho podmísta (podle názvu).
 * Místo, jehož rodič v seznamu není, je nahoře.
 * @param {Array<{id: string, nazev: string, leziV?: string|null}>} mista
 * @returns {Array<{m: object, hloubka: number}>}
 */
export function stromMist(mista) {
  const ids = new Set(mista.map((m) => m.id));
  const podle = (a, b) => a.nazev.localeCompare(b.nazev, 'cs');
  const vysledek = [];
  const videno = new Set();
  const pridat = (m, hloubka) => {
    if (videno.has(m.id)) return;
    videno.add(m.id);
    vysledek.push({ m, hloubka });
    for (const d of mista.filter((x) => x.leziV === m.id).sort(podle)) pridat(d, hloubka + 1);
  };
  for (const m of mista.filter((x) => !x.leziV || !ids.has(x.leziV)).sort(podle)) pridat(m, 0);
  for (const m of mista) if (!videno.has(m.id)) pridat(m, 0); // rozbitý kruh v datech: aspoň se ukáže
  return vysledek;
}

/**
 * Části karty, které sdílí wiki i karta na mapě.
 * @param {{s: object, api: Function, toast: Function, otevritPoznamku: Function, prekreslit: () => void, otevrit: (id: string) => void}} ctx
 */
export function castiKarty(ctx) {
  const { s, api, toast, otevritPoznamku } = ctx;

  function hlasitZapis(r, text) {
    if (r?.vysledek === 'odlozeno') toast('Soubor karty je otevřený jinde (Obsidian?). Změna se zapíše, až se uvolní.');
    else if (text) toast(text);
  }

  async function upravit(cesta, metoda, telo, text) {
    try {
      const r = await api(cesta, { metoda, telo });
      hlasitZapis(r, text);
      if (r.karta && r.karta.id === s.vybrane) s.karta = r.karta;
      ctx.prekreslit();
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
    b.addEventListener('click', () => ctx.otevrit(id));
    return b;
  };

  function prepinac(text, zapnuto, popis, zmena) {
    const vstup = el('input', { type: 'checkbox', role: 'switch', checked: zapnuto });
    vstup.addEventListener('change', () => zmena(vstup.checked));
    return el('label', { className: 'prepinac-zap', title: popis }, vstup, el('span', { textContent: text }));
  }

  /** Ve hře a Družina zná (jen DM). */
  function prepinace(e) {
    return el('div', { className: 'prepinace-karty' },
      prepinac('Ve hře', e.aktualni, 'Štítek aktualni: entita právě hraje roli', (v) => upravit(`/api/kanon/entita/${encodeURIComponent(e.id)}`, 'PUT', { aktualni: v }, v ? 'Označeno: ve hře.' : 'Štítek Ve hře odebrán.')),
      prepinac('Družina zná', e.verejne, 'verejne: true: entita se ukáže v pohledu družiny a na hráčské stránce (jen odkryté odrážky Co ví družina)', (v) => upravit(`/api/kanon/entita/${encodeURIComponent(e.id)}`, 'PUT', { verejne: v }, v ? 'Družina entitu zná. Co o ní ví, odkryješ v oddílu Co ví družina.' : 'Entita je jen pro DM.')));
  }

  function udaje(e) {
    const radky = Object.entries(e.udaje ?? {}).filter(([kl]) => kl !== 'stav').map(([kl, v]) => el('div', {}, el('dt', { textContent: UDAJE[kl] ?? kl }), el('dd', { textContent: kl === 'oblast' && s.podleId.has(v) ? s.podleId.get(v).nazev : v })));
    return radky.length ? el('dl', { className: 'udaje-karty' }, radky) : null;
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
        ctx.prekreslit();
      }
    });
    zrusitBtn.addEventListener('click', () => {
      s.uprava = null;
      ctx.prekreslit();
    });
    odebratBtn?.addEventListener('click', async () => {
      if (await upravit(`/api/kanon/entita/${encodeURIComponent(e.id)}/vztahy/${encodeURIComponent(cil)}`, 'DELETE', undefined, 'Popis vztahu odebrán, vazba zůstala.')) {
        s.uprava = null;
        ctx.prekreslit();
      }
    });
    queueMicrotask(() => {
      f.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      popis.focus({ preventScroll: true });
    });
    return f;
  }

  async function odebratVazbu(k, cil) {
    const nazev = s.podleId.get(cil)?.nazev ?? cil;
    const maVztah = k.vztahy.some((v) => v.s === cil);
    if (!confirm(`Odebrat vazbu ${k.nazev} → ${nazev}${maVztah ? ' i s popisem vztahu' : ''}?`)) return;
    await upravit(`/api/kanon/entita/${encodeURIComponent(k.id)}/vazby/${encodeURIComponent(cil)}`, 'DELETE', undefined, 'Vazba odebrána.');
  }

  function seznamVztahu(k) {
    const dm = s.pohled === 'dm';
    const uprava = dm && !s.jenCteni;
    const cile = [...new Set([...k.vztahy.map((v) => v.s), ...k.vazby])];
    const radky = cile.map((cil) => {
      const v = k.vztahy.find((x) => x.s === cil) ?? null;
      if (s.uprava?.cil === cil && uprava) return el('li', { className: 'vztah-radek upravuje' }, formularVztahu(k, cil, v, s.uprava.nova));
      const existuje = s.podleId.has(cil);
      const tecka = el('span', { className: 'tecka-postoje', title: v && Number.isInteger(v.postoj) ? `Postoj ${postojText(v.postoj)}` : v ? 'Bez postoje' : 'Vazba bez popisu' });
      const barva = v ? barvaPostoje(v.postoj) : null;
      if (barva) tecka.style.background = barva;
      if (!v) tecka.classList.add('jen-vazba');
      const akce = uprava
        ? el('span', { className: 'akce-vztahu' },
          el('button', { type: 'button', className: 'mala', textContent: v ? 'Upravit' : '+ popis', title: v ? 'Upravit popis, postoj a jestli ho zná družina' : 'Doplnit popis vztahu', onclick: () => { s.uprava = { cil }; ctx.prekreslit(); } }),
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
    if (s.uprava && !cile.includes(s.uprava.cil) && uprava) radky.push(el('li', { className: 'vztah-radek upravuje' }, formularVztahu(k, s.uprava.cil, null, true)));
    return radky;
  }

  /** Vyhledávací pole s výsledky (vazba, navázání události, odkaz v editoru). */
  function vyber({ placeholder, polozky, popisek, priVyberu, zrusit }) {
    const vstup = el('input', { type: 'search', placeholder, autocomplete: 'off', 'aria-label': placeholder });
    const vysledky = el('ul', { className: 'vysledky-vazby' });
    const ukaz = () => {
      const nalez = polozky(vstup.value);
      vysledky.replaceChildren(...nalez.map((x) => {
        const p = popisek(x);
        const b = el('button', { type: 'button', className: 'polozka-hledani' }, el('span', { className: 'tecka' }), p.text, el('small', { textContent: ` ${p.drobne ?? ''}` }));
        b.style.setProperty('--c', p.barva ?? 'var(--akcent)');
        b.addEventListener('click', () => priVyberu(x));
        return el('li', {}, b);
      }));
    };
    vstup.addEventListener('input', ukaz);
    vstup.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        zrusit();
      }
      if (ev.key === 'Enter') {
        ev.preventDefault();
        vysledky.querySelector('button')?.click();
      }
    });
    queueMicrotask(() => {
      vstup.focus();
      ukaz();
    });
    return el('div', { className: 'pridat-vazbu' }, vstup, vysledky, el('button', { type: 'button', className: 'mala tiche', textContent: 'Zrušit', onclick: zrusit }));
  }

  function pridatVazbuUI(k) {
    if (!s.pridavani) {
      return el('button', { type: 'button', className: 'mala', textContent: '+ Přidat vazbu', onclick: () => { s.pridavani = true; ctx.prekreslit(); } });
    }
    return vyber({
      placeholder: 'Hledat entitu…',
      polozky: (q) => (q.trim() ? hledat(s.data.entity.filter((e) => e.id !== k.id && !k.vazby.includes(e.id)), q, 8) : []),
      popisek: (e) => ({ text: e.nazev, drobne: TYPY[e.typ]?.j ?? e.typ, barva: barvaTypu(e.typ) }),
      priVyberu: async (e) => {
        s.pridavani = false;
        const r = await upravit(`/api/kanon/entita/${encodeURIComponent(k.id)}/vazby`, 'POST', { cil: e.id }, `Vazba na ${e.nazev} založena.`);
        if (r) {
          s.uprava = { cil: e.id, nova: true };
          ctx.prekreslit();
        }
      },
      zrusit: () => {
        s.pridavani = false;
        ctx.prekreslit();
      },
    });
  }

  function prezdivky(k) {
    const dm = s.pohled === 'dm' && !s.jenCteni;
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

  function obrazkyKarty(k, { bezPrvniho = false } = {}) {
    let obr = k.obrazky.filter((o) => s.pohled === 'dm' || !o.skryta);
    if (bezPrvniho) obr = obr.filter((o) => o.url !== k.obrazek);
    if (!obr.length) return null;
    const portrety = obr.filter((o) => o.ucel === 'portret');
    const sceny = obr.filter((o) => o.ucel !== 'portret');
    return el('div', {},
      portrety.length ? el('div', { className: 'portrety-karty' }, portrety.map((o) => el('a', { href: o.url, target: '_blank', rel: 'noopener', title: o.varianta ? `Podoba: ${o.varianta}` : 'Portrét' }, el('img', { src: o.url, alt: `${k.nazev}${o.varianta ? `: ${o.varianta}` : ''}`, loading: 'lazy' })))) : null,
      sceny.length ? el('div', { className: 'sceny-karty' }, sceny.slice(0, 8).map((o) => el('a', { href: o.url, target: '_blank', rel: 'noopener', className: o.skryta ? 'skryta' : '', title: [o.soubor, o.varianta, o.stav, o.skryta ? 'skrytá (jen DM)' : null].filter(Boolean).join(' · ') }, el('img', { src: o.url, alt: o.soubor, loading: 'lazy' })))) : null,
    );
  }

  /** Místa, která leží přímo v místě `id`, podle názvu. */
  const podmista = (id) => (s.data?.entity ?? []).filter((e) => e.leziV === id).sort((a, b) => a.nazev.localeCompare(b.nazev, 'cs'));

  /** Cesta od nejvyššího místa k místu `id` (bez něj): Mirabar › Chudinská čtvrť. */
  function predci(id) {
    const cesta = [];
    for (let m = s.podleId.get(s.podleId.get(id)?.leziV); m && cesta.length < 20 && !cesta.includes(m) && m.id !== id; m = s.podleId.get(m.leziV)) cesta.unshift(m);
    return cesta;
  }

  /** Kde místo leží, jako proklikávací cesta (karta na mapě); bez nadřazeného místa nic. */
  function cestaMista(e) {
    const cesta = e.typ === 'misto' ? predci(e.id) : [];
    if (!cesta.length) return null;
    return el('nav', { className: 'cesta-mista', 'aria-label': 'Kde místo leží' }, cesta.flatMap((m) => [odkazNaEntitu(m.id), el('span', { className: 'oddelovac', textContent: '›', 'aria-hidden': 'true' })]));
  }

  /**
   * Místo v místě (⚠ bod 116): výběr Leží v (jen DM) a místa, která v něm leží.
   * Nabízí jen místa, ve kterých by nevznikl kruh (ne místo samo ani jeho podmísta).
   */
  function sekceMista(e) {
    const dm = s.pohled === 'dm' && !s.jenCteni;
    const deti = podmista(e.id);
    const vysledek = [];
    if (dm) {
      const potomci = new Set([e.id]);
      for (let pridano = true; pridano;) {
        pridano = false;
        for (const x of s.data.entity) {
          if (!x.leziV || !potomci.has(x.leziV) || potomci.has(x.id)) continue;
          potomci.add(x.id);
          pridano = true;
        }
      }
      const mista = s.data.entity.filter((x) => x.typ === 'misto' && !potomci.has(x.id));
      const vyber = el('select', { 'aria-label': 'Místo, ve kterém leží' }, new Option('— nikde (samostatné místo)', ''), ...stromMist(mista).map(({ m, hloubka }) => new Option(`${'\u00a0\u00a0'.repeat(hloubka)}${m.nazev}`, m.id)));
      vyber.value = e.leziV ?? '';
      vyber.addEventListener('change', () => {
        const cil = vyber.value || null;
        const nazev = cil ? s.podleId.get(cil)?.nazev ?? cil : null;
        upravit(`/api/kanon/entita/${encodeURIComponent(e.id)}/lezi-v`, 'PUT', { cil }, cil ? `${e.nazev} leží v ${nazev}.` : `${e.nazev} je samostatné místo.`);
      });
      vysledek.push(el('label', { className: 'lezi-v', title: 'Místo, ve kterém nebo u kterého toto místo leží (hospoda ve městě, tábor u osady). Mapa ho drží u něj, Místa ho řadí pod něj.' }, el('span', { textContent: 'Leží v' }), vyber));
    }
    if (deti.length) {
      vysledek.push(el('h3', { textContent: `Místa uvnitř (${deti.length})` }));
      vysledek.push(el('ul', { className: 'podmista' }, deti.map((d) => el('li', {}, odkazNaEntitu(d.id), podmista(d.id).length ? el('small', { textContent: ` +${podmista(d.id).length}` }) : null))));
    }
    return vysledek;
  }

  /** Kdo na entitu odkazuje, a nemá ji sama ve vazbách. Místa uvnitř místa ukazuje sekceMista. */
  function zpetneOdkazy(k, nazev) {
    const zpetne = k.odkazujici.filter((o) => !k.vazby.includes(o.id) && s.podleId.get(o.id)?.leziV !== k.id);
    if (!zpetne.length) return null;
    return [
      el('h3', { textContent: `Odkazují sem (${zpetne.length})` }),
      el('ul', { className: 'vztahy-karty zpetne' }, zpetne.map((o) => {
        const tecka = el('span', { className: `tecka-postoje${o.vztah ? '' : ' jen-vazba'}` });
        const b = o.vztah ? barvaPostoje(o.vztah.postoj) : null;
        if (b) tecka.style.background = b;
        return el('li', { className: 'vztah-radek' }, tecka, el('span', { className: 'vztah-text' }, odkazNaEntitu(o.id), o.vztah ? el('span', { className: 'vztah-popis', textContent: ` — ${nazev} je pro ni/něj: ${o.vztah.popis}` }) : null));
      })),
    ];
  }

  /** Ukázat místo v OBS (karta místa s ilustrací scény). */
  function tlacitkoObs(e) {
    if (s.pohled !== 'dm' || s.jenCteni || e.typ !== 'misto' || !e.obrazky.some((o) => o.ucel === 'scena' && !o.skryta)) return null;
    return el('button', { type: 'button', textContent: 'Ukázat v OBS', title: 'Přepne scénu Místo v OBS na toto místo', onclick: async () => {
      try {
        const r = await api('/api/scena/zobrazit', { metoda: 'POST', telo: { misto: e.id, prepnout: true } });
        toast(r.chybaObs ?? `V OBS je ${e.nazev}.`, { chyba: Boolean(r.chybaObs) });
      } catch (chyba) {
        toast(chyba.message, { chyba: true });
      }
    } });
  }

  const tlacitkoPoznamky = (e) => (s.pohled === 'dm' && !s.jenCteni ? el('button', { type: 'button', textContent: 'Poznámka', title: `Poznámka F2 s odkazem [[${e.id}]]`, onclick: () => otevritPoznamku(`[[${e.id}]] `) }) : null);

  return { hlasitZapis, upravit, odkazNaEntitu, prepinac, prepinace, udaje, seznamVztahu, pridatVazbuUI, prezdivky, obrazkyKarty, zpetneOdkazy, tlacitkoObs, tlacitkoPoznamky, vyber, predci, podmista, cestaMista, sekceMista };
}
