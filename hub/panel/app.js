// Ovládací panel DM Hubu. Bez build kroku, čistý JavaScript.
import { Harptos, MESICE, SVATKY, dnyText, zbyvaText } from '/sdilene/harptos.js';

const $ = (sel) => document.querySelector(sel);

const stav = {
  prehled: null,
  serverOk: false,
  rozpracovano: new Set(), // pole, která DM právě píše a ještě se neodeslala
};

async function api(cesta, { metoda = 'GET', telo } = {}) {
  const odpoved = await fetch(cesta, {
    method: metoda,
    headers: telo !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: telo !== undefined ? JSON.stringify(telo) : undefined,
  });
  const data = await odpoved.json().catch(() => ({}));
  if (!odpoved.ok) throw Object.assign(new Error(data.chyba || `Server vrátil ${odpoved.status}`), { kod: data.kod });
  return data;
}

function cas() {
  return new Date().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/* ---------- Navigace ---------- */

function ukazObrazovku(jmeno) {
  const platne = ['prehled', 'odpocet', 'sceny', 'kalendar', 'obchody', 'kontrola', 'nastaveni'];
  const cil = platne.includes(jmeno) ? jmeno : 'prehled';
  if (cil === 'kalendar') nactiImport();
  for (const s of document.querySelectorAll('.obrazovka')) s.hidden = s.id !== `obrazovka-${cil}`;
  for (const a of document.querySelectorAll('.moduly a')) {
    if (a.dataset.obrazovka === cil) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}
window.addEventListener('hashchange', () => ukazObrazovku(location.hash.slice(1)));

/* ---------- Stav kampaně ---------- */

function vykresliStav(s) {
  const k = s?.stav;
  $('#lista-datum').textContent = k?.datumText || 'Datum není zadané';
  $('#stav-datum').textContent = k?.datumText || 'zatím nezadané';
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
    box.append(zprava(`Na GitHubu jsou novější změny (${g.pozadu}).`, { tlacitko: { text: 'Stáhnout změny', akce: stahnoutZmeny } }));
  }
  for (const v of p.obs?.varovaniZdroju ?? []) {
    box.append(zprava(`Zdroj „${v.zdroj}“ v OBS má zapnuté ${v.nastaveni.join(' a ')}. Vypni to, jinak výstup nepřežije výpadek Hubu.`));
  }
  if (p.nastaveni && !p.nastaveni.existuje) {
    box.append(zprava('Hub ještě není nastavený. Vyplň heslo k OBS v Nastavení.', { tlacitko: { text: 'Otevřít Nastavení', akce: () => (location.hash = 'nastaveni') } }));
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
}

/* ---------- Scény OBS ---------- */

function vykresliSceny() {
  const o = stav.prehled?.obs;
  const popis = $('#obs-popis');
  const seznam = $('#seznam-scen');
  seznam.replaceChildren();
  if (!o?.nastaveno) {
    popis.textContent = 'OBS ještě není nastavené. Zadej heslo k WebSocket serveru v Nastavení.';
    return;
  }
  if (!o.pripojeno) {
    popis.textContent = `${o.chyba || 'OBS není připojené.'} Hub to zkouší znovu každých 5 sekund.`;
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Připojit teď';
    b.addEventListener('click', () => api('/api/obs/pripojit', { metoda: 'POST', telo: {} }).catch(() => {}));
    seznam.append(b);
    return;
  }
  popis.textContent = 'Klikni na scénu a OBS ji přepne. Numpad v OBS funguje dál.';
  for (const nazev of o.sceny) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = nazev;
    b.setAttribute('aria-pressed', String(nazev === o.aktualniScena));
    if (nazev === stav.prehled?.nastaveni?.scenaSouboj) b.title = 'Scéna pro Souboj';
    b.addEventListener('click', async () => {
      try {
        await api('/api/obs/scena', { metoda: 'POST', telo: { nazev } });
      } catch (e) {
        popis.textContent = e.message;
      }
    });
    seznam.append(b);
  }
}

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
  $('#pole-pin').placeholder = n.pinNastaven ? 'PIN je uložený. Vyplň jen při změně.' : '4–8 číslic';
  vykresliVyberSouboje();
  const srv = stav.prehled?.server;
  $('#server-info').textContent = srv
    ? `Server běží jako node.exe s PID ${srv.pid}. Ve Správci úloh ho najdeš na kartě Podrobnosti; ukončení tohoto procesu otestuje automatický restart.`
    : '';
}

