// Ovládací panel DM Hubu. Bez build kroku, čistý JavaScript.
import { Harptos, MESICE, SVATKY, dnyText, zbyvaText } from '/sdilene/harptos.js';
import { odebirat } from '/sdilene/zive.js';
import { vytvoritKanon, stromMist } from '/panel/kanon.js';

const $ = (sel) => document.querySelector(sel);

const stav = {
  prehled: null,
  serverOk: false,
  rozpracovano: new Set(), // pole, která DM právě píše a ještě se neodeslala
};

/**
 * Požadavek na Hub. Bez odpovědi do limitu skončí chybou, aby panel tiše nevisel (audit N13).
 * Operace Gitu a nahrání obrázku z dílny mají delší limit.
 */
async function api(cesta, { metoda = 'GET', telo, limitMs } = {}) {
  const limit = limitMs ?? (cesta.startsWith('/api/git/') || cesta.startsWith('/api/dilna/') ? 180000 : 20000);
  // Tlačítko, které změnu spustilo, je do odpovědi zamčené: dvojklik tak nic neprovede dvakrát (audit S3).
  // Safari na iPadu tlačítko po kliknutí nefokusuje, proto i naposledy kliknuté tlačítko.
  const naposledy = performance.now() - posledniKlik.cas < 1000 ? posledniKlik.tlacitko : null;
  const tlacitko = metoda === 'GET' ? null : document.activeElement instanceof HTMLButtonElement ? document.activeElement : naposledy;
  tlacitko?.setAttribute('aria-busy', 'true');
  try {
    return await poslat(cesta, metoda, telo, limit);
  } finally {
    tlacitko?.removeAttribute('aria-busy');
  }
}

// Klik na tlačítko, jehož požadavek ještě běží, se zahodí dřív, než ho dostane obsluha.
let posledniKlik = { tlacitko: null, cas: 0 };
document.addEventListener(
  'click',
  (e) => {
    const b = e.target instanceof Element ? e.target.closest('button') : null;
    if (!b) return;
    if (b.getAttribute('aria-busy') === 'true') {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    posledniKlik = { tlacitko: b, cas: performance.now() };
  },
  true,
);

async function poslat(cesta, metoda, telo, limit) {
  let odpoved;
  try {
    odpoved = await fetch(cesta, {
      method: metoda,
      headers: telo !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: telo !== undefined ? JSON.stringify(telo) : undefined,
      signal: AbortSignal.timeout(limit),
    });
  } catch (e) {
    if (e.name === 'TimeoutError') throw new Error(`Hub neodpověděl do ${Math.round(limit / 1000)} s. Zkontroluj kontrolku Server vpravo nahoře.`);
    throw new Error('Hub není dostupný. Běží? (kontrolka Server vpravo nahoře)');
  }
  const data = await odpoved.json().catch(() => ({}));
  if (!odpoved.ok) throw Object.assign(new Error(data.chyba || `Server vrátil ${odpoved.status}`), { kod: data.kod });
  return data;
}

function cas() {
  return new Date().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/* ---------- Navigace ---------- */

// Stará adresa: Odpočet je od Bloku 2b součástí obrazovky U stolu (dlaždice Start).
// #obchody je od rozhodnutí 51 samostatná obrazovka Obchody (skupina Příprava).
const PRESMEROVANI = { odpocet: ['sceny', 'start'] };

function ukazObrazovku(jmeno) {
  const platne = ['prehled', 'sceny', 'kanon', 'kalendar', 'mista', 'obchody', 'dilna', 'kontrola', 'nastaveni'];
  // #kanon/<id>: Kánon s vybranou entitou (odkazy z hledání a z textu karet).
  let entita;
  if (jmeno.startsWith('kanon/')) {
    entita = jmeno.slice(6); // cesta uvnitř Kánonu (entita, mapa, typ, události), dekóduje ji modul
    jmeno = 'kanon';
  } else if (jmeno === 'kanon') entita = '';
  if (PRESMEROVANI[jmeno]) {
    stav.stulVyber = PRESMEROVANI[jmeno][1];
    jmeno = PRESMEROVANI[jmeno][0];
    history.replaceState(null, '', `#${jmeno}`);
  }
  // Kotvy z kontrolek v liště: Git → GitHub v Sezení, Světla → Nastavení → Světla.
  const KOTVY = { 'nastaveni-zaznam': 'nastaveni', 'prehled-github': 'prehled', 'nastaveni-svetla': 'nastaveni', 'nastaveni-zvuk': 'nastaveni', 'nastaveni-obs': 'nastaveni', 'nastaveni-hub': 'nastaveni', 'nastaveni-vystupy': 'nastaveni', 'nastaveni-role': 'nastaveni' };
  const kotva = KOTVY[jmeno] ? jmeno : null;
  if (kotva) jmeno = KOTVY[jmeno];
  const cil = platne.includes(jmeno) ? jmeno : 'prehled';
  if (cil === 'kalendar') nactiImport();
  if (cil === 'dilna') vykresliDilnu();
  for (const s of document.querySelectorAll('.obrazovka')) s.hidden = s.id !== `obrazovka-${cil}`;
  for (const a of document.querySelectorAll('.moduly a')) {
    if (a.dataset.obrazovka === cil) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  if (cil === 'nastaveni') ukazKategorii(KATEGORIE_KOTVY[kotva] ?? stav.nastaveniKat ?? 'obs', kotva);
  if (cil === 'kanon') kanon.ukazat(entita);
  else kanon.skryt();
  vykresliSceny();
  if (kotva && cil !== 'nastaveni') document.getElementById(kotva)?.scrollIntoView({ block: 'start' });
}
window.addEventListener('hashchange', () => ukazObrazovku(location.hash.slice(1)));

/* Nastavení po kategoriích: vlevo seznam, vpravo jen otevřená kategorie (rozhodnutí 65). */
const KATEGORIE_KOTVY = {
  'nastaveni-obs': 'obs', 'nastaveni-role': 'obs', 'nastaveni-svetla': 'svetla', 'nastaveni-zvuk': 'zvuk',
  'nastaveni-vystupy': 'vystupy', 'nastaveni-hub': 'hub', 'nastaveni-zaznam': 'hub',
};
function ukazKategorii(k, kotva) {
  stav.nastaveniKat = k;
  for (const sekce of document.querySelectorAll('.kategorie')) sekce.hidden = sekce.dataset.kategorie !== k;
  for (const a of document.querySelectorAll('.nastaveni-kategorie a')) {
    if (a.dataset.kategorie === k) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  if (kotva === 'nastaveni-role') document.getElementById(kotva)?.scrollIntoView({ block: 'start' });
}
// Rozbalený Systém se zavře klikem mimo něj nebo po výběru kontrolky.
document.addEventListener('click', (e) => {
  const sys = $('#system');
  if (sys.open && (!sys.contains(e.target) || e.target.closest('.kontrolky a'))) sys.open = false;
});

/* ---------- Stav kampaně (horní lišta, Družina na obrazovce Sezení) ---------- */

/** Jak dlouho sezení běží („1:24“) podle začátku v hlavičce souboru sezení. */
function delkaSezeni(s) {
  if (!s?.bezi || !s.zacatek) return null;
  const ms = Date.now() - new Date(s.zacatek).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const min = Math.floor(ms / 60000);
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
}

/** Stav sezení do horní lišty: „sezení 3 běží 1:24“, nebo „po sezení 2“. */
function textSezeni() {
  const s = stav.prehled?.sezeni;
  if (!s || s.cislo == null) return '';
  if (s.bezi) {
    const delka = delkaSezeni(s);
    return `sezení ${s.cislo} běží${delka ? ` ${delka}` : ''}`;
  }
  return s.cislo > 0 ? `po sezení ${s.cislo}` : 'před prvním sezením';
}


function vykresliStav(s) {
  const k = s?.stav;
  // Bez spojení se serverem panel nic neví: neříkat „není zadané“, když jen čeká (audit N14).
  $('#lista-datum').textContent = k?.datumText || (s ? 'Datum není zadané' : 'Čekám na server…');
  $('#lista-misto').textContent = k?.misto || '';
  $('#lista-misto').hidden = !k?.misto;
  $('#lista-sezeni').textContent = textSezeni();
  if (k) {
    for (const [pole, hodnota] of [['misto', k.misto], ['sezeni', k.sezeni]]) {
      const input = $(`#pole-${pole}`);
      if (!stav.rozpracovano.has(pole) && document.activeElement !== input) input.value = hodnota ?? '';
    }
  }
  vykresliUpozorneni();
}

const casovaceUlozeni = new Map();
$('#formular-stav').addEventListener('input', (e) => {
  const pole = e.target.name;
  if (!pole) return;
  stav.rozpracovano.add(pole);
  $('#stav-ulozeni').textContent = 'Ukládám…';
  $('#stav-ulozeni').className = 'ulozeni';
  clearTimeout(casovaceUlozeni.get(pole));
  casovaceUlozeni.set(pole, setTimeout(() => ulozPole(pole, e.target), 350));
});
$('#formular-stav').addEventListener('submit', (e) => e.preventDefault());

async function ulozPole(pole, input) {
  if (pole === 'sezeni' && !/^\d+$/.test(input.value.trim())) {
    $('#stav-ulozeni').textContent = 'Číslo sezení musí být celé číslo.';
    $('#stav-ulozeni').className = 'ulozeni chyba';
    return;
  }
  const hodnota = pole === 'sezeni' ? Number(input.value) : input.value;
  try {
    const { vysledek } = await api('/api/stav', { metoda: 'PUT', telo: { [pole]: hodnota } });
    stav.rozpracovano.delete(pole);
    const zprava = $('#stav-ulozeni');
    if (vysledek === 'odlozeno') {
      zprava.textContent = 'Soubor stav.md drží otevřený jiný program. Změna je v OBS a uloží se, jakmile to půjde.';
      zprava.className = 'ulozeni varovani';
    } else {
      zprava.textContent = `Uloženo v ${cas()}`;
      zprava.className = 'ulozeni';
    }
  } catch (e) {
    $('#stav-ulozeni').textContent = `Neuloženo: ${e.message}`;
    $('#stav-ulozeni').className = 'ulozeni chyba';
  }
}

/* ---------- Upozornění ---------- */

function zprava(text, { chyba = false, tlacitko } = {}) {
  const div = document.createElement('div');
  div.className = chyba ? 'zprava chyba' : 'zprava';
  const p = document.createElement('p');
  p.textContent = text;
  div.append(p);
  if (tlacitko) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = tlacitko.text;
    b.addEventListener('click', tlacitko.akce);
    div.append(b);
  }
  return div;
}

let casovacOdpoctuRestartu = null;
function vykresliUpozorneni() {
  const box = $('#upozorneni');
  box.replaceChildren();
  const p = stav.prehled;
  if (!stav.serverOk) {
    box.append(zprava('Server neodpovídá. Spouštěč ho do pár sekund spustí znovu; výstupy v OBS mezitím drží poslední stav.', { chyba: true }));
    return;
  }
  if (!p) return;
  $('#lista-zkouska').hidden = !p.prostredi?.zkouska;
  if (p.server?.restartV) {
    // Restart po aktualizaci (bod 91): odpočet s možností odložit.
    const zbyva = Math.max(0, Math.ceil((p.server.restartV - Date.now() - (stav.odchylkaHodin ?? 0)) / 1000));
    const z = zprava(`Nová verze Hubu je stažená. Hub se za ${zbyva} s restartuje sám; panel i výstupy v OBS se pak načtou znovu.`, { tlacitko: { text: 'Restartovat hned', akce: restartovatHub } });
    const odlozit = Object.assign(document.createElement('button'), { type: 'button', className: 'tiche', textContent: 'Teď ne' });
    odlozit.addEventListener('click', () => api('/api/restart/zrusit', { metoda: 'POST', telo: {} }).catch((e) => toast(e.message, { chyba: true })));
    z.append(odlozit);
    box.append(z);
    clearTimeout(casovacOdpoctuRestartu);
    casovacOdpoctuRestartu = setTimeout(vykresliUpozorneni, 1000);
  } else if (p.server?.restartNutny) {
    box.append(
      p.server.restartZPanelu
        ? zprava(p.server.restartNutny, { tlacitko: { text: 'Restartovat Hub', akce: restartovatHub } })
        : zprava(`${p.server.restartNutny} Zavři okno DM Hub a spusť ho znovu.`),
    );
  }
  if (p.stav?.chyba) box.append(zprava(`Soubor stav.md nejde přečíst: ${p.stav.chyba}. Panel ukazuje poslední platný stav.`, { chyba: true }));
  if (p.stav?.odlozeneZapisy?.length) {
    box.append(zprava(`Čeká na zápis (soubor drží otevřený jiný program): ${p.stav.odlozeneZapisy.join(', ')}. Hub to zkouší znovu každou sekundu.`));
  }
  if (p.prostredi?.oneDrive) {
    box.append(zprava('Repo leží ve složce OneDrive. OneDrive soubory zamyká a ruší hlídání změn. Přesuň klon mimo OneDrive.', { chyba: true }));
  }
  if (p.prostredi?.hook === 'cizi-hook') {
    box.append(zprava('V .git/hooks je jiný pre-commit hook, Hub ho nepřepsal. Ochrana proti commitu tajných hodnot proto neběží.'));
  }
  const g = p.git;
  if (g?.pozadu > 0) {
    const coUdela = p.prostredi?.zkouska ? 'Aktualizovat ji stáhne' : 'Aktualizovat uloží tvoje úpravy kampaně, stáhne ji';
    box.append(zprava(`Na GitHubu je nová verze (${g.pozadu} ${g.pozadu === 1 ? 'změna' : g.pozadu < 5 ? 'změny' : 'změn'}). ${coUdela} a případně Hub restartuje.`, { tlacitko: { text: 'Aktualizovat', akce: aktualizovat } }));
  }
  for (const v of p.obs?.varovaniZdroju ?? []) {
    box.append(zprava(`Zdroj „${v.zdroj}“ v OBS má zapnuté ${v.nastaveni.join(' a ')}. Vypni to, jinak výstup nepřežije výpadek Hubu.`));
  }
  if (p.nastaveni && !p.nastaveni.existuje && !p.prostredi?.zkouska) {
    box.append(zprava('Hub ještě není nastavený. Vyplň heslo k OBS v Nastavení.', { tlacitko: { text: 'Otevřít Nastavení', akce: () => (location.hash = 'nastaveni') } }));
  }
}

/** Restart z panelu: počká, až naběhne nový server (jiné PID), a načte panel znovu (nový kód). */
async function restartovatHub() {
  const staryPid = stav.prehled?.server?.pid;
  let port = location.port;
  try {
    ({ port } = await api('/api/restart', { metoda: 'POST', telo: {} }));
  } catch (e) {
    toast(e.message, { chyba: true });
    return;
  }
  toast('Hub se restartuje…');
  const adresa = `${location.protocol}//${location.hostname}:${port}`;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      if (String(port) !== location.port) {
        // Nový port: jiný původ, stačí, že odpovídá.
        await fetch(`${adresa}/api/zdravi`, { mode: 'no-cors', signal: AbortSignal.timeout(1000) });
        location.href = `${adresa}/${location.hash}`;
        return;
      }
      const z = await (await fetch('/api/zdravi', { signal: AbortSignal.timeout(1000) })).json();
      if (z.pid !== staryPid) {
        location.reload();
        return;
      }
    } catch {
      /* server ještě nenaběhl */
    }
  }
  toast('Hub po restartu neodpovídá. Podívej se do okna DM Hub nebo do hub/.stav/hub.log.', { chyba: true });
}
$('#tlacitko-restart').addEventListener('click', restartovatHub);

/* ---------- Kontrolky ---------- */

function vykresliKontrolky() {
  const p = stav.prehled;
  // Údržba v rozbalovacím Systému (bod 91): Kontrola dat a restart vždy po ruce.
  {
    const problemy = p?.kontrola?.problemy ?? [];
    const chyby = problemy.filter((x) => x.uroven === 'chyba').length;
    $('#system-kontrola').textContent = problemy.length ? `Kontrola dat · ${problemy.length}` : 'Kontrola dat';
    $('#system-kontrola').title = problemy.length ? `${chyby} chyb, ${problemy.length - chyby} varování` : 'Bez problémů';
    $('#system-kontrola').classList.toggle('hlavni', chyby > 0);
    const restart = $('#system-restart');
    restart.disabled = !p?.server?.restartZPanelu;
    restart.title = p?.server?.restartZPanelu ? 'Restartuje server; panel i výstupy v OBS se načtou samy' : 'Hub neběží přes zástupce DM Hub: zavři ho a spusť zástupcem';
    restart.classList.toggle('hlavni', Boolean(p?.server?.restartNutny));
    $('#system').classList.toggle('ceka-akce', Boolean(p?.server?.restartNutny || p?.git?.pozadu > 0));
  }
  $('#svetlo-server').dataset.stav = stav.serverOk ? (p?.stav?.odlozeneZapisy?.length ? 'varovani' : 'ok') : 'chyba';
  $('#svetlo-server').parentElement.title = stav.serverOk
    ? `Server běží (proces node.exe, PID ${p?.server?.pid ?? '?'})`
    : 'Server neodpovídá';

  const o = p?.obs;
  $('#svetlo-obs').dataset.stav = !o?.nastaveno ? 'ceka' : o.pripojeno ? (o.varovaniZdroju?.length ? 'varovani' : 'ok') : 'chyba';
  $('#svetlo-obs').parentElement.title = o?.pripojeno ? `Připojeno, scéna ${o.aktualniScena}` : o?.chyba || 'Nenastaveno';

  const g = p?.git;
  $('#svetlo-git').dataset.stav = !g || g.dostupny === null ? 'ceka' : !g.dostupny ? 'chyba' : g.pozadu > 0 || g.chyba ? 'varovani' : 'ok';
  $('#svetlo-git').parentElement.title = !g?.dostupny
    ? g?.chyba || 'Zjišťuji'
    : `Větev ${g.vetev}, neuložených souborů kampaně ${g.zmenenoKampan ?? g.zmeneno}${g.pozadu ? `, na GitHubu je ${g.pozadu} novějších změn` : ''}${g.chyba ? `. ${g.chyba}` : ''}`;
  const sv = p?.svetla;
  const zar = sv?.zarizeni ?? [];
  $('#svetlo-svetla').dataset.stav = !zar.length ? 'ceka' : zar.some((z) => z.ok === false) ? (zar.every((z) => z.ok === false) ? 'chyba' : 'varovani') : zar.every((z) => z.ok) ? 'ok' : 'ceka';
  $('#svetlo-svetla').parentElement.title = !zar.length
    ? 'Světla nejsou nastavená'
    : `${sv.ridit ? 'Hub řídí světla' : 'Hub na světla nesahá (Řídit světla je vypnuté)'}. ${zar.map((z) => `${NAZVY_ROLI[z.role]} ${z.typ === 'hue' ? 'Hue' : `WiZ ${z.id}`}: ${z.ok ? 'odpovídá' : z.ok === false ? z.chyba ?? 'neodpovídá' : 'zjišťuji'}`).join('; ')}`;
  const zv = p?.zvuk;
  const [sh, ss] = [zv?.stranky?.hudba, zv?.stranky?.stul];
  // Stránka Hudba v OBS se počítá, jen když hudba hraje v OBS (rozhodnutí 67).
  const hudbaVObs = zv?.hudbaKde === 'obs';
  const hudbaOk = !hudbaVObs || (sh?.pripojeno && sh.odemceno !== false && !sh.chyba);
  const zvukOk = hudbaOk && ss?.pripojeno && ss.odemceno && ss.vystup?.ok !== false && !ss.chyba;
  $('#svetlo-zvuk').dataset.stav = !zv ? 'ceka' : zvukOk ? 'ok' : (hudbaVObs && sh?.pripojeno) || ss?.pripojeno ? 'varovani' : 'chyba';
  $('#svetlo-zvuk').parentElement.title = !zv ? 'Zjišťuji' : [...(hudbaVObs ? [popisStrankyZvuku('Hudba v OBS', sh)] : []), popisStrankyZvuku('Zvuk u stolu', ss)].join('; ');
  // Stav i slovy, nejen barvou (čtečka obrazovky, audit N12). Rozbalený Systém ukazuje popis u každé kontrolky.
  const tecky = [];
  for (const k of ['server', 'obs', 'git', 'svetla', 'zvuk']) {
    const svetlo = $(`#svetlo-${k}`);
    const li = svetlo.parentElement;
    li.querySelector('small').textContent = li.title;
    li.setAttribute('aria-label', `${li.querySelector('.nazev').textContent}: ${li.title}`);
    tecky.push(Object.assign(document.createElement('span'), { className: 'svetlo' }));
    tecky.at(-1).dataset.stav = svetlo.dataset.stav;
  }
  $('#system-tecky').replaceChildren(...tecky);
  for (const t of document.querySelectorAll('.nastaveni-kategorie .svetlo[data-z]')) t.dataset.stav = $(`#svetlo-${t.dataset.z}`).dataset.stav;
  const spatne = tecky.filter((t) => ['chyba', 'varovani'].includes(t.dataset.stav)).length;
  $('#system-souhrn').setAttribute('aria-label', spatne ? `Stav systému: ${spatne} hlásí problém` : 'Stav systému: vše běží');
}

/* ---------- U stolu: dlaždice scén a ovládání podle role ---------- */

// Role scén v OBS. Dlaždice ukazuje ovládání té role, kterou má přiřazenou v tabulce Role scén.
const ROLE_SCEN = [['start', 'scenaStart', 'Start'], ['misto', 'scenaMisto', 'Místo'], ['obchod', 'scenaObchod', 'Obchod'], ['souboj', 'scenaSouboj', 'Souboj']];
const PANELY = ['start', 'misto', 'obchod', 'souboj'];
/** Improved Initiative: tracker zůstává jeho (rozhodnutí 6). Hub ho ukazuje v záložce Souboj, s Epic účtem ve vlastní záložce (F4). */
const ADRESA_INICIATIVY = 'https://improvedinitiative.app/e/';
/** Kam vložený Improved Initiative míří: s vloženým přihlášením jen přes průchod, nikdy napřímo. */
function adresaVlozeneIniciativy() {
  const pr = stav.prehled?.iniciativa?.pruchod;
  if (pr) return `http://${location.hostname}:${pr.port}/e/`;
  // Přihlášení je vložené, ale průchod ještě není znát: radši počkat, než načíst nepřihlášenou variantu.
  if (stav.prehled?.nastaveni?.iiRelaceNastavena) return null;
  return ADRESA_INICIATIVY;
}

const POCASI_TEXT = { dest: 'déšť', snih: 'sníh', mlha: 'mlha', bourka: 'bouřka' };
const NAZVY_ROLI = { hlavni: 'Hlavní', pozadi: 'Pozadí', lampa: 'Lampa' };
/** Počasí scény jako seznam efektů (starší server posílal jeden řetězec). */
function pocasiSeznam(p) {
  return Array.isArray(p) ? p : p && p !== 'zadne' ? [p] : [];
}

stav.stulMisto = null; // místo vybrané na U stolu, dokud ho DM nepošle do OBS (null = to, co je v OBS)
stav.stulVyber = null; // otevřená záložka nastavení scény; null = při prvním vykreslení podle scény v OBS

function roleScenyOBS(nazev) {
  const n = stav.prehled?.nastaveni;
  if (!nazev || !n) return null;
  return ROLE_SCEN.find(([, klic]) => n[klic] === nazev)?.[0] ?? null;
}

/** Náhled vpravo ukazuje výstup role, která je v OBS (bez OBS výstup místa). */
const NAHLEDY = { misto: '/vystupy/misto.html', obchod: '/vystupy/obchod.html', start: '/vystupy/odpocet.html' };

async function doObs(id) {
  const klic = ROLE_SCEN.find(([r]) => r === id)?.[1];
  const nazev = stav.prehled?.nastaveni?.[klic];
  try {
    // Role Souboj zahájí souboj celý (světla, hudba, zásobník), jako tlačítko Souboj v liště.
    if (id === 'souboj') {
      const v = await api('/api/souboj', { metoda: 'POST', telo: { zapnout: true } });
      if (v.chybaObs) toast(v.chybaObs, { chyba: true });
    } else await api('/api/obs/scena', { metoda: 'POST', telo: { nazev } });
  } catch (e) {
    toast(e.message, { chyba: true });
  }
}

function vykresliSceny() {
  const o = stav.prehled?.obs;
  const popis = $('#obs-popis');
  const pripojeno = Boolean(o?.pripojeno);
  let pripojitTlacitko = null;

  // Záložka s přípravou scény je nezávislá na tom, co je v OBS: DM si scénu připraví a přepne ji
  // tlačítkem Do OBS (rozhodnutí 65). Bez volby se otevře role scény, která je v OBS.
  if (!stav.stulVyber) stav.stulVyber = (pripojeno && roleScenyOBS(o.aktualniScena)) || 'start';
  const role = PANELY.includes(stav.stulVyber) ? stav.stulVyber : 'start';
  const roleVObs = pripojeno ? roleScenyOBS(o.aktualniScena) : null;

  // Text nad řadou jen při potížích s OBS; když vše běží, nic nevysvětluje.
  popis.hidden = pripojeno;
  if (!stav.prehled) popis.textContent = 'Čekám na server Hubu…';
  else if (!o?.nastaveno) popis.textContent = 'OBS není nastavené (Nastavení → OBS). Ovládání funguje, jen se nepřepínají scény.';
  else if (!pripojeno) {
    popis.textContent = `${o.chyba || 'OBS není připojené.'} Zkouším znovu každých 5 s.`;
    pripojitTlacitko = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Připojit teď' });
    pripojitTlacitko.addEventListener('click', () => api('/api/obs/pripojit', { metoda: 'POST', telo: {} }).catch(() => {}));
    popis.append(' ', pripojitTlacitko);
  }

  // Řada rolí: záložka (příprava) + Do OBS + štítek ŽIVĚ.
  const rada = $('#stul-zalozky');
  const souboj = stav.prehled?.scena?.rezim === 'souboj';
  const karty = ROLE_SCEN.map(([id, klic, jmeno]) => {
    const scena = stav.prehled?.nastaveni?.[klic];
    const karta = document.createElement('div');
    karta.className = 'role-karta';
    if (id === role) karta.classList.add('vybrana');
    if (id === roleVObs) karta.classList.add('v-obs');
    const zal = document.createElement('button');
    zal.type = 'button';
    zal.className = 'role-zalozka';
    zal.setAttribute('role', 'tab');
    zal.id = `zalozka-${id}`;
    zal.setAttribute('aria-controls', `stul-${id}`);
    zal.setAttribute('aria-selected', String(id === role));
    zal.tabIndex = id === role ? 0 : -1;
    zal.append(Object.assign(document.createElement('span'), { textContent: jmeno }));
    zal.append(Object.assign(document.createElement('small'), { textContent: podtitulRole(id, scena) }));
    zal.addEventListener('click', () => {
      stav.stulVyber = id;
      vykresliSceny();
    });
    karta.append(zal);
    if (id === roleVObs) {
      karta.append(Object.assign(document.createElement('span'), { className: 'zive', textContent: id === 'souboj' && souboj ? 'Souboj' : 'Živě' }));
    } else {
      const doObsBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'do-obs', textContent: 'Do OBS' });
      doObsBtn.disabled = !pripojeno || !scena;
      doObsBtn.title = !scena ? 'Role nemá scénu: přiřaď ji v Nastavení → Role scén v OBS' : !pripojeno ? 'OBS není připojené' : `Přepnout OBS na scénu ${scena}`;
      doObsBtn.addEventListener('click', () => doObs(id));
      karta.append(doObsBtn);
    }
    return karta;
  });
  // Scény bez role (Mapa, Pauza …): malá tlačítka na konci řady.
  const dalsi = document.createElement('div');
  dalsi.className = 'dalsi-sceny';
  if (pripojeno) {
    const bezRole = (o.sceny ?? []).filter((n) => !roleScenyOBS(n));
    if (bezRole.length) dalsi.append(Object.assign(document.createElement('span'), { textContent: 'Další scény:' }));
    for (const nazev of bezRole) {
      const b = Object.assign(document.createElement('button'), { type: 'button', textContent: nazev, title: `Přepnout OBS na scénu ${nazev}` });
      if (nazev === o.aktualniScena) {
        b.setAttribute('aria-pressed', 'true');
        b.classList.add('v-obs');
      }
      b.addEventListener('click', () => api('/api/obs/scena', { metoda: 'POST', telo: { nazev } }).catch((e) => toast(e.message, { chyba: true })));
      dalsi.append(b);
    }
  }
  dalsi.append(Object.assign(document.createElement('a'), { href: '#nastaveni-role', textContent: 'Role scén…', className: 'odkaz-role' }));
  rada.replaceChildren(...karty, dalsi);

  for (const id of PANELY) $(`#stul-${id}`).hidden = id !== role;
  // Vložený Improved Initiative se načte až při prvním otevření záložky Souboj a pak už zůstane načtený.
  // S vloženým přihlášením jde přes průchod Hubu (přihlášený Epic), jinak přímo (bez Epicu).
  const ramec = $('#iniciativa-ramec');
  const adresaRamce = adresaVlozeneIniciativy();
  if (role === 'souboj' && !$('#obrazovka-sceny').hidden && adresaRamce && ramec.dataset.adresa !== adresaRamce) {
    ramec.dataset.adresa = adresaRamce;
    ramec.setAttribute('src', adresaRamce);
  }
  vykresliSouboj();
  nahledMista(!$('#obrazovka-sceny').hidden, roleVObs);
}

