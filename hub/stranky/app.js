// Čtecí verze kánonu na GitHub Pages (Blok 3, rozhodnutí 3).
// Stejný modul Kánon jako v Hubu, jen místo serveru čte předgenerovaná data (skripty/stranky.js).
// Ovládání poznámek, OBS a úprav celé sítě se nezobrazuje (jenCteni). Text karty, přepínače,
// přezdívky a odrážky Co ví družina jde v pohledu DM upravit: ukládají se přes GitHub API
// s osobním tokenem DM (webUpravy, ⚠ bod 146).
// Pohled družiny je otevřený, pohled DM je zašifrovaný heslem (⚠ bod 124).
import { vytvoritKanon } from '/panel/kanon.js';
import { GitHubSoubory, vytvoritUpravyWebu } from '/sdilene/upravy-webu.js';

const $ = (sel) => document.querySelector(sel);
/** Klíč k pohledu DM zapamatovaný na tomto zařízení (ne heslo samo). */
const ULOZENY_KLIC = 'dmhub-stranky-klic';
/** Osobní token GitHubu pro úpravy na webu (jen na tomto zařízení). */
const ULOZENY_TOKEN = 'dmhub-stranky-token';
/** Volby modulu Kánon (stejný klíč jako v kanon.js). */
const VOLBY_KANONU = 'dmhub-kanon';

async function nactiJson(cesta) {
  const odpoved = await fetch(cesta, { cache: 'no-cache' });
  if (odpoved.status === 404) {
    // Otevřená stránka ze starší verze hledá soubory, které nová verze už nemá: načíst znovu.
    if (await zkontrolovatVerzi()) throw new Error('Vyšla nová verze čtecí verze, načítám ji znovu…');
    throw Object.assign(new Error('Karta v čtecí verzi není.'), { status: 404 });
  }
  if (!odpoved.ok) throw new Error(`Stránka vrátila ${odpoved.status}.`);
  return odpoved.json();
}

/* ---------- Nová verze: stránka otevřená přes nasazení se načte znovu sama ---------- */

let sestaveno = null;
let obnovuje = false;
/** Modul Kánon (vzniká níž, až jsou načtená data stránky). */
let kanon = null;
/** Vyšla od načtení stránky nová verze? Když ano, stránku za chvíli načte znovu a vrátí true. */
async function zkontrolovatVerzi() {
  if (obnovuje) return true;
  // Rozepsanou kartu nová verze nepřeruší; načte se po zavření editoru (další kontrola).
  if (kanon?.upravuje()) return false;
  try {
    const nove = (await (await fetch('data/stranky.json', { cache: 'no-cache' })).json()).sestaveno ?? null;
    if (!sestaveno || !nove || nove === sestaveno) return false;
  } catch {
    return false;
  }
  obnovuje = true;
  toast('Vyšla nová verze kánonu, načítám ji…');
  setTimeout(() => location.reload(), 1500);
  return true;
}

/* ---------- Pohled DM: rozšifrování heslem ---------- */

const zBase64 = (text) => Uint8Array.from(atob(text), (z) => z.charCodeAt(0));
const doBase64 = (bajty) => btoa(String.fromCharCode(...new Uint8Array(bajty)));

function nacistKlic() {
  try {
    const ulozeny = localStorage.getItem(ULOZENY_KLIC);
    return ulozeny ? crypto.subtle.importKey('raw', zBase64(ulozeny), 'AES-GCM', true, ['decrypt']) : null;
  } catch {
    return null;
  }
}
function zapomenoutKlic() {
  try {
    localStorage.removeItem(ULOZENY_KLIC);
  } catch {
    /* soukromé okno */
  }
}
async function ulozitKlic(klic) {
  try {
    localStorage.setItem(ULOZENY_KLIC, doBase64(await crypto.subtle.exportKey('raw', klic)));
  } catch {
    /* soukromé okno: heslo platí jen do zavření stránky */
  }
}

/** Klíč z hesla stejně jako při sestavení (PBKDF2-SHA256, parametry ze souboru). */
async function klicZHesla(heslo, soubor) {
  const zaklad = await crypto.subtle.importKey('raw', new TextEncoder().encode(heslo.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: zBase64(soubor.sul), iterations: soubor.iterace }, zaklad, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
}

async function rozbalit(klic, soubor) {
  const gz = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: zBase64(soubor.iv) }, klic, zBase64(soubor.data));
  const text = await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  return JSON.parse(text);
}

