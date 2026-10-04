// Ovládací panel DM Hubu. Bez build kroku, čistý JavaScript.
import { Harptos, MESICE, SVATKY, dnyText, zbyvaText } from '/sdilene/harptos.js';
import { odebirat } from '/sdilene/zive.js';

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
// #obchody je od rozhodnutí 51 zase samostatná obrazovka: Obchody – správa.
const PRESMEROVANI = { odpocet: ['sceny', 'start'] };

function ukazObrazovku(jmeno) {
  const platne = ['prehled', 'sceny', 'kalendar', 'mista', 'obchody', 'dilna', 'kontrola', 'nastaveni'];
  if (PRESMEROVANI[jmeno]) {
    stav.stulVyber = PRESMEROVANI[jmeno][1];
    jmeno = PRESMEROVANI[jmeno][0];
    history.replaceState(null, '', `#${jmeno}`);
  }
  const cil = platne.includes(jmeno) ? jmeno : 'prehled';
  if (cil === 'kalendar') nactiImport();
  if (cil === 'dilna') vykresliDilnu();
  for (const s of document.querySelectorAll('.obrazovka')) s.hidden = s.id !== `obrazovka-${cil}`;
  for (const a of document.querySelectorAll('.moduly a')) {
    if (a.dataset.obrazovka === cil) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  vykresliSceny();
}
window.addEventListener('hashchange', () => ukazObrazovku(location.hash.slice(1)));

/* ---------- Stav kampaně ---------- */

function vykresliStav(s) {
  const k = s?.stav;
  // Bez spojení se serverem panel nic neví: neříkat „není zadané“, když jen čeká (audit N14).
  $('#lista-datum').textContent = k?.datumText || (s ? 'Datum není zadané' : 'Čekám na server…');
  vykresliDatumStavu(k);
  $('#lista-misto').textContent = k?.misto || '';
  $('#lista-misto').hidden = !k?.misto;
  $('#lista-sezeni').textContent = k ? `sezení ${k.sezeni}` : '';
  if (k) {
    for (const [pole, hodnota] of [['misto', k.misto], ['sezeni', k.sezeni]]) {
      const input = $(`#pole-${pole}`);
      if (!stav.rozpracovano.has(pole) && document.activeElement !== input) input.value = hodnota ?? '';
    }
  }
  vykresliUpozorneni();
}

/* Datum ve Stavu kampaně: stejný výběr jako v Kalendáři, ukládá se samo. */
let vyberStav = null;
let posledniDatumStavu;
function vykresliDatumStavu(k) {
  vyberStav ??= vyberData($('#vyber-stav'));
  const box = $('#vyber-stav');
  if (box.contains(document.activeElement) || stav.rozpracovano.has('datum')) return;
  const klic = JSON.stringify(k?.datum ?? null);
  if (klic === posledniDatumStavu) return;
  posledniDatumStavu = klic;
  vyberStav.set(k?.datum ?? stav.prehled?.kalendar?.zacatek ?? { rok: 1491, mesic: 'Hammer', den: 1 });
}
$('#vyber-stav').addEventListener('change', async () => {
  const datum = vyberStav.get();
  const zprava = $('#stav-ulozeni');
  if (!datum) {
    zprava.textContent = 'Takové datum v Harptosu není (den 1–30, Shieldmeet jen v přestupném roce).';
    zprava.className = 'ulozeni chyba';
    return;
  }
  stav.rozpracovano.add('datum');
  try {
    const { vysledek } = await api('/api/stav', { metoda: 'PUT', telo: { datum } });
    zprava.textContent = vysledek === 'odlozeno' ? 'Soubor stav.md drží otevřený jiný program. Změna je v OBS a uloží se, jakmile to půjde.' : `Uloženo v ${cas()}`;
    zprava.className = vysledek === 'odlozeno' ? 'ulozeni varovani' : 'ulozeni';
  } catch (e) {
    zprava.textContent = `Neuloženo: ${e.message}`;
    zprava.className = 'ulozeni chyba';
  } finally {
    stav.rozpracovano.delete('datum');
  }
});

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

function vykresliUpozorneni() {
  const box = $('#upozorneni');
  box.replaceChildren();
  const p = stav.prehled;
  if (!stav.serverOk) {
    box.append(zprava('Server neodpovídá. Spouštěč ho do pár sekund spustí znovu; výstupy v OBS mezitím drží poslední stav.', { chyba: true }));
    return;
  }
  if (!p) return;
  if (p.server?.restartNutny) {
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
  if (g?.pozadu > 0 && g?.napred > 0) {
    box.append(zprava(`Lokální a GitHubová verze se rozešly: na GitHubu je ${g.pozadu} nových commitů a u tebe ${g.napred} neodeslaných. Sloučení nic nemaže; tvoje změny se přiskládají za novinky a odešlou.`, { tlacitko: { text: 'Sloučit', akce: sloucitZmeny } }));
  } else if (g?.pozadu > 0) {
    box.append(zprava(`Na GitHubu jsou novější změny (${g.pozadu}).`, { tlacitko: { text: 'Stáhnout změny', akce: stahnoutZmeny } }));
  }
  for (const v of p.obs?.varovaniZdroju ?? []) {
    box.append(zprava(`Zdroj „${v.zdroj}“ v OBS má zapnuté ${v.nastaveni.join(' a ')}. Vypni to, jinak výstup nepřežije výpadek Hubu.`));
  }
  if (p.nastaveni && !p.nastaveni.existuje) {
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

async function sloucitZmeny() {
  try {
    const r = await api('/api/git/sloucit', { metoda: 'POST', telo: {} });
    let text = r.push ? 'Sloučeno a odesláno na GitHub.' : 'Sloučeno, ale odeslání na GitHub se nepodařilo. Zkus Uložit do GitHubu později.';
    if (r.vracenoZGitHubu?.length) {
      text += ` Soubory ${r.vracenoZGitHubu.join(', ')} jsi měl rozdělané a zároveň se změnily na GitHubu: platí verze z GitHubu, tvoje verze je v úschovně Gitu. Pošli to Claudovi.`;
    } else if (r.uschovnaNevracena) {
      text += ' Tvoje neuložené změny zůstaly v úschovně Gitu, protože se nedaly vrátit; pošli to Claudovi.';
    }
    toast(text, { chyba: r.uschovnaNevracena });
    await nactiPrehled();
  } catch (e) {
    $('#upozorneni').prepend(zprava(e.message, { chyba: true }));
  }
}
async function stahnoutZmeny() {
  try {
    await api('/api/git/stahnout', { metoda: 'POST', telo: {} });
    await nactiPrehled();
  } catch (e) {
    $('#upozorneni').prepend(zprava(e.message, { chyba: true }));
  }
}

/* ---------- Kontrolky ---------- */

function vykresliKontrolky() {
  const p = stav.prehled;
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
    : `Větev ${g.vetev}, neuložených souborů ${g.zmeneno}${g.pozadu ? `, na GitHubu je ${g.pozadu} novějších změn` : ''}${g.chyba ? `. ${g.chyba}` : ''}`;
  // Stav i slovy, nejen barvou (čtečka obrazovky, audit N12).
  for (const k of ['server', 'obs', 'git']) {
    const li = $(`#svetlo-${k}`).parentElement;
    li.setAttribute('aria-label', `${li.textContent.trim()}: ${li.title}`);
  }
}

/* ---------- U stolu: dlaždice scén a ovládání podle role ---------- */

// Role scén v OBS. Dlaždice ukazuje ovládání té role, kterou má přiřazenou v tabulce Role scén.
const ROLE_SCEN = [['start', 'scenaStart', 'Start'], ['misto', 'scenaMisto', 'Místo'], ['obchod', 'scenaObchod', 'Obchod'], ['souboj', 'scenaSouboj', 'Souboj']];
const PANELY = ['start', 'misto', 'obchod', 'souboj', 'bez'];
const POCASI_TEXT = { dest: 'déšť', snih: 'sníh', mlha: 'mlha' };

stav.stulMisto = null; // místo vybrané na U stolu, dokud ho DM nepošle do OBS (null = to, co je v OBS)
stav.stulVyber = null; // role vybraná kliknutím na dlaždici; null = podle scény, která je právě v OBS

function roleScenyOBS(nazev) {
  const n = stav.prehled?.nastaveni;
  if (!nazev || !n) return null;
  return ROLE_SCEN.find(([, klic]) => n[klic] === nazev)?.[0] ?? null;
}

function vykresliSceny() {
  const o = stav.prehled?.obs;
  const popis = $('#obs-popis');
  const seznam = $('#seznam-scen');
  const stavEl = $('#stul-stav');
  seznam.replaceChildren();
  const pripojeno = Boolean(o?.pripojeno);
  let pripojitTlacitko = null;

  let role = stav.stulVyber;
  if (!role && pripojeno && o.aktualniScena) role = roleScenyOBS(o.aktualniScena) ?? 'bez';
  if (!role && !pripojeno) role = 'start';
  if (!PANELY.includes(role)) role = null;

  if (!stav.prehled) {
    popis.textContent = 'Čekám na server Hubu…';
  } else if (!o?.nastaveno) {
    popis.textContent = 'OBS ještě není nastavené. Zadej heslo k WebSocket serveru v Nastavení. Ovládání níže funguje i bez OBS, jen nepřepíná scény.';
  } else if (!pripojeno) {
    popis.textContent = `${o.chyba || 'OBS není připojené.'} Hub to zkouší znovu každých 5 sekund.`;
    pripojitTlacitko = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Připojit teď' });
    pripojitTlacitko.addEventListener('click', () => api('/api/obs/pripojit', { metoda: 'POST', telo: {} }).catch(() => {}));
  } else {
    popis.textContent = 'Klikni na dlaždici: OBS přepne na scénu a pod ní se ukáže její ovládání. Numpad v OBS funguje dál.';
  }

  if (pripojeno) {
    for (const nazev of o.sceny) {
      const b = document.createElement('button');
      b.type = 'button';
      const r = roleScenyOBS(nazev);
      b.textContent = nazev;
      b.setAttribute('aria-pressed', String(nazev === o.aktualniScena));
      if (r) b.title = `Role: ${ROLE_SCEN.find(([id]) => id === r)[2]}`;
      b.addEventListener('click', async () => {
        stav.stulVyber = r ?? 'bez';
        vykresliSceny();
        try {
          await api('/api/obs/scena', { metoda: 'POST', telo: { nazev } });
        } catch (e) {
          popis.textContent = e.message;
        }
      });
      seznam.append(b);
    }
  } else {
    // Bez OBS jsou dlaždicemi role: jen vybírají ovládání, nic nepřepínají.
    for (const [id, klic, jmeno] of ROLE_SCEN) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = jmeno;
      b.title = stav.prehled?.nastaveni?.[klic] ? `Scéna v OBS: ${stav.prehled.nastaveni[klic]}` : 'Scéna zatím není přiřazená';
      b.setAttribute('aria-pressed', String(id === role));
      b.addEventListener('click', () => {
        stav.stulVyber = id;
        vykresliSceny();
      });
      seznam.append(b);
    }
  }

  // Stav „co je teď v OBS“.
  const sc = stav.prehled?.scena;
  let text = pripojeno ? `V OBS teď: ${o.aktualniScena || 'neznámá scéna'}` : 'OBS není připojené.';
  if (pripojeno && roleScenyOBS(o.aktualniScena) === 'misto' && sc?.misto) {
    text += ` · ${sc.misto.nazev}${sc.ilustrace ? ` · ${sc.ilustrace.soubor}` : ''}`;
    if (sc.pocasi !== 'zadne') text += ` · ${POCASI_TEXT[sc.pocasi] ?? sc.pocasi} ${sc.intenzita}`;
  }
  stavEl.textContent = text;
  if (pripojitTlacitko) stavEl.append(' ', pripojitTlacitko);

  for (const id of PANELY) $(`#stul-${id}`).hidden = id !== role;
  nahledMista(role === 'misto' && !$('#obrazovka-sceny').hidden);
}

/** Živý náhled výstupu místa: iframe 1920 × 1080 zmenšený na šířku rámečku, jen dokud je panel vidět. */
function nahledMista(zobrazit) {
  const ramec = $('#stul-nahled-ramec');
  const cil = zobrazit ? '/vystupy/misto.html' : 'about:blank';
  if (ramec.getAttribute('src') !== cil) ramec.setAttribute('src', cil);
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
  if (!n) return;
  $('#pole-obs-url').value = n.obsUrl;
  $('#pole-obs-heslo').placeholder = n.obsHesloNastaveno ? 'Heslo je uložené. Vyplň jen při změně.' : 'Heslo z OBS';
  $('#pole-port').value = n.port;
  $('#pole-domaci-sit').checked = n.domaciSit;
  $('#pole-pin').placeholder = n.pinNastaven ? 'PIN je uložený. Vyplň jen při změně.' : '6–8 číslic';
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

$('#formular-nastaveni').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const telo = {
    obsUrl: f.get('obsUrl').trim(),
    port: Number(f.get('port')),
    domaciSit: f.get('domaciSit') === 'on',
  };
  if (f.get('obsHeslo')) telo.obsHeslo = f.get('obsHeslo');
  if (f.get('pin')) telo.pin = f.get('pin');
  const vysledek = $('#nastaveni-vysledek');
  try {
    const odpoved = await api('/api/nastaveni', { metoda: 'PUT', telo });
    $('#pole-obs-heslo').value = '';
    $('#pole-pin').value = '';
    vysledek.className = 'ulozeni';
    vysledek.textContent = odpoved.potrebaRestartu
      ? 'Nastavení uloženo. Změna portu nebo přístupu z domácí sítě se projeví po restartu Hubu (tlačítko níž).'
      : `Nastavení uloženo v ${cas()}.`;
    await nactiPrehled();
  } catch (chyba) {
    vysledek.className = 'ulozeni chyba';
    vysledek.textContent = `Neuloženo: ${chyba.message}`;
  }
});

/* ---------- Data ze serveru ---------- */

function prekresli() {
  vykresliStav(stav.prehled?.stav);
  vykresliKontrolky();
  vykresliSceny();
  vykresliKontrolu(stav.prehled?.kontrola);
  vykresliSezeni();
  vykresliOdpocet();
  vykresliGit();
  vykresliVyberSouboje();
  vykresliKalendar();
  vykresliObchody();
  vykresliMista();
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
    scena: (data) => {
      if (!stav.prehled) return;
      stav.prehled.scena = data;
      vykresliScenu();
    },
    odpocet: (data) => {
      if (!stav.prehled) return;
      stav.prehled.odpocet = data;
      stav.odchylkaHodin = Date.parse(data.serverCas) - Date.now();
      vykresliOdpocet();
    },
  };
  odebirat(Object.keys(obsluha), (udalost, data) => obsluha[udalost]?.(data), {
    priStavu: (pripojeno) => {
      if (pripojeno) {
        if (!stav.serverOk) nactiPrehled();
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

/* ---------- Sezení: Zahájit / Ukončit ---------- */

function vykresliSezeni() {
  const s = stav.prehled?.sezeni;
  const b = $('#tlacitko-sezeni');
  b.dataset.bezi = String(Boolean(s?.bezi));
  b.textContent = s?.bezi ? `Ukončit sezení ${s.cislo}` : 'Zahájit sezení';
}

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
      toast(`Sezení ${r.cislo} ukončeno. Do GitHubu ho ulož ze Stavu kampaně.`);
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

$('#tlacitko-sezeni').addEventListener('click', () => (stav.prehled?.sezeni?.bezi ? otevritUkoncit() : otevritZahajit()));

/* ---------- Souboj ---------- */

$('#tlacitko-souboj').addEventListener('click', async () => {
  try {
    await api('/api/obs/souboj', { metoda: 'POST', telo: {} });
  } catch (chyba) {
    toast(chyba.message, { chyba: true });
    if (/není nastavená/.test(chyba.message)) location.hash = 'sceny';
  }
});

/* ---------- Poznámka (F2) ---------- */

function otevritPoznamku() {
  const d = $('#dialog-poznamka');
  if (d.open) return;
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
$('#tlacitko-poznamka').addEventListener('click', otevritPoznamku);
document.addEventListener('keydown', (e) => {
  if (e.key === 'F2') {
    e.preventDefault();
    otevritPoznamku();
  }
});

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
  mini.hidden = !(o && (o.stav === 'bezi' || o.stav === 'pauza'));
  mini.textContent = zbyva == null ? '' : formatCasu(zbyva);
  const texty = {
    zadny: 'Odpočet není nastavený.',
    pripraveny: 'Připraveno. V OBS se ukáže po spuštění.',
    bezi: zbyva === 0 ? 'Odpočet doběhl. Hra začíná.' : `Běží. Konec v ${new Date(o?.konec).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}.`,
    pauza: 'Pozastaveno. V OBS stojí na posledním čase.',
  };
  popis.textContent = texty[o?.stav ?? 'zadny'];
  $('#odpocet-spustit').textContent = o?.stav === 'pauza' ? 'Pokračovat' : 'Spustit';
  $('#odpocet-spustit').disabled = !o || o.stav === 'zadny' || o.stav === 'bezi';
  $('#odpocet-pauza').disabled = o?.stav !== 'bezi' || zbyva === 0;
  $('#odpocet-zrusit').disabled = !o || o.stav === 'zadny';
  const pr = o?.prepnuti;
  const scena = stav.prehled?.nastaveni?.scenaPoOdpoctu;
  $('#odpocet-prepnuti').className = pr && !pr.ok ? 'ulozeni varovani' : 'ulozeni';
  $('#odpocet-prepnuti').textContent = pr
    ? pr.ok ? `Po doběhnutí přepnuto na scénu „${pr.scena}“.` : pr.duvod
    : scena ? `Po doběhnutí se OBS přepne na scénu „${scena}“.` : 'Po doběhnutí se scéna nepřepne.';
}
setInterval(() => {
  if (stav.prehled?.odpocet?.stav === 'bezi') vykresliOdpocet();
}, 250);

$('#formular-odpocet').addEventListener('submit', async (e) => {
  e.preventDefault();
  const cas = $('#pole-odpocet-cas').value.trim();
  const minut = Number($('#pole-odpocet-minut').value);
  try {
    await api('/api/odpocet/pripravit', { metoda: 'POST', telo: cas ? { cas } : { minut } });
    $('#pole-odpocet-cas').value = '';
    $('#pole-odpocet-minut').value = '';
  } catch (chyba) {
    toast(chyba.message, { chyba: true });
  }
});
for (const [id, akce] of [['#odpocet-spustit', 'spustit'], ['#odpocet-pauza', 'pauza'], ['#odpocet-zrusit', 'zrusit']]) {
  $(id).addEventListener('click', () => api(`/api/odpocet/${akce}`, { metoda: 'POST', telo: {} }).catch((chyba) => toast(chyba.message, { chyba: true })));
}


/* ---------- Uložení do GitHubu ---------- */

function vykresliGit() {
  const g = stav.prehled?.git;
  const popis = $('#git-popis');
  if (!g?.dostupny) {
    popis.textContent = g?.chyba || 'Zjišťuji stav Gitu…';
    $('#git-ulozit').disabled = true;
    return;
  }
  $('#git-ulozit').disabled = false;
  $('#git-stahnout').hidden = !(g.pozadu > 0);
  const kdy = g.kontrolovano ? ` Naposledy zkontrolováno v ${new Date(g.kontrolovano).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}.` : '';
  popis.textContent = `Větev ${g.vetev}. Neuložených souborů v repu: ${g.zmeneno}.${g.pozadu > 0 ? ` Na GitHubu je ${g.pozadu} novějších změn.` : ''}${kdy} Uložit ukládá jen data kampaně (kampan/), ne kód Hubu.`;
}

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
$('#git-stahnout').addEventListener('click', async () => {
  const v = $('#git-vysledek');
  v.className = 'ulozeni';
  v.textContent = 'Stahuji…';
  try {
    await api('/api/git/stahnout', { metoda: 'POST', telo: {} });
    await nactiPrehled();
    v.textContent = 'Staženo. Pokud se měnil kód Hubu, zavři okno DM Hub a spusť ho znovu.';
  } catch (chyba) {
    v.className = 'ulozeni chyba';
    v.textContent = chyba.message;
  }
});

$('#git-ulozit').addEventListener('click', async () => {
  const v = $('#git-vysledek');
  v.className = 'ulozeni';
  v.textContent = 'Ukládám…';
  try {
    const r = await api('/api/git/ulozit', { metoda: 'POST', telo: {} });
    v.className = r.chybaPush ? 'ulozeni varovani' : 'ulozeni';
    v.textContent = r.chybaPush ?? (r.commit ? `Uloženo a odesláno na GitHub v ${cas()}.` : 'Nic nového k uložení, GitHub je aktuální.');
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

function radekUdalosti(u, dnes) {
  const tr = document.createElement('tr');
  const z = Harptos.absolutni(u.datum);
  const k = u.konec ? Harptos.absolutni(u.konec) : z;
  const d = dnes ? Harptos.absolutni(dnes) : null;
  if (d !== null && d >= z && d <= k) tr.dataset.dnes = 'true';
  const datum = document.createElement('td');
  datum.textContent = textData(u);
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
  const smazat = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Smazat' });
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
  for (const b of document.querySelectorAll('[data-posun], #kalendar-dalsi-den, #tlacitko-dalsi-den')) b.disabled = !dnes;
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
  const probehle = k.udalosti.filter((u) => d !== null && konec(u) < d).reverse();
  $('#tabulka-udalosti tbody').replaceChildren(...nadchazejici.map((u) => radekUdalosti(u, dnes)));
  $('#tabulka-udalosti').hidden = nadchazejici.length === 0;
  $('#tabulka-probehlych tbody').replaceChildren(...probehle.map((u) => radekUdalosti(u, dnes)));
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
$('#tlacitko-dalsi-den').addEventListener('click', otevritDalsiDen);
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

  // Obchody – správa
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
      const smazat = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Smazat' });
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
    const hodnota = String(s[seg.dataset.pole]);
    for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === hodnota));
  }
  const vyberStavu = $('#sc-stav');
  if (document.activeElement !== vyberStavu) {
    vyberStavu.replaceChildren(new Option('výchozí', ''), ...s.stavy.map((x) => new Option(x, x)));
    vyberStavu.value = s.stav ?? '';
    vyberStavu.disabled = !s.stavy.length;
  }
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
  $('#stul-mista').replaceChildren(
    ...seznam.map((m) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'karta-mista mala';
      b.setAttribute('aria-pressed', String(m.id === vybrane?.id));
      if (m.id === zive?.id) b.classList.add('v-obs');
      const nahled = (m.ilustrace.find((il) => !il.skryta && il.ucel === 'scena') ?? m.ilustrace[0]);
      if (nahled) b.style.backgroundImage = `url("${nahled.url}")`;
      b.append(Object.assign(document.createElement('span'), { textContent: m.nazev }));
      if (m.id === zive?.id) b.append(Object.assign(document.createElement('small'), { textContent: 'v OBS' }));
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
        ? 'Klikni na ilustraci a ukáže se v OBS. Odkrýt a Skrýt rozhoduje, co se do OBS vůbec dostane.'
        : `V OBS je pořád ${zive ? zive.nazev : 'jiná scéna'}. Klikni na ilustraci a OBS přepne rovnou na ni.`;
  const ukazatMisto = $('#stul-misto-ukazat');
  ukazatMisto.hidden = !vybrane || jeZive;
  ukazatMisto.textContent = vybrane ? `Ukázat ${vybrane.nazev} v OBS (výchozí ilustrace)` : '';
  $('#stul-ilustrace').replaceChildren(...(vybrane?.ilustrace ?? []).map((il) => kartaIlustrace(vybrane, il, s, jeZive, false)));

  $('#seznam-mist').replaceChildren(
    ...seznam.map((m) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'karta-mista';
      b.setAttribute('aria-pressed', String(m.id === vybraneMisto));
      const odkryte = m.ilustrace.filter((il) => !il.skryta && il.ucel === 'scena');
      const nahled = odkryte[0] ?? m.ilustrace[0];
      if (nahled) b.style.backgroundImage = `url("${nahled.url}")`;
      const popis = document.createElement('span');
      popis.textContent = `${m.nazev}${s?.misto?.id === m.id ? ' · v OBS' : ''}`;
      const pocet = document.createElement('small');
      pocet.textContent = `${odkryte.length} odkrytých, ${m.ilustrace.length - odkryte.length} skrytých`;
      b.append(popis, pocet);
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
  const vObs = s?.misto?.id === m.id;
  $('#misto-ukazat').textContent = vObs ? 'Znovu přepnout OBS na místo' : 'Ukázat v OBS';
  $('#misto-souhrn').textContent = m.ilustrace.length
    ? `Klikni na odkrytou ilustraci a ukáže se v OBS. Skryté (šedé) do OBS nejdou, dokud je neodkryješ.`
    : 'Místo zatím nemá žádnou ilustraci. Vytvoř ji v Ilustrační dílně.';
  // Rozepsaný popis nepřepíše žádná živá změna (střídání ilustrací, změna jinde), dokud ho DM neuloží (audit S7).
  if (document.activeElement !== $('#misto-popis') && !stav.rozpracovano.has(`popis:${m.id}`)) $('#misto-popis').value = m.popisObrazu;
  const mrizka = $('#misto-ilustrace');
  // Nepřekresluj pod rukama, když DM právě píše stav nebo vybírá variantu (tlačítka nevadí).
  const aktivni = document.activeElement;
  if (mrizka.contains(aktivni) && ['INPUT', 'SELECT'].includes(aktivni.tagName)) return;
  mrizka.replaceChildren(...m.ilustrace.map((il) => kartaIlustrace(m, il, s, vObs, true)));
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
  const zahodit = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Zahodit' });
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
  skupinaM.append(...mista.map((m) => new Option(m.nazev, `misto:${m.id}`)));
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
      vysledek.textContent = `Uloženo jako ${r.soubor} (skrytá). Odkryj ji na obrazovce Místa – správa.`;
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
for (const b of document.querySelectorAll('[data-kopirovat]')) {
  b.addEventListener('click', async () => {
    await navigator.clipboard?.writeText($(`#${b.dataset.kopirovat}`).textContent).catch(() => {});
    b.textContent = 'Zkopírováno';
    setTimeout(() => (b.textContent = 'Kopírovat adresu'), 1500);
  });
}

const adresaVystupu = `${location.origin}/vystupy/test.html`;
$('#adresa-vystupu').textContent = adresaVystupu;
$('#kopirovat-adresu').addEventListener('click', async () => {
  await navigator.clipboard?.writeText(adresaVystupu).catch(() => {});
  $('#kopirovat-adresu').textContent = 'Zkopírováno';
  setTimeout(() => ($('#kopirovat-adresu').textContent = 'Kopírovat adresu'), 1500);
});

await nactiPrehled();
ukazObrazovku(stav.prehled?.nastaveni && !stav.prehled.nastaveni.existuje && !location.hash ? 'nastaveni' : location.hash.slice(1));
pripojitUdalosti();