/** Podtitul role v řadě: co je připravené. */
function podtitulRole(id, scena) {
  if (!scena) return 'bez scény v OBS';
  const p = stav.prehled;
  if (id === 'misto') return p?.scena?.misto?.nazev ?? 'žádné místo';
  if (id === 'obchod') return p?.obchody?.aktivni ? 'ceník v OBS' : 'ceník skrytý';
  if (id === 'start') return p?.odpocet?.stav === 'bezi' ? 'odpočet běží' : p?.odpocet?.stav === 'zadny' ? 'bez odpočtu' : 'odpočet připraven';
  if (id === 'souboj') return p?.scena?.rezim === 'souboj' ? 'souboj běží' : 'iniciativa';
  return `scéna ${scena}`;
}

// Šipky vlevo/vpravo mezi záložkami (přístupnost, vzor ARIA tabs).
$('#stul-zalozky').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const ids = ROLE_SCEN.map(([id]) => id);
  const i = ids.indexOf(stav.stulVyber);
  stav.stulVyber = ids[(i + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length];
  vykresliSceny();
  $(`#zalozka-${stav.stulVyber}`).focus();
});

/** Živý náhled výstupu místa: iframe 1920 × 1080 zmenšený na šířku rámečku, jen dokud je panel vidět. */
function nahledMista(zobrazit, roleVObs) {
  const ramec = $('#stul-nahled-ramec');
  // Souboj: náhled je Player View z Improved Initiative (bez CSS carouselu z OBS).
  const iniciativa = stav.prehled?.iniciativa?.odkaz;
  const cil = !zobrazit ? 'about:blank' : roleVObs === 'souboj' && iniciativa ? iniciativa : NAHLEDY[roleVObs] ?? NAHLEDY.misto;
  if (ramec.getAttribute('src') !== cil) ramec.setAttribute('src', cil);
  // Při souboji leží v OBS pod Player View zdroj Hub – místo: náhled skládá stejné dvě vrstvy.
  const podklad = $('#stul-nahled-podklad');
  const sPodkladem = zobrazit && roleVObs === 'souboj' && Boolean(iniciativa);
  const cilPodkladu = sPodkladem ? NAHLEDY.misto : 'about:blank';
  if (podklad.getAttribute('src') !== cilPodkladu) podklad.setAttribute('src', cilPodkladu);
  podklad.hidden = !sPodkladem;
  $('#nahled-zive').hidden = !roleVObs || !(NAHLEDY[roleVObs] || (roleVObs === 'souboj' && iniciativa));
}
new ResizeObserver(([zaznam]) => {
  const sirka = zaznam.contentRect.width;
  if (sirka) $('#stul-nahled').style.setProperty('--meritko', String(sirka / 1920));
}).observe($('#stul-nahled'));

/* ---------- Kontrola dat ---------- */

function vykresliKontrolu(k) {
  if (!k) return;
  const chyby = k.problemy.filter((p) => p.uroven === 'chyba').length;
  const varovani = k.problemy.length - chyby;
  $('#kontrola-souhrn').textContent = k.problemy.length
    ? `Prošel jsem ${k.pocetSouboru} souborů. Chyby: ${chyby}, varování: ${varovani}. Rozbité soubory Hub přeskočí, zbytek běží dál.`
    : `Prošel jsem ${k.pocetSouboru} souborů v kampan/. Vše v pořádku.`;
  const pocet = $('#pocet-problemu');
  pocet.hidden = chyby === 0;
  pocet.textContent = chyby;
  const tabulka = $('#tabulka-problemu');
  tabulka.hidden = k.problemy.length === 0;
  const tbody = tabulka.querySelector('tbody');
  tbody.replaceChildren();
  for (const p of k.problemy) {
    const tr = document.createElement('tr');
    tr.dataset.uroven = p.uroven;
    const soubor = document.createElement('td');
    const code = document.createElement('code');
    code.textContent = p.soubor;
    soubor.append(code);
    const text = document.createElement('td');
    text.textContent = p.zprava;
    tr.append(soubor, text);
    tbody.append(tr);
  }
}
$('#zkontrolovat').addEventListener('click', async () => vykresliKontrolu(await api('/api/kontrola')));

/* ---------- Nastavení ---------- */

function vykresliNastaveni(n) {
  // Stav přihlášení Improved Initiative závisí i na nastavení (relace vložená / odebraná).
  queueMicrotask(vykresliIniciativu);
  if (!n) return;
  if (document.activeElement !== $('#pole-obs-url')) $('#pole-obs-url').value = n.obsUrl;
  $('#pole-obs-heslo').placeholder = n.obsHesloNastaveno ? 'Heslo je uložené. Vyplň jen při změně.' : 'Heslo z OBS';
  if (document.activeElement !== $('#pole-port')) $('#pole-port').value = n.port;
  $('#pole-domaci-sit').checked = n.domaciSit;
  $('#pole-pin').placeholder = n.pinNastaven ? 'PIN je uložený. Vyplň jen při změně.' : '6–8 číslic';
  if (document.activeElement !== $('#pole-hue-bridge')) $('#pole-hue-bridge').value = n.hueBridge ?? '';
  {
    $('#pole-wiz').value = [n.svetlaHlavni, n.svetlaPozadi, n.svetlaLampa].join(',').split(',').filter((x) => x.startsWith('wiz:')).map((x) => x.slice(4)).join(', ');
    vykresliWiz();
  }
  $('#pole-blesky').checked = n.blesky !== false;
  $('#pole-hp-svetla').checked = n.hpSvetla !== false;
  $('#hue-stav').textContent = !n.hueBridge
    ? 'Zadej IP adresu bridge, stiskni na něm kulaté tlačítko a do 30 s klikni na Spárovat.'
    : n.hueSparovano ? `Bridge ${n.hueBridge} je spárovaný.` : `Bridge ${n.hueBridge} zatím není spárovaný: stiskni na něm kulaté tlačítko a do 30 s klikni na Spárovat.`;
  if (n.hueSparovano && !stav.hueSvetla) nactiHueSvetla();
  if (document.activeElement !== $('#pole-zvuk-slozka')) $('#pole-zvuk-slozka').value = n.zvukSlozka ?? '';
  if (n.obsidianTrezorVychozi) stav.obsidianVychozi = n.obsidianTrezorVychozi;
  if (document.activeElement !== $('#pole-obsidian')) $('#pole-obsidian').value = n.obsidianTrezor ?? '';
  $('#pole-obsidian').placeholder = stav.obsidianVychozi ? `${stav.obsidianVychozi} (jméno složky repa)` : 'jméno složky repa';
  $('#pole-zvuk-otevrit').checked = n.zvukOtevrit !== false;
  vykresliVyberSouboje();
  const srv = stav.prehled?.server;
  $('#server-info').textContent = srv
    ? `Server běží jako node.exe s PID ${srv.pid}. Restart načte nový kód a nastavení; výstupy v OBS se samy znovu připojí.`
    : '';
  $('#tlacitko-restart').hidden = !srv?.restartZPanelu;
}

/** Role scén: scény z OBS, a pokud OBS neběží, aspoň uložená hodnota. */
function vykresliVyberSouboje() {
  for (const select of document.querySelectorAll('.role-sceny select')) {
    if (document.activeElement === select) continue;
    const ulozena = stav.prehled?.nastaveni?.[select.dataset.klic] || '';
    const sceny = [...new Set([...(stav.prehled?.obs?.sceny ?? []), ...(ulozena ? [ulozena] : [])])];
    select.replaceChildren(new Option('— nepřepínat —', ''), ...sceny.map((n) => new Option(n, n)));
    select.value = ulozena;
  }
}

/** Prázdným rolím přiřadí scénu se stejným nebo podobným názvem (bez diakritiky, Souboj ~ Boj). */
const PODOBNE_NAZVY = { scenaStart: ['start', 'zacatek', 'uvod'], scenaMisto: ['misto', 'mista', 'scena'], scenaObchod: ['obchod', 'cenik', 'shop'], scenaSouboj: ['souboj', 'boj', 'iniciativa', 'combat'] };
const bezDiakritiky = (x) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
$('#role-navrhnout').addEventListener('click', async () => {
  const sceny = stav.prehled?.obs?.sceny ?? [];
  if (!sceny.length) return toast('OBS není připojené: názvy scén neznám.', { chyba: true });
  const n = stav.prehled?.nastaveni ?? {};
  const telo = {};
  for (const [klic, nazvy] of Object.entries(PODOBNE_NAZVY)) {
    if (n[klic]) continue;
    const scena = sceny.find((x) => nazvy.includes(bezDiakritiky(x))) ?? sceny.find((x) => nazvy.some((y) => bezDiakritiky(x).includes(y)));
    if (scena) telo[klic] = scena;
  }
  if (!Object.keys(telo).length) return toast('Nic k navržení: role jsou přiřazené, nebo žádná scéna názvem nesedí.');
  if (await ulozitNastaveni(telo, $('#role-navrhnout'))) {
    vykresliVyberSouboje();
    vykresliSceny();
    toast(`Navrženo: ${Object.values(telo).join(', ')}. Zkontroluj a případně změň.`);
  }
});

for (const select of document.querySelectorAll('.role-sceny select')) {
  select.addEventListener('change', async () => {
    try {
      const odpoved = await api('/api/nastaveni', { metoda: 'PUT', telo: { [select.dataset.klic]: select.value } });
      stav.prehled.nastaveni = odpoved.nastaveni;
      vykresliSceny();
      vykresliOdpocet();
      toast(select.value ? `Role přiřazena: ${select.value}` : 'Role bez scény: Hub nic nepřepne.');
    } catch (chyba) {
      toast(chyba.message, { chyba: true });
    }
  });
}

/* Nastavení se ukládá samo (rozhodnutí 65): každé pole po změně, „Uloženo ✓“ u něj.
   Heslo OBS a PIN mají vlastní tlačítko, ať se neuloží rozepsané. */
async function ulozitNastaveni(telo, pole, { chybaDo } = {}) {
  try {
    const r = await api('/api/nastaveni', { metoda: 'PUT', telo });
    stav.prehled.nastaveni = r.nastaveni;
    vykresliNastaveni(r.nastaveni);
    if (pole) oznacUlozeno(pole);
    if (r.potrebaRestartu) {
      $('#nastaveni-vysledek').className = 'ulozeni';
      $('#nastaveni-vysledek').textContent = 'Změna portu nebo přístupu z domácí sítě se projeví po restartu Hubu (níž).';
    }
    return r;
  } catch (chyba) {
    const kam = chybaDo ?? $('#nastaveni-vysledek');
    kam.className = 'ulozeni chyba';
    kam.textContent = `Neuloženo: ${chyba.message}`;
    vykresliNastaveni(stav.prehled?.nastaveni);
    return null;
  }
}

$('#pole-obs-url').addEventListener('change', (e) => ulozitNastaveni({ obsUrl: e.target.value.trim() }, e.target, { chybaDo: $('#napoveda-heslo') }));
$('#obs-heslo-ulozit').addEventListener('click', async () => {
  const pole = $('#pole-obs-heslo');
  if (!pole.value) return pole.focus();
  if (await ulozitNastaveni({ obsHeslo: pole.value }, pole, { chybaDo: $('#napoveda-heslo') })) pole.value = '';
});
$('#pole-port').addEventListener('change', (e) => ulozitNastaveni({ port: Number(e.target.value) }, e.target));
$('#pole-domaci-sit').addEventListener('change', (e) => ulozitNastaveni({ domaciSit: e.target.checked }, e.target.closest('label')));
$('#pin-ulozit').addEventListener('click', async () => {
  const pole = $('#pole-pin');
  if (!pole.value) return pole.focus();
  if (await ulozitNastaveni({ pin: pole.value }, pole)) pole.value = '';
});

/* ---------- Data ze serveru ---------- */

function prekresli() {
  vykresliStav(stav.prehled?.stav);
  vykresliKontrolky();
  vykresliSceny();
  vykresliKontrolu(stav.prehled?.kontrola);
  vykresliSezeni();
  vykresliObrazovkuSezeni();
  vykresliOdpocet();
  vykresliGit();
  vykresliVyberSouboje();
  vykresliKalendar();
  vykresliObchody();
  vykresliMista();
  vykresliSvetla();
  vykresliSouboj();
  vykresliZvuk();
  vykresliIniciativu();
}

async function nactiPrehled() {
  try {
    stav.prehled = await api('/api/prehled');
    stav.odchylkaHodin = Date.parse(stav.prehled.odpocet?.serverCas ?? new Date().toISOString()) - Date.now();
    stav.serverOk = true;
    vykresliNastaveni(stav.prehled.nastaveni);
  } catch {
    stav.serverOk = false;
  }
  prekresli();
}

function pripojitUdalosti() {
  const aktualizuj = (klic) => (data) => {
    if (!stav.prehled) return;
    stav.prehled[klic] = data;
    stav.serverOk = true;
    prekresli();
  };
  const obsluha = {
    stav: aktualizuj('stav'),
    obs: aktualizuj('obs'),
    git: aktualizuj('git'),
    kontrola: aktualizuj('kontrola'),
    sezeni: aktualizuj('sezeni'),
    'kalendar-dm': aktualizuj('kalendar'),
    obchody: aktualizuj('obchody'),
    mista: aktualizuj('mista'),
    server: aktualizuj('server'),
    iniciativa: (data) => {
      if (!stav.prehled) return;
      stav.prehled.iniciativa = data;
      vykresliIniciativu();
      vykresliSceny();
    },
    scena: (data) => {
      if (!stav.prehled) return;
      stav.prehled.scena = data;
      vykresliScenu();
      vykresliSouboj();
      vykresliSoundboard();
    },
    'zvuk-stav': (data) => {
      if (!stav.prehled) return;
      const zmenaSouboru = stav.prehled.zvuk?.pocetSouboru !== data.pocetSouboru;
      stav.prehled.zvuk = data;
      if (zmenaSouboru) nactiZvukoveSoubory();
      vykresliZvuk();
      vykresliKontrolky();
      vykresliObrazovkuSezeni();
    },
    svetla: (data) => {
      if (!stav.prehled) return;
      stav.prehled.svetla = data;
      vykresliSvetla();
      vykresliKontrolky();
      vykresliObrazovkuSezeni();
    },
    zaznam: (data) => pridatDoZaznamu(data),
    kanon: (data) => kanon.zmena(data),
    odpocet: (data) => {
      if (!stav.prehled) return;
      stav.prehled.odpocet = data;
      stav.odchylkaHodin = Date.parse(data.serverCas) - Date.now();
      vykresliOdpocet();
    },
  };
  odebirat(Object.keys(obsluha), (udalost, data) => obsluha[udalost]?.(data), {
    priStavu: (pripojeno, poVypadku) => {
      if (pripojeno) {
        if (!stav.serverOk) nactiPrehled();
        if (poVypadku) nactiZaznam();
      } else {
        stav.serverOk = false;
        prekresli();
      }
    },
  });
}

/* ---------- Toast ---------- */

let casovacToastu = null;
function toast(text, { chyba = false } = {}) {
  const t = $('#toast');
  t.textContent = text;
  t.className = chyba ? 'toast chyba' : 'toast';
  t.hidden = false;
  clearTimeout(casovacToastu);
  casovacToastu = setTimeout(() => (t.hidden = true), chyba ? 7000 : 3500);
}

/* ---------- Kánon (Blok 3): mapa, karta, hledání v liště ---------- */

const kanon = vytvoritKanon({ api, toast, otevritPoznamku });

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
  vstup.addEventListener('focus', () => {
    if (vstup.value.trim() && vysledky.length) vykreslit();
  });
}

$('#pole-obsidian').addEventListener('change', (e) => ulozitNastaveni({ obsidianTrezor: e.target.value.trim() }, e.target));

/* ---------- Sezení: Zahájit / Ukončit ---------- */

function vykresliSezeni() {
  const s = stav.prehled?.sezeni;
  // Odznak sezení v liště: zahajuje se na obrazovce Sezení (rozhodnutí 65).
  const b = $('#tlacitko-sezeni');
  b.dataset.bezi = String(Boolean(s?.bezi));
  const delka = s?.bezi ? delkaSezeni(s) : null;
  b.querySelector('.text').textContent = !s || s.cislo == null ? '…' : s.bezi ? `Sezení ${s.cislo}${delka ? ` · ${delka}` : ''}` : 'Mimo sezení';
}

/* ---------- Obrazovka Sezení: před hrou kontrola, během hry poznámky ---------- */

function polozkaKontroly(uroven, text, akce) {
  const li = document.createElement('li');
  li.dataset.uroven = uroven; // ok | varovani | chyba | info
  li.append(Object.assign(document.createElement('span'), { className: 'stav-ikona', ariaHidden: 'true' }));
  li.append(Object.assign(document.createElement('span'), { className: 'text', textContent: text }));
  if (akce) {
    const prvek = akce.odkaz
      ? Object.assign(document.createElement('a'), { href: akce.odkaz, textContent: akce.text })
      : Object.assign(document.createElement('button'), { type: 'button', textContent: akce.text });
    if (akce.klik) prvek.addEventListener('click', akce.klik);
    li.append(prvek);
  }
  return li;
}

function vykresliObrazovkuSezeni() {
  const p = stav.prehled;
  const s = p?.sezeni;
  const bezi = Boolean(s?.bezi);
  $('#sezeni-stav').textContent = !p ? 'Čekám na server…' : bezi ? `Sezení ${s.cislo} běží` : s?.cislo > 0 ? `Mimo sezení · odehráno ${s.cislo}` : 'Mimo sezení';
  const delka = delkaSezeni(s);
  $('#sezeni-detail').textContent = bezi
    ? `${delka ? `Běží ${delka} h. ` : ''}Poznámky padají do ${s.soubor}.`
    : 'Zahájení spustí čas sezení; odpočet do začátku nastavíš v dialogu.';
  const akce = $('#sezeni-akce');
  akce.textContent = bezi ? `Ukončit sezení ${s.cislo}` : `Zahájit sezení ${(s?.cislo ?? 0) + 1}`;
  akce.disabled = !p;
  const mini = $('#sezeni-mini');
  mini.hidden = !bezi;
  mini.textContent = bezi ? (delka ?? 'běží') : '';

  // Před hrou: co musí fungovat, aby sezení proběhlo bez zádrhelu.
  $('#sezeni-pred').hidden = bezi;
  if (p && !bezi) {
    const k = [];
    const o = p.obs;
    if (!o?.nastaveno) k.push(polozkaKontroly('chyba', 'OBS není nastavené.', { text: 'Nastavení', odkaz: '#nastaveni' }));
    else if (!o.pripojeno) k.push(polozkaKontroly('chyba', `OBS není připojené. ${o.chyba ?? ''}`.trim(), { text: 'Připojit teď', klik: () => api('/api/obs/pripojit', { metoda: 'POST', telo: {} }).catch(() => {}) }));
    else k.push(polozkaKontroly('ok', `OBS je připojené, scéna ${o.aktualniScena}.`));
    const n = p.nastaveni ?? {};
    const chybiRole = ROLE_SCEN.filter(([, klic]) => !n[klic]).map(([, , jmeno]) => jmeno);
    k.push(chybiRole.length
      ? polozkaKontroly('varovani', `Role scén bez přiřazené scény: ${chybiRole.join(', ')}.`, { text: 'Nastavení → Role scén', odkaz: '#nastaveni-role' })
      : polozkaKontroly('ok', 'Role scén jsou přiřazené.'));
    const g = p.git;
    if (!g?.dostupny) k.push(polozkaKontroly('varovani', g?.chyba ?? 'Stav Gitu zjišťuji…'));
    else if (g.pozadu > 0) k.push(polozkaKontroly('varovani', `Na GitHubu je nová verze (${g.pozadu}).`, { text: 'Aktualizovat', klik: aktualizovat }));
    else if (g.chyba) k.push(polozkaKontroly('varovani', g.chyba));
    else k.push(polozkaKontroly('ok', 'Data jsou stejná jako na GitHubu.'));
    const chyby = (p.kontrola?.problemy ?? []).filter((x) => x.uroven === 'chyba').length;
    k.push(chyby ? polozkaKontroly('chyba', `Kontrola dat našla chyby: ${chyby}.`, { text: 'Kontrola dat', odkaz: '#kontrola' }) : polozkaKontroly('ok', 'Data kampaně jsou bez chyb.'));
    if (!p.stav?.stav?.datum) k.push(polozkaKontroly('chyba', 'Dnešní datum v Harptosu není zadané.', { text: 'Kalendář', odkaz: '#kalendar' }));
    const od = p.odpocet?.stav;
    k.push(od === 'bezi'
      ? polozkaKontroly('ok', 'Odpočet do začátku běží.')
      : od === 'pripraveny' || od === 'pauza'
        ? polozkaKontroly('info', 'Odpočet je nastavený, ale neběží.', { text: 'U stolu → Start', klik: () => { stav.stulVyber = 'start'; location.hash = 'sceny'; } })
        : polozkaKontroly('info', 'Odpočet není nastavený (volitelné, jde i při zahájení).'));
    const sv = p.svetla;
    if (sv?.nastaveno) {
      for (const [typ, jmeno] of [['hue', 'Hue'], ['wiz', 'WiZ']]) {
        const z = sv.zarizeni.filter((x) => x.typ === typ);
        if (!z.length) continue;
        const spatne = z.filter((x) => x.ok === false);
        k.push(spatne.length
          ? polozkaKontroly('chyba', `${jmeno} neodpovídá: ${spatne[0].chyba ?? ''}`.trim(), { text: 'Zkontrolovat znovu', klik: () => api('/api/svetla/overit', { metoda: 'POST', telo: {} }).catch((e) => toast(e.message, { chyba: true })) })
          : z.every((x) => x.ok) ? polozkaKontroly('ok', `${jmeno} odpovídá.`) : polozkaKontroly('info', `${jmeno}: zjišťuji…`));
      }
      k.push(sv.ridit
        ? polozkaKontroly('ok', 'Řídit světla je zapnuté.')
        : polozkaKontroly('varovani', 'Řídit světla je vypnuté: světla nebudou sledovat scénu.', { text: 'Zapnout', klik: () => nastavitRidit(true) }));
    } else {
      k.push(polozkaKontroly('info', 'Světla nejsou nastavená (volitelné).', { text: 'Nastavení → Světla', odkaz: '#nastaveni-svetla' }));
    }
    const zv = p.zvuk;
    if (zv) {
      const sh = zv.stranky?.hudba;
      const ss = zv.stranky?.stul;
      if (zv.hudbaKde === 'obs') {
        k.push(sh?.pripojeno
          ? polozkaKontroly(sh.chyba ? 'varovani' : 'ok', sh.chyba ? `Hudba v OBS: ${sh.chyba}` : 'Hudba v OBS je připojená.')
          : polozkaKontroly('varovani', 'Hudba v OBS není připojená (zdroj Hub – hudba).', { text: 'Adresa výstupu', odkaz: '#nastaveni-zvuk' }));
      }
      k.push(!ss?.pripojeno
        ? polozkaKontroly('varovani', 'Zvuk u stolu není otevřený.', { text: 'Otevřít', klik: otevritZvukUStolu })
        : !ss.odemceno
          ? polozkaKontroly('varovani', 'Zvuk u stolu čeká na kliknutí (Zapnout zvuk u stolu).', { text: 'Otevřít', klik: otevritZvukUStolu })
          : ss.vystup?.ok === false
            ? polozkaKontroly('chyba', `Reproduktor ${ss.vystup.nazev} je odpojený.`)
            : polozkaKontroly('ok', `Zvuk u stolu hraje${ss.vystup?.vybrany ? ` do ${ss.vystup.nazev}` : ''}.`));
      const chybi = (p.kontrola?.problemy ?? []).filter((x) => /^Zvuk „|^Složka zvuku/.test(x.zprava)).length;
      if (chybi) k.push(polozkaKontroly('varovani', `Chybí zvukové soubory scén: ${chybi}.`, { text: 'Kontrola dat', odkaz: '#kontrola' }));
    }
    const ii = p.iniciativa;
    if (p.nastaveni?.iiRelaceNastavena) {
      k.push(ii?.pruchodChyba
        ? polozkaKontroly('chyba', ii.pruchodChyba)
        : ii?.pruchod?.prihlasen === false
          ? polozkaKontroly('varovani', 'Přihlášení Improved Initiative vypršelo: Souboj poběží bez Epic účtu.', { text: 'Nastavení → Hub', odkaz: '#nastaveni-hub' })
          : polozkaKontroly(ii?.pruchod?.prihlasen ? 'ok' : 'info', ii?.pruchod?.prihlasen ? 'Improved Initiative je přihlášený.' : 'Improved Initiative: ověřuji přihlášení…'));
    }
    if (p.server?.restartNutny) k.push(polozkaKontroly('varovani', p.server.restartNutny, p.server.restartZPanelu ? { text: 'Restartovat Hub', klik: restartovatHub } : undefined));
    // Nejdřív to, co je potřeba vyřešit; body v pořádku sbalené do jednoho řádku (rozhodnutí 65).
    const PORADI = { chyba: 0, varovani: 1, info: 2, ok: 3 };
    k.sort((x, y) => PORADI[x.dataset.uroven] - PORADI[y.dataset.uroven]);
    // Řádky jen pro to, co je potřeba vyřešit; ostatní jako drobné štítky v jedné řadě (rozhodnutí 66).
    const vporadku = k.filter((x) => x.dataset.uroven === 'ok');
    const resit = k.filter((x) => ['chyba', 'varovani'].includes(x.dataset.uroven)).length;
    const radky = k.filter((x) => ['chyba', 'varovani'].includes(x.dataset.uroven));
    const stitky = k.filter((x) => ['info', 'ok'].includes(x.dataset.uroven));
    for (const li of stitky) {
      const t = li.querySelector('.text');
      t.textContent = t.textContent.replace(/\.$/, '');
    }
    $('#sezeni-kontrola').replaceChildren(...radky);
    $('#sezeni-kontrola').hidden = !radky.length;
    $('#sezeni-v-poradku').replaceChildren(...stitky);
    $('#sezeni-souhrn').textContent = resit ? `${resit} k vyřešení · ${vporadku.length} v pořádku` : 'Všechno je připravené.';
  }

  // Poznámky: během sezení z jeho souboru, mimo sezení z přípravy.
  const poznamky = s?.poznamky ?? [];
  $('#sezeni-poznamky-nadpis').textContent = bezi ? 'Poznámky ze stolu' : 'Poznámky mimo sezení';
  $('#sezeni-poznamky-popis').textContent = poznamky.length
    ? `Ukládají se do ${s?.soubor ?? 'souboru sezení'}.`
    : 'Zatím žádné. Zapisuješ je klávesou F2 nebo tlačítkem Poznámka v horní liště.';
  $('#sezeni-poznamky').replaceChildren(
    ...[...poznamky].reverse().map((x) => {
      const li = document.createElement('li');
      li.append(Object.assign(document.createElement('time'), { textContent: x.cas }));
      if (x.harptos) li.append(Object.assign(document.createElement('small'), { textContent: x.harptos }));
      li.append(Object.assign(document.createElement('p'), { textContent: x.text }));
      return li;
    }),
  );
}

