// Čtecí verze kánonu na GitHub Pages (Blok 3, rozhodnutí 3).
// Stejný modul Kánon jako v Hubu, jen místo serveru čte předgenerovaná data (skripty/stranky.js)
// a nic nemění: ovládání úprav, poznámek a OBS se nezobrazuje (jenCteni).
import { vytvoritKanon } from '/panel/kanon.js';

const $ = (sel) => document.querySelector(sel);

async function nactiJson(cesta) {
  const odpoved = await fetch(cesta, { cache: 'no-cache' });
  if (odpoved.status === 404) throw Object.assign(new Error('Karta v čtecí verzi není.'), { status: 404 });
  if (!odpoved.ok) throw new Error(`Stránka vrátila ${odpoved.status}.`);
  return odpoved.json();
}

/** Náhrada API Hubu: jen čtení z předgenerovaných souborů ve složce data/. */
async function api(cesta, { metoda = 'GET' } = {}) {
  if (metoda !== 'GET') throw new Error('Tohle je čtecí verze. Měnit jde jen v Hubu doma.');
  const url = new URL(cesta, location.href);
  const pohled = url.searchParams.get('pohled') === 'druzina' ? 'druzina' : 'dm';
  if (url.pathname.endsWith('/api/kanon')) return nactiJson(`data/kanon-${pohled}.json`);
  let m = /\/api\/kanon\/entita\/([a-z0-9-]{1,80})$/.exec(url.pathname);
  if (m) return nactiJson(`data/entita/${pohled}/${m[1]}.json`);
  m = /\/api\/kanon\/nastenky\/([a-z0-9-]{1,60})$/.exec(url.pathname);
  if (m) return nactiJson(`data/nastenky/${m[1]}.json`);
  throw new Error('Tohle čtecí verze neumí.');
}

let casovacToastu = null;
function toast(text, { chyba = false } = {}) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.toggle('chyba', chyba);
  t.hidden = false;
  clearTimeout(casovacToastu);
  casovacToastu = setTimeout(() => (t.hidden = true), chyba ? 7000 : 3500);
}

const kanon = vytvoritKanon({ api, toast, otevritPoznamku: () => {}, jenCteni: true });

function ukazat() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h !== 'kanon' && !h.startsWith('kanon/')) {
    history.replaceState(null, '', '#kanon');
    return ukazat();
  }
  $('#obrazovka-kanon').hidden = false;
  kanon.ukazat(h === 'kanon' ? '' : h.slice(6));
}
window.addEventListener('hashchange', ukazat);
ukazat();

/* ---------- Hledání v liště (stejně jako v Hubu) ---------- */
{
  const vstup = $('#hledat-kanon');
  const seznam = $('#hledat-vysledky');
  let vysledky = [];
  let aktivni = 0;
  let poradi = 0;
  const zavrit = () => {
    seznam.hidden = true;
    vstup.setAttribute('aria-expanded', 'false');
  };
  const otevrit = (id) => {
    zavrit();
    vstup.value = '';
    kanon.hledat('');
    const adresa = kanon.adresa(id);
    if (location.hash === `#${adresa}`) kanon.ukazat(adresa.slice(6));
    else location.hash = adresa;
    vstup.blur();
  };
  const vykreslit = () => {
    seznam.replaceChildren(
      ...(vysledky.length
        ? vysledky.map((e, i) => {
          const li = document.createElement('li');
          li.setAttribute('role', 'option');
          li.setAttribute('aria-selected', String(i === aktivni));
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'polozka-hledani';
          b.style.setProperty('--c', e.barva);
          const tecka = document.createElement('span');
          tecka.className = 'tecka';
          const typ = document.createElement('small');
          typ.textContent = ` ${e.typText}`;
          b.append(tecka, `${e.ikona ? `${e.ikona} ` : ''}${e.nazev}`, typ);
          b.addEventListener('mousedown', (ev) => ev.preventDefault());
          b.addEventListener('click', () => otevrit(e.id));
          li.append(b);
          return li;
        })
        : [Object.assign(document.createElement('li'), { className: 'poznamka', textContent: 'Nic nenalezeno.' })]),
    );
    seznam.hidden = false;
    vstup.setAttribute('aria-expanded', 'true');
  };
  vstup.addEventListener('input', async () => {
    const dotaz = vstup.value;
    const moje = ++poradi;
    const r = await kanon.hledat(dotaz);
    if (moje !== poradi) return;
    vysledky = r;
    aktivni = 0;
    if (!dotaz.trim()) zavrit();
    else vykreslit();
  });
  vstup.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!vysledky.length) return;
      aktivni = (aktivni + (e.key === 'ArrowDown' ? 1 : -1) + vysledky.length) % vysledky.length;
      vykreslit();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (vysledky[aktivni]) otevrit(vysledky[aktivni].id);
    } else if (e.key === 'Escape') {
      vstup.value = '';
      kanon.hledat('');
      zavrit();
      vstup.blur();
    }
  });
  vstup.addEventListener('blur', () => setTimeout(zavrit, 150));
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      vstup.focus();
      vstup.select();
    }
  });
}