/** Zeptá se na heslo. Vrací { heslo, pamatovat }, nebo null (Pohled družiny). */
function zeptatSeNaHeslo(chyba = '') {
  const dialog = $('#dialog-heslo');
  const pole = $('#pole-heslo');
  $('#heslo-chyba').textContent = chyba;
  pole.value = '';
  dialog.returnValue = '';
  dialog.showModal();
  pole.focus();
  return new Promise((hotovo) => {
    dialog.addEventListener('close', () => hotovo(dialog.returnValue === 'odemknout' && pole.value ? { heslo: pole.value, pamatovat: $('#pamatovat-heslo').checked } : null), { once: true });
  });
}

let stranky = { dm: false };
let balikDm = null;
let odemykani = null;

function prepnoutNaDruzinu() {
  setTimeout(() => $('#kanon-pohled [data-pohled="druzina"]')?.click(), 0);
}

async function odemknout() {
  if (!stranky.dm) throw new Error('Pohled DM tu není.');
  const soubor = await nactiJson('data/dm.json');
  const ulozeny = await nacistKlic();
  if (ulozeny) {
    try {
      balikDm = await rozbalit(ulozeny, soubor);
    } catch {
      zapomenoutKlic(); // heslo se mezitím změnilo
    }
  }
  let chyba = '';
  while (!balikDm) {
    const odpoved = await zeptatSeNaHeslo(chyba);
    if (!odpoved) {
      prepnoutNaDruzinu();
      throw new Error('Pohled DM je zamčený heslem.');
    }
    const klic = await klicZHesla(odpoved.heslo, soubor);
    try {
      balikDm = await rozbalit(klic, soubor);
      if (odpoved.pamatovat) await ulozitKlic(klic);
    } catch {
      chyba = 'Nesprávné heslo.';
    }
  }
  $('#zamknout-dm').hidden = false;
  return balikDm;
}

/** Data pohledu DM; při prvním použití se zeptá na heslo (souběžné dotazy čekají na jedno odemčení). */
async function dataDm() {
  if (balikDm) return balikDm;
  odemykani ??= odemknout().finally(() => (odemykani = null));
  return odemykani;
}

/* ---------- Úpravy na webu: token GitHubu a zápis přes GitHub API (⚠ bod 146) ---------- */

let token = '';
try {
  token = localStorage.getItem(ULOZENY_TOKEN) ?? '';
} catch {
  /* soukromé okno */
}
function zapomenoutToken() {
  token = '';
  try {
    localStorage.removeItem(ULOZENY_TOKEN);
  } catch {
    /* soukromé okno */
  }
}

