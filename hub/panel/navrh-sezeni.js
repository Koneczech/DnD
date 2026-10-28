// Obrazovka Návrh po sezení (⚠ bod 153): operace z hub/.stav/navrhy/sNN.yaml, rozhodnutí DM a zápis.
const $ = (s) => document.querySelector(s);
const PREPIS = 'http://127.0.0.1:8765';
const stav = { cislo: null, detail: null, upravuji: null };

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function api(cesta, metoda = 'GET', telo) {
  const odpoved = await fetch(cesta, {
    method: metoda,
    headers: telo !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: telo !== undefined ? JSON.stringify(telo) : undefined,
  });
  const data = await odpoved.json().catch(() => ({}));
  if (!odpoved.ok) throw new Error(data.chyba || `Server vrátil ${odpoved.status}`);
  return data;
}

const NAZVY_STAVU = { nerozhodnuto: 'Čeká', schvaleno: 'Schváleno', zamitnuto: 'Zamítnuto', zapsano: 'Zapsáno' };
const POPISKY_POLI = { text: 'Text', nazev: 'Název', telo: 'Text karty', co_se_stalo: 'Co se stalo', dusledek: 'Důsledek', obsah: 'Obsah', nove: 'Nová hodnota', popis: 'Popis vztahu' };

function odkazPoslech(cas) {
  return `${PREPIS}/?cislo=${encodeURIComponent(stav.cislo)}&cas=${encodeURIComponent(cas)}`;
}