$('#sezeni-akce').addEventListener('click', () => (stav.prehled?.sezeni?.bezi ? otevritUkoncit() : otevritZahajit()));
// Délka sezení v liště a na obrazovce Sezení se posouvá i bez změn ze serveru.
setInterval(() => {
  if (!stav.prehled?.sezeni?.bezi) return;
  $('#lista-sezeni').textContent = textSezeni();
  vykresliSezeni();
  vykresliObrazovkuSezeni();
}, 30000);

function navrhCasu() {
  // Nejbližší čtvrthodina, nejméně 10 minut od teď
  const d = new Date(Date.now() + 10 * 60000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  return d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
}

function otevritZahajit() {
  const s = stav.prehled?.sezeni;
  $('#zahajit-cislo').textContent = s ? s.cislo + 1 : '';
  const box = $('#zahajit-hraci');
  box.replaceChildren();
  for (const h of s?.hraci ?? []) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = 'pritomni';
    input.value = h.jmeno;
    input.checked = true;
    const small = document.createElement('small');
    small.textContent = h.postava ? `(${h.postava})` : '';
    label.append(input, ` ${h.jmeno} `, small);
    box.append(label);
  }
  if (!s?.hraci?.length) box.textContent = 'V kampan/kampan.yaml nejsou hráči (pole hraci).';
  $('#zahajit-cas').value = navrhCasu();
  const g = stav.prehled?.git;
  const varovani = $('#zahajit-varovani');
  varovani.hidden = !(g?.pozadu > 0);
  varovani.textContent = g?.pozadu > 0 ? `Na GitHubu jsou novější změny (${g.pozadu}). Sezení jde zahájit i bez nich, ale doporučuju je nejdřív stáhnout.` : '';
  $('#zahajit-potvrdit').textContent = g?.pozadu > 0 ? 'Zahájit bez stažení změn' : 'Zahájit sezení';
  $('#zahajit-chyba').textContent = '';
  $('#dialog-zahajit').showModal();
}

$('#formular-zahajit').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'zahajit') return;
  e.preventDefault();
  const pritomni = [...document.querySelectorAll('#zahajit-hraci input:checked')].map((i) => i.value);
  const cas = $('#zahajit-cas').value.trim();
  try {
    const r = await api('/api/sezeni/zahajit', {
      metoda: 'POST',
      telo: { pritomni, odpocet: cas ? { cas } : null, potvrzenoBezStazeni: true },
    });
    $('#dialog-zahajit').close();
    toast(`Sezení ${r.cislo} zahájeno. Poznámky padají do ${r.soubor}.`);
    if (cas) location.hash = 'odpocet';
  } catch (chyba) {
    $('#zahajit-chyba').textContent = chyba.message;
  }
});

function otevritUkoncit() {
  const s = stav.prehled?.sezeni;
  $('#ukoncit-cislo').textContent = s?.cislo ?? '';
  $('#ukoncit-vysledek').textContent = '';
  $('#ukoncit-vysledek').className = 'ulozeni';
  for (const i of document.querySelectorAll('#dialog-ukoncit input')) i.checked = false;
  ukonceneSezeni = null;
  $('#dialog-ukoncit').showModal();
}

// Sezení ukončené v tomto dialogu: když pak selže uložení do GitHubu, další klik zkusí jen uložení (audit N13).
let ukonceneSezeni = null;

$('#formular-ukoncit').addEventListener('submit', async (e) => {
  const volba = e.submitter?.value;
  if (volba !== 'ukoncit' && volba !== 'jen-ukoncit') return;
  e.preventDefault();
  const vysledek = $('#ukoncit-vysledek');
  try {
    const r = ukonceneSezeni ?? (await api('/api/sezeni/ukoncit', { metoda: 'POST', telo: {} }));
    ukonceneSezeni = r;
    if (volba === 'jen-ukoncit') {
      $('#dialog-ukoncit').close();
      toast(`Sezení ${r.cislo} ukončeno. Do GitHubu ho ulož na obrazovce Sezení.`);
      return;
    }
    vysledek.textContent = 'Ukládám do GitHubu…';
    const g = await api('/api/git/ulozit', { metoda: 'POST', telo: { zprava: r.zpravaCommitu } });
    $('#dialog-ukoncit').close();
    toast(g.chybaPush ? g.chybaPush : `Sezení ${r.cislo} ukončeno a uloženo do GitHubu.`, { chyba: Boolean(g.chybaPush) });
  } catch (chyba) {
    vysledek.className = 'ulozeni chyba';
    vysledek.textContent = ukonceneSezeni
      ? `Sezení ${ukonceneSezeni.cislo} je ukončené, ale uložení do GitHubu se nepodařilo: ${chyba.message} Zkus to znovu stejným tlačítkem.`
      : chyba.message;
  }
});


/* ---------- Souboj ---------- */

function vykresliSouboj() {
  const souboj = stav.prehled?.scena?.rezim === 'souboj';
  const b = $('#tlacitko-souboj');
  b.querySelector('span').textContent = souboj ? 'Konec souboje' : 'Souboj';
  b.setAttribute('aria-pressed', String(souboj));
  // Záložka Souboj na U stolu
  $('#souboj-stav').textContent = souboj ? 'Souboj běží.' : 'Souboj neběží.';
  $('#souboj-prepnout').textContent = souboj ? 'Konec souboje' : 'Zahájit souboj';
  $('#souboj-bez-fanfary').hidden = !souboj;
}

$('#souboj-prepnout').addEventListener('click', () => $('#tlacitko-souboj').click());

/* Player View: Improved Initiative dává pro každé setkání nový odkaz (bod 69). */
function vykresliIniciativu() {
  const i = stav.prehled?.iniciativa;
  // Nastavení → Hub: přihlášení Epic přes průchod.
  const n = stav.prehled?.nastaveni;
  const iiStav = $('#ii-stav');
  const pr = i?.pruchod;
  iiStav.className = i?.pruchodChyba || pr?.prihlasen === false ? 'ulozeni chyba' : 'ulozeni';
  iiStav.textContent = i?.pruchodChyba
    ?? (!n?.iiRelaceNastavena ? 'Není vložené: Improved Initiative v záložce Souboj běží bez Epic účtu.'
      : pr?.prihlasen === true ? 'Přihlášení platí: záložka Souboj běží s Epic účtem.'
        : pr?.prihlasen === false ? 'Přihlášení vypršelo nebo je neplatné. Vlož novou hodnotu connect.sid.'
          : 'Ověřuji přihlášení…');
  $('#ii-relace-smazat').hidden = !n?.iiRelaceNastavena;
  const pole = $('#iniciativa-pole');
  if (document.activeElement !== pole) pole.value = i?.odkaz ?? '';
  const el = $('#iniciativa-stav');
  // Odmítnutý odkaz zůstane ohlášený, dokud DM nevloží platný.
  el.className = stav.iniciativaChyba ? 'ulozeni chyba' : i?.chyba ? 'ulozeni varovani' : 'ulozeni';
  el.textContent = stav.iniciativaChyba
    ?? (!i?.odkaz ? 'Vlož odkaz na Player View: Hub ho dá do OBS i do náhledu.' : i.chyba ?? `V OBS: ${i.zdroje.join(', ')}`);
  // Nastavení Player View v účtu Epic (bod 78): typicky je přepíše druhé okno editoru s jiným nastavením.
  const ucet = pr?.prihlasen ? pr.ucet : null;
  const idOdkazu = i?.odkaz?.match(/\/p\/([A-Za-z0-9_-]+)/)?.[1];
  const varovani = [];
  if (ucet && !ucet.encounterId) varovani.push(`V Improved Initiative chybí vlastní Encounter ID, takže Player View v OBS se přestane hýbat. V editoru: Settings → Player View → Custom Encounter ID${idOdkazu ? ` = ${idOdkazu}` : ''}, pak Save.`);
  if (ucet && !ucet.portrety) varovani.push('Display Portraits je v Improved Initiative vypnuté: karty v OBS jsou bez ilustrací. Settings → Player View → Display Portraits, pak Save.');
  const v = $('#iniciativa-ucet');
  v.hidden = !varovani.length;
  v.textContent = varovani.join(' ');
}
async function ulozitIniciativu(odkaz) {
  try {
    const r = await api('/api/iniciativa', { metoda: 'PUT', telo: { odkaz } });
    stav.iniciativaChyba = null;
    stav.prehled.iniciativa = r;
    vykresliIniciativu();
    vykresliSceny();
    if (!r.chyba) toast('Player View je v OBS.');
  } catch (chyba) {
    stav.iniciativaChyba = chyba.message;
    vykresliIniciativu();
  }
}
// Enter i opuštění pole vyvolá change; odeslání formuláře jen zastavit, ať se neukládá dvakrát.
$('#iniciativa-formular').addEventListener('submit', (e) => e.preventDefault());
$('#ii-relace-ulozit').addEventListener('click', async () => {
  const pole = $('#pole-ii-relace');
  if (!pole.value.trim()) return pole.focus();
  if (await ulozitNastaveni({ iiRelace: pole.value.trim() }, pole, { chybaDo: $('#ii-stav') })) pole.value = '';
});
$('#ii-relace-smazat').addEventListener('click', async () => {
  if (!confirm('Odebrat přihlášení? Záložka Souboj pak poběží bez Epic účtu.')) return;
  await ulozitNastaveni({ smazatIiRelace: true }, $('#ii-relace-smazat'), { chybaDo: $('#ii-stav') });
});
$('#iniciativa-pole').addEventListener('change', (e) => e.target.value.trim() && ulozitIniciativu(e.target.value));
$('#iniciativa-schranka').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    $('#iniciativa-pole').value = text.trim();
    await ulozitIniciativu(text);
  } catch {
    toast('Schránku se nepodařilo přečíst. Vlož odkaz do pole ručně (Ctrl+V).', { chyba: true });
    $('#iniciativa-pole').focus();
  }
});
$('#tlacitko-souboj').addEventListener('click', async () => {
  const zapnout = stav.prehled?.scena?.rezim !== 'souboj';
  try {
    const r = await api('/api/souboj', { metoda: 'POST', telo: { zapnout } });
    if (r.chybaObs) toast(r.chybaObs, { chyba: true });
  } catch (chyba) {
    toast(chyba.message, { chyba: true });
    if (/není nastavená/.test(chyba.message)) location.hash = 'nastaveni-role';
  }
});

/* ---------- Poznámka (F2) ---------- */

function otevritPoznamku(predvyplnit = '') {
  const d = $('#dialog-poznamka');
  if (d.open) return;
  // Z karty v Kánonu: poznámka začne odkazem [[id]] na entitu (Blok 3).
  const pole = $('#pole-poznamka');
  if (typeof predvyplnit === 'string' && predvyplnit && !pole.value.includes(predvyplnit.trim())) pole.value = `${predvyplnit}${pole.value}`;
  const s = stav.prehled?.sezeni;
  $('#poznamka-kam').textContent = s?.bezi
    ? `Zapíše se do sezení ${s.cislo} s aktuálním časem.`
    : 'Sezení neběží, poznámka se zapíše do kampan/sezeni/priprava.md.';
  $('#poznamka-chyba').textContent = '';
  // Otevřený dialog (třeba připomínky Dalšího dne) zůstane pod poznámkou, nezavře se (audit S7).
  d.showModal();
  $('#pole-poznamka').focus();
}

let zapisujePoznamku = false;
async function zapsatPoznamku() {
  const pole = $('#pole-poznamka');
  if (!pole.value.trim() || zapisujePoznamku) return;
  zapisujePoznamku = true;
  try {
    const r = await api('/api/poznamka', { metoda: 'POST', telo: { text: pole.value } });
    pole.value = '';
    $('#dialog-poznamka').close();
    toast(r.vysledek === 'odlozeno' ? 'Poznámka čeká na zápis (soubor je otevřený jinde).' : `Poznámka zapsána v ${r.cas}.`);
  } catch (chyba) {
    $('#poznamka-chyba').textContent = chyba.message;
  } finally {
    zapisujePoznamku = false;
  }
}

$('#formular-poznamka').addEventListener('submit', (e) => {
  if (e.submitter?.value !== 'ulozit') return;
  e.preventDefault();
  zapsatPoznamku();
});
$('#pole-poznamka').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    zapsatPoznamku();
  }
});
$('#tlacitko-poznamka').addEventListener('click', () => otevritPoznamku(kanon.odkazProPoznamku()));
document.addEventListener('keydown', (e) => {
  if (e.key === 'F2') {
    e.preventDefault();
    otevritPoznamku(kanon.odkazProPoznamku());
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    $('#hledat-kanon').focus();
    $('#hledat-kanon').select();
  }
  if (e.key === 'Escape' && !$('#obrazovka-kanon').hidden && !document.querySelector('dialog[open]') && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) {
    kanon.zrusitVyber();
  }
  if (e.key === 'F4') {
    e.preventDefault();
    otevritIniciativu();
  }
});

/* Pojmenované okno: první klik ho otevře, další ho jen přenese do popředí (stav setkání se neztratí). */
let oknoIniciativy = null;
function otevritIniciativu() {
  if (!oknoIniciativy || oknoIniciativy.closed) {
    // Po obnovení panelu Hub o okně neví: prázdné jméno okno najde, ale nenačte znovu (souboj se nepřeruší).
    oknoIniciativy = window.open('', 'improved-initiative');
    if (!oknoIniciativy) return toast('Prohlížeč zablokoval otevření okna. Povol pro Hub vyskakovací okna.', { chyba: true });
    let prazdne = false;
    try {
      prazdne = oknoIniciativy.location.href === 'about:blank'; // cizí stránka (Improved Initiative) sem nepustí
    } catch {
      prazdne = false;
    }
    // Přes průchod Hubu: stejné přihlášení, stejné úložiště a nastavení z účtu jako editor v panelu.
    // Přímá adresa improvedinitiative.app má vlastní úložiště prohlížeče a po uložení by do účtu
    // poslala jiná nastavení Player View (bod 78).
    if (prazdne) oknoIniciativy.location.href = adresaVlozeneIniciativy() ?? ADRESA_INICIATIVY;
  }
  oknoIniciativy.focus();
}
$('#iniciativa-okno').addEventListener('click', otevritIniciativu);

/* ---------- Odpočet ---------- */

stav.odchylkaHodin = 0;

function formatCasu(ms) {
  const celkem = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(celkem / 3600);
  const m = Math.floor((celkem % 3600) / 60);
  const s = celkem % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

function zbyvajiciMs(o) {
  if (!o) return null;
  if (o.stav === 'bezi') return Math.max(0, Date.parse(o.konec) - (Date.now() + stav.odchylkaHodin));
  return o.zbyvaMs;
}

function vykresliOdpocet() {
  const o = stav.prehled?.odpocet;
  const casEl = $('#odpocet-cas');
  const mini = $('#odpocet-mini');
  const popis = $('#odpocet-popis');
  const zbyva = zbyvajiciMs(o);
  casEl.dataset.stav = o?.stav ?? 'zadny';
  casEl.textContent = zbyva == null ? '--:--' : formatCasu(zbyva);
  // Doběhlý odpočet (0:00) v navigaci nesvítí, jen ten, který ještě běží nebo stojí.
  mini.hidden = !(o && (o.stav === 'bezi' || o.stav === 'pauza')) || zbyva === 0;
  mini.textContent = zbyva == null ? '' : formatCasu(zbyva);
  const texty = {
    zadny: 'Odpočet není nastavený.',
    pripraveny: 'Připraveno. V OBS se ukáže po spuštění.',
    bezi: zbyva === 0 ? 'Odpočet doběhl. Hra začíná.' : `Běží. Konec v ${new Date(o?.konec).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}.`,
    pauza: 'Pozastaveno. V OBS stojí na posledním čase.',
  };
  popis.textContent = texty[o?.stav ?? 'zadny'];
  // Jedno ovládání podle stavu (rozhodnutí 66): bez odpočtu nebo připravený = čas + Spustit odpočet;
  // běží nebo stojí = Pauza / Pokračovat a Zrušit. Doběhlý odpočet jde rovnou nastavit znovu.
  const bezi = (o?.stav === 'bezi' && zbyva !== 0) || o?.stav === 'pauza';
  $('#formular-odpocet').hidden = bezi;
  $('#odpocet-bezi').hidden = !bezi;
  $('#odpocet-spustit').hidden = o?.stav !== 'pauza';
  $('#odpocet-pauza').hidden = o?.stav !== 'bezi';
  for (const b of document.querySelectorAll('#odpocet-predvolby button')) b.setAttribute('aria-pressed', String(Number(b.dataset.minut) === stav.odpocetMinut));
  const pr = o?.prepnuti;
  $('#odpocet-prepnuti').className = pr && !pr.ok ? 'ulozeni varovani' : 'ulozeni';
  $('#odpocet-prepnuti').textContent = pr
    ? pr.ok ? `Po doběhnutí přepnuto na scénu „${pr.scena}“.` : pr.duvod
    : ''; // kam se přepne, ukazuje výběr hned vedle
}
setInterval(() => {
  if (stav.prehled?.odpocet?.stav === 'bezi') vykresliOdpocet();
}, 250);

// Předvolba vyplní „za kolik minut“ a vymaže čas; čas vymaže předvolbu. Jedno Spustit připraví a spustí.
$('#odpocet-predvolby').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-minut]');
  if (!b) return;
  const minut = Number(b.dataset.minut);
  stav.odpocetMinut = stav.odpocetMinut === minut ? null : minut;
  if (stav.odpocetMinut) $('#pole-odpocet-cas').value = '';
  vykresliOdpocet();
});
$('#pole-odpocet-cas').addEventListener('input', () => {
  stav.odpocetMinut = null;
  vykresliOdpocet();
});
$('#formular-odpocet').addEventListener('submit', async (e) => {
  e.preventDefault();
  const cas = $('#pole-odpocet-cas').value.trim();
  const minut = stav.odpocetMinut;
  const o = stav.prehled?.odpocet;
  if (!cas && !minut && o?.stav !== 'pripraveny') {
    toast('Zadej čas začátku nebo vyber, za kolik minut.', { chyba: true });
    $('#pole-odpocet-cas').focus();
    return;
  }
  try {
    if (cas || minut) await api('/api/odpocet/pripravit', { metoda: 'POST', telo: cas ? { cas } : { minut } });
    await api('/api/odpocet/spustit', { metoda: 'POST', telo: {} });
    $('#pole-odpocet-cas').value = '';
    stav.odpocetMinut = null;
  } catch (chyba) {
    toast(chyba.message, { chyba: true });
  }
});
for (const [id, akce] of [['#odpocet-spustit', 'spustit'], ['#odpocet-pauza', 'pauza'], ['#odpocet-zrusit', 'zrusit']]) {
  $(id).addEventListener('click', () => api(`/api/odpocet/${akce}`, { metoda: 'POST', telo: {} }).catch((chyba) => toast(chyba.message, { chyba: true })));
}


/* ---------- GitHub: Aktualizovat (bod 91) ---------- */

function popisTlacitkaAktualizovat(g) {
  if (!g?.dostupny) return 'Aktualizovat';
  if (g.pozadu > 0) return `Aktualizovat (${g.pozadu} nových)`;
  if ((g.zmenenoKampan ?? g.zmeneno) > 0) return 'Uložit na GitHub';
  return 'Aktualizovat';
}

function vykresliGit() {
  const g = stav.prehled?.git;
  const popis = $('#git-popis');
  for (const b of [$('#git-aktualizovat'), $('#system-aktualizovat')]) {
    b.disabled = !g?.dostupny;
    b.textContent = popisTlacitkaAktualizovat(g);
    b.classList.toggle('hlavni', Boolean(g?.pozadu > 0));
  }
  if (!g?.dostupny) {
    popis.textContent = g?.chyba || 'Zjišťuji stav Gitu…';
    return;
  }
  const kdy = g.kontrolovano ? ` Naposledy zkontrolováno v ${new Date(g.kontrolovano).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}.` : '';
  const kampan = g.zmenenoKampan ?? g.zmeneno;
  const mimo = g.zmeneno - kampan;
  const soubory = (n) => `${n} ${n === 1 ? 'soubor' : n < 5 ? 'soubory' : 'souborů'}`;
  popis.textContent = `${kampan ? `Neuložené úpravy kampaně: ${soubory(kampan)}. ` : 'Kampaň je uložená. '}${mimo > 0 ? `Mimo kampaň je změněno ${soubory(mimo)} (třeba nastavení Obsidianu), Aktualizovat je neukládá. ` : ''}${g.pozadu > 0 ? `Na GitHubu je nová verze (${g.pozadu}). ` : ''}${kdy.trim()} Aktualizovat uloží tvoje úpravy kampaně, stáhne novou verzi a odešle vše na GitHub; při nové verzi Hubu ho restartuje.`;
}

/** Jedno tlačítko místo Uložit, Stáhnout a Sloučit. */
async function aktualizovat() {
  const v = $('#git-vysledek');
  v.className = 'ulozeni';
  v.textContent = 'Aktualizuji…';
  toast('Aktualizuji…');
  try {
    const r = await api('/api/git/aktualizovat', { metoda: 'POST', telo: {} });
    const casti = [];
    if (r.ulozeno) casti.push('tvoje úpravy uloženy');
    if (r.stazeno) casti.push(`staženo ${r.stazeno} ${r.stazeno === 1 ? 'změna' : r.stazeno < 5 ? 'změny' : 'změn'}`);
    if ((r.ulozeno || r.stazeno) && !stav.prehled?.prostredi?.zkouska) casti.push(r.push ? 'odesláno na GitHub' : 'na GitHub se zatím neodeslalo (zkus později)');
    let text = casti.length ? `${casti.join(', ')}.` : 'Všechno je aktuální.';
    text = text[0].toUpperCase() + text.slice(1);
    if (r.vracenoZGitHubu?.length) text += ` Soubory ${r.vracenoZGitHubu.join(', ')} se změnily i na GitHubu: platí verze z GitHubu, tvoje je v úschovně Gitu. Pošli to Claudovi.`;
    if (r.restart === 'auto') text += ' Hub se za chvíli restartuje.';
    if (r.restart === 'rucne') text += ' Nová verze Hubu se spustí po restartu: běží sezení, tak jsem nic nerestartoval.';
    if (r.restart === 'nejde') text += ' Nová verze Hubu se spustí, až Hub zavřeš a spustíš zástupcem DM Hub.';
    v.className = r.push || !(r.ulozeno || r.stazeno) || stav.prehled?.prostredi?.zkouska ? 'ulozeni' : 'ulozeni varovani';
    v.textContent = text;
    toast(text, { chyba: Boolean(r.vracenoZGitHubu?.length) });
    await nactiPrehled();
  } catch (e) {
    v.className = 'ulozeni chyba';
    v.textContent = e.message;
    toast(e.message, { chyba: true });
  }
}
$('#git-aktualizovat').addEventListener('click', aktualizovat);
$('#system-aktualizovat').addEventListener('click', aktualizovat);
$('#system-restart').addEventListener('click', restartovatHub);

$('#git-zkontrolovat').addEventListener('click', async () => {
  const v = $('#git-vysledek');
  v.className = 'ulozeni';
  v.textContent = 'Zjišťuji stav na GitHubu…';
  try {
    const g = await api('/api/git/obnovit', { metoda: 'POST', telo: {} });
    stav.prehled.git = g;
    prekresli();
    v.className = g.chyba ? 'ulozeni varovani' : 'ulozeni';
    v.textContent = g.chyba ?? (g.pozadu > 0 ? `Na GitHubu je ${g.pozadu} novějších změn.` : 'Lokální kopie je aktuální.');
  } catch (chyba) {
    v.className = 'ulozeni chyba';
    v.textContent = chyba.message;
  }
});
/* ---------- Výběr data v Harptosu ---------- */

/** Rok, měsíc nebo svátek a den. Vrací {get, set}; get() dá datum, nebo null, když je neplatné. */
function vyberData(kontejner) {
  const rok = Object.assign(document.createElement('input'), { type: 'number', min: 1, max: 9999, className: 'rok', title: 'Rok DR' });
  const mesic = document.createElement('select');
  mesic.title = 'Měsíc nebo svátek';
  MESICE.forEach((m, mi) => {
    mesic.append(new Option(`${m} (${mi + 1}.)`, `m:${m}`));
    for (const sv of SVATKY[mi] || []) mesic.append(new Option(`✦ ${sv}${sv === 'Shieldmeet' ? ' (přestupný rok)' : ''}`, `s:${sv}`));
  });
  const den = Object.assign(document.createElement('input'), { type: 'number', min: 1, max: 30, className: 'den', title: 'Den' });
  const popisky = [['Den', den], ['Měsíc nebo svátek', mesic], ['Rok DR', rok]].map(([t, pole]) => {
    const l = document.createElement('label');
    l.append(t, pole);
    return l;
  });
  kontejner.replaceChildren(...popisky);
  const prepni = () => (popisky[0].hidden = mesic.value.startsWith('s:'));
  mesic.addEventListener('change', prepni);
  return {
    get() {
      const r = Number(rok.value);
      const [druh, nazev] = mesic.value.split(':');
      const d = druh === 's' ? { rok: r, svatek: nazev } : { rok: r, mesic: nazev, den: Number(den.value) };
      return Harptos.normalizuj(d);
    },
    set(d) {
      if (!d) return;
      rok.value = d.rok;
      mesic.value = d.svatek ? `s:${d.svatek}` : `m:${d.mesic}`;
      den.value = d.svatek ? 1 : d.den;
      prepni();
    },
  };
}

/* ---------- Kalendář ---------- */

const vyberDnes = vyberData($('#vyber-dnes'));
const vyberOd = vyberData($('#vyber-udalost-od'));
const vyberDo = vyberData($('#vyber-udalost-do'));
let posledniDnes = null;

function textData(u) {
  return u.konec ? Harptos.formatRozsah(u.datum, u.konec) : Harptos.format(u.datum);
}

/** Pořadí události v rámci dne: {vDni, pocet} (víc událostí téhož dne, podle pořadí zápisu). */
function poradiVDni(u, udalosti) {
  const den = udalosti.filter((x) => Harptos.absolutni(x.datum) === Harptos.absolutni(u.datum));
  return { vDni: den.indexOf(u) + 1, pocet: den.length };
}