/** Zeptá se na token a ověří ho na GitHubu. Vrací true, když je připojený. */
async function pripojitGitHub(chyba = '') {
  const { repo } = stranky.zapis;
  const [vlastnik, nazevRepa] = repo.split('/');
  const dialog = $('#dialog-github');
  const pole = $('#pole-token');
  const odkaz = new URL('https://github.com/settings/personal-access-tokens/new');
  odkaz.search = new URLSearchParams({
    name: 'DM Hub web', description: `Úpravy kánonu z ${location.host} (jen repo ${repo}, Contents: Read and write)`,
    target_name: vlastnik, expires_in: '90', contents: 'write',
  }).toString();
  $('#odkaz-token').href = odkaz.href;
  $('#repo-tokenu').textContent = nazevRepa;
  for (;;) {
    $('#token-chyba').textContent = chyba;
    pole.value = '';
    dialog.returnValue = '';
    dialog.showModal();
    pole.focus();
    const odpoved = await new Promise((hotovo) => {
      dialog.addEventListener('close', () => hotovo(dialog.returnValue === 'ulozit' && pole.value.trim() ? { token: pole.value.trim(), pamatovat: $('#pamatovat-token').checked } : null), { once: true });
    });
    if (!odpoved) return false;
    let r;
    try {
      r = await fetch(`https://api.github.com/repos/${repo}`, { cache: 'no-store', headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${odpoved.token}` } });
    } catch {
      chyba = 'GitHub není dostupný. Zkontroluj připojení.';
      continue;
    }
    if (r.status === 401) {
      chyba = 'Token neplatí. Zkopíruj ho celý (začíná github_pat_).';
      continue;
    }
    if (!r.ok) {
      chyba = `Token nevidí repo ${repo}. Při vytváření vyber Only select repositories → ${nazevRepa}.`;
      continue;
    }
    token = odpoved.token;
    if (odpoved.pamatovat) {
      try {
        localStorage.setItem(ULOZENY_TOKEN, token);
      } catch {
        /* soukromé okno: token platí jen do zavření stránky */
      }
    }
    toast('GitHub připojený. Úpravy se ukládají do repa, web se obnoví za 2–3 minuty.');
    return true;
  }
}

let upravyWebu = null;
/** Zápis přes GitHub; bez tokenu (nebo s neplatným) se zeptá a zkusí to znovu. */
async function zapsatNaWebu(cesta, volby) {
  upravyWebu ??= vytvoritUpravyWebu({
    soubory: new GitHubSoubory({ repo: stranky.zapis.repo, vetev: stranky.zapis.vetev, token: () => token }),
    balik: () => balikDm,
    // Seznam v modulu Kánon je tentýž objekt jako balíček; jiná verze ho přiměje načíst se znovu.
    poZmene: () => setTimeout(() => kanon.zmena({ verze: null }), 0),
  });
  for (let pokus = 0; ; pokus++) {
    if (!token && !(await pripojitGitHub())) throw new Error('Bez připojení ke GitHubu se úprava neuloží.');
    try {
      return await upravyWebu(cesta, volby);
    } catch (e) {
      if (e.kod !== 'token' || pokus > 0) throw e;
      zapomenoutToken();
      if (!(await pripojitGitHub(e.message))) throw e;
    }
  }
}

/* ---------- Náhrada API Hubu: čtení z předgenerovaných souborů ve složce data/ ---------- */

async function api(cesta, volby = {}) {
  const { metoda = 'GET' } = volby;
  const zapis = metoda !== 'GET' || /\/api\/kanon\/entita\/[a-z0-9-]{1,80}\/zdroj$/.test(new URL(cesta, location.href).pathname);
  if (zapis) {
    if (!stranky.zapis) throw new Error('Tohle je čtecí verze. Měnit jde jen v Hubu doma.');
    await dataDm();
    const r = await zapsatNaWebu(cesta, volby);
    if (r === undefined) throw new Error('Tohle jde změnit jen v Hubu doma.');
    return r;
  }
  const url = new URL(cesta, location.href);
  const pohled = url.searchParams.get('pohled') === 'druzina' ? 'druzina' : 'dm';
  let m = /\/api\/kanon\/nastenky\/([a-z0-9-]{1,60})$/.exec(url.pathname);
  if (m) return balikDm?.nastenky[m[1]] ?? nactiJson(`data/nastenky/${m[1]}.json`);
  if (pohled === 'druzina') {
    if (url.pathname.endsWith('/api/kanon')) return nactiJson('data/kanon-druzina.json');
    m = /\/api\/kanon\/entita\/([a-z0-9-]{1,80})$/.exec(url.pathname);
    if (m) return nactiJson(`data/entita/druzina/${m[1]}.json`);
  } else {
    const dm = await dataDm();
    if (url.pathname.endsWith('/api/kanon')) return dm.seznam;
    m = /\/api\/kanon\/entita\/([a-z0-9-]{1,80})$/.exec(url.pathname);
    if (m) {
      if (!dm.karty[m[1]]) throw Object.assign(new Error('Karta v kánonu není.'), { status: 404 });
      return dm.karty[m[1]];
    }
  }
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

stranky = await nactiJson('data/stranky.json').catch(() => ({ dm: false }));
sestaveno = stranky.sestaveno ?? null;
setInterval(zkontrolovatVerzi, 60000);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && zkontrolovatVerzi());
// Kdo heslo na tomto zařízení nezadal (hráči), začíná v pohledu družiny, bez dotazu na heslo.
if (!stranky.dm || !(await nacistKlic())) {
  try {
    const volby = JSON.parse(localStorage.getItem(VOLBY_KANONU)) ?? {};
    localStorage.setItem(VOLBY_KANONU, JSON.stringify({ ...volby, pohled: 'druzina' }));
  } catch {
    /* soukromé okno: kanon.js pak začne v pohledu DM a zeptá se na heslo */
  }
}

/** Soubor karty (kampan/…/karta.md) v editoru GitHubu; GitHub si sám řekne o přihlášení. */
const upravitNaGitHubu = stranky.upravy
  ? (soubor) => `${stranky.upravy}${soubor.split('/').map(encodeURIComponent).join('/')}`
  : null;
kanon = vytvoritKanon({ api, toast, otevritPoznamku: () => {}, jenCteni: true, upravitNaGitHubu, webUpravy: Boolean(stranky.zapis) });
if (!stranky.dm) $('#kanon-pohled [data-pohled="dm"]').hidden = true;

$('#zamknout-dm').addEventListener('click', () => {
  zapomenoutKlic();
  zapomenoutToken();
  balikDm = null;
  $('#zamknout-dm').hidden = true;
  prepnoutNaDruzinu();
  toast('Pohled DM je na tomto zařízení zase zamčený, token GitHubu zapomenutý.');
});

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
