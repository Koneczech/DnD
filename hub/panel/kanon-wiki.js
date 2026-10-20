// Wiki kánonu (rozhodnutí DM 20. 10. 2026, inspirace Kankou): hlavní pohled modulu Kánon.
// Přehled, kategorie podle typu, stránka entity s oddílem Co ví družina po odrážkách, události
// kalendáře s navázanými kartami a plný editor karty (kanon-editor.js). Mapa je druhá záložka.
import { hledat, proHledani } from '/sdilene/sit.js';
import { naHtml } from '/sdilene/markdown.js';
import { $, TYPY, STAVY, barvaTypu, el, nahradit, obrazekEntity, stitekTypu } from '/panel/kanon-spolecne.js';
import { vytvoritEditor } from '/panel/kanon-editor.js';

const UDAJE_DLAZDICE = (e) => e.udaje?.hrac ? `hraje ${e.udaje.hrac}` : e.typ === 'rozhodnuti' ? STAVY[e.udaje?.stav] ?? '' : e.aliases?.[0] ?? '';

function casPred(iso) {
  if (!iso) return '';
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return 'právě teď';
  if (min < 60) return `před ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `před ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'včera' : `před ${d} dny`;
}

/**
 * @param {object} ctx sdílený kontext modulu (s, api, toast, otevritPoznamku, prekreslit, otevrit, nacist, nacistKartu)
 * @param {object} karta části karty z kanon-spolecne.js
 */