async function posunoutVDni(u, smer) {
  try {
    await api(`/api/kalendar/udalosti/${encodeURIComponent(u.id)}/poradi`, { metoda: 'POST', telo: { smer } });
  } catch (chyba) {
    toast(chyba.message, { chyba: true });
  }
}

function radekUdalosti(u, dnes, udalosti = []) {
  const tr = document.createElement('tr');
  const z = Harptos.absolutni(u.datum);
  const k = u.konec ? Harptos.absolutni(u.konec) : z;
  const d = dnes ? Harptos.absolutni(dnes) : null;
  if (d !== null && d >= z && d <= k) tr.dataset.dnes = 'true';
  const datum = document.createElement('td');
  datum.textContent = textData(u);
  const { vDni, pocet } = poradiVDni(u, udalosti);
  if (pocet > 1) {
    const poradi = Object.assign(document.createElement('span'), { className: 'poradi-v-dni', textContent: ` · ${vDni}. z ${pocet}`, title: `${vDni}. událost toho dne z ${pocet}` });
    datum.append(poradi);
  }
  if (d !== null && z > d) {
    const za = document.createElement('small');
    za.textContent = zbyvaText(z - d);
    datum.append(document.createElement('br'), za);
  }
  const text = document.createElement('td');
  text.textContent = u.text;
  const obs = document.createElement('td');
  obs.textContent = u.verejna ? (u.lhuta ? `ano, lhůta ${dnyText(u.lhuta)}` : 'ano') : 'skrytá';
  if (!u.verejna) obs.className = 'skryta';
  const akce = document.createElement('td');
  akce.className = 'akce-radku';
  const upravit = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Upravit' });
  upravit.addEventListener('click', () => otevritUdalost(u));
  const smazat = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Smazat', className: 'nebezpecne' });
  smazat.addEventListener('click', async () => {
    if (smazat.dataset.potvrd !== 'true') {
      smazat.dataset.potvrd = 'true';
      smazat.textContent = 'Opravdu smazat?';
      setTimeout(() => {
        smazat.dataset.potvrd = '';
        smazat.textContent = 'Smazat';
      }, 4000);
      return;
    }
    try {
      await api(`/api/kalendar/udalosti/${encodeURIComponent(u.id)}`, { metoda: 'DELETE' });
      toast(`Smazáno: ${u.text}`);
    } catch (chyba) {
      toast(chyba.message, { chyba: true });
    }
  });
  if (pocet > 1) {
    const driv = Object.assign(document.createElement('button'), { type: 'button', textContent: '↑', className: 'mala', title: 'Dřív v tom dni', disabled: vDni === 1 });
    driv.setAttribute('aria-label', `${u.text}: dřív v tom dni`);
    driv.addEventListener('click', () => posunoutVDni(u, -1));
    const pozdeji = Object.assign(document.createElement('button'), { type: 'button', textContent: '↓', className: 'mala', title: 'Později v tom dni', disabled: vDni === pocet });
    pozdeji.setAttribute('aria-label', `${u.text}: později v tom dni`);
    pozdeji.addEventListener('click', () => posunoutVDni(u, 1));
    akce.append(driv, pozdeji);
  }
  akce.append(upravit, smazat);
  tr.append(datum, text, obs, akce);
  return tr;
}

function vykresliKalendar() {
  const k = stav.prehled?.kalendar;
  if (!k) return;
  const dnes = k.dnes;
  $('#kalendar-datum').textContent = dnes ? Harptos.format(dnes) : 'Datum není zadané';
  $('#kalendar-svatek').textContent = dnes?.svatek ? `Svátek ${Harptos.popisSvatku(dnes)}.` : '';
  for (const b of document.querySelectorAll('[data-posun], #kalendar-dalsi-den, #sc-dalsi-den')) b.disabled = !dnes;
  if (JSON.stringify(dnes) !== JSON.stringify(posledniDnes) && !$('#formular-dnes').contains(document.activeElement)) {
    vyberDnes.set(dnes ?? k.zacatek ?? { rok: 1491, mesic: 'Hammer', den: 1 });
    posledniDnes = dnes;
  }

  const chyba = $('#kalendar-chyba');
  chyba.hidden = !k.chyba;
  chyba.textContent = k.chyba ?? '';

  const d = dnes ? Harptos.absolutni(dnes) : null;
  const konec = (u) => Harptos.absolutni(u.konec ?? u.datum);
  const nadchazejici = k.udalosti.filter((u) => d === null || konec(u) >= d);
  // Proběhlé: nejnovější dny nahoře, v rámci dne ale v pořadí, jak šly po sobě.
  const probehle = k.udalosti
    .map((u, i) => ({ u, i }))
    .filter(({ u }) => d !== null && konec(u) < d)
    .sort((a, b) => Harptos.absolutni(b.u.datum) - Harptos.absolutni(a.u.datum) || a.i - b.i)
    .map(({ u }) => u);
  $('#tabulka-udalosti tbody').replaceChildren(...nadchazejici.map((u) => radekUdalosti(u, dnes, k.udalosti)));
  $('#tabulka-udalosti').hidden = nadchazejici.length === 0;
  $('#tabulka-probehlych tbody').replaceChildren(...probehle.map((u) => radekUdalosti(u, dnes, k.udalosti)));
  $('#pocet-probehlych').textContent = probehle.length;

  // Lhůty, které OBS právě ukazuje (stejný výpočet jako výstupy)
  const lhuty = dnes
    ? k.udalosti
        .filter((u) => u.verejna && u.lhuta)
        .map((u) => ({ u, zbyva: Harptos.rozdil(dnes, u.datum) }))
        .filter((x) => x.zbyva >= 1 && x.zbyva <= x.u.lhuta)
        .sort((a, b) => a.zbyva - b.zbyva)
    : [];
  $('#kalendar-lhuty-box').hidden = lhuty.length === 0;
  $('#kalendar-lhuty').replaceChildren(
    ...lhuty.map(({ u, zbyva }) => Object.assign(document.createElement('li'), { textContent: `${u.text} — ${zbyvaText(zbyva)}` })),
  );
  const mini = $('#kalendar-mini');
  mini.hidden = !dnes;
  mini.textContent = dnes ? Harptos.kratce(dnes) : '';

  if (!k.existuje) $('#kalendar-import').hidden = false;
}

async function zmenitDnes(telo) {
  const v = $('#kalendar-vysledek');
  try {
    const r = await api('/api/kalendar/dnes', { metoda: 'PUT', telo });
    v.className = r.vysledek === 'odlozeno' ? 'ulozeni varovani' : 'ulozeni';
    v.textContent = r.vysledek === 'odlozeno' ? 'stav.md drží otevřený jiný program; v OBS už je nové datum.' : `Datum nastaveno v ${cas()}.`;
  } catch (chyba) {
    v.className = 'ulozeni chyba';
    v.textContent = chyba.message;
  }
}
for (const b of document.querySelectorAll('[data-posun]')) b.addEventListener('click', () => zmenitDnes({ posun: Number(b.dataset.posun) }));
$('#formular-dnes').addEventListener('submit', (e) => {
  e.preventDefault();
  const datum = vyberDnes.get();
  if (!datum) {
    $('#kalendar-vysledek').className = 'ulozeni chyba';
    $('#kalendar-vysledek').textContent = 'Takové datum v Harptosu není (den 1–30, Shieldmeet jen v přestupném roce).';
    return;
  }
  zmenitDnes({ datum });
});

/* Import ze samostatného kalendáře */

function seznamImportu(ol, polozky) {
  // Obě strany podle data, ať jdou porovnat řádek po řádku.
  const serazene = [...polozky].sort((a, b) => (a.datum ? Harptos.absolutni(a.datum) : Infinity) - (b.datum ? Harptos.absolutni(b.datum) : Infinity));
  ol.replaceChildren(
    ...serazene.map((u) => Object.assign(document.createElement('li'), { textContent: `${u.datum ? Harptos.format(u.datum) : 'neplatné datum'} — ${u.text}` })),
  );
}

async function nactiImport() {
  let k;
  try {
    k = await api('/api/kalendar');
  } catch {
    return;
  }
  const box = $('#kalendar-import');
  const imp = k.import;
  // Import je jednorázový převod ze starého kalendáře. Jakmile události v repu jsou, box se
  // neukazuje: opakovaný import by jedním klikem přepsal události i dnešní datum (audit V2).
  box.hidden = k.existuje;
  if (box.hidden) return;
  $('#import-pocet-zdroj').textContent = imp.pocet;
  seznamImportu($('#import-zdroj'), imp.seznam);
  $('#import-pocet-cil').textContent = k.existuje ? k.udalosti.length : 0;
  seznamImportu($('#import-cil'), k.existuje ? k.udalosti : []);
  const b = $('#import-spustit');
  if (!imp.dostupny) {
    $('#import-popis').textContent = 'Soubor Apps/Calendar/kalendar-data.js nebyl nalezen. Události přidávej rovnou tady.';
    b.hidden = true;
    return;
  }
  b.hidden = false;
  if (k.existuje) {
    $('#import-popis').textContent = 'Události už v repu jsou. Opakovaný import je přepíše daty ze samostatného kalendáře (ten se od Bloku 1b dál nevyvíjí). Seznamy porovnej vedle sebe.';
    b.textContent = 'Importovat znovu a přepsat';
    b.dataset.prepsat = 'true';
    b.className = '';
  } else {
    $('#import-popis').textContent = `Převezme ${imp.pocet} událostí, dnešní datum${imp.dnes ? ` (${Harptos.format(imp.dnes)})` : ''} a začátek kampaně${imp.zacatek ? ` (${Harptos.format(imp.zacatek)})` : ''}. Originál zůstane jako záloha.`;
    b.textContent = 'Importovat';
    b.dataset.prepsat = '';
    b.className = 'hlavni';
  }
}

$('#import-spustit').addEventListener('click', async () => {
  const b = $('#import-spustit');
  const v = $('#import-vysledek');
  try {
    const r = await api('/api/kalendar/import', { metoda: 'POST', telo: { prepsat: b.dataset.prepsat === 'true' } });
    v.className = r.pocetZdroj === r.pocetCil ? 'ulozeni' : 'ulozeni varovani';
    v.textContent = r.pocetZdroj === r.pocetCil
      ? `Hotovo: ${r.pocetZdroj} událostí v kalendar-data.js, ${r.pocetCil} v udalosti.yaml. Počty se shodují.`
      : `Pozor: ${r.pocetZdroj} událostí v kalendar-data.js, ale ${r.pocetCil} v udalosti.yaml (${r.vadne} s neplatným datem nebo bez textu).`;
    seznamImportu($('#import-zdroj'), r.zdroj);
    seznamImportu($('#import-cil'), r.cil);
    $('#import-pocet-zdroj').textContent = r.pocetZdroj;
    $('#import-pocet-cil').textContent = r.pocetCil;
    b.hidden = true;
  } catch (chyba) {
    v.className = 'ulozeni chyba';
    v.textContent = chyba.message;
  }
});

/* Formulář události */

let upravovana = null;

function otevritUdalost(u = null) {
  upravovana = u;
  const dnes = stav.prehled?.kalendar?.dnes ?? { rok: 1491, mesic: 'Hammer', den: 1 };
  $('#udalost-nadpis').textContent = u ? 'Upravit událost' : 'Nová událost';
  $('#udalost-text').value = u?.text ?? '';
  vyberOd.set(u?.datum ?? dnes);
  $('#udalost-vicedenni').checked = Boolean(u?.konec);
  $('#udalost-konec-box').hidden = !u?.konec;
  vyberDo.set(u?.konec ?? Harptos.posun(u?.datum ?? dnes, 1));
  $('#udalost-verejna').checked = u ? u.verejna : true;
  $('#udalost-lhuta').value = u?.lhuta ?? '';
  $('#udalost-chyba').textContent = '';
  $('#dialog-udalost').showModal();
  $('#udalost-text').focus();
}
$('#udalost-nova').addEventListener('click', () => otevritUdalost());
$('#udalost-vicedenni').addEventListener('change', (e) => {
  $('#udalost-konec-box').hidden = !e.target.checked;
  if (e.target.checked && vyberOd.get()) vyberDo.set(Harptos.posun(vyberOd.get(), 1));
});

$('#formular-udalost').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'ulozit') return;
  e.preventDefault();
  const chyba = $('#udalost-chyba');
  const datum = vyberOd.get();
  const konec = $('#udalost-vicedenni').checked ? vyberDo.get() : null;
  if (!datum || ($('#udalost-vicedenni').checked && !konec)) {
    chyba.textContent = 'Takové datum v Harptosu není (den 1–30, Shieldmeet jen v přestupném roce).';
    return;
  }
  const lhuta = $('#udalost-lhuta').value.trim();
  const telo = {
    text: $('#udalost-text').value.trim(),
    datum,
    konec,
    verejna: $('#udalost-verejna').checked,
    lhuta: lhuta ? Number(lhuta) : null,
  };
  try {
    if (upravovana) await api(`/api/kalendar/udalosti/${encodeURIComponent(upravovana.id)}`, { metoda: 'PUT', telo });
    else await api('/api/kalendar/udalosti', { metoda: 'POST', telo });
    $('#dialog-udalost').close();
    toast(upravovana ? 'Událost upravena.' : 'Událost přidána.');
  } catch (err) {
    chyba.textContent = err.message;
  }
});

/* ---------- Další den ---------- */

function prehledDneEl(den, { nadpis }) {
  const box = document.createDocumentFragment();
  const p = (text, trida) => Object.assign(document.createElement('p'), { textContent: text, className: trida ?? '' });
  if (nadpis) box.append(p(nadpis, 'uvod'));
  if (den.svatek) box.append(p(`Svátek ${den.svatek}.`, 'svatek'));
  if (den.udalosti.length) {
    const ul = document.createElement('ul');
    for (const u of den.udalosti) {
      const li = document.createElement('li');
      li.textContent = `${u.text}${u.celkem > 1 ? ` (den ${u.den} z ${u.celkem})` : ''}${u.verejna ? '' : ' — skrytá, hráči ji nevidí'}`;
      ul.append(li);
    }
    box.append(ul);
  } else if (!den.svatek) box.append(p('Žádné události.', 'uvod'));
  if (den.lhuty.length) box.append(p(`Lhůty: ${den.lhuty.map((l) => `${l.text} ${zbyvaText(l.zbyva)}`).join(', ')}.`, 'uvod'));
  return box;
}

async function otevritDalsiDen() {
  if (!stav.prehled?.kalendar?.dnes) {
    toast('Dnešní datum ještě není zadané. Nastav ho v Kalendáři.', { chyba: true });
    location.hash = 'kalendar';
    return;
  }
  let n;
  try {
    n = await api('/api/den/nahled');
  } catch (chyba) {
    toast(chyba.message, { chyba: true });
    return;
  }
  $('#den-datum').textContent = Harptos.format(n.zitra);
  $('#den-nahled').replaceChildren(prehledDneEl(n.den, { nadpis: 'Co ten den čeká:' }));
  $('#den-chyba').textContent = '';
  $('#den-krok1').hidden = false;
  $('#den-krok2').hidden = true;
  stav.denOdeslan = false;
  for (const dlg of document.querySelectorAll('dialog[open]')) dlg.close();
  $('#dialog-den').showModal();
}

$('#formular-den').addEventListener('submit', async (e) => {
  const volba = e.submitter?.value;
  if (volba !== 'ano' && volba !== 'ne') return;
  e.preventDefault();
  // Jeden dialog = nejvýš jeden posun kalendáře, i při dvojkliku (audit S3).
  if (stav.denOdeslan) return;
  stav.denOdeslan = true;
  try {
    const r = await api('/api/den/dalsi', { metoda: 'POST', telo: { dukladny: volba === 'ano' } });
    $('#den-datum').textContent = r.dnesText;
    $('#den-vysledek').replaceChildren(prehledDneEl(r, { nadpis: '' }));
    $('#den-pripominky-nadpis').textContent = r.dukladny ? 'Po důkladném odpočinku' : 'Bez důkladného odpočinku';
    const ul = $('#den-pripominky');
    ul.replaceChildren(
      ...r.pripominky.map((p) => {
        const li = document.createElement('li');
        const kdo = Object.assign(document.createElement('strong'), { textContent: p.kdo });
        li.append(kdo, ` ${p.text}`);
        return li;
      }),
    );
    if (r.chybaPripominek) ul.append(Object.assign(document.createElement('li'), { textContent: r.chybaPripominek, className: 'chyba' }));
    $('#den-poznamka').textContent = `Zapsáno do ${r.poznamka}.`;
    $('#den-krok1').hidden = true;
    $('#den-krok2').hidden = false;
  } catch (chyba) {
    stav.denOdeslan = false;
    $('#den-chyba').textContent = chyba.message;
  }
});
$('#sc-dalsi-den').addEventListener('click', otevritDalsiDen);
$('#kalendar-dalsi-den').addEventListener('click', otevritDalsiDen);

/* ---------- Obchody ---------- */

const TYPY_OBCHODU = {
  kovarna: 'Kovárna a zbrojíř', lukar: 'Lukař', kozeluh: 'Koželuh', chram: 'Chrám', kolonial: 'Koloniál',
  dobrodruzne: 'Vybavení pro dobrodruhy', krejci: 'Krejčí a látky', klenotnik: 'Klenotník a kamenoryt',
  alchymista: 'Alchymista', arkanni: 'Arkánní krám', staje: 'Stáje a povozník', pristavni: 'Přístavní zboží',
  magicke: 'Magické zboží', prekupnik: 'Překupník', umeni_hry: 'Umění a hry',
};
const LOKALITY = { rural: 'venkov', urban: 'město', premium: 'luxus' };

async function ukazatObchod(id, nazev) {
  try {
    const r = await api('/api/obchody/aktivni', { metoda: 'PUT', telo: { id, prepnout: Boolean(id) } });
    if (r.chybaObs) toast(r.chybaObs, { chyba: true });
    else toast(id ? `V OBS: ${nazev}${r.scena ? ` (scéna ${r.scena})` : ''}` : 'Ceník skrytý.');
  } catch (chyba) {
    toast(chyba.message, { chyba: true });
  }
}
$('#obchod-skryt').addEventListener('click', () => ukazatObchod(null));

function nazevObchodu(s) {
  return `${s.nazev}${s.mesto ? `, ${s.mesto}` : ''}`;
}

/** Obchody: U stolu jen ukázat v OBS, správa (příprava, obrázek, mazání) na vlastní obrazovce (rozhodnutí 51). */
function vykresliObchody() {
  const o = stav.prehled?.obchody;
  if (!o) return;
  const aktivni = o.sortimenty.find((s) => s.id === o.aktivni);
  $('#obchod-aktivni').textContent = aktivni ? `Ceník ukazuje: ${nazevObchodu(aktivni)}` : 'Ceník je skrytý.';
  $('#obchod-skryt').hidden = !aktivni;
  const td = (text) => Object.assign(document.createElement('td'), { textContent: text });
  const typ = (s) => `${TYPY_OBCHODU[s.typ] ?? s.typ} (${LOKALITY[s.lokalita] ?? s.lokalita})`;

  // U stolu
  $('#sortimenty-prazdno').hidden = o.sortimenty.length > 0;
  $('#tabulka-sortimentu').hidden = o.sortimenty.length === 0;
  $('#tabulka-sortimentu tbody').replaceChildren(
    ...o.sortimenty.map((s) => {
      const tr = document.createElement('tr');
      const jeAktivni = s.id === o.aktivni;
      if (jeAktivni) tr.dataset.dnes = 'true';
      const nazev = td(nazevObchodu(s));
      if (jeAktivni) nazev.append(Object.assign(document.createElement('small'), { textContent: ' · v OBS' }));
      const akce = document.createElement('td');
      akce.className = 'akce-radku';
      const ukazat = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Ukázat v OBS', className: 'hlavni' });
      ukazat.addEventListener('click', () => ukazatObchod(s.id, s.nazev));
      akce.append(ukazat);
      tr.append(nazev, td(typ(s)), td(String(s.pocet)), akce);
      return tr;
    }),
  );

  // Obchody (Příprava)
  $('#sprava-sortimenty-prazdno').hidden = o.sortimenty.length > 0;
  $('#tabulka-sprava-sortimentu').hidden = o.sortimenty.length === 0;
  const vadne = $('#sortimenty-vadne');
  vadne.hidden = !o.vadne.length;
  vadne.textContent = o.vadne.map((v) => `${v.soubor}: ${v.chyba}`).join(' · ');
  $('#tabulka-sprava-sortimentu tbody').replaceChildren(
    ...o.sortimenty.map((s) => {
      const tr = document.createElement('tr');
      const jeAktivni = s.id === o.aktivni;
      const nazev = td(nazevObchodu(s));
      if (jeAktivni) nazev.append(Object.assign(document.createElement('small'), { textContent: ' · v OBS' }));
      const obrazek = td(s.obrazek ? 'vlastní' : 'výchozí');
      const doDilny = Object.assign(document.createElement('a'), { href: '#dilna', textContent: s.obrazek ? 'Vyměnit v dílně' : 'Vytvořit v dílně' });
      doDilny.addEventListener('click', () => (dilna.cil = `obchod:${s.id}`));
      obrazek.append(document.createElement('br'), doDilny);
      const akce = document.createElement('td');
      akce.className = 'akce-radku';
      const smazat = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Smazat', className: 'nebezpecne' });
      smazat.addEventListener('click', async () => {
        if (smazat.dataset.potvrd !== 'true') {
          smazat.dataset.potvrd = 'true';
          smazat.textContent = jeAktivni ? 'Je v OBS. Opravdu smazat?' : 'Opravdu smazat?';
          setTimeout(() => {
            smazat.dataset.potvrd = '';
            smazat.textContent = 'Smazat';
          }, 4000);
          return;
        }
        try {
          await api(`/api/obchody/sortimenty/${s.id}`, { metoda: 'DELETE' });
          toast(`Smazáno: ${s.nazev}`);
        } catch (chyba) {
          toast(chyba.message, { chyba: true });
        }
      });
      akce.append(smazat);
      const kdy = s.vygenerovano ? new Date(s.vygenerovano).toLocaleDateString('cs-CZ') : '';
      tr.append(nazev, td(typ(s)), td(String(s.pocet)), td(kdy), obrazek, akce);
      return tr;
    }),
  );
}

/* ---------- Místa a scéna místa (Blok 2) ---------- */

let vybraneMisto = null; // místo zobrazené v panelu (nemusí být to, co je v OBS)

/** Ilustrace, které by OBS ukázalo pro danou denní dobu a stav (stejné pravidlo jako server, scena.js). */
function viditelneIlustrace(m, { varianta, stav: stavMista }) {
  return (m?.ilustrace ?? []).filter(
    (il) => il.ucel === 'scena' && !il.skryta && (!il.varianta || il.varianta === varianta) && (!il.stav || il.stav === stavMista),
  );
}

/** Před akcí, po které by v OBS zůstalo černo, se zeptat (audit S6). */
function potvrditCerno(m, volby) {
  if (viditelneIlustrace(m, volby).length) return true;
  const kdy = [volby.varianta === 'noc' ? 'noc' : 'den', volby.stav ? `stav ${volby.stav}` : null].filter(Boolean).join(', ');
  return confirm(`${m.nazev} nemá pro ${kdy} žádnou odkrytou ilustraci, takže v OBS bude černo. Přesto přepnout?`);
}

function textIlustrace(il) {
  return [il.varianta, il.stav].filter(Boolean).join(' · ') || 'vždy';
}

function vykresliScenu() {
  const s = stav.prehled?.scena;
  if (!s) return;
  $('#scena-nazev').textContent = s.misto ? `V OBS: ${s.misto.nazev}` : 'V OBS není žádné místo.';
  $('#scena-detail').textContent = s.misto
    ? s.ilustrace
      ? `${s.ilustrace.soubor} (${s.poradi}/${s.pocet})${s.stridani.zapnuto && s.pocet > 1 ? `, střídá se po ${s.stridani.sekund} s` : ''}`
      : 'Pro tuhle denní dobu a stav nemá místo žádnou odkrytou ilustraci; OBS je černé.'
    : 'Klikni na místo a ukáže se v OBS.';
  const mini = $('#mista-mini');
  mini.hidden = !s.misto;
  mini.textContent = s.misto?.nazev ?? '';
  for (const seg of document.querySelectorAll('.prepinace .segment')) {
    if (seg.dataset.pole === 'pocasi') {
      // Počasí jsou přepínače: déšť, sníh a mlha jdou zapnout i naráz, Žádné je vypne všechny.
      const zap = pocasiSeznam(s.pocasi);
      for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === 'zadne' ? zap.length === 0 : zap.includes(b.dataset.v)));
      continue;
    }
    const hodnota = String(s[seg.dataset.pole]);
    for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === hodnota));
  }
  const vyberStavu = $('#sc-stav');
  if (document.activeElement !== vyberStavu) {
    vyberStavu.replaceChildren(new Option('výchozí', ''), ...s.stavy.map((x) => new Option(x, x)));
    vyberStavu.value = s.stav ?? '';
    vyberStavu.disabled = !s.stavy.length;
  }
  $('#sc-bourka-radek').hidden = !pocasiSeznam(s.pocasi).includes('bourka');
  if (document.activeElement !== $('#scena-sekund')) $('#scena-sekund').value = s.stridani.sekund;
  $('#scena-stridani').checked = s.stridani.zapnuto;
  for (const id of ['#scena-predchozi', '#scena-dalsi']) $(id).disabled = !(s.pocet > 1);
  vykresliSceny();
  vykresliMista();
}

async function scenaApi(cesta, metoda, telo) {
  try {
    const r = await api(cesta, { metoda, telo });
    if (r.chybaObs) toast(r.chybaObs, { chyba: true });
    return r;
  } catch (chyba) {
    toast(chyba.message, { chyba: true });
    return null;
  }
}

for (const seg of document.querySelectorAll('.prepinace .segment')) {
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const pole = seg.dataset.pole;
    const s = stav.prehled?.scena;
    if (pole === 'pocasi') {
      const zap = pocasiSeznam(s?.pocasi);
      const nove = b.dataset.v === 'zadne' ? [] : zap.includes(b.dataset.v) ? zap.filter((x) => x !== b.dataset.v) : [...zap, b.dataset.v];
      scenaApi('/api/scena', 'PUT', { pocasi: nove });
      return;
    }
    const m = stav.prehled?.mista?.mista?.find((x) => x.id === s?.misto?.id);
    if (pole === 'varianta' && m && b.dataset.v !== s.varianta && !potvrditCerno(m, { varianta: b.dataset.v, stav: s.stav })) return;
    scenaApi('/api/scena', 'PUT', { [pole]: pole === 'intenzita' ? Number(b.dataset.v) : b.dataset.v });
  });
}
$('#sc-stav').addEventListener('change', (e) => {
  const s = stav.prehled?.scena;
  const m = stav.prehled?.mista?.mista?.find((x) => x.id === s?.misto?.id);
  if (m && !potvrditCerno(m, { varianta: s.varianta, stav: e.target.value || null })) {
    e.target.value = s.stav ?? '';
    return;
  }
  scenaApi('/api/scena', 'PUT', { stav: e.target.value || null });
});
$('#scena-predchozi').addEventListener('click', () => scenaApi('/api/scena/dalsi', 'POST', { smer: -1 }));
$('#scena-dalsi').addEventListener('click', () => scenaApi('/api/scena/dalsi', 'POST', { smer: 1 }));
$('#scena-stridani').addEventListener('change', (e) => scenaApi('/api/scena', 'PUT', { stridani: { zapnuto: e.target.checked } }));
$('#scena-sekund').addEventListener('change', (e) => scenaApi('/api/scena', 'PUT', { stridani: { sekund: Number(e.target.value) } }));

