// Ovládací panel DM Hubu. Bez build kroku, čistý JavaScript.
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
  const platne = ['prehled', 'odpocet', 'sceny', 'kontrola', 'nastaveni'];
  const cil = platne.includes(jmeno) ? jmeno : 'prehled';
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
  $('#lista-datum').textContent = k?.datum || 'Datum není zadané';
  $('#lista-misto').textContent = k?.misto || '';
  $('#lista-misto').hidden = !k?.misto;
  $('#lista-sezeni').textContent = k ? `sezení ${k.sezeni}` : '';
  if (k) {
    for (const [pole, hodnota] of [['datum', k.datum], ['misto', k.misto], ['sezeni', k.sezeni]]) {
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
  $('#svetlo-server').parentElement.title = stav.serverOk ? 'Server běží' : 'Server neodpovídá';

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
}

/** Výběr scény pro Souboj: scény z OBS, a pokud OBS neběží, aspoň uložená hodnota. */
function vykresliVyberSouboje() {
  const select = $('#pole-scena-souboj');
  if (document.activeElement === select) return;
  const ulozena = stav.prehled?.nastaveni?.scenaSouboj || '';
  const sceny = [...new Set([...(stav.prehled?.obs?.sceny ?? []), ...(ulozena ? [ulozena] : [])])];
  select.replaceChildren(new Option('— vyber scénu —', ''), ...sceny.map((n) => new Option(n, n)));
  select.value = ulozena;
}

$('#formular-nastaveni').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const telo = {
    obsUrl: f.get('obsUrl').trim(),
    port: Number(f.get('port')),
    domaciSit: f.get('domaciSit') === 'on',
    scenaSouboj: f.get('scenaSouboj') ?? '',
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
  popis.textContent = `Větev ${g.vetev}. Neuložených souborů v repu: ${g.zmeneno}. Tlačítko uloží jen data kampaně (kampan/), ne kód Hubu.`;
}

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

/* ---------- Adresy výstupů ---------- */

const adresaOdpoctu = `${location.origin}/vystupy/odpocet.html`;
$('#adresa-odpoctu').textContent = adresaOdpoctu;
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
