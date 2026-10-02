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
  if (!odpoved.ok) throw new Error(data.chyba || `Server vrátil ${odpoved.status}`);
  return data;
}

function cas() {
  return new Date().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/* ---------- Navigace ---------- */

function ukazObrazovku(jmeno) {
  const platne = ['prehled', 'sceny', 'kontrola', 'nastaveni'];
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
}

async function nactiPrehled() {
  try {
    stav.prehled = await api('/api/prehled');
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