function vykresliMista() {
  const seznam = stav.prehled?.mista?.mista ?? [];
  const s = stav.prehled?.scena;
  if (!vybraneMisto || !seznam.some((m) => m.id === vybraneMisto)) vybraneMisto = s?.misto?.id ?? null;

  // U stolu: místa jako rychlé dlaždice (klik = ukázat v OBS) a ilustrace místa, které v OBS právě je.
  const zive = seznam.find((x) => x.id === s?.misto?.id) ?? null;
  // Klik na místo ho jen vybere v panelu; do OBS jde až zvolená ilustrace (nebo Ukázat místo v OBS).
  // Hráči tak nevidí probliknout výchozí ilustraci, než DM vybere tu správnou.
  if (stav.stulMisto && !seznam.some((m) => m.id === stav.stulMisto)) stav.stulMisto = null;
  if (stav.stulMisto === zive?.id) stav.stulMisto = null;
  const vybrane = seznam.find((x) => x.id === stav.stulMisto) ?? zive;
  const volby = { varianta: s?.varianta ?? 'den', stav: null };
  // Na dlaždicích jsou jen místa se scénou pro OBS. Místa z kánonu bez ilustrací (komora, sídla, štoly)
  // by tu jen překážela; najdeš je v modulu Místa, kde jim dílna může ilustraci přidat.
  const naStul = seznam.filter((m) => m.id === zive?.id || m.id === vybrane?.id || (m.ilustrace ?? []).some((il) => il.ucel === 'scena'));
  // Podmísta pod svým místem (⚠ bod 116); když nadřazené místo na dlaždicích není, je jeho jméno před názvem.
  const podleIdMist = new Map(seznam.map((m) => [m.id, m]));
  $('#stul-mista').replaceChildren(
    ...stromMist(naStul).map(({ m, hloubka }) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'polozka-mista';
      b.style.setProperty('--hloubka', hloubka);
      if (hloubka) b.classList.add('podmisto');
      b.setAttribute('aria-pressed', String(m.id === vybrane?.id));
      if (m.id === zive?.id) b.classList.add('v-obs');
      const rodic = !hloubka && m.leziV ? podleIdMist.get(m.leziV) : null;
      b.append(Object.assign(document.createElement('span'), { textContent: m.nazev }, rodic ? { title: `${m.nazev} leží v ${rodic.nazev}` } : {}));
      if (rodic) b.firstChild.prepend(Object.assign(document.createElement('span'), { className: 'rodic-mista', textContent: `${rodic.nazev} › ` }));
      if (m.id === zive?.id) b.append(Object.assign(document.createElement('span'), { className: 'zive', textContent: 'Živě' }));
      // Místo, které by teď v OBS dalo černo, je označené už na dlaždici (audit S6).
      if (!viditelneIlustrace(m, volby).length) {
        b.classList.add('bez-ilustrace');
        const jindy = viditelneIlustrace(m, { varianta: volby.varianta === 'noc' ? 'den' : 'noc', stav: null }).length;
        const text = jindy ? `bez ilustrace na ${volby.varianta === 'noc' ? 'noc' : 'den'}` : 'bez odkryté ilustrace';
        b.append(Object.assign(document.createElement('small'), { textContent: text }));
      }
      b.addEventListener('click', () => {
        stav.stulMisto = m.id === zive?.id ? null : m.id;
        vykresliMista();
      });
      return b;
    }),
  );
  const jeZive = vybrane && vybrane.id === zive?.id;
  $('#stul-ilustrace-nadpis').textContent = !vybrane ? 'Ilustrace' : jeZive ? `Ilustrace: ${vybrane.nazev} (v OBS)` : `Ilustrace: ${vybrane.nazev}`;
  $('#stul-ilustrace-popis').textContent = !vybrane
    ? 'V OBS není žádné místo. Vyber ho výše.'
    : !vybrane.ilustrace.length
      ? 'Místo zatím nemá žádnou ilustraci. Vytvoř ji v Ilustrační dílně.'
      : jeZive
        ? 'Klik na ilustraci = do OBS. Šedé jsou skryté, do OBS nejdou.'
        : `V OBS je pořád ${zive ? zive.nazev : 'jiná scéna'}. Klikni na ilustraci a OBS přepne rovnou na ni.`;
  const ukazatMisto = $('#stul-misto-ukazat');
  ukazatMisto.hidden = !vybrane || jeZive;
  ukazatMisto.textContent = vybrane ? `Ukázat ${vybrane.nazev} v OBS (výchozí ilustrace)` : '';
  // Všechny ilustrace v jedné mřížce, skryté za odkrytými a ztlumené (rozhodnutí 66): odkrytí je u stolu
  // běžná akce, nemá se schovávat za rozbalovací tlačítko.
  const vsechny = vybrane?.ilustrace ?? [];
  const serazene = [...vsechny.filter((il) => !il.skryta), ...vsechny.filter((il) => il.skryta)];
  $('#stul-ilustrace').replaceChildren(...serazene.map((il) => kartaIlustrace(vybrane, il, s, jeZive, false)));

  // Strom míst (⚠ bod 116): podmísta jsou vidět jen ve větvi vybraného místa, jinak by seznam
  // přerostl obrazovku (rozhodnutí 66). Sbalené místo ukazuje, kolik míst v něm leží.
  const podleIdM = new Map(seznam.map((x) => [x.id, x]));
  const rozbalene = new Set();
  for (let x = podleIdM.get(vybraneMisto); x && !rozbalene.has(x.id); x = podleIdM.get(x.leziV)) rozbalene.add(x.id);
  const pocetUvnitr = (id) => seznam.filter((x) => x.leziV === id).length;
  const strom = stromMist(seznam);
  const viditelne = strom.filter(({ m }) => {
    for (let r = podleIdM.get(m.leziV), k = 0; r && k < 20; r = podleIdM.get(r.leziV), k++) if (!rozbalene.has(r.id)) return false;
    return true;
  });
  $('#seznam-mist').replaceChildren(
    ...viditelne.map(({ m, hloubka }) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'polozka-mista';
      b.style.setProperty('--hloubka', hloubka);
      if (hloubka) b.classList.add('podmisto');
      b.setAttribute('aria-pressed', String(m.id === vybraneMisto));
      const odkryte = m.ilustrace.filter((il) => !il.skryta && il.ucel === 'scena');
      const uvnitr = pocetUvnitr(m.id);
      b.append(Object.assign(document.createElement('span'), { textContent: m.nazev }));
      if (uvnitr && !rozbalene.has(m.id)) {
        b.firstChild.append(Object.assign(document.createElement('small'), { className: 'pocet-uvnitr', textContent: ` ▸ ${uvnitr}`, title: `Leží v něm ${uvnitr} míst. Klikni a ukážou se.` }));
      }
      const pocet = Object.assign(document.createElement('span'), { className: 'pocet-ilustraci', textContent: `${odkryte.length} / ${m.ilustrace.length - odkryte.length}` });
      pocet.title = `${odkryte.length} odkrytých, ${m.ilustrace.length - odkryte.length} skrytých`;
      b.append(pocet);
      b.addEventListener('click', () => {
        if (m.id !== vybraneMisto && stav.rozpracovano.has(`popis:${vybraneMisto}`)) {
          if (!confirm('Popis vzhledu není uložený. Přejít jinam a rozepsaný text zahodit?')) return;
          stav.rozpracovano.delete(`popis:${vybraneMisto}`);
        }
        vybraneMisto = m.id;
        vykresliMista();
      });
      return b;
    }),
  );
  const m = seznam.find((x) => x.id === vybraneMisto);
  $('#misto-detail').hidden = !m;
  if (!m) return;
  $('#misto-nazev').textContent = m.nazev;
  vykresliLeziV(m, seznam);
  const vObs = s?.misto?.id === m.id;
  $('#misto-ukazat').textContent = vObs ? 'Znovu přepnout OBS na místo' : 'Ukázat v OBS';
  $('#misto-souhrn').textContent = m.ilustrace.length
    ? 'Klikni na ilustraci a uprav ji vpravo. Šedé jsou skryté (do OBS nejdou).'
    : 'Místo zatím nemá žádnou ilustraci. Vytvoř ji v Ilustrační dílně.';
  vykresliSvetlaMista(m);
  vykresliZvukMista(m);
  // Rozepsaný popis nepřepíše žádná živá změna (střídání ilustrací, změna jinde), dokud ho DM neuloží (audit S7).
  if (document.activeElement !== $('#misto-popis') && !stav.rozpracovano.has(`popis:${m.id}`)) $('#misto-popis').value = m.popisObrazu;
  const mrizka = $('#misto-ilustrace');
  // Nepřekresluj pod rukama, když DM právě píše stav nebo vybírá variantu (tlačítka nevadí).
  const aktivni = document.activeElement;
  if (mrizka.contains(aktivni) && ['INPUT', 'SELECT'].includes(aktivni.tagName)) return;
  // Příprava (rozhodnutí 66): karta jen vybírá, úpravy jsou v jednom panelu vpravo.
  if (!m.ilustrace.some((il) => il.soubor === stav.mistoIlustrace)) stav.mistoIlustrace = m.ilustrace[0]?.soubor ?? null;
  mrizka.replaceChildren(...m.ilustrace.map((il) => kartaPripravy(m, il, s, vObs)));
  vykresliInspektor(m);
}

function kartaPripravy(m, il, s, vObs) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'karta-pripravy';
  b.dataset.skryta = String(il.skryta);
  b.setAttribute('aria-pressed', String(il.soubor === stav.mistoIlustrace));
  const obr = Object.assign(document.createElement('span'), { className: 'obrazek' });
  obr.style.backgroundImage = `url("${il.url}")`;
  const jmeno = Object.assign(document.createElement('span'), { className: 'jmeno', textContent: il.soubor.replace(/\.[a-z0-9]+$/i, '') });
  const stitky = Object.assign(document.createElement('span'), { className: 'stitky', textContent: `${il.skryta ? 'skrytá · ' : ''}${textIlustrace(il)}` });
  b.append(obr, jmeno, stitky);
  if (vObs && s?.ilustrace?.soubor === il.soubor) b.append(Object.assign(document.createElement('span'), { className: 'zive', textContent: 'Živě' }));
  b.addEventListener('click', () => {
    stav.mistoIlustrace = il.soubor;
    vykresliMista();
  });
  return b;
}

/** Panel vybrané ilustrace: odkrytá, kdy se ukazuje, stav místa, zahodit. */
function vykresliInspektor(m) {
  const panel = $('#misto-inspektor');
  if (panel.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
  const il = m.ilustrace.find((x) => x.soubor === stav.mistoIlustrace);
  if (!il) {
    panel.replaceChildren(Object.assign(document.createElement('p'), { className: 'ulozeni', textContent: 'Vyber ilustraci vlevo.' }));
    return;
  }
  const nahled = Object.assign(document.createElement('div'), { className: 'inspektor-nahled' });
  nahled.style.backgroundImage = `url("${il.url}")`;
  const jmeno = Object.assign(document.createElement('p'), { className: 'inspektor-jmeno', textContent: il.soubor });

  const odkryta = Object.assign(document.createElement('label'), { className: 'prepinac-zap' });
  const sw = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !il.skryta });
  sw.setAttribute('role', 'switch');
  sw.addEventListener('change', () => upravIlustraci(m.id, il.soubor, { skryta: !sw.checked }));
  odkryta.append(sw, Object.assign(document.createElement('span'), { textContent: 'Odkrytá (může do OBS)' }));

  const kdy = Object.assign(document.createElement('div'), { className: 'prepinac' });
  kdy.append(Object.assign(document.createElement('span'), { textContent: 'Kdy se ukazuje' }));
  const seg = Object.assign(document.createElement('div'), { className: 'segment' });
  for (const [v, t] of [['', 'Vždy'], ['den', 'Den'], ['noc', 'Noc']]) {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: t });
    b.setAttribute('aria-pressed', String((il.varianta ?? '') === v));
    b.addEventListener('click', () => upravIlustraci(m.id, il.soubor, { varianta: v || null }));
    seg.append(b);
  }
  kdy.append(seg);

  // Stav místa: pole s nabídkou stavů, které už místo používá (⚠ návrh: výběr místo volného textu).
  const stavy = [...new Set(m.ilustrace.map((x) => x.stav).filter(Boolean))];
  const stavLabel = Object.assign(document.createElement('label'), { className: 'pole-stavu' });
  stavLabel.append(Object.assign(document.createElement('span'), { textContent: 'Jen ve stavu místa' }));
  const stavPole = Object.assign(document.createElement('input'), { value: il.stav ?? '', placeholder: 'kterýkoli (výchozí)' });
  const seznamId = `stavy-${m.id}`;
  stavPole.setAttribute('list', seznamId);
  const datalist = Object.assign(document.createElement('datalist'), { id: seznamId });
  datalist.append(...stavy.map((x) => new Option(x, x)));
  stavPole.addEventListener('change', () => upravIlustraci(m.id, il.soubor, { stav: stavPole.value.trim() || null }));
  stavLabel.append(stavPole, datalist);

  const paticka = Object.assign(document.createElement('div'), { className: 'inspektor-paticka' });
  paticka.append(Object.assign(document.createElement('span'), { className: 'ulozeni', textContent: il.prompt ? 'Má uložený prompt.' : 'Ukládá se samo.' }));
  const zahodit = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Zahodit…', className: 'nebezpecne' });
  zahodit.addEventListener('click', async () => {
    if (!confirm(`Zahodit ilustraci ${il.soubor}? Soubor se smaže z místa.`)) return;
    try {
      await api(`/api/mista/${m.id}/ilustrace/${encodeURIComponent(il.soubor)}`, { metoda: 'DELETE' });
      toast(`Zahozeno: ${il.soubor}`);
    } catch (chyba) {
      toast(chyba.message, { chyba: true });
    }
  });
  paticka.append(zahodit);
  panel.replaceChildren(nahled, jmeno, odkryta, kdy, stavLabel, paticka);
}

/**
 * Karta jedné ilustrace. `sprava` = plná sada (varianta, stav, zahodit); jinak jen to, co se hodí u stolu:
 * ukázat v OBS a odkrýt/skrýt.
 */
function kartaIlustrace(m, il, s, vObs, sprava) {
  const karta = document.createElement('div');
  karta.className = 'karta-ilustrace';
  karta.dataset.skryta = String(il.skryta);
  if (vObs && s.ilustrace?.soubor === il.soubor) karta.dataset.aktualni = 'true';
  const obr = document.createElement('button');
  obr.type = 'button';
  obr.className = 'obrazek';
  obr.style.backgroundImage = `url("${il.url}")`;
  obr.title = il.skryta ? 'Skrytá: nejdřív ji odkryj' : 'Ukázat v OBS';
  obr.disabled = il.skryta || il.ucel !== 'scena';
  obr.addEventListener('click', async () => {
    const r = await scenaApi('/api/scena/zobrazit', 'POST', { misto: m.id, ilustrace: il.soubor, prepnout: !vObs });
    if (r && !vObs) stav.stulMisto = null; // vybrané místo je teď v OBS
  });
  const jmeno = document.createElement('p');
  jmeno.className = 'jmeno';
  jmeno.textContent = il.soubor;
  const stitky = document.createElement('p');
  stitky.className = 'stitky';
  stitky.textContent = `${il.skryta ? 'skrytá · ' : ''}${textIlustrace(il)}${il.prompt ? ' · má prompt' : ''}`;
  const ovl = document.createElement('div');
  ovl.className = 'ovladani-ilustrace';
  const odkryt = Object.assign(document.createElement('button'), { type: 'button', textContent: il.skryta ? 'Odkrýt' : 'Skrýt' });
  if (il.skryta) odkryt.className = 'hlavni';
  odkryt.addEventListener('click', () => upravIlustraci(m.id, il.soubor, { skryta: !il.skryta }));
  const varianta = document.createElement('select');
  varianta.title = 'Denní doba';
  varianta.append(new Option('vždy', ''), new Option('den', 'den'), new Option('noc', 'noc'));
  varianta.value = il.varianta ?? '';
  varianta.addEventListener('change', () => upravIlustraci(m.id, il.soubor, { varianta: varianta.value || null }));
  const stavPole = Object.assign(document.createElement('input'), { value: il.stav ?? '', placeholder: 'stav', title: 'Stav místa (např. po-pozaru); prázdné = výchozí' });
  stavPole.className = 'stav-ilustrace';
  stavPole.addEventListener('change', () => upravIlustraci(m.id, il.soubor, { stav: stavPole.value.trim() || null }));
  const zahodit = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Zahodit', className: 'nebezpecne' });
  zahodit.addEventListener('click', async () => {
    if (zahodit.dataset.potvrd !== 'true') {
      zahodit.dataset.potvrd = 'true';
      zahodit.textContent = 'Opravdu?';
      setTimeout(() => {
        zahodit.dataset.potvrd = '';
        zahodit.textContent = 'Zahodit';
      }, 4000);
      return;
    }
    try {
      await api(`/api/mista/${m.id}/ilustrace/${encodeURIComponent(il.soubor)}`, { metoda: 'DELETE' });
      toast(`Zahozeno: ${il.soubor}`);
    } catch (chyba) {
      toast(chyba.message, { chyba: true });
    }
  });
  ovl.append(odkryt);
  if (sprava) ovl.append(varianta, stavPole, zahodit);
  karta.append(obr, jmeno, stitky, ovl);
  return karta;
}

async function upravIlustraci(misto, soubor, zmeny) {
  try {
    await api(`/api/mista/${misto}/ilustrace/${encodeURIComponent(soubor)}`, { metoda: 'PUT', telo: zmeny });
  } catch (chyba) {
    toast(chyba.message, { chyba: true });
  }
}

$('#misto-ukazat').addEventListener('click', async () => {
  const s = stav.prehled?.scena;
  const m = stav.prehled?.mista?.mista?.find((x) => x.id === vybraneMisto);
  if (m && s?.misto?.id !== m.id && !potvrditCerno(m, { varianta: s?.varianta ?? 'den', stav: null })) return;
  const r = await scenaApi('/api/scena/zobrazit', 'POST', { misto: vybraneMisto, prepnout: true });
  if (r && !r.chybaObs) toast(`V OBS: ${r.misto?.nazev ?? ''}${r.scenaObs ? ` (scéna ${r.scenaObs})` : ''}`);
});
$('#stul-misto-ukazat').addEventListener('click', async () => {
  const s = stav.prehled?.scena;
  const m = stav.prehled?.mista?.mista?.find((x) => x.id === stav.stulMisto);
  if (!m || !potvrditCerno(m, { varianta: s?.varianta ?? 'den', stav: null })) return;
  const r = await scenaApi('/api/scena/zobrazit', 'POST', { misto: m.id, prepnout: true });
  if (r && !r.chybaObs) toast(`V OBS: ${r.misto?.nazev ?? m.nazev}${r.scenaObs ? ` (scéna ${r.scenaObs})` : ''}`);
});
$('#misto-popis').addEventListener('input', () => stav.rozpracovano.add(`popis:${vybraneMisto}`));
$('#misto-popis-ulozit').addEventListener('click', async () => {
  try {
    await api(`/api/mista/${vybraneMisto}/popis`, { metoda: 'PUT', telo: { popis: $('#misto-popis').value } });
    stav.rozpracovano.delete(`popis:${vybraneMisto}`);
    toast('Popis uložen.');
  } catch (chyba) {
    toast(chyba.message, { chyba: true });
  }
});
$('#misto-do-dilny').addEventListener('click', () => (dilna.cil = `misto:${vybraneMisto}`));

/** Kde místo leží (⚠ bod 116): cesta nad názvem a výběr Leží v (nabízí jen místa bez kruhu). */
function vykresliLeziV(m, seznam) {
  const podleId = new Map(seznam.map((x) => [x.id, x]));
  const predci = [];
  for (let r = podleId.get(m.leziV); r && predci.length < 20 && !predci.includes(r) && r.id !== m.id; r = podleId.get(r.leziV)) predci.unshift(r);
  const cesta = $('#misto-cesta');
  cesta.hidden = !predci.length;
  cesta.replaceChildren(
    ...predci.flatMap((r, i) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: 'odkaz', textContent: r.nazev });
      b.addEventListener('click', () => {
        vybraneMisto = r.id;
        vykresliMista();
      });
      return i ? [' › ', b] : [b];
    }),
    ' ›',
  );
  const vyber = $('#misto-lezi-v');
  if (document.activeElement === vyber) return;
  const potomci = new Set([m.id]);
  for (let pridano = true; pridano;) {
    pridano = false;
    for (const x of seznam) {
      if (!x.leziV || !potomci.has(x.leziV) || potomci.has(x.id)) continue;
      potomci.add(x.id);
      pridano = true;
    }
  }
  vyber.replaceChildren(
    new Option('— nikde (samostatné místo)', ''),
    ...stromMist(seznam.filter((x) => !potomci.has(x.id))).map(({ m: x, hloubka }) => new Option(`${'\u00a0\u00a0'.repeat(hloubka)}${x.nazev}`, x.id)),
  );
  vyber.value = m.leziV ?? '';
}

$('#misto-lezi-v').addEventListener('change', async (e) => {
  const id = vybraneMisto;
  const cil = e.target.value || null;
  try {
    await api(`/api/kanon/entita/${encodeURIComponent(id)}/lezi-v`, { metoda: 'PUT', telo: { cil } });
    const m = stav.prehled?.mista?.mista?.find((x) => x.id === id);
    const r = cil ? stav.prehled?.mista?.mista?.find((x) => x.id === cil) : null;
    toast(r ? `${m?.nazev ?? id} leží v ${r.nazev}.` : `${m?.nazev ?? id} je samostatné místo.`);
  } catch (chyba) {
    toast(chyba.message, { chyba: true });
    vykresliMista();
  }
});

/* ---------- Ilustrační dílna ---------- */

const dilna = { cil: null, obrazek: null, posun: 0.5 };
const CIL_W = 1920;
const CIL_H = 1080;

function cilDilny() {
  const [typ, id] = String($('#dilna-cil').value || '').split(':');
  return { typ, id };
}

function vykresliDilnu() {
  const mista = stav.prehled?.mista?.mista ?? [];
  const obchody = stav.prehled?.obchody?.sortimenty ?? [];
  const vyber = $('#dilna-cil');
  const puvodni = dilna.cil ?? vyber.value;
  const skupinaM = document.createElement('optgroup');
  skupinaM.label = 'Místa';
  skupinaM.append(...stromMist(mista).map(({ m, hloubka }) => new Option(`${'\u00a0\u00a0'.repeat(hloubka)}${m.nazev}`, `misto:${m.id}`)));
  const skupinaO = document.createElement('optgroup');
  skupinaO.label = 'Obchody (obrázek interiéru)';
  skupinaO.append(...obchody.map((o) => new Option(`${o.nazev}${o.mesto ? `, ${o.mesto}` : ''}`, `obchod:${o.id}`)));
  vyber.replaceChildren(skupinaM, ...(obchody.length ? [skupinaO] : []));
  if (puvodni && [...vyber.options].some((o) => o.value === puvodni)) vyber.value = puvodni;
  dilna.cil = null;
  prepnoutCil();
}

function prepnoutCil() {
  const { typ, id } = cilDilny();
  for (const el of document.querySelectorAll('.jen-misto')) el.hidden = typ !== 'misto';
  for (const el of document.querySelectorAll('.jen-obchod')) el.hidden = typ !== 'obchod';
  if (typ === 'misto') {
    const m = (stav.prehled?.mista?.mista ?? []).find((x) => x.id === id);
    const predloha = $('#dilna-predloha');
    const bylo = predloha.value;
    predloha.replaceChildren(new Option('— nová kompozice —', ''), ...(m?.ilustrace ?? []).map((il) => new Option(il.soubor, il.url)));
    if ([...predloha.options].some((o) => o.value === bylo)) predloha.value = bylo;
    sestavitPrompt();
  }
}

async function sestavitPrompt() {
  const { typ, id } = cilDilny();
  if (typ !== 'misto') return;
  const predloha = $('#dilna-predloha').value;
  $('#dilna-predloha-info').hidden = !predloha;
  if (predloha) $('#dilna-predloha-odkaz').href = predloha;
  const q = new URLSearchParams({
    misto: id,
    zaber: $('#dilna-zaber').value,
    varianta: $('#dilna-varianta').value || 'den',
    stav: $('#dilna-stav').value.trim(),
    pocasi: $('#dilna-pocasi').value,
    predloha: predloha ? '1' : '0',
  });
  try {
    const r = await api(`/api/dilna/prompt?${q}`);
    $('#dilna-prompt').value = r.prompt;
  } catch (chyba) {
    $('#dilna-prompt').value = '';
    toast(chyba.message, { chyba: true });
  }
}

$('#dilna-cil').addEventListener('change', prepnoutCil);
for (const id of ['#dilna-zaber', '#dilna-varianta', '#dilna-pocasi', '#dilna-predloha']) $(id).addEventListener('change', sestavitPrompt);
$('#dilna-stav').addEventListener('change', sestavitPrompt);
$('#dilna-sestavit').addEventListener('click', sestavitPrompt);
$('#dilna-kopirovat').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#dilna-prompt').value);
    toast('Prompt je ve schránce. Vlož ho do ChatGPT a přilož stylovou předlohu.');
  } catch {
    $('#dilna-prompt').select();
    toast('Schránka nejde použít, prompt je označený: zkopíruj ho Ctrl+C.', { chyba: true });
  }
});

/* Import: ořez na 16:9 s posuvným výřezem, zvětšení na 1920 × 1080 (canvas v prohlížeči). */

function vyrez(img, posun) {
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const pomer = CIL_W / CIL_H;
  if (W / H > pomer) {
    const w = Math.round(H * pomer);
    return { x: Math.round((W - w) * posun), y: 0, w, h: H, smer: 'vodorovně' };
  }
  const h = Math.round(W / pomer);
  return { x: 0, y: Math.round((H - h) * posun), w: W, h, smer: 'svisle' };
}

function vykresliOrez() {
  const img = dilna.obrazek;
  if (!img) return;
  const c = $('#dilna-nahled');
  const meritko = Math.min(960 / img.naturalWidth, 640 / img.naturalHeight);
  c.width = Math.round(img.naturalWidth * meritko);
  c.height = Math.round(img.naturalHeight * meritko);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, c.width, c.height);
  const v = vyrez(img, dilna.posun);
  g.fillStyle = 'rgba(10,13,20,0.65)';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, v.x, v.y, v.w, v.h, v.x * meritko, v.y * meritko, v.w * meritko, v.h * meritko);
  g.strokeStyle = '#c6a15b';
  g.lineWidth = 2;
  g.strokeRect(v.x * meritko + 1, v.y * meritko + 1, v.w * meritko - 2, v.h * meritko - 2);
  const presne = v.w === img.naturalWidth && v.h === img.naturalHeight;
  $('#dilna-rozmer').textContent = `Původní ${img.naturalWidth} × ${img.naturalHeight}, výřez ${v.w} × ${v.h} → 1920 × 1080.${presne ? '' : ` Posuvníkem posuneš výřez ${v.smer}.`}`;
  $('#dilna-posun').disabled = presne;
}