/** Výběr scén (Souboj, po odpočtu): scény z OBS, a pokud OBS neběží, aspoň uložená hodnota. */
function vykresliVyberSouboje() {
  for (const [id, klic, prazdna] of [
    ['#pole-scena-souboj', 'scenaSouboj', '— vyber scénu —'],
    ['#pole-scena-po-odpoctu', 'scenaPoOdpoctu', '— nepřepínat —'],
  ]) {
    const select = $(id);
    if (document.activeElement === select) continue;
    const ulozena = stav.prehled?.nastaveni?.[klic] || '';
    const sceny = [...new Set([...(stav.prehled?.obs?.sceny ?? []), ...(ulozena ? [ulozena] : [])])];
    select.replaceChildren(new Option(prazdna, ''), ...sceny.map((n) => new Option(n, n)));
    select.value = ulozena;
  }
}

$('#formular-nastaveni').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const telo = {
    obsUrl: f.get('obsUrl').trim(),
    port: Number(f.get('port')),
    domaciSit: f.get('domaciSit') === 'on',
    scenaSouboj: f.get('scenaSouboj') ?? '',
    scenaPoOdpoctu: f.get('scenaPoOdpoctu') ?? '',
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
      ? 'Nastavení uloženo. Změna portu nebo přístupu z domácí sítě se projeví po restartu Hubu.'
      : `Nastavení uloženo v ${cas()}. Připojuji se k OBS…`;
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
  const zdroj = new EventSource('/api/udalosti');
  zdroj.addEventListener('open', () => {
    if (!stav.serverOk) nactiPrehled();
  });
  zdroj.addEventListener('error', () => {
    stav.serverOk = false;
    prekresli();
    if (zdroj.readyState === EventSource.CLOSED) setTimeout(pripojitUdalosti, 1000);
  });
  const aktualizuj = (klic) => (e) => {
    if (!stav.prehled) return;
    stav.prehled[klic] = JSON.parse(e.data);
    stav.serverOk = true;
    prekresli();
  };
  zdroj.addEventListener('stav', aktualizuj('stav'));
  zdroj.addEventListener('obs', aktualizuj('obs'));
  zdroj.addEventListener('git', aktualizuj('git'));
  zdroj.addEventListener('kontrola', aktualizuj('kontrola'));
  zdroj.addEventListener('sezeni', aktualizuj('sezeni'));
  zdroj.addEventListener('kalendar-dm', aktualizuj('kalendar'));
  zdroj.addEventListener('obchody', aktualizuj('obchody'));
  zdroj.addEventListener('odpocet', (e) => {
    if (!stav.prehled) return;
    stav.prehled.odpocet = JSON.parse(e.data);
    stav.odchylkaHodin = Date.parse(stav.prehled.odpocet.serverCas) - Date.now();
    vykresliOdpocet();
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
  $('#dialog-ukoncit').showModal();
}

$('#formular-ukoncit').addEventListener('submit', async (e) => {
  const volba = e.submitter?.value;
  if (volba !== 'ukoncit' && volba !== 'jen-ukoncit') return;
  e.preventDefault();
  const vysledek = $('#ukoncit-vysledek');
  try {
    const r = await api('/api/sezeni/ukoncit', { metoda: 'POST', telo: {} });
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
    vysledek.textContent = chyba.message;
  }
});

$('#tlacitko-sezeni').addEventListener('click', () => (stav.prehled?.sezeni?.bezi ? otevritUkoncit() : otevritZahajit()));

/* ---------- Souboj ---------- */

$('#tlacitko-souboj').addEventListener('click', async () => {
  try {
    await api('/api/obs/souboj', { metoda: 'POST', telo: {} });
  } catch (chyba) {
    toast(chyba.message, { chyba: true });
    if (/není nastavená/.test(chyba.message)) location.hash = 'nastaveni';
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
  for (const dlg of document.querySelectorAll('dialog[open]')) dlg.close();
  d.showModal();
  $('#pole-poznamka').focus();
}

async function zapsatPoznamku() {
  const pole = $('#pole-poznamka');
  if (!pole.value.trim()) return;
  try {
    const r = await api('/api/poznamka', { metoda: 'POST', telo: { text: pole.value } });
    pole.value = '';
    $('#dialog-poznamka').close();
    toast(r.vysledek === 'odlozeno' ? 'Poznámka čeká na zápis (soubor je otevřený jinde).' : `Poznámka zapsána v ${r.cas}.`);
  } catch (chyba) {
    $('#poznamka-chyba').textContent = chyba.message;
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
    : scena ? `Po doběhnutí se OBS přepne na scénu „${scena}“.` : 'Po doběhnutí se scéna nepřepne (nastavíš v Nastavení).';
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
  box.hidden = !imp?.dostupny && k.existuje;
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
  for (const dlg of document.querySelectorAll('dialog[open]')) dlg.close();
  $('#dialog-den').showModal();
}

$('#formular-den').addEventListener('submit', async (e) => {
  const volba = e.submitter?.value;
  if (volba !== 'ano' && volba !== 'ne') return;
  e.preventDefault();
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

function vykresliObchody() {
  const o = stav.prehled?.obchody;
  if (!o) return;
  const sloty = $('#sloty');
  if (!sloty.contains(document.activeElement)) {
    sloty.replaceChildren(
      ...['1', '2', '3'].map((n) => {
        const label = document.createElement('label');
        const select = document.createElement('select');
        select.append(new Option('— prázdný (v OBS skrytý) —', ''), ...o.sortimenty.map((s) => new Option(`${s.nazev}${s.mesto ? `, ${s.mesto}` : ''}`, s.id)));
        select.value = o.sloty[n] ?? '';
        select.addEventListener('change', async () => {
          try {
            await api(`/api/obchody/sloty/${n}`, { metoda: 'PUT', telo: { id: select.value || null } });
            toast(select.value ? `Slot ${n}: ${select.selectedOptions[0].textContent}` : `Slot ${n} je prázdný.`);
          } catch (chyba) {
            toast(chyba.message, { chyba: true });
          }
        });
        label.append(`Slot ${n}`, select);
        return label;
      }),
    );
  }
  $('#sortimenty-prazdno').hidden = o.sortimenty.length > 0;
  $('#tabulka-sortimentu').hidden = o.sortimenty.length === 0;
  const vadne = $('#sortimenty-vadne');
  vadne.hidden = !o.vadne.length;
  vadne.textContent = o.vadne.map((v) => `${v.soubor}: ${v.chyba}`).join(' · ');
  $('#tabulka-sortimentu tbody').replaceChildren(
    ...o.sortimenty.map((s) => {
      const tr = document.createElement('tr');
      const td = (text) => Object.assign(document.createElement('td'), { textContent: text });
      const vSlotu = Object.entries(o.sloty).filter(([, id]) => id === s.id).map(([n]) => n);
      const nazev = td(`${s.nazev}${s.mesto ? `, ${s.mesto}` : ''}`);
      if (vSlotu.length) nazev.append(Object.assign(document.createElement('small'), { textContent: ` · slot ${vSlotu.join(', ')}` }));
      const akce = document.createElement('td');
      akce.className = 'akce-radku';
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
          await api(`/api/obchody/sortimenty/${s.id}`, { metoda: 'DELETE' });
          toast(`Smazáno: ${s.nazev}`);
        } catch (chyba) {
          toast(chyba.message, { chyba: true });
        }
      });
      akce.append(smazat);
      const kdy = s.vygenerovano ? new Date(s.vygenerovano).toLocaleDateString('cs-CZ') : '';
      tr.append(nazev, td(`${TYPY_OBCHODU[s.typ] ?? s.typ} (${LOKALITY[s.lokalita] ?? s.lokalita})`), td(String(s.pocet)), td(kdy), akce);
      return tr;
    }),
  );
}

/* ---------- Adresy výstupů ---------- */

const adresaOdpoctu = `${location.origin}/vystupy/odpocet.html`;
$('#adresa-odpoctu').textContent = adresaOdpoctu;
$('#adresa-orloj-velky').textContent = `${location.origin}/vystupy/kalendar-velky.html`;
$('#adresa-orloj-maly').textContent = `${location.origin}/vystupy/kalendar-maly.html`;
$('#adresa-rekapitulace').textContent = `${location.origin}/vystupy/rekapitulace.html`;
$('#adresa-cenik').textContent = `${location.origin}/vystupy/cenik.html?slot=1`;
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