function htmlOperace(o) {
  const stitky = [
    `<span class="stitek-n ${o.stav === 'schvaleno' || o.stav === 'zapsano' ? 'ok' : ''}">${o.op === 'rozpor' && o.stav === 'schvaleno' ? 'Vyřízeno' : NAZVY_STAVU[o.stav]}</span>`,
    `<span class="stitek-n ${o.jistota === 'jista' ? '' : 'pozor'}">${o.jistota === 'jista' ? 'jisté' : 'nutno potvrdit'}</span>`,
    o.upraveno ? '<span class="stitek-n pozor">upraveno tebou</span>' : '',
    o.problemy.length ? `<span class="stitek-n chyba">${o.problemy.length} ${o.problemy.length === 1 ? 'chyba' : 'chyby'}</span>` : '',
    o.dukazy && !o.dukazy.ok ? '<span class="stitek-n pozor">důkaz nesedí</span>' : '',
    o.dukazy && o.dukazy.ok ? '<span class="stitek-n ok">důkaz ověřen v přepisu</span>' : '',
  ].join('');
  const dukazy = o.dukaz.length ? `<div class="dukazy">Důkaz: ${o.dukaz.map((d) => `<a href="${esc(odkazPoslech(d.cas))}" target="prepis" title="Otevře místo v přepisovém nástroji">▶ ${esc(d.cas)}</a>${d.citat ? ` „${esc(d.citat)}“` : ''}`).join(' · ')}</div>` : '';
  const problemy = o.problemy.map((p) => `<div class="problemy">✖ ${esc(p)}</div>`).join('');
  const varovani = [...o.varovani, ...(o.dukazy && !o.dukazy.ok ? o.dukazy.problemy.map((p) => `kontrola v přepisu: ${p}`) : [])]
    .map((p) => `<div class="varovani">⚠ ${esc(p)}</div>`).join('');
  let ukazka = '';
  if (o.op === 'rozpor') {
    ukazka = `<div class="ukazka"><div><div class="popisek">Karta říká</div><pre class="pred">${esc(o.data.karta_tvrzeni)}</pre></div>
      <div><div class="popisek">U stolu zaznělo</div><pre class="po">${esc(o.data.prepis_tvrzeni)}</pre></div></div>
      <p class="uvod">Rozpor se nezapisuje sám. Rozhodni ho v kartě (Upravit), tady ho jen označ jako vyřízený.</p>`;
  } else if (o.ukazka?.chyba) {
    ukazka = `<div class="problemy">Ukázku nejde spočítat: ${esc(o.ukazka.chyba)}</div>`;
  } else if (o.ukazka?.pred !== undefined) {
    ukazka = `<div class="ukazka"><div><div class="popisek">Teď${o.ukazka.soubor ? ` · ${esc(o.ukazka.soubor)}` : ''}</div><pre class="pred">${esc(o.ukazka.pred)}</pre></div>
      <div><div class="popisek">Po zápisu</div><pre class="po">${esc(o.ukazka.po)}</pre></div></div>`;
  } else if (o.ukazka?.po) {
    ukazka = `<div class="ukazka jedna"><div><div class="popisek">${o.ukazka.soubor ? `Nový soubor ${esc(o.ukazka.soubor)}` : 'Po zápisu'}</div><pre class="po">${esc(o.ukazka.po)}</pre></div></div>`;
  }
  const upravit = stav.upravuji === o.id ? o.upravitelne.map((pole) => `<label>${esc(POPISKY_POLI[pole] ?? pole)}
      <textarea data-pole="${esc(pole)}" rows="${pole === 'telo' || pole === 'obsah' ? 10 : 4}">${esc(o.data[pole])}</textarea></label>`).join('') : '';
  const akce = o.stav === 'zapsano' ? '' : stav.upravuji === o.id
    ? `<button class="hlavni" data-akce="ulozit-upravu" data-id="${esc(o.id)}">Uložit úpravu</button>
       <button data-akce="zrusit-upravu">Zrušit</button>
       ${o.upraveno ? `<button class="tiche" data-akce="vratit-upravu" data-id="${esc(o.id)}">Vrátit původní text návrhu</button>` : ''}`
    : `${o.stav !== 'schvaleno' ? `<button class="hlavni" data-akce="stav" data-stav="schvaleno" data-id="${esc(o.id)}" ${o.problemy.length ? 'disabled title="Nejdřív oprav chyby (Upravit), nebo operaci zamítni."' : ''}>${o.op === 'rozpor' ? 'Vyřízeno' : 'Schválit'}</button>` : ''}
       ${o.stav !== 'zamitnuto' ? `<button data-akce="stav" data-stav="zamitnuto" data-id="${esc(o.id)}">Zamítnout</button>` : ''}
       ${o.stav !== 'nerozhodnuto' ? `<button class="tiche" data-akce="stav" data-stav="nerozhodnuto" data-id="${esc(o.id)}">Vrátit mezi čekající</button>` : ''}
       ${o.upravitelne.length ? `<button class="tiche" data-akce="upravit" data-id="${esc(o.id)}">Upravit</button>` : ''}`;
  return `<article class="op" data-stav="${esc(o.stav)}" id="op-${esc(o.id)}">
    <h3>${esc(o.popis)}</h3>
    <div class="stitky">${stitky}</div>
    ${problemy}${varovani}${dukazy}${ukazka}${upravit}
    <div class="akce">${akce}</div>
  </article>`;
}

function vykreslit() {
  const d = stav.detail;
  if (!d) return;
  const p = d.pocty;
  const jiste = d.operace.filter((o) => o.stav === 'nerozhodnuto' && o.jistota === 'jista' && !o.problemy.length && o.op !== 'rozpor' && (!o.dukazy || o.dukazy.ok));
  $('#souhrn').innerHTML = `
    <span class="stitek-n">${d.operace.length} operací</span>
    <span class="stitek-n">${p.nerozhodnuto} čeká</span>
    <span class="stitek-n ok">${p.schvaleno} schváleno</span>
    <span class="stitek-n">${p.zamitnuto} zamítnuto</span>
    ${p.zapsano ? `<span class="stitek-n ok">${p.zapsano} zapsáno</span>` : ''}
    <span class="mezera" style="flex:1"></span>
    <button data-akce="schvalit-jiste" ${jiste.length ? '' : 'disabled'} title="Jisté operace bez chyb, jejichž důkaz přepis potvrdil">Schválit jisté (${jiste.length})</button>
    <button class="hlavni" data-akce="zapsat" ${p.schvaleno ? '' : 'disabled'}>Zapsat schválené (${d.operace.filter((o) => o.stav === 'schvaleno' && o.op !== 'rozpor').length})</button>`;
  $('#operace').innerHTML = d.operace.length ? d.operace.map(htmlOperace).join('') : '<p class="prazdno">Návrh nemá žádné operace.</p>';
}