function nacistSoubor(soubor) {
  if (!soubor || !soubor.type.startsWith('image/')) {
    toast('Tohle není obrázek.', { chyba: true });
    return;
  }
  const url = URL.createObjectURL(soubor);
  const img = new Image();
  img.onload = () => {
    dilna.obrazek = img;
    dilna.posun = 0.5;
    $('#dilna-posun').value = 500;
    $('#dilna-orez').hidden = false;
    $('#dilna-vysledek').textContent = '';
    vykresliOrez();
  };
  img.onerror = () => toast('Obrázek nejde načíst.', { chyba: true });
  img.src = url;
}

const zona = $('#dilna-dropzona');
zona.addEventListener('dragover', (e) => {
  e.preventDefault();
  zona.dataset.nad = 'true';
});
zona.addEventListener('dragleave', () => (zona.dataset.nad = ''));
zona.addEventListener('drop', (e) => {
  e.preventDefault();
  zona.dataset.nad = '';
  nacistSoubor(e.dataTransfer.files[0]);
});
document.addEventListener('paste', (e) => {
  if (location.hash !== '#dilna') return;
  const soubor = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
  if (soubor) nacistSoubor(soubor);
});
$('#dilna-soubor').addEventListener('change', (e) => nacistSoubor(e.target.files[0]));
$('#dilna-posun').addEventListener('input', (e) => {
  dilna.posun = Number(e.target.value) / 1000;
  vykresliOrez();
});
$('#dilna-zrusit').addEventListener('click', () => {
  dilna.obrazek = null;
  $('#dilna-orez').hidden = true;
  $('#dilna-soubor').value = '';
});

function naBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

$('#dilna-ulozit').addEventListener('click', async () => {
  const img = dilna.obrazek;
  if (!img) return;
  const { typ, id } = cilDilny();
  const v = vyrez(img, dilna.posun);
  const c = document.createElement('canvas');
  c.width = CIL_W;
  c.height = CIL_H;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, v.x, v.y, v.w, v.h, 0, 0, CIL_W, CIL_H);
  const vysledek = $('#dilna-vysledek');
  vysledek.className = 'ulozeni';
  vysledek.textContent = 'Ukládám…';
  try {
    const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
    const telo = { cil: { typ, id }, png: await naBase64(blob) };
    if (typ === 'misto') {
      Object.assign(telo, {
        zaber: $('#dilna-zaber').value,
        varianta: $('#dilna-varianta').value || null,
        stav: $('#dilna-stav').value.trim() || null,
        prompt: $('#dilna-prompt').value,
      });
    }
    const r = await api('/api/dilna/ilustrace', { metoda: 'POST', telo });
    dilna.obrazek = null;
    $('#dilna-orez').hidden = true;
    $('#dilna-soubor').value = '';
    if (typ === 'misto') {
      vysledek.textContent = `Uloženo jako ${r.soubor} (skrytá). Odkryj ji na obrazovce Místa.`;
      vybraneMisto = id;
    } else {
      vysledek.textContent = 'Obrázek obchodu uložen. Ukáže se s ceníkem po Ukázat v OBS.';
    }
  } catch (chyba) {
    vysledek.className = 'ulozeni chyba';
    vysledek.textContent = `Neuloženo: ${chyba.message}`;
  }
});

/* ---------- Adresy výstupů ---------- */

const adresaOdpoctu = `${location.origin}/vystupy/odpocet.html`;
$('#adresa-odpoctu').textContent = adresaOdpoctu;
$('#adresa-orloj-velky').textContent = `${location.origin}/vystupy/kalendar-velky.html`;
$('#adresa-orloj-maly').textContent = `${location.origin}/vystupy/kalendar-maly.html`;
$('#adresa-rekapitulace').textContent = `${location.origin}/vystupy/rekapitulace.html`;
$('#adresa-cenik').textContent = `${location.origin}/vystupy/obchod.html`;
$('#adresa-misto').textContent = `${location.origin}/vystupy/misto.html`;
$('#adresa-hudba').textContent = `${location.origin}/vystupy/hudba.html`;
$('#adresa-uder').textContent = `${location.origin}/vystupy/uder.html`;
$('#adresa-strop').textContent = `${location.origin}/vystupy/strop.html`;
for (const b of document.querySelectorAll('[data-kopirovat]')) {
  b.addEventListener('click', async () => {
    await navigator.clipboard?.writeText($(`#${b.dataset.kopirovat}`).textContent).catch(() => {});
    b.textContent = 'Zkopírováno';
    setTimeout(() => (b.textContent = 'Kopírovat'), 1500);
  });
}

$('#adresa-vystupu').textContent = `${location.origin}/vystupy/test.html`;

/* ---------- Záznam událostí (bod 84) ---------- */

const MAX_ZAZNAMU_V_PANELU = 300;
let zaznamPolozky = [];

function radekZaznamu(z) {
  const li = document.createElement('li');
  li.className = z.uroven;
  const cas = document.createElement('time');
  cas.dateTime = z.cas;
  cas.textContent = new Date(z.cas).toLocaleTimeString('cs-CZ');
  const zdroj = document.createElement('span');
  zdroj.className = 'zdroj';
  zdroj.textContent = z.zdroj;
  const zprava = document.createElement('span');
  zprava.className = 'zaznam-text';
  zprava.textContent = z.zprava;
  if (z.data) zprava.title = JSON.stringify(z.data, null, 1);
  li.append(cas, zdroj, zprava);
  return li;
}

function vykresliZaznam() {
  const seznam = $('#zaznam-seznam');
  if (!seznam) return;
  const jenProblemy = $('#zaznam-problemy').checked;
  const vyber = zaznamPolozky.filter((z) => !jenProblemy || z.uroven !== 'info').slice().reverse();
  if (!vyber.length) {
    const li = document.createElement('li');
    li.className = 'prazdny';
    li.textContent = jenProblemy ? 'Žádná varování ani chyby.' : 'Zatím nic.';
    seznam.replaceChildren(li);
    return;
  }
  seznam.replaceChildren(...vyber.map(radekZaznamu));
}

function pridatDoZaznamu(z) {
  if (!z || zaznamPolozky.some((x) => x.cislo === z.cislo && x.cas === z.cas)) return;
  zaznamPolozky.push(z);
  if (zaznamPolozky.length > MAX_ZAZNAMU_V_PANELU) zaznamPolozky.splice(0, zaznamPolozky.length - MAX_ZAZNAMU_V_PANELU);
  const seznam = $('#zaznam-seznam');
  if (!seznam || ($('#zaznam-problemy').checked && z.uroven === 'info')) return;
  seznam.querySelector('.prazdny')?.remove();
  seznam.prepend(radekZaznamu(z));
  while (seznam.children.length > MAX_ZAZNAMU_V_PANELU) seznam.lastElementChild.remove();
}

async function nactiZaznam() {
  try {
    const { polozky } = await api(`/api/zaznam?n=${MAX_ZAZNAMU_V_PANELU}`);
    zaznamPolozky = polozky;
  } catch {
    /* Hub neodpovídá; záznam se doplní po připojení */
  }
  vykresliZaznam();
}

$('#zaznam-problemy').addEventListener('change', vykresliZaznam);

await nactiPrehled();
nactiZaznam();
ukazObrazovku(stav.prehled?.nastaveni && !stav.prehled.nastaveni.existuje && !stav.prehled.prostredi?.zkouska && !location.hash ? 'nastaveni' : location.hash.slice(1));
pripojitUdalosti();

/* ---------- Světla (Blok 4) ---------- */

function popisRole(r) {
  if (!r) return '—';
  if (r.vypnuto) return 'vypnuto';
  if (r.wiz_scena) return `scéna ${r.wiz_scena}, jas ${r.jas ?? '?'} %`;
  return `${r.barva ? `rgb(${r.barva.join(', ')})` : 'barva'}, jas ${r.jas ?? '?'} %`;
}

function vzorek(barva) {
  const span = document.createElement('span');
  span.className = 'vzorek-barvy';
  if (barva) span.style.background = `rgb(${barva.join(',')})`;
  return span;
}

function vykresliSvetla() {
  const sv = stav.prehled?.svetla;
  if (!sv) return;
  // U stolu: přepínač Řídit světla a co světla teď dělají.
  const ridit = $('#svetla-ridit');
  ridit.checked = sv.ridit;
  ridit.disabled = !sv.nastaveno;
  const spatne = sv.zarizeni.filter((z) => z.ok === false);
  vykresliHpNastaveni(sv.hpNastaveni);
  $('#svetla-popis').textContent = sv.kritickeHp
    ? `${sv.kritickeHp.jmeno} na ${sv.kritickeHp.hp}/${sv.kritickeHp.max} HP: lampa pulzuje, pozadí červené.`
    : !sv.nastaveno
    ? 'Světla nejsou nastavená. Přiřaď je v Nastavení → Světla.'
    : !sv.ridit
      ? 'Hub na světla nesahá. Zapni, a světla budou sledovat místo, denní dobu, počasí i souboj.'
      : spatne.length
        ? `Neodpovídá: ${spatne.map((z) => `${NAZVY_ROLI[z.role]} (${z.typ === 'hue' ? 'Hue' : 'WiZ'})`).join(', ')}. Ostatní světla sledují scénu.`
        : `Světla sledují scénu. Hlavní ${sv.cil.hlavni.jas} %, pozadí ${sv.cil.pozadi.zap ? `${sv.cil.pozadi.jas} %` : 'vypnuto'}, lampa ${sv.cil.lampa.zap ? sv.cil.lampa.scena ?? `${sv.cil.lampa.jas} %` : 'vypnuto'}.`;
  $('#svetla-normal').disabled = !sv.nastaveno;
  $('#sc-blesk').disabled = !sv.blesky;
  $('#sc-blesk').title = sv.blesky ? 'Jeden blesk hned (nejvýš 3 za sekundu)' : 'Blesky jsou vypnuté v Nastavení → Světla';

  // Nastavení → Světla: zařízení, výchozí stav, chyby vrstev.
  $('#svetla-zarizeni').replaceChildren(
    ...(sv.zarizeni.length
      ? sv.zarizeni.map((z) => polozkaKontroly(z.ok ? 'ok' : z.ok === false ? 'chyba' : 'info',
        `${NAZVY_ROLI[z.role]}: ${z.typ === 'hue' ? `Hue ${nazevHue(z.id)}` : `WiZ ${z.id}`} — ${z.ok ? 'odpovídá' : z.ok === false ? z.chyba ?? 'neodpovídá' : 'zjišťuji'}`))
      : [polozkaKontroly('info', 'Žádné světlo není přiřazené k roli.')]),
  );
  for (const b of document.querySelectorAll('[data-test-role]')) b.disabled = !sv.zarizeni.some((z) => z.role === b.dataset.testRole);
  vykresliHueSvetla();
  vykresliWiz();
  const v = sv.vychozi ?? {};
  $('#pole-nabeh-startu').checked = sv.nabehStartu !== false;
  $('#svetla-vychozi').replaceChildren(
    'Platí, když místo světla nemá, pro Světla normál a po vypnutí Řídit světla. ',
    ...['hlavni', 'pozadi', 'lampa'].flatMap((r) => [vzorek(v[r]?.barva), `${NAZVY_ROLI[r]}: ${popisRole(v[r])}. `]),
  );
  const chyby = $('#svetla-chyby-vrstev');
  chyby.hidden = !sv.chybyVrstev?.length;
  chyby.textContent = (sv.chybyVrstev ?? []).map((c) => `${c.soubor}: ${c.chyba}`).join(' · ');
  vykresliHueSvetla();
  const m = stav.prehled?.mista?.mista?.find((x) => x.id === vybraneMisto);
  if (m) vykresliSvetlaMista(m);
}

async function nastavitRidit(ridit) {
  try {
    stav.prehled.svetla = await api('/api/svetla/ridit', { metoda: 'PUT', telo: { ridit } });
    vykresliSvetla();
    toast(ridit ? 'Světla sledují scénu.' : 'Hub na světla nesahá; vrátil je na výchozí stav.');
  } catch (chyba) {
    toast(chyba.message, { chyba: true });
    vykresliSvetla();
  }
}
$('#svetla-ridit').addEventListener('change', (e) => nastavitRidit(e.target.checked));

async function svetlaNormal() {
  try {
    await api('/api/svetla/normal', { metoda: 'POST', telo: {} });
    toast('Světla jsou ve výchozím stavu.');
  } catch (chyba) {
    toast(chyba.message, { chyba: true });
  }
}
$('#svetla-normal').addEventListener('click', svetlaNormal);
$('#svetla-normal-nastaveni').addEventListener('click', svetlaNormal);

$('#sc-blesk').addEventListener('click', async () => {
  try {
    const r = await api('/api/svetla/blesk', { metoda: 'POST', telo: {} });
    if (!r.blesk) toast(r.duvod, { chyba: true });
  } catch (chyba) {
    toast(chyba.message, { chyba: true });
  }
});

/* Místa → Světla: co je v hlavičce místa a Zachytit světla. */
function vykresliSvetlaMista(m) {
  const dl = $('#misto-svetla');
  dl.replaceChildren(
    ...['den', 'noc'].flatMap((varianta) => {
      const role = m.svetla?.[varianta];
      const dd = document.createElement('dd');
      if (!role) dd.textContent = varianta === 'noc' && m.svetla?.den ? 'nezachyceno: den s polovičním jasem' : 'nezachyceno: výchozí stav světel';
      else dd.append(...['hlavni', 'pozadi', 'lampa'].flatMap((r) => [vzorek(role[r]?.barva), `${NAZVY_ROLI[r]}: ${role[r] ? popisRole(role[r]) : 'výchozí'}. `]));
      return [Object.assign(document.createElement('dt'), { textContent: varianta === 'den' ? 'Den' : 'Noc' }), dd];
    }),
  );
  const lze = Boolean(stav.prehled?.svetla?.nastaveno);
  for (const id of ['#misto-zachytit-den', '#misto-zachytit-noc']) {
    $(id).disabled = !lze;
    $(id).title = lze ? '' : 'Nejdřív přiřaď světla v Nastavení → Světla';
  }
}

async function zachytitMisto(varianta) {
  const m = stav.prehled?.mista?.mista?.find((x) => x.id === vybraneMisto);
  if (!m) return;
  if (m.svetla?.[varianta] && !confirm(`Místo ${m.nazev} už má světla pro ${varianta === 'den' ? 'den' : 'noc'}. Přepsat je tím, co svítí teď?`)) return;
  const vysledek = $('#misto-svetla-vysledek');
  try {
    await api('/api/svetla/zachytit', { metoda: 'POST', telo: { misto: m.id, varianta } });
    vysledek.className = 'ulozeni';
    vysledek.textContent = `Světla pro ${varianta === 'den' ? 'den' : 'noc'} uložena do hlavičky místa v ${cas()}.`;
  } catch (chyba) {
    vysledek.className = 'ulozeni chyba';
    vysledek.textContent = `Nezachyceno: ${chyba.message}`;
  }
}
$('#misto-zachytit-den').addEventListener('click', () => zachytitMisto('den'));
$('#misto-zachytit-noc').addEventListener('click', () => zachytitMisto('noc'));

/* Nastavení → Světla */
stav.hueSvetla = null; // světla na bridgi (načtená po spárování)

function nazevHue(id) {
  return stav.hueSvetla?.find((x) => x.id === id)?.nazev ?? id.slice(0, 8);
}

async function nactiHueSvetla() {
  stav.hueSvetla = [];
  try {
    stav.hueSvetla = (await api('/api/svetla/hue')).svetla;
  } catch (chyba) {
    $('#hue-stav').textContent = `Světla z bridge se nenačetla: ${chyba.message}`;
  }
  vykresliHueSvetla();
  vykresliSvetla();
}

/** Role Hue světla podle uloženého nastavení. */
function roleHue(id) {
  const n = stav.prehled?.nastaveni ?? {};
  for (const [r, klic] of [['hlavni', 'svetlaHlavni'], ['pozadi', 'svetlaPozadi'], ['lampa', 'svetlaLampa']]) {
    if (String(n[klic] ?? '').split(',').includes(`hue:${id}`)) return r;
  }
  return '';
}

function vykresliHueSvetla() {
  const tabulka = $('#hue-svetla');
  const svetla = stav.hueSvetla ?? [];
  tabulka.hidden = !svetla.length;
  const tbody = tabulka.querySelector('tbody');
  if (tbody.contains(document.activeElement)) return;
  tbody.replaceChildren(
    ...svetla.map((l) => {
      const tr = document.createElement('tr');
      const select = document.createElement('select');
      select.dataset.hue = l.id;
      select.append(new Option('— nepoužívat —', ''), new Option('Hlavní (herna)', 'hlavni'), new Option('Pozadí (vedlejší místnost)', 'pozadi'), new Option('Lampa', 'lampa'));
      select.value = roleHue(l.id);
      select.setAttribute('aria-label', `Role světla ${l.nazev}`);
      const td = document.createElement('td');
      td.append(select);
      tr.append(Object.assign(document.createElement('td'), { textContent: `${l.nazev}${l.barevne ? '' : ' (jen bílá)'}` }), td, bunkaStavu('hue', l.id));
      return tr;
    }),
  );
}

$('#hue-sparovat').addEventListener('click', async () => {
  const bridge = $('#pole-hue-bridge').value.trim();
  try {
    const r = await api('/api/svetla/hue/sparovat', { metoda: 'POST', telo: { bridge } });
    stav.prehled.nastaveni = r.nastaveni;
    vykresliNastaveni(r.nastaveni);
    toast('Hue bridge je spárovaný. Přiřaď světlům role a ulož.');
    await nactiHueSvetla();
  } catch (chyba) {
    $('#hue-stav').textContent = chyba.message;
  }
});

/** Buňka se stavem zařízení z poslední kontroly světel (odpovídá / chyba / nepoužito). */
function bunkaStavu(typ, id) {
  const z = (stav.prehled?.svetla?.zarizeni ?? []).find((x) => x.typ === typ && x.id === id);
  const td = Object.assign(document.createElement('td'), { className: 'stav-zarizeni' });
  td.dataset.uroven = !z ? 'nic' : z.ok ? 'ok' : z.ok === false ? 'chyba' : 'info';
  td.textContent = !z ? '—' : z.ok ? 'odpovídá' : z.ok === false ? z.chyba ?? 'neodpovídá' : 'zjišťuji';
  return td;
}

/** WiZ lampy jako řádky s odebráním (rozhodnutí 66); skryté pole drží seznam pro uložení rolí. */
function vykresliWiz() {
  const ip = $('#pole-wiz').value.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
  $('#wiz-tabulka').hidden = !ip.length;
  $('#wiz-seznam').replaceChildren(...ip.map((adresa) => {
    const tr = document.createElement('tr');
    const odebrat = Object.assign(document.createElement('button'), { type: 'button', className: 'tiche', textContent: '×', title: `Odebrat lampu ${adresa}` });
    odebrat.setAttribute('aria-label', `Odebrat lampu ${adresa}`);
    odebrat.addEventListener('click', () => zmenitWiz(ip.filter((x) => x !== adresa)));
    const td = document.createElement('td');
    td.append(odebrat);
    tr.append(Object.assign(document.createElement('td'), { textContent: adresa }), bunkaStavu('wiz', adresa), td);
    return tr;
  }));
}
function zmenitWiz(seznam) {
  $('#pole-wiz').value = seznam.join(', ');
  vykresliWiz();
  $('#pole-wiz').dispatchEvent(new Event('change'));
}
$('#wiz-pridat-formular').addEventListener('submit', (e) => {
  e.preventDefault();
  const nova = $('#wiz-nova').value.trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(nova)) {
    $('#svetla-vysledek').className = 'ulozeni chyba';
    $('#svetla-vysledek').textContent = 'Zadej IP adresu lampy, např. 192.168.0.87.';
    return;
  }
  const seznam = $('#pole-wiz').value.split(/[,\s]+/).filter(Boolean);
  if (!seznam.includes(nova)) zmenitWiz([...seznam, nova]);
  $('#wiz-nova').value = '';
});

/** Seznamy zařízení rolí z výběru Hue světel a pole WiZ lamp. */
function seznamyRoli() {
  const role = { hlavni: [], pozadi: [], lampa: [] };
  const n = stav.prehled?.nastaveni ?? {};
  // Hue světla podle výběru; když se z bridge nenačetla, zůstanou uložená.
  if (stav.hueSvetla?.length) {
    for (const v of document.querySelectorAll('#hue-svetla select')) if (v.value) role[v.value].push(`hue:${v.dataset.hue}`);
  } else {
    for (const [r, klic] of [['hlavni', 'svetlaHlavni'], ['pozadi', 'svetlaPozadi'], ['lampa', 'svetlaLampa']]) {
      role[r].push(...String(n[klic] ?? '').split(',').filter((x) => x.startsWith('hue:')));
    }
  }
  for (const ip of $('#pole-wiz').value.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean)) role.lampa.push(`wiz:${ip}`);
  return { svetlaHlavni: role.hlavni.join(','), svetlaPozadi: role.pozadi.join(','), svetlaLampa: role.lampa.join(',') };
}
$('#hue-svetla').addEventListener('change', (e) => {
  if (e.target.matches('select')) ulozitNastaveni(seznamyRoli(), e.target, { chybaDo: $('#svetla-vysledek') });
});
$('#pole-wiz').addEventListener('change', () => ulozitNastaveni(seznamyRoli(), $('#wiz-tabulka'), { chybaDo: $('#svetla-vysledek') }));
/* Málo HP: barvy, jas a délky fází (Nastavení → Světla). Ukládá se po změně pole. */
function naHex(rgb) {
  return `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
function zHex(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
function vykresliHpNastaveni(n) {
  // Nepřepisovat pole, do kterého DM právě píše (tlačítka režimu nevadí).
  if (!n || ($('#hp-nastaveni').contains(document.activeElement) && document.activeElement.tagName === 'INPUT')) return;
  for (const b of document.querySelectorAll('#hp-rezim button')) b.setAttribute('aria-pressed', String(b.dataset.v === n.rezim));
  for (const [f, d] of [['a', n.a], ['b', n.b], ['poz', { ...n.pozadi, s: n.pozadi.nabeh_s }]]) {
    $(`#hp-${f}-barva`).value = naHex(d.rgb);
    $(`#hp-${f}-jas`).value = d.jas;
    $(`#hp-${f}-s`).value = d.s;
  }
  $('#hp-prechod').value = n.prechod_s;
  const hl = n.hlavni ?? { zap: false, rgb: [255, 0, 0], jas: 60 };
  $('#hp-hl-barva').value = naHex(hl.rgb);
  $('#hp-hl-jas').value = hl.jas;
  $('#hp-hl-zap').checked = hl.zap;
  $('#hp-hl-barva').disabled = $('#hp-hl-jas').disabled = !hl.zap;
  // Jen intenzita: fáze B má barvu fáze A, mění se jen jas.
  $('#hp-b-barva').disabled = n.rezim === 'intenzita';
}
async function ulozitHp(zmena, pole) {
  try {
    const sv = await api('/api/svetla/hp', { metoda: 'PUT', telo: zmena });
    stav.prehled.svetla = sv;
    vykresliHpNastaveni(sv.hpNastaveni);
    // Značka „Uloženo“ do řádku pod mřížkou: vložená do mřížky nebo přepínače by posunula pole.
    $('#hp-vysledek').className = 'ulozeni';
    $('#hp-vysledek').textContent = pole ? 'Uloženo ✓' : '';
    clearTimeout(stav.casovacHp);
    stav.casovacHp = setTimeout(() => {
      if ($('#hp-vysledek').textContent === 'Uloženo ✓') $('#hp-vysledek').textContent = '';
    }, 3000);
  } catch (chyba) {
    $('#hp-vysledek').className = 'ulozeni chyba';
    $('#hp-vysledek').textContent = `Neuloženo: ${chyba.message}`;
  }
}
$('#hp-rezim').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-v]');
  if (b) ulozitHp({ rezim: b.dataset.v }, b);
});
$('#hp-nastaveni').addEventListener('change', (e) => {
  if (e.target.id === 'hp-prechod') return ulozitHp({ prechod_s: Number(e.target.value) }, e.target);
  if (e.target.id === 'hp-hl-zap') return ulozitHp({ hlavni: { zap: e.target.checked } }, e.target);
  if (e.target.id === 'hp-hl-barva') return ulozitHp({ hlavni: { rgb: zHex(e.target.value) } }, e.target);
  if (e.target.id === 'hp-hl-jas') return ulozitHp({ hlavni: { jas: Number(e.target.value) } }, e.target);
  const m = e.target.id.match(/^hp-(a|b|poz)-(barva|jas|s)$/);
  if (!m) return;
  const [, f, co] = m;
  const hodnota = co === 'barva' ? zHex(e.target.value) : Number(e.target.value);
  const klic = co === 'barva' ? 'rgb' : f === 'poz' && co === 's' ? 'nabeh_s' : co;
  ulozitHp({ [f === 'poz' ? 'pozadi' : f]: { [klic]: hodnota } }, e.target);
});
$('#hp-zkusit').addEventListener('click', async () => {
  try {
    await api('/api/svetla/hp/zkouska', { metoda: 'POST', telo: {} });
    $('#hp-vysledek').className = 'ulozeni';
    $('#hp-vysledek').textContent = 'Pulz běží 12 s, pak se světla vrátí.';
  } catch (chyba) {
    toast(chyba.message, { chyba: true });
  }
});

$('#pole-hp-svetla').addEventListener('change', (e) => ulozitNastaveni({ hpSvetla: e.target.checked }, e.target.closest('label'), { chybaDo: $('#svetla-vysledek') }));
$('#pole-nabeh-startu').addEventListener('change', async (e) => {
  try {
    stav.prehled.svetla = await api('/api/svetla/nabeh', { metoda: 'PUT', telo: { zap: e.target.checked } });
    oznacUlozeno(e.target.closest('label'));
  } catch (chyba) {
    toast(chyba.message, { chyba: true });
  }
});
$('#pole-blesky').addEventListener('change', (e) => ulozitNastaveni({ blesky: e.target.checked }, e.target.closest('label'), { chybaDo: $('#svetla-vysledek') }));
$('#pole-hue-bridge').addEventListener('change', async (e) => {
  const n = stav.prehled?.nastaveni ?? {};
  const nova = e.target.value.trim();
  // Jiná adresa bridge zruší spárování (jiný klíč i certifikát): zeptat se.
  if (n.hueSparovano && nova !== n.hueBridge && !confirm(`Změna adresy zruší spárování s bridgem ${n.hueBridge}. Pokračovat?`)) {
    e.target.value = n.hueBridge;
    return;
  }
  await ulozitNastaveni({ hueBridge: nova }, e.target, { chybaDo: $('#hue-stav') });
});

for (const b of document.querySelectorAll('[data-test-role]')) {
  b.addEventListener('click', async () => {
    try {
      const r = await api('/api/svetla/test', { metoda: 'POST', telo: { role: b.dataset.testRole } });
      toast(r.ok ? `${NAZVY_ROLI[b.dataset.testRole]}: světla dvakrát blikla zeleně.` : `Neodpovídá: ${r.zarizeni.filter((z) => !z.ok).map((z) => z.chyba).join('; ')}`, { chyba: !r.ok });
    } catch (chyba) {
      toast(chyba.message, { chyba: true });
    }
  });
}
$('#svetla-overit').addEventListener('click', () => api('/api/svetla/overit', { metoda: 'POST', telo: {} }).catch((e) => toast(e.message, { chyba: true })));
$('#svetla-zachytit-vychozi').addEventListener('click', async () => {
  try {
    stav.prehled.svetla = await api('/api/svetla/zachytit', { metoda: 'POST', telo: { cil: 'vychozi' } });
    vykresliSvetla();
    toast('Výchozí stav světel uložen.');
  } catch (chyba) {
    toast(chyba.message, { chyba: true });
  }
});

