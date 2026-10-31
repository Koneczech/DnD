// Plný editor karty kánonu v Hubu (rozhodnutí DM 20. 10. 2026). Text karty je markdown jako
// v Obsidianu; ukládá se sám chvíli po psaní. Když kartu mezitím změnil Obsidian, editor nic
// nepřepíše a nabídne načíst novou podobu, nebo přepsat svou.
import { hledat } from '/sdilene/sit.js';
import { naHtml } from '/sdilene/markdown.js';
import { TYPY, STAVY, barvaTypu, el, nahradit, obrazekEntity } from '/panel/kanon-spolecne.js';
import { POLE_TYPU, OSUDY, ODKAZOVA_POLE, NAPOVEDA, popisekPole, chybejiciOddily, vlozitOddil } from '/sdilene/typy-karet.js';
import { prikazyKarty, najitLomitko, filtrovatPrikazy, provestPrikaz } from '/sdilene/prikazy-editoru.js';
import { vytvoritPole } from '/panel/kanon-zivy-nahled.js';

const PRODLEVA_MS = 1500;

/**
 * @param {{s, api, toast, kam: HTMLElement, poZavreni: () => void}} ctx
 */
export function vytvoritEditor(ctx) {
  const { s, api, toast, kam } = ctx;
  let st = null; // stav otevřeného editoru
  // Na webu (čtecí verze s úpravami, ⚠ bod 148) je každé uložení commit na GitHubu: ukládá se
  // tlačítkem Uložit, Ctrl+S nebo při Hotovo, ne samo po každé pauze v psaní.
  const naWebu = () => Boolean(s.jenCteni);

  const stavText = (text, trida = '') => {
    if (!st) return;
    st.stavEl.textContent = text;
    st.stavEl.className = `ulozeni stav-editoru ${trida}`;
  };

  async function ulozit({ prepsat = false } = {}) {
    if (!st) return;
    clearTimeout(st.casovac);
    if (st.bezi) {
      st.znovu = true;
      return st.bezi;
    }
    const telo = st.textarea.value !== st.ulozeneTelo ? st.textarea.value : undefined;
    const pole = Object.keys(st.zmenenaPole).length ? { ...st.zmenenaPole } : undefined;
    if (telo === undefined && !pole && !prepsat) return;
    st.zmenenaPole = {};
    stavText('Ukládám…');
    const id = st.id;
    st.bezi = (async () => {
      try {
        const r = await api(`/api/kanon/entita/${encodeURIComponent(id)}/zdroj`, { metoda: 'PUT', telo: { telo: telo ?? (prepsat ? st.textarea.value : undefined), zaklad: st.hash, prepsat, pole } });
        if (!st || st.id !== id) return;
        st.hash = r.hash;
        if (telo !== undefined || prepsat) st.ulozeneTelo = telo ?? st.textarea.value;
        st.konflikt?.remove();
        st.konflikt = null;
        if (r.karta) s.karta = r.karta;
        const cas = new Date().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
        stavText(r.vysledek === 'odlozeno' ? 'Soubor je otevřený jinde, zápis počká.' : naWebu() ? `Uloženo na GitHub ${cas}` : `Uloženo ${cas}`, r.vysledek === 'odlozeno' ? 'varovani' : 'ok');
      } catch (chyba) {
        if (!st || st.id !== id) return;
        if (pole) Object.assign(st.zmenenaPole, pole, st.zmenenaPole);
        if (chyba.kod === 'konflikt') ukazatKonflikt();
        else stavText(`Neuloženo: ${chyba.message}`, 'chyba');
      } finally {
        if (st) {
          st.bezi = null;
          if (st.znovu) {
            st.znovu = false;
            await ulozit();
          }
        }
      }
    })();
    return st.bezi;
  }

  const naplanovat = () => {
    if (!st) return;
    if (naWebu()) return stavText('Neuloženo: Uložit nebo Ctrl+S', 'varovani');
    stavText('Neuloženo…');
    clearTimeout(st.casovac);
    st.casovac = setTimeout(() => ulozit(), PRODLEVA_MS);
  };

  function ukazatKonflikt() {
    stavText('Karta se změnila jinde', 'chyba');
    if (st.konflikt) return;
    st.konflikt = el('div', { className: 'zprava varovani konflikt' },
      el('span', { textContent: naWebu() ? 'Kartu mezitím změnil někdo jiný (Hub doma nebo jiné zařízení). Tvoje úprava se zatím neuložila.' : 'Kartu mezitím změnil někdo jiný (nejspíš Obsidian). Tvoje úprava se zatím neuložila.' }),
      el('button', { type: 'button', textContent: 'Načíst jejich verzi', title: 'Zahodí tvoje neuložené změny textu', onclick: () => nacistZnovu() }),
      el('button', { type: 'button', textContent: 'Přepsat mou verzí', onclick: () => ulozit({ prepsat: true }) }));
    st.formular.prepend(st.konflikt);
  }

  async function nacistZnovu() {
    const z = await api(`/api/kanon/entita/${encodeURIComponent(st.id)}/zdroj`);
    st.textarea.value = z.telo;
    st.ulozeneTelo = z.telo;
    st.hash = z.hash;
    st.konflikt?.remove();
    st.konflikt = null;
    nahled();
    stavText('Načteno ze souboru', 'ok');
  }

  function nahled() {
    if (!st?.nahledEl || st.nahledEl.hidden) return;
    st.nahledEl.innerHTML = naHtml(st.textarea.value, { existuje: (id) => s.podleId.has(id), vynechatNadpis: st.nazev, oznacitDm: true });
  }

  /* ---------- Psaní: nástroje a našeptávání [[odkazů ---------- */

  function vlozit(pred, za = '', vychozi = '') {
    const t = st.textarea;
    const od = t.selectionStart;
    const do_ = t.selectionEnd;
    const vybrano = t.value.slice(od, do_) || vychozi;
    t.setRangeText(`${pred}${vybrano}${za}`, od, do_, 'end');
    t.selectionStart = od + pred.length;
    t.selectionEnd = od + pred.length + vybrano.length;
    t.focus();
    t.dispatchEvent(new Event('input'));
  }

  function zacatekRadku(prefix) {
    const t = st.textarea;
    const od = t.value.lastIndexOf('\n', t.selectionStart - 1) + 1;
    t.setRangeText(prefix, od, od, 'end');
    t.focus();
    t.dispatchEvent(new Event('input'));
  }

  function naseptavani() {
    const t = st.textarea;
    const pred = t.value.slice(0, t.selectionStart);
    const m = /\[\[([^\]\n|#]{0,40})$/.exec(pred);
    if (!m) {
      // Příkazy „/“ (⚠ bod 149): nabídka prvků k vložení.
      const l = t.selectionStart === t.selectionEnd ? najitLomitko(t.value, t.selectionStart) : null;
      st.nalez = l ? filtrovatPrikazy(prikazyKarty(st.typ, t.value), l.dotaz).slice(0, 20) : [];
      st.rezim = 'prikaz';
      st.lomitko = l;
      st.vybranyNalez = 0;
      vykreslitNaseptavac();
      return;
    }
    st.rezim = 'odkaz';
    const nalez = (m[1].trim() ? hledat(s.data?.entity ?? [], m[1], 8) : (s.data?.entity ?? []).filter((e) => e.aktualni).slice(0, 8));
    st.nalez = nalez;
    st.vybranyNalez = 0;
    st.dotazOdkazu = m[1];
    vykreslitNaseptavac();
  }

  function vykreslitNaseptavac() {
    if (!st.nalez.length) {
      st.naseptavac.hidden = true;
      return;
    }
    if (st.rezim === 'prikaz') {
      nahradit(st.naseptavac, st.nalez.map((p, i) => {
        const b = el('button', { type: 'button', className: 'polozka-hledani polozka-prikazu', 'aria-selected': String(i === st.vybranyNalez) }, p.nazev, el('small', {}, el('code', { textContent: p.ukazka })));
        b.addEventListener('mousedown', (ev) => ev.preventDefault());
        b.addEventListener('click', () => vlozitPrikaz(p));
        return el('li', {}, b);
      }));
      st.naseptavac.hidden = false;
      st.naseptavac.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
      return;
    }
    nahradit(st.naseptavac, st.nalez.map((e, i) => {
      const b = el('button', { type: 'button', className: 'polozka-hledani', 'aria-selected': String(i === st.vybranyNalez) }, el('span', { className: 'tecka' }), e.nazev, el('small', { textContent: ` ${TYPY[e.typ]?.j ?? e.typ}` }));
      b.style.setProperty('--c', barvaTypu(e.typ));
      b.addEventListener('mousedown', (ev) => ev.preventDefault());
      b.addEventListener('click', () => doplnitOdkaz(e));
      return el('li', {}, b);
    }));
    st.naseptavac.hidden = false;
  }

  function vlozitPrikaz(p) {
    const t = st.textarea;
    const l = st.lomitko ?? { od: t.selectionStart, dotaz: '' };
    const r = provestPrikaz(t.value, l.od, l.od + 1 + l.dotaz.length, p, st.typ);
    st.naseptavac.hidden = true;
    t.value = r.text;
    t.focus();
    t.selectionStart = t.selectionEnd = r.kurzor;
    t.dispatchEvent(new Event('input')); // uložení, náhled, oddíly; u odkazu i našeptávání karet
    oddily();
  }

  function doplnitOdkaz(e) {
    const t = st.textarea;
    const konec = t.selectionStart;
    const zacatek = konec - st.dotazOdkazu.length - 2;
    const za = t.value.slice(konec, konec + 2) === ']]' ? 2 : 0;
    t.setRangeText(`[[${e.id}|${e.nazev}]]`, zacatek, konec + za, 'end');
    st.naseptavac.hidden = true;
    t.focus();
    t.dispatchEvent(new Event('input'));
  }

  /* ---------- Formulář ---------- */

  function poleFormulare(z, typ) {
    const pole = [];
    const zmena = (klic, hodnota) => {
      st.zmenenaPole[klic] = hodnota;
      naplanovat();
    };
    const nazev = el('input', { type: 'text', value: z.pole.nazev ?? '', maxLength: 120, required: true });
    nazev.addEventListener('input', () => {
      st.nazev = nazev.value;
      zmena('nazev', nazev.value);
    });
    const ikona = el('input', { type: 'text', value: z.pole.ikona ?? '', maxLength: 8, className: 'pole-ikona', placeholder: '–', title: 'Jeden emoji znak, ukáže se místo obrázku' });
    ikona.addEventListener('input', () => zmena('ikona', ikona.value));
    pole.push(el('label', { className: 'pole-nazev' }, 'Název', nazev), el('label', { className: 'pole-ikony' }, 'Ikona', ikona));
    for (const klic of POLE_TYPU[typ] ?? []) {
      const popisek = popisekPole(klic, typ);
      let vstup;
      if (klic in ODKAZOVA_POLE) {
        // Kde ho najít, Patří k, Sídlo, U koho je: výběr z karet povoleného typu (rozhodnutí 74).
        const typy = ODKAZOVA_POLE[klic].cil;
        const karty = (s.data?.entity ?? []).filter((e) => typy.includes(e.typ) && e.id !== z.id).sort((a, b) => a.nazev.localeCompare(b.nazev, 'cs'));
        vstup = el('select', {}, new Option('—', ''), ...karty.map((e) => new Option(typy.length > 1 ? `${e.nazev} (${TYPY[e.typ]?.j ?? e.typ})` : e.nazev, e.id)));
        vstup.value = z.pole[klic] ?? '';
        vstup.addEventListener('change', () => zmena(klic, vstup.value));
      } else if (klic === 'osud') {
        vstup = el('select', {}, ...Object.entries(OSUDY).map(([h, t]) => new Option(t, h)));
        vstup.value = z.pole.osud || 'zije';
        // Živý je výchozí: v hlavičce se nepíše (prázdná hodnota klíč odebere).
        vstup.addEventListener('change', () => zmena('osud', vstup.value === 'zije' ? '' : vstup.value));
      } else if (klic === 'stav') {
        vstup = el('select', {}, ...Object.entries(STAVY).map(([h, t]) => new Option(t, h)));
        vstup.value = z.pole.stav || 'otevrene';
        vstup.addEventListener('change', () => zmena('stav', vstup.value));
      } else if (klic === 'oblast') {
        const postavy = (s.data?.entity ?? []).filter((e) => e.typ === 'postava');
        vstup = el('select', {}, new Option('kampaň', 'kampan'), ...postavy.map((e) => new Option(e.nazev, e.id)));
        vstup.value = z.pole.oblast || 'kampan';
        vstup.addEventListener('change', () => zmena('oblast', vstup.value));
      } else if (klic === 'doresit') {
        vstup = el('input', { type: 'checkbox', checked: z.pole.doresit === true });
        vstup.addEventListener('change', () => zmena('doresit', vstup.checked));
        pole.push(el('label', { className: 'zaskrtavaci' }, vstup, ' Má dohru, na kterou se nesmí zapomenout'));
        continue;
      } else if (klic === 'kdo') {
        vstup = el('input', { type: 'text', value: (z.pole.kdo ?? []).join(', '), placeholder: 'parta, nebo id postav: tusker, leta' });
        vstup.addEventListener('input', () => zmena('kdo', vstup.value.split(',').map((x) => x.trim()).filter(Boolean)));
      } else {
        const napoveda = NAPOVEDA[klic];
        vstup = el('input', { type: 'text', value: z.pole[klic] ?? '', maxLength: 200, placeholder: typeof napoveda === 'string' ? napoveda : napoveda?.[typ] ?? '' });
        vstup.addEventListener('input', () => zmena(klic, vstup.value));
      }
      pole.push(el('label', {}, popisek, vstup));
    }
    return pole;
  }

  function prezdivky(z) {
    const vstup = el('input', { type: 'text', value: z.aliases.join(', '), placeholder: 'Další jména pro hledání, oddělená čárkou' });
    vstup.addEventListener('change', async () => {
      try {
        const r = await api(`/api/kanon/entita/${encodeURIComponent(st.id)}`, { metoda: 'PUT', telo: { aliases: vstup.value.split(',').map((x) => x.trim()).filter(Boolean) } });
        if (r.karta) s.karta = r.karta;
        stavText('Přezdívky uloženy', 'ok');
      } catch (chyba) {
        if (!/Není co změnit/.test(chyba.message)) stavText(`Neuloženo: ${chyba.message}`, 'chyba');
      }
    });
    return el('label', { className: 'pole-siroke' }, 'Přezdívky', vstup);
  }

  function portret(z) {
    if (!z.slozkaEntity || naWebu()) return null; // portrét nahraješ v Hubu doma
    const e = s.podleId.get(z.id);
    const nahledEl = el('div', { className: 'portret-editoru' }, e ? obrazekEntity(e, 'ikona-karty') : null);
    const soubor = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', className: 'vizualne-skryte' });
    const tlacitko = el('button', { type: 'button', textContent: e?.obrazek ? 'Vyměnit portrét' : 'Přidat portrét', onclick: () => soubor.click() });
    soubor.addEventListener('change', async () => {
      const f = soubor.files?.[0];
      if (!f) return;
      if (f.size > 15 * 1024 * 1024) return toast('Obrázek je větší než 15 MB.', { chyba: true });
      const data = await new Promise((hotovo, chyba) => {
        const r = new FileReader();
        r.onload = () => hotovo(String(r.result).split(',')[1] ?? '');
        r.onerror = () => chyba(r.error);
        r.readAsDataURL(f);
      });
      try {
        const r = await api(`/api/kanon/entita/${encodeURIComponent(st.id)}/portret`, { metoda: 'POST', telo: { data } });
        if (r.karta) {
          s.karta = r.karta;
          s.podleId.set(r.karta.id, { ...s.podleId.get(r.karta.id), obrazek: r.karta.obrazek, portret: r.karta.portret, obrazky: r.karta.obrazky });
          nahradit(nahledEl, obrazekEntity(s.podleId.get(r.karta.id), 'ikona-karty'));
        }
        stavText(`Portrét uložen jako ${r.soubor}`, 'ok');
      } catch (chyba) {
        toast(chyba.message, { chyba: true });
      }
    });
    return el('div', { className: 'pole-portretu' }, nahledEl, el('div', {}, tlacitko, soubor, el('small', { className: 'poznamka', textContent: 'PNG, JPEG nebo WebP. Uloží se do složky karty jako portret.' })));
  }

  /**
   * Doporučené oddíly podle typu, které karta ještě nemá (typové stránky, rozhodnutí 74).
   * Klik oddíl vloží na místo podle doporučeného pořadí; nic se nepřejmenovává.
   */
  function oddily() {
    if (!st) return;
    const kam = st.formular.querySelector('.editor-oddily');
    const chybi = chybejiciOddily(st.typ, st.textarea.value);
    if (!chybi.length) return nahradit(kam);
    nahradit(kam, el('span', { className: 'poznamka', textContent: 'Chybí oddíly:' }), chybi.map((nadpis) => el('button', {
      type: 'button', className: 'mala', textContent: `+ ${nadpis}`, title: 'Vloží prázdný oddíl na místo podle šablony',
      onclick: () => {
        const t = st.textarea;
        t.value = vlozitOddil(st.typ, t.value, nadpis);
        const kde = t.value.indexOf(`## ${nadpis}\n`);
        t.focus();
        if (kde !== -1) t.selectionStart = t.selectionEnd = kde + nadpis.length + 4;
        t.dispatchEvent(new Event('input'));
        oddily();
      },
    })));
  }

  async function otevrit(id) {
    await zavrit();
    let z;
    try {
      z = await api(`/api/kanon/entita/${encodeURIComponent(id)}/zdroj`);
    } catch (chyba) {
      toast(chyba.message, { chyba: true });
      location.hash = `kanon/${encodeURIComponent(id)}`;
      return;
    }
    // Živý náhled (⚠ bod 150): formátování přímo v textu, značky jen na řádku s kurzorem.
    const textarea = await vytvoritPole(z.telo, {
      popisekOdkazu: (cil) => {
        const e = s.podleId.get(cil);
        return { text: e?.nazev ?? cil, existuje: Boolean(e), barva: e ? barvaTypu(e.typ) : undefined };
      },
    });
    const naseptavac = el('ul', { className: 'naseptavac', hidden: true, role: 'listbox' });
    // Náhled vedle je s živým náhledem navíc: výchozí je skrytý, tlačítko Náhled ho ukáže.
    let nahledVypnuty = true;
    try {
      nahledVypnuty = localStorage.getItem('dmhub-editor-nahled-vedle') !== '1';
    } catch {
      /* bez úložiště */
    }
    const nahledEl = el('div', { className: 'text-karty editor-nahled', hidden: nahledVypnuty });
    const stavEl = el('span', { className: 'ulozeni stav-editoru', textContent: naWebu() ? 'Uloží se tlačítkem Uložit nebo Hotovo' : 'Ukládá se samo' });
    const nastroj = (text, titul, akce) => el('button', { type: 'button', className: 'mala', textContent: text, title: titul, onclick: akce });
    const tlacitkoNahledu = el('button', { type: 'button', className: 'mala', textContent: 'Náhled', 'aria-pressed': String(!nahledEl.hidden) });
    tlacitkoNahledu.addEventListener('click', () => {
      nahledEl.hidden = !nahledEl.hidden;
      tlacitkoNahledu.setAttribute('aria-pressed', String(!nahledEl.hidden));
      try {
        localStorage.setItem('dmhub-editor-nahled-vedle', nahledEl.hidden ? '0' : '1');
      } catch {
        /* bez úložiště */
      }
      nahled();
    });
    const formular = el('form', { className: 'editor-karty', autocomplete: 'off' },
      el('div', { className: 'editor-hlava' },
        el('nav', { className: 'drobecky' }, el('a', { href: '#kanon', textContent: 'Kánon' }), ' › ', el('a', { href: `#kanon/typ/${z.typ}`, textContent: TYPY[z.typ]?.mn ?? z.typ }), ' › '),
        el('div', { className: 'radek-hlavy' },
          el('h2', { className: 'wiki-nadpis', textContent: `Úprava: ${z.pole.nazev ?? id}` }),
          stavEl,
          naWebu() ? el('button', { type: 'button', textContent: 'Uložit', title: 'Uloží na GitHub (Ctrl+S)', onclick: () => ulozit() }) : null,
          el('a', { className: 'tlacitko hlavni', href: `#kanon/${encodeURIComponent(id)}`, textContent: 'Hotovo', title: naWebu() ? 'Uloží a zavře' : undefined }))),
      el('div', { className: 'editor-pole' }, ...[]),
      el('div', { className: 'editor-psani' },
        el('div', { className: 'editor-nastroje', role: 'toolbar', 'aria-label': 'Formátování' },
          nastroj('B', 'Tučně', () => vlozit('**', '**', 'tučně')),
          nastroj('I', 'Kurzíva', () => vlozit('*', '*', 'kurzíva')),
          nastroj('Nadpis', 'Nadpis oddílu (##)', () => zacatekRadku('## ')),
          nastroj('• Odrážka', 'Odrážka', () => zacatekRadku('- ')),
          nastroj('[[ Odkaz', 'Odkaz na jinou kartu', () => {
            vlozit('[[', '');
            naseptavani();
          }),
          nastroj('+ Jen pro DM', 'Přidá oddíl DM (družina ho nikdy neuvidí)', () => {
            textarea.value = `${textarea.value.replace(/\s+$/, '')}\n\n## DM\n\n`;
            textarea.focus();
            textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
            textarea.dispatchEvent(new Event('input'));
          }),
          el('span', { className: 'oddelovac' }),
          tlacitkoNahledu),
        el('div', { className: 'editor-oddily', 'aria-live': 'polite' }),
        el('div', { className: 'editor-plochy' }, el('div', { className: 'editor-obal' }, textarea.element, naseptavac), nahledEl),
        el('p', { className: 'poznamka napoveda-editoru' }, 'Markdown jako v Obsidianu. ', el('kbd', { textContent: '/' }), ' nabídne prvek k vložení (nadpis, odrážka, tabulka, oddíl…), ', el('kbd', { textContent: '[[' }), ' našeptá odkaz na kartu, ', el('kbd', { textContent: 'Ctrl+S' }), ' uloží hned. V oddílu ', el('strong', { textContent: 'Co ví družina' }), ' je každá odrážka zvlášť; odkrytá má na konci značku ', el('code', { textContent: '%%zná%%' }), ' (v kartě ji přepneš okem 👁). Stejnou značkou na konci prvního řádku odkryješ i kterýkoli odstavec nebo odrážku jinde v textu. Oddíly ', el('code', { textContent: '## DM…' }), ' družina nikdy neuvidí.')));
    kam.replaceChildren(formular);
    st = { id, nazev: z.pole.nazev ?? id, typ: z.typ, hash: z.hash, ulozeneTelo: z.telo, textarea, naseptavac, nahledEl, stavEl, formular, zmenenaPole: {}, casovac: null, bezi: null, znovu: false, konflikt: null, nalez: [], vybranyNalez: 0, dotazOdkazu: '' };
    nahradit(formular.querySelector('.editor-pole'), ...poleFormulare(z, z.typ), z.typ === 'sezeni' ? null : prezdivky(z), portret(z));
    oddily();
    textarea.addEventListener('input', () => {
      clearTimeout(st.casovacOddilu);
      st.casovacOddilu = setTimeout(oddily, 400);
      naplanovat();
      naseptavani();
      clearTimeout(st.casovacNahledu);
      st.casovacNahledu = setTimeout(nahled, 250);
    });
    textarea.addEventListener('keydown', (ev) => {
      if (!st.naseptavac.hidden) {
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
          ev.preventDefault();
          st.vybranyNalez = (st.vybranyNalez + (ev.key === 'ArrowDown' ? 1 : -1) + st.nalez.length) % st.nalez.length;
          vykreslitNaseptavac();
          return;
        }
        if (ev.key === 'Enter' || ev.key === 'Tab') {
          ev.preventDefault();
          if (st.rezim === 'prikaz') vlozitPrikaz(st.nalez[st.vybranyNalez]);
          else doplnitOdkaz(st.nalez[st.vybranyNalez]);
          return;
        }
        if (ev.key === 'Escape') {
          ev.preventDefault();
          ev.stopPropagation();
          st.naseptavac.hidden = true;
          return;
        }
      }
    });
    // Kurzor přesunutý myší: nabídka (odkaz, příkaz) se přepočítá podle nového místa.
    textarea.addEventListener('click', () => naseptavani());
    textarea.addEventListener('blur', () => setTimeout(() => {
      if (st) st.naseptavac.hidden = true;
    }, 150));
    formular.addEventListener('submit', (ev) => ev.preventDefault());
    formular.addEventListener('keydown', (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') {
        ev.preventDefault();
        ulozit();
      }
    });
    nahled();
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(0, 0);
    textarea.scrollTop = 0;
  }

  /** Zavře editor a uloží rozepsané (při odchodu na jinou stránku). */
  async function zavrit() {
    if (!st) return;
    clearTimeout(st.casovac);
    await ulozit();
    if (st.bezi) await st.bezi;
    const nedokonceno = st.konflikt || st.textarea.value !== st.ulozeneTelo;
    if (nedokonceno) toast('Úprava karty se neuložila (karta se změnila jinde). Otevři ji znovu přes Upravit.', { chyba: true });
    st = null;
    ctx.poZavreni?.();
  }

  // Zavření okna s rozepsanou kartou: prohlížeč se zeptá.
  addEventListener('beforeunload', (ev) => {
    if (st && (st.textarea.value !== st.ulozeneTelo || Object.keys(st.zmenenaPole).length)) {
      ulozit();
      ev.preventDefault();
    }
  });

  return { otevrit, zavrit, upravuje: () => Boolean(st) };
}