export function vytvoritWiki(ctx, karta) {
  const { s, api, toast } = ctx;
  const koren = $('#kanon-wiki');
  const menu = el('nav', { className: 'wiki-menu karta', 'aria-label': 'Kategorie kánonu' });
  const obsah = el('div', { className: 'wiki-obsah' });
  koren.append(menu, obsah);
  const w = {
    stranka: 'prehled',
    typ: null,
    udalost: null,
    filtr: '',
    jenVeHre: false,
    navazovani: false, // výběr události u entity
    pridavaniKarty: false, // výběr karty u události
  };
  const editor = vytvoritEditor({ ...ctx, kam: obsah, poZavreni: () => ctx.nacist() });
  const dm = () => s.pohled === 'dm';
  /** Ovládání, které mění data (čtecí verze na GitHub Pages ho nemá). */
  const uprav = () => dm() && !s.jenCteni;
  const entity = () => s.data?.entity ?? [];
  const udalosti = () => s.data?.udalosti ?? [];

  /* ---------- Menu ---------- */

  function vykresliMenu() {
    const pocty = {};
    for (const e of entity()) pocty[e.typ] = (pocty[e.typ] ?? 0) + 1;
    const odkaz = (href, text, aktivni, { barva, pocet } = {}) => {
      const a = el('a', { href, className: `polozka-menu${aktivni ? ' aktivni' : ''}`, 'aria-current': aktivni ? 'page' : null }, barva ? el('span', { className: 'tecka' }) : null, el('span', { textContent: text }), pocet !== undefined ? el('span', { className: 'pocet-menu', textContent: pocet }) : null);
      if (barva) a.style.setProperty('--c', barva);
      return a;
    };
    nahradit(menu,
      odkaz('#kanon', 'Přehled', w.stranka === 'prehled'),
      el('p', { className: 'skupina-menu', textContent: 'Kategorie' }),
      Object.entries(TYPY).filter(([t]) => pocty[t]).map(([t, d]) => odkaz(`#kanon/typ/${t}`, d.mn, w.stranka === 'typ' && w.typ === t || (w.stranka === 'entita' && s.podleId.get(s.vybrane)?.typ === t), { barva: barvaTypu(t), pocet: pocty[t] })),
      el('p', { className: 'skupina-menu', textContent: 'Čas' }),
      odkaz('#kanon/udalosti', 'Události', w.stranka === 'udalosti' || w.stranka === 'udalost', { barva: 'var(--akcent)', pocet: udalosti().length }),
      uprav() && s.data?.typyNove?.length ? el('button', { type: 'button', className: 'nova-karta', textContent: '+ Nová karta', onclick: () => otevritNovou() }) : null,
    );
  }

  /* ---------- Dlaždice a řádky ---------- */

  function dlazdice(e) {
    const a = el('a', { href: `#kanon/${encodeURIComponent(e.id)}`, className: 'dlazdice' },
      obrazekEntity(e, 'dlazdice-obr'),
      el('span', { className: 'dlazdice-text' },
        el('strong', { textContent: e.nazev }),
        el('small', { textContent: [TYPY[e.typ]?.j, UDAJE_DLAZDICE(e)].filter(Boolean).join(' · ') }),
        e.popis ? el('span', { className: 'dlazdice-popis', textContent: e.popis }) : null,
        el('span', { className: 'dlazdice-stitky' },
          e.aktualni ? el('span', { className: 'stitek-ve-hre', textContent: 've hře' }) : null,
          dm() && e.verejne ? el('span', { className: 'stitek-maly', textContent: 'družina zná' }) : null)));
    a.style.setProperty('--c', barvaTypu(e.typ));
    return a;
  }

  function radekUdalosti(u, { odebrat } = {}) {
    const vazby = u.vazby.map((id) => s.podleId.get(id)).filter(Boolean);
    return el('li', { className: 'udalost-radek' },
      el('a', { href: `#kanon/udalost/${encodeURIComponent(u.id)}`, className: 'udalost-odkaz' },
        el('span', { className: 'udalost-datum', textContent: u.konecText ? `${u.datumText} – ${u.konecText}` : u.datumText }),
        el('span', { className: 'udalost-text', textContent: u.text }),
        dm() && !u.verejna ? el('span', { className: 'stitek-dm', textContent: 'skrytá' }) : null),
      vazby.length ? el('span', { className: 'udalost-vazby' }, vazby.slice(0, 6).map((e) => {
        const c = el('a', { href: `#kanon/${encodeURIComponent(e.id)}`, className: 'cip-entity', textContent: e.nazev });
        c.style.setProperty('--c', barvaTypu(e.typ));
        return c;
      }), vazby.length > 6 ? el('small', { textContent: `+${vazby.length - 6}` }) : null) : null,
      odebrat ? el('button', { type: 'button', className: 'mala tiche', textContent: '×', title: 'Zrušit navázání', 'aria-label': `Zrušit navázání na ${u.text}`, onclick: odebrat }) : null);
  }

  /* ---------- Stránky ---------- */

  function prehled() {
    const vse = entity();
    const postavy = vse.filter((e) => e.typ === 'postava');
    const veHre = vse.filter((e) => e.aktualni && e.typ !== 'postava');
    const posledni = dm() ? [...vse].filter((e) => e.upraveno).sort((a, b) => b.upraveno.localeCompare(a.upraveno)).slice(0, 8) : [];
    const ud = udalosti();
    nahradit(obsah,
      el('div', { className: 'wiki-hlava' },
        el('h2', { className: 'wiki-nadpis', textContent: dm() ? 'Kánon kampaně' : 'Co ví družina' }),
        el('p', { className: 'uvod', textContent: s.jenCteni && dm()
          ? `${vse.length} karet a ${ud.length} událostí. Čtecí verze: karty se upravují v Hubu doma nebo v Obsidianu.`
          : dm()
          ? `${vse.length} karet a ${ud.length} událostí. Karty upravíš tady i v Obsidianu; co z nich zná družina, odkrýváš po odrážkách v oddílu Co ví družina.`
          : `${vse.length} karet, které družina zná, a jen to, co o nich ví. Slouží k rekapitulaci.` })),
      postavy.length ? el('section', { className: 'wiki-sekce' }, el('h3', { textContent: 'Postavy hráčů' }), el('div', { className: 'mrizka-dlazdic' }, postavy.map(dlazdice))) : null,
      veHre.length ? el('section', { className: 'wiki-sekce' }, el('h3', { textContent: `Ve hře (${veHre.length})` }), el('div', { className: 'mrizka-dlazdic' }, veHre.map(dlazdice))) : null,
      ud.length ? el('section', { className: 'wiki-sekce' }, el('div', { className: 'sekce-hlava' }, el('h3', { textContent: 'Poslední události' }), el('a', { href: '#kanon/udalosti', className: 'tlacitko tiche', textContent: 'Všechny události' })), el('ul', { className: 'udalosti-seznam' }, ud.slice(-5).reverse().map((u) => radekUdalosti(u)))) : null,
      posledni.length ? el('section', { className: 'wiki-sekce' }, el('h3', { textContent: 'Naposledy upravené' }), el('ul', { className: 'naposledy' }, posledni.map((e) => {
        const a = el('a', { href: `#kanon/${encodeURIComponent(e.id)}` }, el('span', { className: 'tecka' }), el('span', { textContent: e.nazev }), el('small', { textContent: `${TYPY[e.typ]?.j ?? e.typ} · ${casPred(e.upraveno)}` }));
        a.style.setProperty('--c', barvaTypu(e.typ));
        return el('li', {}, a);
      }))) : null,
      dm() && s.data?.chyby?.length ? el('section', { className: 'wiki-sekce' }, el('h3', { textContent: 'Karty, které se nenačetly' }), el('ul', { className: 'chyby-kanonu' }, s.data.chyby.map((c) => el('li', {}, el('code', { textContent: c.soubor }), ` ${c.chyba}`)))) : null,
    );
  }

  function kategorie() {
    const t = w.typ;
    const vse = entity().filter((e) => e.typ === t);
    const q = proHledani(w.filtr).trim();
    const seznam = (q ? hledat(vse, w.filtr, 500) : [...vse].sort((a, b) => a.nazev.localeCompare(b.nazev, 'cs'))).filter((e) => !w.jenVeHre || e.aktualni);
    const filtr = el('input', { type: 'search', placeholder: `Hledat v kategorii ${TYPY[t]?.mn ?? t}…`, value: w.filtr, 'aria-label': 'Hledat v kategorii' });
    filtr.addEventListener('input', () => {
      w.filtr = filtr.value;
      const poz = filtr.selectionStart;
      kategorie();
      const novy = obsah.querySelector('.wiki-filtr input');
      novy?.focus();
      novy?.setSelectionRange(poz, poz);
    });
    const veHre = vse.filter((e) => e.aktualni).length;
    const cip = dm() && veHre ? el('button', { type: 'button', className: 'cip cip-ve-hre', 'aria-pressed': String(w.jenVeHre) }, el('span', { className: 'tecka' }), 'Jen ve hře', el('span', { className: 'pocet-cipu', textContent: veHre })) : null;
    cip?.addEventListener('click', () => {
      w.jenVeHre = !w.jenVeHre;
      kategorie();
    });
    nahradit(obsah,
      el('div', { className: 'wiki-hlava' },
        el('nav', { className: 'drobecky' }, el('a', { href: '#kanon', textContent: 'Kánon' }), ' › '),
        el('div', { className: 'radek-hlavy' },
          el('h2', { className: 'wiki-nadpis', textContent: `${TYPY[t]?.mn ?? t} (${vse.length})` }),
          uprav() && s.data?.typyNove?.includes(t) ? el('button', { type: 'button', textContent: `+ ${TYPY[t]?.j ?? t}`, onclick: () => otevritNovou(t) }) : null),
        el('div', { className: 'wiki-filtr' }, filtr, cip)),
      seznam.length ? el('div', { className: 'mrizka-dlazdic' }, seznam.map(dlazdice)) : el('p', { className: 'poznamka', textContent: q ? 'Nic nenalezeno.' : 'V kategorii zatím nic není.' }),
    );
  }

  function stranaUdalosti() {
    const ud = udalosti();
    nahradit(obsah,
      el('div', { className: 'wiki-hlava' },
        el('nav', { className: 'drobecky' }, el('a', { href: '#kanon', textContent: 'Kánon' }), ' › '),
        el('h2', { className: 'wiki-nadpis', textContent: `Události (${ud.length})` }),
        el('p', { className: 'uvod' }, uprav() ? 'Události z Kalendáře. Datum a text se mění v ' : dm() ? 'Události z Kalendáře.' : 'Co se kdy stalo.', uprav() ? el('a', { href: '#kalendar', textContent: 'Kalendáři' }) : null, uprav() ? '; tady k nim navážeš postavy, místa a co se u nich ve hře rozhodlo.' : null)),
      ud.length ? el('ul', { className: 'udalosti-seznam casova-osa' }, ud.map((u) => radekUdalosti(u))) : el('p', { className: 'poznamka', textContent: 'V kalendáři zatím nejsou žádné události.' }),
    );
  }

  async function navazat(udalostId, cil, pridat) {
    try {
      const r = pridat
        ? await api(`/api/kanon/udalosti/${encodeURIComponent(udalostId)}/vazby`, { metoda: 'POST', telo: { cil } })
        : await api(`/api/kanon/udalosti/${encodeURIComponent(udalostId)}/vazby/${encodeURIComponent(cil)}`, { metoda: 'DELETE' });
      karta.hlasitZapis(r, pridat ? 'Navázáno na událost.' : 'Navázání zrušeno.');
      // Seznam událostí v datech se obnoví živou událostí; do té doby ho upravíme sami.
      const u = s.data.udalosti.find((x) => x.id === udalostId);
      if (u && r.udalost) u.vazby = r.udalost.vazby;
      if (s.karta && w.stranka === 'entita') ctx.nacistKartu(s.karta.id);
      prekreslit();
    } catch (chyba) {
      toast(chyba.message, { chyba: true });
    }
  }

  function stranaUdalost() {
    const u = udalosti().find((x) => x.id === w.udalost);
    if (!u) {
      nahradit(obsah, el('p', { className: 'poznamka', textContent: dm() ? 'Událost v kalendáři není.' : 'Tuhle událost družina nezná.' }));
      return;
    }
    const vazby = u.vazby.map((id) => s.podleId.get(id)).filter(Boolean);
    const rozhodnuto = vazby.filter((e) => e.typ === 'kanon');
    const ostatni = vazby.filter((e) => e.typ !== 'kanon');
    const odebrat = (e) => (uprav() ? el('button', { type: 'button', className: 'mala tiche', textContent: '×', title: 'Zrušit navázání', 'aria-label': `Zrušit navázání ${e.nazev}`, onclick: () => navazat(u.id, e.id, false) }) : null);
    const pridat = uprav()
      ? w.pridavaniKarty
        ? karta.vyber({
          placeholder: 'Hledat kartu…',
          polozky: (q) => (q.trim() ? hledat(entity().filter((e) => !u.vazby.includes(e.id)), q, 8) : []),
          popisek: (e) => ({ text: e.nazev, drobne: TYPY[e.typ]?.j ?? e.typ, barva: barvaTypu(e.typ) }),
          priVyberu: (e) => {
            w.pridavaniKarty = false;
            navazat(u.id, e.id, true);
          },
          zrusit: () => {
            w.pridavaniKarty = false;
            prekreslit();
          },
        })
        : el('div', { className: 'tlacitka' },
          el('button', { type: 'button', textContent: '+ Navázat kartu', onclick: () => { w.pridavaniKarty = true; prekreslit(); } }),
          s.data?.typyNove?.includes('kanon') ? el('button', { type: 'button', textContent: '+ Zapsat, co se rozhodlo', title: 'Nový záznam hráčského kánonu navázaný na tuto událost', onclick: () => otevritNovou('kanon', { udalost: u.id, nazev: '' }) }) : null)
      : null;
    nahradit(obsah,
      el('article', { className: 'clanek clanek-udalosti' },
        el('div', { className: 'wiki-hlava' },
          el('nav', { className: 'drobecky' }, el('a', { href: '#kanon', textContent: 'Kánon' }), ' › ', el('a', { href: '#kanon/udalosti', textContent: 'Události' }), ' › '),
          el('h2', { className: 'wiki-nadpis', textContent: u.text }),
          el('p', { className: 'udalost-meta' }, el('span', { className: 'udalost-datum', textContent: u.konecText ? `${u.datumText} – ${u.konecText}` : u.datumText }), dm() ? el('span', { className: u.verejna ? 'stitek-maly' : 'stitek-dm', textContent: u.verejna ? 'veřejná (OBS, družina)' : 'skrytá' }) : null, uprav() ? el('a', { href: '#kalendar', className: 'tlacitko tiche', textContent: 'Upravit v Kalendáři' }) : null)),
        el('section', { className: 'wiki-sekce' },
          el('h3', { textContent: 'Co se rozhodlo' }),
          rozhodnuto.length
            ? el('ul', { className: 'rozhodnuto' }, rozhodnuto.map((e) => el('li', {}, el('a', { href: `#kanon/${encodeURIComponent(e.id)}`, className: 'rozhodnuto-odkaz' }, el('strong', { textContent: e.nazev }), e.popis ? el('span', { textContent: e.popis }) : null), odebrat(e))))
            : el('p', { className: 'poznamka', textContent: dm() ? 'Zatím nic. Zápis hráčského kánonu (Co se stalo, Důsledek) přidáš tlačítkem níž, nebo ho navážeš.' : 'Zatím nic.' })),
        el('section', { className: 'wiki-sekce' },
          el('h3', { textContent: 'Kdo a kde' }),
          ostatni.length
            ? el('div', { className: 'mrizka-dlazdic mala' }, ostatni.map((e) => el('div', { className: 'dlazdice-obal' }, dlazdice(e), odebrat(e))))
            : el('p', { className: 'poznamka', textContent: 'K události zatím není navázaná žádná karta.' })),
        pridat));
  }

  /* ---------- Stránka entity ---------- */

  async function prepnoutBlok(e, b) {
    await karta.upravit(`/api/kanon/entita/${encodeURIComponent(e.id)}/druzina/${b.index}`, 'PUT', { zna: !b.zna }, b.zna ? 'Skryto před družinou.' : 'Družina to teď ví.');
  }

  function coViDruzina(e, k) {
    const bloky = k.druzina ?? [];
    const odkryte = bloky.filter((b) => b.zna).length;
    const celkem = bloky.filter((b) => b.index >= 0).length;
    if (!dm() && !bloky.length) {
      return el('section', { className: 'co-vi-druzina' }, el('h3', { textContent: 'Co ví družina' }), el('p', { className: 'poznamka', textContent: `Družina o ${e.nazev} zatím nic dalšího neví.` }));
    }
    const polozky = bloky.map((b) => {
      if (b.druh === 'nadpis') return el('li', { className: `blok-nadpis${b.dm ? ' blok-dm' : ''}` }, el('span', { textContent: b.text }), b.dm ? el('span', { className: 'stitek-dm', textContent: 'jen DM' }) : null);
      const text = el('div', { className: 'blok-text' });
      text.innerHTML = naHtml(b.text, { existuje: (id) => s.podleId.has(id) });
      if (!dm()) return el('li', { className: 'blok' }, text);
      if (b.dm) return el('li', { className: 'blok blok-dm' }, el('span', { className: 'oko', textContent: '🔒', title: 'Pododdíl DM: družina ho nevidí nikdy' }), text);
      if (!uprav()) return el('li', { className: `blok${b.zna ? ' zna' : ''}` }, el('span', { className: `oko${b.zna ? ' zna' : ''}`, textContent: b.zna ? '👁' : '🔒', title: b.zna ? 'Družina to ví.' : 'Družina to zatím neví.' }), text);
      const oko = el('button', { type: 'button', className: `oko${b.zna ? ' zna' : ''}`, textContent: b.zna ? '👁' : '🔒', title: b.zna ? 'Družina to ví. Klik skryje.' : 'Družina to zatím neví. Klik odkryje.', 'aria-pressed': String(b.zna), 'aria-label': b.zna ? 'Skrýt před družinou' : 'Odkrýt družině' });
      oko.addEventListener('click', () => prepnoutBlok(e, b));
      return el('li', { className: `blok${b.zna ? ' zna' : ''}` }, oko, text);
    });
    let pridat = null;
    if (uprav()) {
      const vstup = el('input', { type: 'text', placeholder: 'Co se družina dozvěděla… (Enter přidá jako odkryté)', maxLength: 600, 'aria-label': 'Nová odrážka Co ví družina' });
      const skryte = el('input', { type: 'checkbox' });
      const odeslat = async () => {
        if (!vstup.value.trim()) return vstup.focus();
        const r = await karta.upravit(`/api/kanon/entita/${encodeURIComponent(e.id)}/druzina`, 'POST', { text: vstup.value, zna: !skryte.checked }, skryte.checked ? 'Přidáno, zatím skryté.' : 'Přidáno: družina to ví.');
        if (r) queueMicrotask(() => obsah.querySelector('.pridat-druzina input[type=text]')?.focus());
      };
      vstup.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          odeslat();
        }
      });
      pridat = el('div', { className: 'pridat-druzina' }, vstup, el('label', { className: 'zaskrtavaci', title: 'Připravit dopředu, odkryješ u stolu' }, skryte, ' zatím skryté'), el('button', { type: 'button', textContent: 'Přidat', onclick: odeslat }));
    }
    return el('section', { className: 'co-vi-druzina' },
      el('div', { className: 'sekce-hlava' }, el('h3', { textContent: 'Co ví družina' }), dm() ? el('span', { className: 'ulozeni', textContent: celkem ? `odkryto ${odkryte} z ${celkem}${e.verejne ? '' : ' · karta je jen pro DM'}` : '' }) : null),
      dm() && !e.verejne && odkryte ? el('p', { className: 'poznamka varovani-druzina', textContent: 'Družina kartu zatím nezná (přepínač Družina zná je vypnutý), odkryté odrážky uvidí, až ho zapneš.' }) : null,
      polozky.length ? el('ul', { className: 'bloky-druziny' }, polozky) : el('p', { className: 'poznamka', textContent: 'Zatím nic. Každá odrážka se odkrývá zvlášť: družina uvidí jen ty s okem 👁.' }),
      pridat);
  }

  function udalostiEntity(e, k) {
    const ud = k.udalosti ?? [];
    let navazani = null;
    if (uprav()) {
      navazani = w.navazovani
        ? karta.vyber({
          placeholder: 'Hledat událost podle textu nebo data…',
          polozky: (q) => {
            const dotaz = proHledani(q).trim();
            return udalosti().filter((u) => !u.vazby.includes(e.id) && (!dotaz || proHledani(`${u.text} ${u.datumText}`).includes(dotaz))).slice(-10).reverse();
          },
          popisek: (u) => ({ text: u.text, drobne: u.datumText }),
          priVyberu: (u) => {
            w.navazovani = false;
            navazat(u.id, e.id, true);
          },
          zrusit: () => {
            w.navazovani = false;
            prekreslit();
          },
        })
        : el('button', { type: 'button', className: 'mala', textContent: '+ Navázat událost', onclick: () => { w.navazovani = true; prekreslit(); } });
    }
    return el('section', { className: 'wiki-sekce' },
      el('div', { className: 'sekce-hlava' }, el('h3', { textContent: `Události (${ud.length})` }), w.navazovani ? null : navazani),
      w.navazovani ? navazani : null,
      ud.length ? el('ul', { className: 'udalosti-seznam' }, ud.map((u) => radekUdalosti({ ...u, vazby: u.vazby.filter((x) => x !== e.id) }, { odebrat: uprav() ? () => navazat(u.id, e.id, false) : null }))) : el('p', { className: 'poznamka', textContent: dm() ? 'Karta zatím není navázaná na žádnou událost z Kalendáře.' : 'Žádné události.' }));
  }

  function stranaEntity() {
    const e = s.podleId.get(s.vybrane);
    if (!e) {
      nahradit(obsah, el('p', { className: 'poznamka', textContent: dm() ? 'Karta v kánonu není.' : 'Tuhle kartu družina nezná.' }));
      return;
    }
    const k = s.karta?.id === e.id ? s.karta : null;
    const stitky = [stitekTypu(e.typ)];
    if (e.udaje?.stav) stitky.push(el('span', { className: `stitek-stavu ${e.udaje.stav}`, textContent: STAVY[e.udaje.stav] ?? e.udaje.stav }));
    if (e.aktualni) stitky.push(el('span', { className: 'stitek-ve-hre', textContent: 've hře' }));
    if (dm()) stitky.push(el('span', { className: e.verejne ? 'stitek-maly' : 'stitek-dm', textContent: e.verejne ? 'družina zná' : 'jen DM' }));
    const akce = el('div', { className: 'akce-clanku' },
      uprav() ? el('a', { className: 'tlacitko hlavni', href: `#kanon/${encodeURIComponent(e.id)}/upravit`, textContent: 'Upravit' }) : null,
      uprav() && k?.obsidian ? el('a', { className: 'tlacitko', href: k.obsidian, textContent: 'Otevřít v Obsidianu', title: k.soubor }) : null,
      karta.tlacitkoPoznamky(e),
      el('a', { className: 'tlacitko', href: `#kanon/mapa/${encodeURIComponent(e.id)}`, textContent: 'Na mapě' }),
      karta.tlacitkoObs(e));
    const hlava = el('div', { className: 'wiki-hlava clanek-hlava' },
      el('nav', { className: 'drobecky' }, el('a', { href: '#kanon', textContent: 'Kánon' }), ' › ', el('a', { href: `#kanon/typ/${e.typ}`, textContent: TYPY[e.typ]?.mn ?? e.typ }), ' › ',
        // Místo v místě: Kánon › Místa › Mirabar › Chudinská čtvrť.
        e.typ === 'misto' ? karta.predci(e.id).flatMap((m) => [karta.odkazNaEntitu(m.id), ' › ']) : null),
      el('div', { className: 'radek-hlavy' }, el('h2', { className: 'wiki-nadpis', textContent: `${e.ikona && !e.obrazek ? `${e.ikona} ` : ''}${e.nazev}` }), el('div', { className: 'stitky-karty' }, stitky)),
      e.aliases.length ? el('p', { className: 'aliasy', textContent: `Také: ${e.aliases.join(', ')}` }) : null,
      akce);
    if (!k) {
      nahradit(obsah, el('article', { className: 'clanek' }, hlava, el('p', { className: 'uvod', textContent: 'Načítám kartu…' })));
      return;
    }
    const text = el('div', { className: 'text-karty' });
    if (k.telo.trim()) text.innerHTML = naHtml(k.telo, { existuje: (id) => s.podleId.has(id), vynechatNadpis: e.nazev, oznacitDm: dm() });
    const portret = k.obrazky.find((o) => o.url === k.obrazek && o.ucel === 'portret');
    const pocetVazeb = new Set([...k.vztahy.map((v) => v.s), ...k.vazby]).size;
    const infobox = el('aside', { className: 'infobox karta' },
      portret ? el('a', { href: portret.url, target: '_blank', rel: 'noopener', className: 'infobox-portret' }, el('img', { src: portret.url, alt: e.nazev })) : k.obrazek ? el('a', { href: k.obrazek, target: '_blank', rel: 'noopener', className: 'infobox-scena' }, el('img', { src: k.obrazek, alt: e.nazev })) : null,
      uprav() ? karta.prepinace(e) : null,
      karta.udaje(e),
      e.typ === 'misto' ? karta.sekceMista(e) : null,
      (uprav() || e.aliases.length) ? el('h3', { textContent: 'Přezdívky' }) : null,
      karta.prezdivky(e),
      el('div', { className: 'sekce-hlava' }, el('h3', { textContent: `Vztahy a vazby (${pocetVazeb})` }), uprav() ? karta.pridatVazbuUI(k) : null),
      (() => {
        const radky = karta.seznamVztahu(k);
        return radky.length ? el('ul', { className: 'vztahy-karty' }, radky) : el('p', { className: 'poznamka', textContent: dm() ? 'Zatím bez vazeb.' : 'Družina o žádném vztahu neví.' });
      })(),
      karta.zpetneOdkazy(k, e.nazev),
      (() => {
        const obr = karta.obrazkyKarty(k, { bezPrvniho: true });
        return obr ? [el('h3', { textContent: 'Ilustrace' }), obr] : null;
      })());
    const hlavni = el('div', { className: 'clanek-hlavni' },
      // Hráčský kánon je celý pro družinu, oddíl Co ví družina má jen karta, která ho opravdu obsahuje.
      e.typ !== 'kanon' || (k.druzina ?? []).length ? coViDruzina(e, k) : null,
      k.telo.trim() ? text : uprav() ? el('p', { className: 'poznamka', textContent: 'Karta zatím nemá další text. Napiš ho přes Upravit.' }) : null,
      udalostiEntity(e, k));
    nahradit(obsah, el('article', { className: 'clanek' }, hlava, el('div', { className: 'clanek-telo' }, hlavni, infobox)));
  }

  obsah.addEventListener('click', (ev) => {
    const a = ev.target.closest?.('.text-karty a.odkaz-entity, .blok-text a.odkaz-entity');
    if (!a) return;
    ev.preventDefault();
    location.hash = `kanon/${encodeURIComponent(a.dataset.id)}`;
  });

  /* ---------- Nová karta ---------- */

  let novaUdalost = null;
  function otevritNovou(typ, { udalost = null, nazev = '' } = {}) {
    const d = $('#dialog-nova-karta');
    const vyber = $('#nova-karta-typ');
    vyber.replaceChildren(...(s.data?.typyNove ?? []).map((t) => new Option(TYPY[t]?.j ?? t, t)));
    vyber.value = typ && s.data?.typyNove?.includes(typ) ? typ : w.typ && s.data?.typyNove?.includes(w.typ) ? w.typ : 'npc';
    $('#nova-karta-nazev').value = nazev;
    $('#nova-karta-chyba').textContent = '';
    novaUdalost = udalost;
    $('#nova-karta-udalost').hidden = !udalost;
    $('#nova-karta-udalost').textContent = udalost ? `Karta se naváže na událost „${udalosti().find((u) => u.id === udalost)?.text ?? ''}“.` : '';
    d.showModal();
    $('#nova-karta-nazev').focus();
  }

  $('#formular-nova-karta').addEventListener('submit', async (ev) => {
    if (ev.submitter?.value === 'zrusit') return;
    ev.preventDefault();
    try {
      const r = await api('/api/kanon/entity', { metoda: 'POST', telo: { typ: $('#nova-karta-typ').value, nazev: $('#nova-karta-nazev').value } });
      if (novaUdalost) await api(`/api/kanon/udalosti/${encodeURIComponent(novaUdalost)}/vazby`, { metoda: 'POST', telo: { cil: r.karta.id } });
      $('#dialog-nova-karta').close();
      toast(`Karta ${r.karta.nazev} založena (${r.karta.soubor}).`);
      await ctx.nacist();
      location.hash = `kanon/${encodeURIComponent(r.karta.id)}/upravit`;
    } catch (chyba) {
      $('#nova-karta-chyba').textContent = chyba.message;
    }
  });

  /* ---------- Řízení ---------- */

  function prekreslit() {
    if (editor.upravuje()) return; // editor si kreslí sám
    vykresliMenu();
    if (!s.data) return nahradit(obsah, el('p', { className: 'uvod', textContent: 'Načítám kánon…' }));
    if (w.stranka === 'typ') kategorie();
    else if (w.stranka === 'udalosti') stranaUdalosti();
    else if (w.stranka === 'udalost') stranaUdalost();
    else if (w.stranka === 'entita') stranaEntity();
    else prehled();
  }

  return {
    /** casti: [''] přehled, ['typ', t], ['udalosti'], ['udalost', id], [id], [id, 'upravit'] */
    async ukazat(casti) {
      const [a, b] = casti;
      const editovat = b === 'upravit' && a && s.pohled === 'dm' && !s.jenCteni;
      if (!editovat) await editor.zavrit();
      w.navazovani = false;
      w.pridavaniKarty = false;
      if (!a) {
        w.stranka = 'prehled';
        s.vybrane = null;
      } else if (a === 'typ' && b) {
        if (w.typ !== b) w.filtr = '';
        w.stranka = 'typ';
        w.typ = b;
        s.vybrane = null;
      } else if (a === 'udalosti') {
        w.stranka = 'udalosti';
        s.vybrane = null;
      } else if (a === 'udalost' && b) {
        w.stranka = 'udalost';
        w.udalost = b;
        s.vybrane = null;
      } else {
        w.stranka = 'entita';
        if (s.vybrane !== a) {
          s.uprava = null;
          s.pridavani = false;
        }
        s.vybrane = a;
        if (s.karta?.id !== a) s.karta = null;
        if (editovat) {
          vykresliMenu();
          await editor.otevrit(a);
          return;
        }
        if (s.podleId.has(a)) ctx.nacistKartu(a);
      }
      prekreslit();
      obsah.scrollTop = 0;
    },
    prekreslit,
    /** Opouští se wiki (jiná obrazovka, mapa): editor uloží rozepsané. */
    async opustit() {
      await editor.zavrit();
    },
    upravuje: () => editor.upravuje(),
  };
}