/* ---------- Zvuk (Blok 5) ---------- */

stav.zvukoveSoubory = null;

function popisStrankyZvuku(nazev, x) {
  if (!x?.pripojeno) return `${nazev}: neotevřeno`;
  if (x.odemceno === false) return `${nazev}: čeká na kliknutí`;
  if (x.chyba) return `${nazev}: ${x.chyba}`;
  if (x.vystup?.ok === false) return `${nazev}: reproduktor ${x.vystup.nazev} odpojený`;
  return `${nazev}: ${x.hraje?.length ? `hraje ${x.hraje.join(', ')}` : 'připojeno, nic nehraje'}${x.vystup?.vybrany ? ` (${x.vystup.nazev})` : ''}`;
}

async function nactiZvukoveSoubory() {
  try {
    stav.zvukoveSoubory = (await api('/api/zvuk/soubory')).soubory;
  } catch {
    stav.zvukoveSoubory = [];
  }
  const m = stav.prehled?.mista?.mista?.find((x) => x.id === vybraneMisto);
  if (m) vykresliZvukMista(m);
}

/** Hudba v liště (DM 20. 10. 2026): co hraje, pauza, další skladba a hlasitosti na každé obrazovce. */
function vykresliHudbuVListe(z) {
  const t = z.hrajeTed;
  const pauza = z.pauzaHudby === true;
  const spotifyStoji = t?.zdroj === 'spotify' && t.pozastaveno;
  const nazev = pauza ? 'Hudba pozastavená' : !t ? 'Hudba: nic' : t.nazev ?? (t.zdroj === 'spotify' ? 'Spotify' : 'Hudba');
  $('#hudba-nazev').textContent = nazev;
  $('#hudba-detail > summary').title = t?.autor ? `${t.nazev} · ${t.autor}` : nazev;
  const tlPauza = $('#hudba-pauza');
  tlPauza.setAttribute('aria-pressed', String(pauza || spotifyStoji));
  tlPauza.title = pauza || spotifyStoji ? 'Pustit hudbu znovu' : 'Pozastavit hudbu (ambient a efekty hrají dál). Jiná scéna pustí svou hudbu sama.';
  tlPauza.disabled = !pauza && !t;
  $('#hudba-dalsi').disabled = pauza || !t || (t.zdroj === 'slozka' && !t.playlist);
  const ted = $('#hudba-ted');
  ted.replaceChildren();
  if (pauza) ted.textContent = 'Hudba je pozastavená. Ambient a efekty hrají dál.';
  else if (!t) ted.textContent = z.ticho ? 'Ticho: hraje jen to, co pustíš ručně.' : 'Tahle scéna nemá hudbu.';
  else {
    ted.append(document.createTextNode(t.nazev ?? (t.zdroj === 'spotify' ? 'Spotify přepíná…' : '…')));
    const pod = document.createElement('small');
    pod.textContent = [t.autor, t.zdroj === 'spotify' ? `Spotify${spotifyStoji ? ', pozastavené v aplikaci (pauza ▶ ji pustí)' : ''}` : t.playlist ? `playlist ${t.playlist}` : 'ze složky'].filter(Boolean).join(' · ');
    ted.append(pod);
  }
  for (const k of ['hudba', 'ambient', 'efekty']) {
    const posuvnik = $(`#lista-${k}`);
    if (document.activeElement !== posuvnik) posuvnik.value = Math.round((z.hlasitost?.[k] ?? 0) * 100);
    $(`#lista-${k}-hodnota`).textContent = `${posuvnik.value} %`;
  }
}

function vykresliZvuk() {
  const z = stav.prehled?.zvuk;
  if (!z) return;
  vykresliHudbuVListe(z);
  if (stav.zvukoveSoubory === null) nactiZvukoveSoubory();
  const ticho = $('#tlacitko-ticho');
  ticho.setAttribute('aria-pressed', String(z.ticho));
  ticho.querySelector('span').textContent = z.ticho ? 'Zrušit ticho' : 'Ticho';
  for (const k of ['hudba', 'ambient']) {
    const posuvnik = $(`#zvuk-${k}`);
    if (document.activeElement !== posuvnik) posuvnik.value = Math.round(z.hlasitost[k] * 100);
    $(`#zvuk-${k}-hodnota`).textContent = `${posuvnik.value} %`;
  }
  $('#zvuk-popis').textContent = z.ticho
    ? 'Ticho: hudba i ambient jsou ztlumené.'
    : `Hudba: ${z.hudba?.soubor ?? 'žádná'} · Ambient: ${z.ambient.length ? z.ambient.map((a) => a.soubor).join(', ') : 'žádný'}${z.chybiTed?.length ? ` · chybí: ${z.chybiTed.join(', ')}` : ''}`;
  vykresliSoundboard();
  $('#souboj-tahy').checked = z.tahy?.zapnuto !== false;
  $('#zvuk-tahy-hraci').checked = z.tahy?.jenHraci === true;

  // Nastavení → Zvuk
  $('#zvuk-slozka-stav').textContent = `${z.slozkaNastavena ? '' : 'Nevyplněno = výchozí '}${z.slozka}: ${z.slozkaExistuje ? `${z.pocetSouboru} zvukových souborů` : 'složka neexistuje'}. Efekty pro tlačítka U stolu dej do podsložky efekty.`;
  const hudbaVObs = z.hudbaKde === 'obs';
  for (const [id, hodnota] of [['#zvuk-hudba-kde', z.hudbaKde ?? 'stul'], ['#zvuk-tlumeni', z.tlumeni?.rozsah ?? 'hudba'], ['#zvuk-tlumeni-hz', String(z.tlumeni?.hz ?? 500)]]) {
    const select = $(id);
    if (document.activeElement === select) continue;
    // Útlum nastavený jinak než nabídka (ručně v zvuk.json): ukáže se jako vlastní položka.
    if (![...select.options].some((o) => o.value === hodnota)) select.append(new Option(`${hodnota} Hz`, hodnota));
    select.value = hodnota;
  }
  $('#zvuk-tlumeni-hz').disabled = z.tlumeni?.rozsah === 'vypnuto';
  $('#zvuk-zkusebni-obs').hidden = !hudbaVObs;
  $('#zvuk-poznamka').firstChild.textContent = hudbaVObs
    ? 'Hudba hraje výstup Hudba v OBS (zvuk na TV), ambient a efekty stránka Zvuk u stolu do BT reproduktoru. Postup v '
    : 'Hudba, ambient i efekty hraje stránka Zvuk u stolu do BT reproduktoru. Postup v ';
  vykresliSadu(z);
  vykresliSrovnani(z);
  vykresliSpotify(z);
  $('#zvuk-stranky').replaceChildren(
    ...[...(hudbaVObs ? [['Hudba v OBS', z.stranky.hudba]] : []), ['Zvuk u stolu', z.stranky.stul]].map(([nazev, x]) =>
      polozkaKontroly(x?.pripojeno && x.odemceno !== false && !x.chyba && x.vystup?.ok !== false ? 'ok' : x?.pripojeno ? 'varovani' : 'chyba', popisStrankyZvuku(nazev, x))),
  );
}

/* ---------- Spotify (DM 20. 10. 2026): hudba z aplikace Spotify přes virtuální kabel ---------- */

function vykresliSpotify(z) {
  const sp = z.spotify;
  const n = stav.prehled?.nastaveni ?? {};
  if (!sp) return;
  const pole = $('#pole-spotify-klient');
  if (document.activeElement !== pole && !pole.dataset.upraveno) pole.value = n.spotifyKlient ?? '';
  for (const [id, hodnota] of [['#pole-spotify-kabel', n.spotifyKabel], ['#pole-spotify-zarizeni', n.spotifyZarizeni]]) {
    const p = $(id);
    if (document.activeElement !== p && !p.dataset.upraveno) p.value = hodnota ?? '';
  }
  $('#pole-spotify-kabel').placeholder = n.spotifyKabelVychozi ?? 'CABLE Output';
  $('#spotify-presmerovani').textContent = sp.presmerovani;
  $('#spotify-odhlasit').hidden = !sp.prihlaseno;
  $('#spotify-prihlasit').textContent = sp.prihlaseno ? 'Přihlásit znovu' : 'Přihlásit ke Spotify';
  const kabel = sp.kabel;
  const polozky = [
    sp.prihlaseno
      ? polozkaKontroly('ok', `Přihlášeno${sp.uzivatel ? ` jako ${sp.uzivatel}` : ''}`)
      : polozkaKontroly(sp.klient ? 'varovani' : 'chyba', sp.klient ? 'Nepřihlášeno: klikni na Přihlásit ke Spotify' : 'Chybí Client ID aplikace ze Spotify'),
  ];
  if (sp.prihlaseno) {
    polozky.push(sp.zarizeni ? polozkaKontroly('ok', `Aplikace Spotify: ${sp.zarizeni}`) : polozkaKontroly('chyba', sp.chyba ?? 'Aplikace Spotify na tomto PC neběží'));
    polozky.push(
      !z.stranky?.stul?.pripojeno
        ? polozkaKontroly('varovani', 'Kabel: otevři stránku Zvuk u stolu')
        : !kabel
          ? polozkaKontroly('varovani', `Kabel: stránka ho teprve otevírá (${sp.jmenoKabelu})`)
          : !kabel.ok
            ? polozkaKontroly('chyba', `Kabel: ${kabel.chyba ?? 'nejde otevřít'}`)
            : kabel.ticho
              ? polozkaKontroly('varovani', `Kabel ${kabel.nazev}: ticho. Ve Směšovači hlasitosti pošli Spotify do CABLE Input.`)
              : polozkaKontroly('ok', `Kabel: ${kabel.nazev}`),
    );
    polozky.push(
      sp.hrajeTed
        ? polozkaKontroly('ok', `Hraje Spotify${sp.hraje ? '' : ' (přepíná se)'}`)
        : polozkaKontroly('info', sp.chyba && sp.zarizeni ? `Hraje záloha ze složky: ${sp.chyba}` : 'Teď hraje hudba ze složky (scéna nemá Spotify, nebo Spotify nejede)'),
    );
  }
  $('#spotify-kontrola').replaceChildren(...polozky);
}

async function ulozitSpotify(telo, tlacitko) {
  const r = await ulozitNastaveni(telo, tlacitko, { chybaDo: $('#spotify-vysledek') });
  for (const id of ['#pole-spotify-klient', '#pole-spotify-kabel', '#pole-spotify-zarizeni']) delete $(id).dataset.upraveno;
  return r;
}

for (const id of ['#pole-spotify-klient', '#pole-spotify-kabel', '#pole-spotify-zarizeni']) {
  $(id).addEventListener('input', (e) => (e.target.dataset.upraveno = '1'));
}

$('#spotify-prihlasit').addEventListener('click', async () => {
  const vysledek = $('#spotify-vysledek');
  const klient = $('#pole-spotify-klient').value.trim();
  try {
    if (klient !== (stav.prehled?.nastaveni?.spotifyKlient ?? '')) {
      if (!(await ulozitSpotify({ spotifyKlient: klient }))) return;
    }
    const { url } = await api('/api/spotify/prihlasit', { metoda: 'POST', telo: {} });
    window.open(url, '_blank', 'noopener');
    vysledek.className = 'ulozeni';
    vysledek.textContent = 'Přihlas se v novém okně a potvrď přístup. Hub se pak přepne sám.';
  } catch (e) {
    vysledek.className = 'ulozeni chyba';
    vysledek.textContent = e.message;
  }
});

$('#spotify-odhlasit').addEventListener('click', async () => {
  try {
    await api('/api/spotify/odhlasit', { metoda: 'POST', telo: {} });
    $('#spotify-vysledek').className = 'ulozeni';
    $('#spotify-vysledek').textContent = 'Odhlášeno. Hraje záloha ze složky.';
  } catch (e) {
    $('#spotify-vysledek').className = 'ulozeni chyba';
    $('#spotify-vysledek').textContent = e.message;
  }
});

$('#spotify-ulozit').addEventListener('click', () =>
  ulozitSpotify({ spotifyKabel: $('#pole-spotify-kabel').value.trim(), spotifyZarizeni: $('#pole-spotify-zarizeni').value.trim() }, $('#spotify-ulozit')),
);

/** Playlisty ze Spotify pro výběr hudby místa (načtou se jednou, když je Hub přihlášený). */
stav.spotifyPlaylisty = null;
async function nactiSpotifyPlaylisty() {
  stav.spotifyPlaylisty = [];
  try {
    stav.spotifyPlaylisty = (await api('/api/spotify/playlisty')).playlisty;
  } catch {
    stav.spotifyPlaylisty = [];
  }
  const m = stav.prehled?.mista?.mista?.find((x) => x.id === vybraneMisto);
  if (m) vykresliZvukMista(m);
}

/* ---------- Zvuková sada a srovnání hlasitosti (bod 86) ---------- */

function vykresliSadu(z) {
  const sada = z.sada;
  if (!sada) return;
  const klic = Boolean(stav.prehled?.nastaveni?.freesoundNastaven ?? sada.klic);
  $('#sada-klic-stav').textContent = klic
    ? 'Hledá na Freesoundu (klíč je vložený), pak v Openverse (Wikimedia Commons, Jamendo, ccMixter …).'
    : 'Hledá v Openverse (Wikimedia Commons, Jamendo, ccMixter …). S klíčem Freesound bude výběr větší a lepší: Freesound se pak prohledá jako první.';
  $('#freesound-smazat').hidden = !klic;
  const p = sada.prubeh ?? {};
  const chybi = sada.polozky.reduce((n, x) => n + x.chybi, 0);
  const doplnit = $('#sada-doplnit');
  doplnit.disabled = p.bezi || !chybi;
  doplnit.textContent = chybi ? `Doplnit chybějící zvuky (${chybi})` : 'Všechny zvuky sady jsou ve složce';
  const prubeh = $('#sada-prubeh');
  prubeh.className = p.chyba && !p.bezi ? 'ulozeni chyba' : 'ulozeni';
  prubeh.textContent = p.bezi ? `${p.hotovo}/${p.celkem} · ${p.text ?? ''}` : p.text ? `${p.text}${p.chyba ? ` ${p.chyba.split('\n').slice(0, 3).join(' · ')}` : ''}` : sada.chyby.length ? `Chyby v kampan/zvuky-sada.yaml: ${sada.chyby.join(' · ')}` : '';
  const tabulka = $('#sada-tabulka');
  if (tabulka.contains(document.activeElement) && !p.bezi) return;
  const hlava = document.createElement('tr');
  hlava.append(...['Zvuk', 'Hledá (nebo balíček)', 'Soubory', ''].map((t) => Object.assign(document.createElement('th'), { textContent: t, scope: 'col' })));
  tabulka.replaceChildren(
    hlava,
    ...sada.polozky.map((x) => {
      const tr = document.createElement('tr');
      const co = document.createElement('td');
      co.append(Object.assign(document.createElement('code'), { textContent: x.cil }), ...(x.popis ? [Object.assign(document.createElement('small'), { textContent: x.popis })] : []));
      const hleda = Object.assign(document.createElement('td'), { textContent: x.balik ?? `${x.hledat} · ${x.delka[0]}–${x.delka[1]} s` });
      const soubory = document.createElement('td');
      soubory.className = 'sada-soubory';
      for (const f of x.soubory) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = f.je ? 'sada-soubor je' : 'sada-soubor';
        b.textContent = `${f.je ? '▶' : '·'} ${f.soubor.split('/').pop()}`;
        b.disabled = !f.je;
        b.title = f.je ? `${f.zdroj ? `${f.zdroj.nazev} · ${f.zdroj.autor} · ${f.zdroj.licence} · ${f.zdroj.odkud}` : 'Tvůj soubor'} (klik = ukázka)` : 'Ve složce chybí';
        if (f.je) b.addEventListener('click', () => prehratUkazku(f.skutecny ?? f.soubor, b));
        soubory.append(b);
        // Jen tahle varianta za další v pořadí (ostatní zůstanou).
        if (f.je && !x.balik) {
          const v = document.createElement('button');
          v.type = 'button';
          v.className = 'tiche sada-vymenit';
          v.textContent = '↻';
          v.title = `Vyměnit jen ${f.soubor.split('/').pop()} za další zvuk v pořadí`;
          v.setAttribute('aria-label', v.title);
          v.disabled = p.bezi;
          v.addEventListener('click', () => doplnitSadu({ cil: x.cil, soubor: f.soubor, vymenit: true }));
          soubory.append(v);
        }
      }
      const akce = document.createElement('td');
      const vymenit = document.createElement('button');
      vymenit.type = 'button';
      vymenit.className = 'tiche';
      vymenit.disabled = p.bezi;
      vymenit.textContent = x.chybi === x.soubory.length ? 'Stáhnout' : x.chybi ? 'Doplnit' : x.soubory.length > 1 ? 'Vyměnit vše' : 'Vyměnit';
      vymenit.title = x.chybi === x.soubory.length ? 'Stáhnout jen tuhle položku' : x.chybi ? 'Doplnit chybějící varianty' : 'Stáhnout místo všech souborů položky další zvuky v pořadí (jednu variantu vyměníš tlačítkem ↻)';
      vymenit.addEventListener('click', () => doplnitSadu({ cil: x.cil, vymenit: !x.chybi }));
      // Zvuk z balíčku nemá „další v pořadí“: mění se jménem souboru v kampan/zvuky-sada.yaml.
      vymenit.hidden = Boolean(x.balik) && !x.chybi;
      akce.append(vymenit);
      tr.append(co, hleda, soubory, akce);
      return tr;
    }),
  );
}

async function doplnitSadu(telo) {
  try {
    await api('/api/zvuk/sada/doplnit', { metoda: 'POST', telo });
  } catch (e) {
    toast(e.message, { chyba: true });
  }
}
$('#sada-doplnit').addEventListener('click', () => doplnitSadu({}));
$('#freesound-ulozit').addEventListener('click', async () => {
  const pole = $('#pole-freesound');
  if (!pole.value.trim()) return pole.focus();
  if (await ulozitNastaveni({ freesoundKlic: pole.value.trim() }, pole, { chybaDo: $('#sada-klic-stav') })) pole.value = '';
});
$('#freesound-smazat').addEventListener('click', async () => {
  if (!confirm('Odebrat klíč Freesound? Stažené zvuky ve složce zůstanou.')) return;
  await ulozitNastaveni({ smazatFreesoundKlic: true }, $('#freesound-smazat'), { chybaDo: $('#sada-klic-stav') });
});

function vykresliSrovnani(z) {
  // Seznam uvnitř funkce: panel kreslí zvuk už při načtení (top-level await), před koncem modulu.
  const HLADINY_POPIS = [
    ['hudba', 'Hudba'],
    ['ambient', 'Ambient'],
    ['nahodne', 'Náhodné zvuky'],
    ['efekty', 'Soundboard a tahy'],
    ['hrom', 'Hrom'],
  ];
  const s = z.srovnani;
  if (!s) return;
  $('#zvuk-srovnat').checked = s.zapnuto;
  const obal = $('#zvuk-hladiny');
  if (!obal.contains(document.activeElement)) {
    obal.replaceChildren(
      ...HLADINY_POPIS.map(([k, popis]) => {
        const label = document.createElement('label');
        label.textContent = `${popis} (LUFS)`;
        const input = Object.assign(document.createElement('input'), { type: 'number', min: '-40', max: '-6', step: '1', value: String(s.hladiny[k]) });
        input.disabled = !s.zapnuto;
        input.addEventListener('change', () => ulozitZvuk({ hladiny: { [k]: Number(input.value) } }));
        label.append(input);
        return label;
      }),
    );
  }
  const nejdou = s.nejdou?.length ? ` Prohlížeč neumí přečíst: ${s.nejdou.slice(0, 5).join(', ')}${s.nejdou.length > 5 ? ' …' : ''} (poškozený nebo nepodporovaný soubor).` : '';
  $('#srovnani-stav').textContent = (!s.celkem
    ? 'Ve složce zatím nejsou žádné zvuky.'
    : s.zmereno >= s.celkem
      ? `Změřeno všech ${s.celkem} souborů. Hub každému přidá zesílení nebo zeslabení na hladinu jeho druhu a u krátkých zvuků přeskočí ticho na začátku. Soubory se nemění.`
      : `Změřeno ${s.zmereno} z ${s.celkem} souborů. Měří stránka Zvuk u stolu postupně na pozadí, takže musí být otevřená. Nezměřené soubory hrají beze změny.`) + nejdou;
}
$('#zvuk-srovnat').addEventListener('change', (e) => ulozitZvuk({ srovnat: e.target.checked }));

let casovacHlasitosti = null;
for (const k of ['hudba', 'ambient']) {
  $(`#zvuk-${k}`).addEventListener('input', (e) => {
    $(`#zvuk-${k}-hodnota`).textContent = `${e.target.value} %`;
    clearTimeout(casovacHlasitosti);
    casovacHlasitosti = setTimeout(() => api('/api/zvuk', { metoda: 'PUT', telo: { [k]: Number(e.target.value) / 100 } }).catch((x) => toast(x.message, { chyba: true })), 150);
  });
}

async function ovladatHudbu(akce) {
  try {
    stav.prehled.zvuk = await api('/api/zvuk/hudba', { metoda: 'POST', telo: { akce } });
    vykresliZvuk();
  } catch (e) {
    toast(e.message, { chyba: true });
  }
}
$('#hudba-pauza').addEventListener('click', () => ovladatHudbu('pauza'));
$('#hudba-dalsi').addEventListener('click', () => ovladatHudbu('dalsi'));
{
  let casovacListy;
  for (const k of ['hudba', 'ambient', 'efekty']) {
    $(`#lista-${k}`).addEventListener('input', (e) => {
      $(`#lista-${k}-hodnota`).textContent = `${e.target.value} %`;
      clearTimeout(casovacListy);
      casovacListy = setTimeout(() => api('/api/zvuk', { metoda: 'PUT', telo: { [k]: Number(e.target.value) / 100 } }).catch((x) => toast(x.message, { chyba: true })), 150);
    });
  }
}
// Rozbalená hudba v liště se zavře klikem jinam.
document.addEventListener('click', (e) => {
  const d = $('#hudba-detail');
  if (d.open && !d.contains(e.target)) d.open = false;
});

$('#tlacitko-ticho').addEventListener('click', async () => {
  try {
    stav.prehled.zvuk = await api('/api/zvuk', { metoda: 'PUT', telo: { ticho: !stav.prehled?.zvuk?.ticho } });
    vykresliZvuk();
  } catch (e) {
    toast(e.message, { chyba: true });
  }
});

async function ulozitZvuk(telo) {
  try {
    stav.prehled.zvuk = await api('/api/zvuk', { metoda: 'PUT', telo });
    vykresliZvuk();
    $('#zvuk-volby-vysledek').textContent = 'Uloženo.';
  } catch (e) {
    $('#zvuk-volby-vysledek').textContent = e.message;
  }
}
$('#zvuk-hudba-kde').addEventListener('change', (e) => ulozitZvuk({ hudbaKde: e.target.value }));
$('#zvuk-tlumeni').addEventListener('change', (e) => ulozitZvuk({ tlumeni: e.target.value }));
$('#zvuk-tlumeni-hz').addEventListener('change', (e) => ulozitZvuk({ tlumeniHz: Number(e.target.value) }));
$('#zvuk-tlumeni-zkusit').addEventListener('click', async () => {
  try {
    await api('/api/svetla/hp/zkouska', { metoda: 'POST', telo: {} });
    toast(stav.prehled?.zvuk?.stranky?.stul?.pripojeno ? 'Na 12 s ucpané uši (a pulz lampy). Slyšíš rozdíl?' : 'Zvuk u stolu není otevřený, tlumení nemá kdo zahrát.', { chyba: !stav.prehled?.zvuk?.stranky?.stul?.pripojeno });
  } catch (e) {
    toast(e.message, { chyba: true });
  }
});

function otevritZvukUStolu() {
  window.open('/vystupy/zvuk-u-stolu.html', 'dmhub-zvuk', 'popup,width=760,height=620');
}
$('#zvuk-otevrit-stul').addEventListener('click', otevritZvukUStolu);

for (const b of document.querySelectorAll('[data-zkusebni]')) {
  b.addEventListener('click', async () => {
    try {
      const r = await api('/api/zvuk/efekt', { metoda: 'POST', telo: { test: true, cil: b.dataset.zkusebni } });
      toast(r.pripojeno ? 'Hrají tři tóny. Slyšíš je z reproduktoru?' : 'Stránka není otevřená, zkušební zvuk nemá kdo zahrát.', { chyba: !r.pripojeno });
    } catch (e) {
      toast(e.message, { chyba: true });
    }
  });
}

$('#pole-zvuk-slozka').addEventListener('change', async (e) => {
  if (await ulozitNastaveni({ zvukSlozka: e.target.value.trim() }, e.target, { chybaDo: $('#zvuk-vysledek') })) {
    await nactiPrehled();
    nactiZvukoveSoubory();
  }
});
$('#pole-zvuk-otevrit').addEventListener('change', (e) => ulozitNastaveni({ zvukOtevrit: e.target.checked }, e.target.closest('label'), { chybaDo: $('#zvuk-vysledek') }));
$('#zvuk-prohledat').addEventListener('click', async () => {
  try {
    stav.prehled.zvuk = await api('/api/zvuk/prohledat', { metoda: 'POST', telo: {} });
    await nactiZvukoveSoubory();
    vykresliZvuk();
    toast(`Ve složce je ${stav.prehled.zvuk.pocetSouboru} zvukových souborů.`);
  } catch (e) {
    toast(e.message, { chyba: true });
  }
});

/* ---------- Soundboard (bod 76) ---------- */

/** Všechny zvuky knihovny (jednorázové i smyčky) s druhem. */
function zvukyKnihovny() {
  const k = stav.prehled?.zvuk?.knihovna;
  if (!k) return [];
  return [...k.jednorazove.map((x) => ({ ...x, smycka: false })), ...k.smycky.map((x) => ({ ...x, smycka: true }))];
}

/** Místo, které je teď ve scéně (k němu se zvuky připínají). */
function mistoSceny() {
  const id = stav.prehled?.scena?.misto?.id;
  return id ? stav.prehled?.mista?.mista?.find((m) => m.id === id) ?? null : null;
}

/** Připnuté zvuky místa, které ve složce opravdu jsou (pořadí = klávesy 1–9). */
function pripnuteZvuky() {
  const vse = zvukyKnihovny();
  return (mistoSceny()?.zvuk?.pripnute ?? []).map((id) => vse.find((x) => x.id === id)).filter(Boolean);
}

function prehratZvuk(z) {
  const zap = stav.prehled?.zvuk?.zapnuteSmycky ?? [];
  const pozadavek = z.smycka
    ? api('/api/zvuk/smycka', { metoda: 'PUT', telo: { zvuk: z.id, zap: !zap.includes(z.id) } }).then((st) => {
      stav.prehled.zvuk = st;
      vykresliSoundboard();
      vykresliKnihovnu();
    })
    : api('/api/zvuk/efekt', { metoda: 'POST', telo: { zvuk: z.id } });
  pozadavek.catch((e) => toast(e.message, { chyba: true }));
}