async function nacist(cislo) {
  stav.cislo = cislo;
  try {
    stav.detail = await api(`/api/navrh-sezeni/${cislo}`);
    vykreslit();
  } catch (e) {
    $('#operace').innerHTML = `<p class="prazdno">${esc(e.message)}</p>`;
  }
}

async function start() {
  let seznam;
  try {
    seznam = (await api('/api/navrh-sezeni')).navrhy;
  } catch (e) {
    $('#operace').innerHTML = `<p class="prazdno">${esc(e.message)}</p>`;
    return;
  }
  if (!seznam.length) {
    $('#vyber').hidden = true;
    $('#operace').innerHTML = `<p class="prazdno">Zatím tu žádný návrh není. Vznikne v přepisovém nástroji
      (Sezení → Do kánonu…): nástroj připraví podklad, Claude podle něj napíše návrh do hub/.stav/navrhy/ a ten se ukáže tady.</p>`;
    return;
  }
  const z = new URLSearchParams(location.search).get('sezeni');
  $('#vyber').innerHTML = seznam.map((n) => `<option value="${esc(n.cislo)}">${esc(n.cislo)} · ${n.chyba ? 'chyba v návrhu' : `${n.operaci} operací, ${n.nerozhodnuto ?? 0} čeká`}</option>`).join('');
  const cislo = seznam.some((n) => n.cislo === z) ? z : seznam.at(-1).cislo;
  $('#vyber').value = cislo;
  await nacist(cislo);
}

$('#vyber').addEventListener('change', (e) => {
  history.replaceState(null, '', `?sezeni=${e.target.value}`);
  stav.upravuji = null;
  nacist(e.target.value);
});

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-akce]');
  if (!t) return;
  const akce = t.dataset.akce;
  try {
    if (akce === 'stav') {
      stav.detail = await api(`/api/navrh-sezeni/${stav.cislo}/operace/${t.dataset.id}`, 'PUT', { stav: t.dataset.stav });
    } else if (akce === 'upravit') {
      stav.upravuji = t.dataset.id;
    } else if (akce === 'zrusit-upravu') {
      stav.upravuji = null;
    } else if (akce === 'ulozit-upravu' || akce === 'vratit-upravu') {
      const upraveno = akce === 'vratit-upravu' ? null
        : Object.fromEntries([...document.querySelectorAll(`#op-${CSS.escape(t.dataset.id)} textarea[data-pole]`)].map((x) => [x.dataset.pole, x.value]));
      stav.detail = await api(`/api/navrh-sezeni/${stav.cislo}/operace/${t.dataset.id}`, 'PUT', { upraveno });
      stav.upravuji = null;
    } else if (akce === 'schvalit-jiste') {
      const jiste = stav.detail.operace.filter((o) => o.stav === 'nerozhodnuto' && o.jistota === 'jista' && !o.problemy.length && o.op !== 'rozpor' && (!o.dukazy || o.dukazy.ok));
      if (!confirm(`Schválit ${jiste.length} jistých operací bez chyb? Zapíšou se až tlačítkem Zapsat schválené.`)) return;
      for (const o of jiste) stav.detail = await api(`/api/navrh-sezeni/${stav.cislo}/operace/${o.id}`, 'PUT', { stav: 'schvaleno' });
    } else if (akce === 'zapsat') {
      const n = stav.detail.operace.filter((o) => o.stav === 'schvaleno' && o.op !== 'rozpor').length;
      if (!confirm(`Zapsat ${n} schválených změn do kánonu? Pak je ulož tlačítkem Uložit na GitHub (Systém).`)) return;
      const v = await api(`/api/navrh-sezeni/${stav.cislo}/zapsat`, 'POST', {});
      alert(`Zapsáno: ${v.operaci} operací v ${v.karet} kartách${v.udalosti ? `, ${v.udalosti} událostí v kalendáři` : ''}.${v.odlozeno ? ` ${v.odlozeno} souborů bylo zamčených, Hub je zapíše, jakmile to půjde.` : ''}`);
      await nacist(stav.cislo);
      return;
    } else return;
    vykreslit();
  } catch (err) {
    alert(err.message);
  }
});

start();