function tlacitkoZvuku(z, poradi) {
  const zap = stav.prehled?.zvuk?.zapnuteSmycky ?? [];
  const b = document.createElement('button');
  b.type = 'button';
  if (poradi) {
    const k = document.createElement('kbd');
    k.textContent = String(poradi);
    b.append(k);
  }
  b.append(z.nazev);
  if (z.smycka) {
    b.dataset.smycka = '';
    b.setAttribute('aria-pressed', String(zap.includes(z.id)));
    b.title = `${zap.includes(z.id) ? 'Vypnout' : 'Zapnout'} smyčku ${z.nazev}${z.limit_s ? ` (sama skončí po ${z.limit_s} s)` : ''}`;
  } else {
    b.title = `Přehrát ${z.nazev}${z.soubory.length > 1 ? ` (${z.soubory.length} variant)` : ''}`;
  }
  b.addEventListener('click', () => prehratZvuk(z));
  return b;
}

function vykresliSoundboard() {
  const z = stav.prehled?.zvuk;
  const el = $('#zvuk-efekty');
  if (!z || !el || el.contains(document.activeElement)) return;
  const pripnute = pripnuteZvuky();
  const zap = z.zapnuteSmycky ?? [];
  // Zapnuté smyčky, které nejsou připnuté, jsou vidět taky (jde je vypnout).
  const vse = zvukyKnihovny();
  const dalsi = zap.filter((id) => !pripnute.some((x) => x.id === id)).map((id) => vse.find((x) => x.id === id)).filter(Boolean);
  el.replaceChildren(...pripnute.map((x, i) => tlacitkoZvuku(x, i < 9 ? i + 1 : null)), ...dalsi.map((x) => tlacitkoZvuku(x)));
  $('#sb-zastavit').hidden = !zap.length;
  const misto = mistoSceny();
  $('#sb-popis').textContent = !vse.length
    ? 'Ve složce zvuku nejsou složky jednorazove, smycky ani efekty.'
    : pripnute.length ? '' : `${misto ? `${misto.nazev} nemá` : 'Bez místa nejsou'} připnuté zvuky. Připneš je v Knihovně.`;
}

function vykresliKnihovnu() {
  const dialog = $('#dialog-knihovna');
  if (!dialog.open) return;
  const misto = mistoSceny();
  const pripnute = misto?.zvuk?.pripnute ?? [];
  $('#knihovna-popis').textContent = misto
    ? `☆ připne zvuk k místu ${misto.nazev}: pak je na U stolu a hraje klávesou 1–9.`
    : 'Ve scéně není místo, připnout teď nejde. Přehrát můžeš cokoli.';
  const hledat = $('#knihovna-hledat').value.trim().toLowerCase();
  const bezDiakritiky = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const vse = zvukyKnihovny().filter((x) => !hledat || bezDiakritiky(`${x.nazev} ${x.kategorie} ${x.id}`).includes(bezDiakritiky(hledat)));
  const skupiny = new Map();
  for (const x of vse) {
    const k = `${x.smycka ? 'Smyčky' : 'Jednorázové'} · ${x.kategorie}`;
    if (!skupiny.has(k)) skupiny.set(k, []);
    skupiny.get(k).push(x);
  }
  const seznam = $('#knihovna-seznam');
  if (!skupiny.size) {
    const p = document.createElement('p');
    p.className = 'ulozeni';
    p.textContent = zvukyKnihovny().length ? 'Nic neodpovídá hledání.' : 'Knihovna je prázdná. Dej zvuky do složek jednorazove\\<kategorie> a smycky ve složce zvuku.';
    seznam.replaceChildren(p);
    return;
  }
  seznam.replaceChildren(
    ...[...skupiny].map(([nazev, zvuky]) => {
      const sekce = document.createElement('section');
      const h = document.createElement('h3');
      h.textContent = nazev;
      const radek = document.createElement('div');
      radek.className = 'knihovna-skupina';
      for (const x of zvuky) {
        const obal = document.createElement('span');
        obal.className = 'knihovna-zvuk';
        const pin = document.createElement('button');
        pin.type = 'button';
        pin.className = 'pripnout';
        const je = pripnute.includes(x.id);
        pin.textContent = je ? '★' : '☆';
        pin.setAttribute('aria-pressed', String(je));
        pin.setAttribute('aria-label', `${je ? 'Odepnout' : 'Připnout'} ${x.nazev}`);
        pin.disabled = !misto;
        pin.addEventListener('click', () => pripnoutZvuk(x.id, !je));
        obal.append(tlacitkoZvuku(x), pin);
        radek.append(obal);
      }
      sekce.append(h, radek);
      return sekce;
    }),
  );
}

async function pripnoutZvuk(id, pripnout) {
  const misto = mistoSceny();
  if (!misto) return;
  const ted = misto.zvuk?.pripnute ?? [];
  const nove = pripnout ? [...ted.filter((x) => x !== id), id] : ted.filter((x) => x !== id);
  try {
    const r = await api(`/api/mista/${misto.id}/zvuk-pripnute`, { metoda: 'PUT', telo: { pripnute: nove } });
    const i = stav.prehled.mista.mista.findIndex((m) => m.id === misto.id);
    if (i >= 0) stav.prehled.mista.mista[i] = r.misto;
    vykresliKnihovnu();
    vykresliSoundboard();
  } catch (e) {
    toast(e.message, { chyba: true });
  }
}

$('#sb-knihovna').addEventListener('click', () => {
  $('#knihovna-hledat').value = '';
  $('#dialog-knihovna').showModal();
  vykresliKnihovnu();
  $('#knihovna-hledat').focus();
});
$('#knihovna-hledat').addEventListener('input', vykresliKnihovnu);
$('#knihovna-hledat').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') e.preventDefault(); // Enter v hledání dialog nezavře
});

function zastavitSmycky() {
  api('/api/zvuk/smycky/zastavit', { metoda: 'POST', telo: {} })
    .then((st) => {
      stav.prehled.zvuk = st;
      vykresliSoundboard();
      vykresliKnihovnu();
    })
    .catch((e) => toast(e.message, { chyba: true }));
}
$('#sb-zastavit').addEventListener('click', zastavitSmycky);

// Klávesy 1–9 hrají připnuté zvuky, 0 vypne smyčky. Ne při psaní a ne v otevřeném dialogu.
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || !/^[0-9]$/.test(e.key)) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable="true"]') || document.querySelector('dialog[open]')) return;
  if (!stav.prehled?.zvuk) return;
  e.preventDefault();
  if (e.key === '0') return zastavitSmycky();
  const z = pripnuteZvuky()[Number(e.key) - 1];
  if (z) prehratZvuk(z);
});

$('#souboj-tahy').addEventListener('change', (e) => ulozitZvuk({ tahy: e.target.checked }));
$('#zvuk-tahy-hraci').addEventListener('change', (e) => ulozitZvuk({ tahyJenHraci: e.target.checked }));
$('#souboj-bez-fanfary').addEventListener('click', async () => {
  try {
    const r = await api('/api/souboj', { metoda: 'POST', telo: { zapnout: false, fanfara: false } });
    if (r.chybaObs) toast(r.chybaObs, { chyba: true });
  } catch (chyba) {
    toast(chyba.message, { chyba: true });
  }
});

/* Místa → Zvuk: hudba a ambient pro den a noc, ukázka v panelu. */
let ukazka = null;
function prehratUkazku(soubor, tlacitko) {
  if (ukazka) {
    ukazka.a.pause();
    ukazka.b.textContent = '▶';
    const stejne = ukazka.soubor === soubor;
    ukazka = null;
    if (stejne) return;
  }
  // Playlist (složka): ukázka zahraje první skladbu z něj.
  const skutecny = soubor.endsWith('/') ? (stav.zvukoveSoubory ?? []).find((x) => x.toLowerCase().startsWith(soubor.toLowerCase())) : soubor;
  if (!skutecny) return toast('Playlist je zatím prázdný.', { chyba: true });
  const a = new Audio(`/audio/${skutecny.split('/').map(encodeURIComponent).join('/')}`);
  a.volume = 0.8;
  a.play().catch((e) => toast(`Ukázka nehraje: ${e.message}`, { chyba: true }));
  a.addEventListener('ended', () => prehratUkazku(soubor, tlacitko));
  tlacitko.textContent = '■';
  ukazka = { a, b: tlacitko, soubor };
}

/** Jméno bez přípony: dest.mp3 v datech najde i dest.wav (stejně jako server). */
const kmenZvuku = (x) => x.replace(/\.[a-z0-9]+$/i, '').toLowerCase();

/** Vzdálenost 0–1 slovy (posuvníky v Místa → Zvuk). */
function popisVzdalenosti(v) {
  if (!v) return 'u stolu';
  if (v <= 0.3) return 'kousek';
  if (v <= 0.6) return 'opodál';
  if (v <= 0.85) return 'daleko';
  return 'hodně daleko';
}

/** Posuvník 0–100 % s popiskem; `popis` převede hodnotu 0–1 na text vedle. */
function posuvnikZvuku(text, hodnota, popis, priZmene) {
  const label = document.createElement('label');
  label.className = 'posuvnik-mista';
  const nazev = document.createElement('span');
  nazev.textContent = text;
  const input = Object.assign(document.createElement('input'), { type: 'range', min: '0', max: '100', step: '5', value: String(Math.round((hodnota ?? 0) * 100)) });
  const vystup = document.createElement('output');
  const ukaz = () => (vystup.textContent = popis(Number(input.value) / 100));
  ukaz();
  input.addEventListener('input', ukaz);
  input.addEventListener('change', () => priZmene(Number(input.value) / 100));
  label.append(nazev, input, vystup);
  return { label, input };
}

/** Skupiny pro náhodné zvuky: nejdřív složka nahodne/, pak jednorázové zvuky soundboardu. */
function skupinyNahodnych() {
  const k = stav.prehled?.zvuk?.knihovna ?? {};
  return [
    ['Náhodné zvuky (složka nahodne)', k.nahodne ?? []],
    ['Jednorázové zvuky', k.jednorazove ?? []],
  ];
}

function vykresliZvukMista(m) {
  const kontejner = $('#misto-zvuk');
  if (kontejner.contains(document.activeElement)) return;
  const soubory = stav.zvukoveSoubory ?? [];
  // Hrom hraje Hub sám po blesku, do hudby ani ambientu místa nepatří (⚠ návrh).
  const bezEfektu = soubory.filter((x) => !x.startsWith('efekty/') && !x.startsWith('nahodne/') && !/^hrom/i.test(kmenZvuku(x)));
  // Playlisty: složky se skladbami pod hudba/ (hudba/souboj/ …). Vybírají se jen pro hudbu.
  const playlisty = new Map();
  for (const f of soubory.filter((x) => x.startsWith('hudba/') && x.includes('/', 6))) {
    const slozka = `${f.split('/').slice(0, 2).join('/')}/`;
    playlisty.set(slozka, (playlisty.get(slozka) ?? 0) + 1);
  }
  const ulozitZvuk = async (cesta, telo, hlaseni) => {
    const vysledek = $('#misto-zvuk-vysledek');
    try {
      await api(cesta, { metoda: 'PUT', telo });
      vysledek.className = 'ulozeni';
      vysledek.textContent = `${hlaseni} v ${cas()}.`;
    } catch (e) {
      vysledek.className = 'ulozeni chyba';
      vysledek.textContent = `Neuloženo: ${e.message}`;
    }
  };

  // Dozvuk místa: platí pro den i noc (bod 85).
  const prostor = document.createElement('div');
  prostor.className = 'zvuk-radek';
  prostor.append(Object.assign(document.createElement('strong'), { textContent: 'Prostor' }));
  const lDozvuk = document.createElement('label');
  lDozvuk.textContent = 'Dozvuk';
  const sDozvuk = document.createElement('select');
  // Seznam je tady, ne nahoře v modulu: panel kreslí místa už při načtení (top-level await).
  const dozvuky = [
    ['zadny', 'Bez dozvuku (venku)'],
    ['mistnost', 'Místnost'],
    ['kobka', 'Kobka, sklep'],
    ['sal', 'Velký sál, chrám'],
    ['jeskyne', 'Jeskyně'],
  ];
  sDozvuk.append(...dozvuky.map(([v, t]) => new Option(t, v)));
  sDozvuk.value = m.zvuk?.dozvuk ?? 'zadny';
  sDozvuk.addEventListener('change', () => ulozitZvuk(`/api/mista/${m.id}/zvuk-dozvuk`, { dozvuk: sDozvuk.value }, 'Dozvuk uložen'));
  lDozvuk.append(sDozvuk);
  // Motiv oblohy na stropě z projektoru (⚠ bod 143). Bez volby ho určí dozvuk.
  const lStrop = document.createElement('label');
  lStrop.textContent = 'Strop';
  const sStrop = document.createElement('select');
  const motivPodleDozvuku = () => ({ jeskyne: 'jeskyně', kobka: 'jeskyně', mistnost: 'interiér', sal: 'interiér' })[sDozvuk.value] ?? 'nebe';
  const moznostAuto = new Option('', 'auto');
  const popsatAuto = () => (moznostAuto.textContent = `Podle dozvuku (${motivPodleDozvuku()})`);
  popsatAuto();
  sStrop.append(moznostAuto, ...[
    ['nebe', 'Nebe'],
    ['les', 'Les (koruny stromů)'],
    ['tabor', 'Tábor (nebe a oheň)'],
    ['jeskyne', 'Jeskyně'],
    ['interier', 'Interiér (trámy, svíce)'],
  ].map(([v, t]) => new Option(t, v)));
  sStrop.value = m.strop ?? 'auto';
  sDozvuk.addEventListener('change', popsatAuto);
  sStrop.addEventListener('change', () => ulozitZvuk(`/api/mista/${m.id}/strop`, { motiv: sStrop.value }, 'Strop uložen'));
  lStrop.append(sStrop);
  prostor.append(lDozvuk, lStrop, Object.assign(document.createElement('small'), { className: 'poznamka', textContent: 'Dozvuk: ozvěna prostoru pro náhodné zvuky a soundboard. Strop: co ukáže projektor na stropě; počasí je vidět jen venku.' }));

  const NAZVY = { den: 'Den', noc: 'Noc', souboj: 'Souboj' };
  const varianty = ['den', 'noc', 'souboj'].map((varianta) => {
    const obal = document.createElement('div');
    obal.className = 'zvuk-varianta';
    const radek = document.createElement('div');
    radek.className = 'zvuk-radek';
    radek.append(Object.assign(document.createElement('strong'), { textContent: NAZVY[varianta] }));
    const kdy = varianta;
    for (const [k, popis] of [['hudba', 'Hudba'], ['ambient', 'Ambient']]) {
      const hodnota = m.zvuk?.[varianta]?.[k] ?? '';
      // Hudba ze Spotify: { spotify, zaloha }. Výběr ukáže playlist Spotify, záloha zůstane.
      const sp = hodnota && typeof hodnota === 'object' && !Array.isArray(hodnota) ? hodnota : null;
      const ziva = sp ? sp.zaloha ?? '' : hodnota;
      // Seznam (víc playlistů nebo souborů) jde zapsat jen v datech; tady se ukáže jako jedna volba.
      const aktualni = sp ? sp.spotify : Array.isArray(ziva) ? ziva.join(' + ') : ziva;
      if (k === 'hudba' && stav.prehled?.zvuk?.spotify?.prihlaseno && stav.spotifyPlaylisty === null) nactiSpotifyPlaylisty();
      const label = document.createElement('label');
      label.textContent = popis;
      const select = document.createElement('select');
      const souboryVolby = k === 'hudba' ? bezEfektu.filter((x) => !x.startsWith('hudba/') || !x.includes('/', 6)) : bezEfektu;
      const moznosti = [...new Set([...souboryVolby, ...(aktualni && !sp && !playlisty.has(aktualni) ? [aktualni] : [])])];
      // Souboj bez vlastní volby: hudba souboje z kampan/sceny/rezim/souboj.yaml, ambient místa ztlumený.
      const prazdna = varianta === 'souboj' ? (k === 'hudba' ? '— hudba souboje —' : '— ambient místa, ztlumený —') : varianta === 'noc' && m.zvuk?.den?.[k] ? '— jako ve dne —' : '— žádná —';
      select.append(new Option(prazdna, ''));
      if (k === 'hudba' && playlisty.size) {
        const skupina = Object.assign(document.createElement('optgroup'), { label: 'Playlisty (složky v hudba/)' });
        skupina.append(...[...playlisty].map(([slozka, n]) => new Option(`📁 ${slozka} (${n} ${n === 1 ? 'skladba' : n < 5 ? 'skladby' : 'skladeb'})`, slozka)));
        select.append(skupina);
      }
      if (k === 'hudba' && (sp || stav.spotifyPlaylisty?.length)) {
        const seznam = [...(stav.spotifyPlaylisty ?? [])];
        if (sp && !seznam.some((x) => x.uri === sp.spotify)) seznam.unshift({ uri: sp.spotify, nazev: 'playlist z dat' });
        const skupina = Object.assign(document.createElement('optgroup'), { label: 'Spotify (záloha ze složky zůstává)' });
        skupina.append(...seznam.map((x) => new Option(`🎵 ${x.nazev}`, x.uri)));
        select.append(skupina);
      }
      select.append(...moznosti.map((x) => new Option(x.endsWith('/') ? `📁 ${x} (prázdný)` : x.includes(' + ') || soubory.includes(x) || soubory.some((y) => kmenZvuku(y) === kmenZvuku(x)) ? x : `${x} (ve složce chybí)`, x)));
      select.value = aktualni;
      if (sp) select.title = `Záloha, když Spotify nejede: ${Array.isArray(sp.zaloha) ? sp.zaloha.join(' + ') : sp.zaloha ?? 'žádná'}`;
      select.addEventListener('change', () => {
        let v = select.value || null;
        // Playlist ze Spotify: dosavadní hudba ze složky zůstane jako záloha.
        if (v?.startsWith('spotify:')) v = { spotify: v, ...(ziva ? { zaloha: ziva } : {}) };
        ulozitZvuk(`/api/mista/${m.id}/zvuk/${varianta}`, { [k]: v }, `${popis} pro ${kdy} uložen${k === 'hudba' ? 'a' : ''}`);
      });
      const prehrat = document.createElement('button');
      prehrat.type = 'button';
      prehrat.textContent = '▶';
      prehrat.title = 'Přehrát ukázku v tomto prohlížeči';
      prehrat.addEventListener('click', () => {
        if (!select.value) return;
        // Ukázka playlistu ze Spotify se otevře ve Spotify (zvuk z kabelu by panel neslyšel).
        if (select.value.startsWith('spotify:')) return window.open(`https://open.spotify.com/${select.value.split(':').slice(1).join('/')}`, '_blank', 'noopener');
        prehratUkazku(select.value, prehrat);
      });
      label.append(select);
      radek.append(label, prehrat);
    }
    // Vzdálenost ambientu (bod 85): tišší a tupější, jako by se ozýval zdálky.
    const { label: lVzd } = posuvnikZvuku('Vzdálenost ambientu', m.zvuk?.[varianta]?.vzdalenost ?? 0, popisVzdalenosti, (v) =>
      ulozitZvuk(`/api/mista/${m.id}/zvuk/${varianta}`, { vzdalenost: v }, `Vzdálenost ambientu pro ${kdy} uložena`),
    );
    radek.append(lVzd);
    obal.append(radek, vykresliNahodne(m, varianta, ulozitZvuk));
    return obal;
  });

  kontejner.replaceChildren(prostor, ...varianty);
  $('#misto-zvuk-popis').textContent = soubory.length
    ? `Hudba hraje ${stav.prehled?.zvuk?.hudbaKde === 'obs' ? 'v OBS' : 'u stolu'}, ambient a náhodné zvuky u stolu. Noc bez vlastního zvuku hraje zvuk dne. Souboj nahradí jen to, co u něj nastavíš.`
    : 'Ve složce zvuku zatím nic není. Nastav ji v Nastavení → Zvuk a nahraj do ní soubory (mp3, ogg, wav).';
}

/**
 * Náhodné zvuky místa pro den, nebo noc (bod 85): krátké zvuky, které se samy občas ozvou
 * pod ambientem. Každá změna uloží celý seznam.
 */
function vykresliNahodne(m, varianta, ulozitZvuk) {
  const sekce = document.createElement('div');
  sekce.className = 'nahodne-mista';
  const nadpis = document.createElement('p');
  nadpis.className = 'nahodne-nadpis';
  nadpis.textContent = 'Náhodné zvuky';
  const seznam = document.createElement('div');
  seznam.className = 'nahodne-seznam';
  const skupiny = skupinyNahodnych();
  const vsechny = skupiny.flatMap(([, g]) => g);
  const kdy = { den: 've dne', noc: 'v noci', souboj: 'v souboji' }[varianta];

  const sebrat = () =>
    [...seznam.querySelectorAll('.nahodny-zvuk')].map((r) => ({
      zvuk: r.querySelector('select').value,
      kazdych_s: Number(r.querySelector('[data-k="kazdych_s"]').value),
      nahodilost: Number(r.querySelector('[data-k="nahodilost"]').value) / 100,
      hlasitost: Number(r.querySelector('[data-k="hlasitost"]').value) / 100,
      vzdalenost: Number(r.querySelector('[data-k="vzdalenost"]').value) / 100,
    }));
  const ulozitSeznam = (hlaseni = `Náhodné zvuky ${kdy} uloženy`) => ulozitZvuk(`/api/mista/${m.id}/zvuk/${varianta}`, { nahodne: sebrat() }, hlaseni);

  const radek = (n) => {
    const r = document.createElement('div');
    r.className = 'nahodny-zvuk';
    const lZvuk = document.createElement('label');
    lZvuk.textContent = 'Zvuk';
    const select = document.createElement('select');
    for (const [nazev, g] of skupiny) {
      if (!g.length) continue;
      const og = document.createElement('optgroup');
      og.label = nazev;
      og.append(...g.map((x) => new Option(`${x.kategorie} · ${x.nazev}${x.soubory.length > 1 ? ` (${x.soubory.length}×)` : ''}`, x.id)));
      select.append(og);
    }
    if (!vsechny.some((x) => x.id === n.zvuk || x.id.endsWith(`/${n.zvuk}`))) select.append(new Option(`${n.zvuk} (ve složce chybí)`, n.zvuk));
    select.value = vsechny.find((x) => x.id === n.zvuk)?.id ?? vsechny.find((x) => x.id.endsWith(`/${n.zvuk}`))?.id ?? n.zvuk;
    select.addEventListener('change', () => ulozitSeznam());
    lZvuk.append(select);

    const lKazdych = document.createElement('label');
    lKazdych.textContent = 'Každých (s)';
    const kazdych = Object.assign(document.createElement('input'), { type: 'number', min: '3', max: '600', step: '1', value: String(n.kazdych_s) });
    kazdych.dataset.k = 'kazdych_s';
    kazdych.className = 'kratke-cislo';
    kazdych.addEventListener('change', () => ulozitSeznam());
    lKazdych.append(kazdych);

    const posuvnik = (k, text, popis) => {
      const { label, input } = posuvnikZvuku(text, n[k], popis, () => ulozitSeznam());
      input.dataset.k = k;
      return label;
    };
    const prehrat = document.createElement('button');
    prehrat.type = 'button';
    prehrat.textContent = '▶';
    prehrat.title = 'Přehrát jednu variantu v tomto prohlížeči';
    prehrat.addEventListener('click', () => {
      const g = vsechny.find((x) => x.id === select.value);
      if (g) prehratUkazku(g.soubory[Math.floor(Math.random() * g.soubory.length)], prehrat);
    });
    const odebrat = document.createElement('button');
    odebrat.type = 'button';
    odebrat.className = 'tiche';
    odebrat.textContent = '✕';
    odebrat.title = 'Odebrat náhodný zvuk';
    odebrat.setAttribute('aria-label', 'Odebrat náhodný zvuk');
    odebrat.addEventListener('click', () => {
      r.remove();
      ulozitSeznam(`Náhodný zvuk ${kdy} odebrán`);
      pridat.hidden = false;
    });
    r.append(
      lZvuk,
      lKazdych,
      posuvnik('nahodilost', 'Nahodilost', (v) => (v < 0.15 ? 'pravidelně' : v < 0.6 ? 'trochu' : 'hodně')),
      posuvnik('hlasitost', 'Hlasitost', (v) => `${Math.round(v * 100)} %`),
      posuvnik('vzdalenost', 'Vzdálenost', popisVzdalenosti),
      prehrat,
      odebrat,
    );
    return r;
  };

  const vlastni = m.zvuk?.[varianta]?.nahodne ?? [];
  seznam.append(...vlastni.map(radek));
  const pridat = document.createElement('button');
  pridat.type = 'button';
  pridat.className = 'tiche';
  pridat.textContent = '+ Náhodný zvuk';
  pridat.hidden = vlastni.length >= 8;
  pridat.disabled = !vsechny.length;
  pridat.title = vsechny.length ? '' : 'Ve složce zvuku nejsou krátké zvuky (nahodne/ nebo jednorazove/).';
  pridat.addEventListener('click', () => {
    const pouzite = new Set(sebrat().map((x) => x.zvuk));
    const volny = vsechny.find((x) => !pouzite.has(x.id));
    if (!volny) return toast('Všechny zvuky ze složky už v seznamu jsou.', { chyba: true });
    seznam.append(radek({ zvuk: volny.id, kazdych_s: 30, nahodilost: 0.5, hlasitost: 0.8, vzdalenost: 0.3 }));
    pridat.hidden = seznam.children.length >= 8;
    ulozitSeznam(`Náhodný zvuk ${kdy} přidán`);
  });
  const prazdne = document.createElement('small');
  prazdne.className = 'poznamka';
  prazdne.textContent =
    varianta === 'souboj'
      ? 'Bez vlastních zvuků hrají v souboji náhodné zvuky místa ztlumené. Vlastní je nahradí (třeba řinčení zbraní a výkřiky zdálky).'
      : varianta === 'noc' && !m.zvuk?.noc && m.zvuk?.den?.nahodne?.length
        ? 'Noc bez vlastního zvuku hraje zvuky dne.'
        : 'Krátké zvuky, které se samy občas ozvou pod ambientem (kůň, kovadlina, krkavec). Varianty kun-1, kun-2 … se střídají.';
  sekce.append(nadpis, seznam, pridat, ...(vlastni.length ? [] : [prazdne]));
  return sekce;
}

/* ---------- Odezva (rozhodnutí 65) ----------
   U pole: „Uloženo ✓“ na 3 s (oznacUlozeno). Výsledek akce: toast. Výpadek systému: pruh upozornění nahoře. */
const casovaceZnacek = new WeakMap();
function oznacUlozeno(pole) {
  let znacka = pole?.parentElement?.querySelector(':scope > .ulozeno-znacka');
  if (!pole) return;
  if (!znacka) {
    znacka = Object.assign(document.createElement('span'), { className: 'ulozeno-znacka', textContent: 'Uloženo ✓' });
    znacka.setAttribute('aria-live', 'polite');
    pole.insertAdjacentElement('afterend', znacka);
  }
  znacka.dataset.ukazat = 'true';
  clearTimeout(casovaceZnacek.get(znacka));
  casovaceZnacek.set(znacka, setTimeout(() => (znacka.dataset.ukazat = 'false'), 3000));
}
window.oznacUlozeno = oznacUlozeno;

/* Místa: záložky v detailu místa (Ilustrace · Světla · Zvuk · Popis a poloha), rozhodnutí 65 */
stav.mistoZalozka = 'ilustrace';
function ukazMistoZalozku(z) {
  stav.mistoZalozka = z;
  for (const b of document.querySelectorAll('.misto-zalozky [data-mz]')) b.setAttribute('aria-selected', String(b.dataset.mz === z));
  for (const p of document.querySelectorAll('.misto-panel')) p.hidden = p.dataset.mz !== z;
}
for (const b of document.querySelectorAll('.misto-zalozky [data-mz]')) b.addEventListener('click', () => ukazMistoZalozku(b.dataset.mz));
