// Obrazovka Návrh po sezení (⚠ body 153 a 157): operace z hub/.stav/navrhy/sNN.yaml, rozhodnutí DM
// (schválit, upravit, zamítnout, rozhodnout rozpor) a zápis do kánonu.
const $ = (s) => document.querySelector(s);
const PREPIS = 'http://127.0.0.1:8765';
const stav = { cislo: null, detail: null, upravuji: null, jinak: null };

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
const POPISKY_POLI = { text: 'Text', nazev: 'Název', telo: 'Text karty', co_se_stalo: 'Co se stalo', dusledek: 'Důsledek', obsah: 'Obsah', nove: 'Nová hodnota', popis: 'Popis vztahu', nahradit: 'Nový text místo vyřazeného', duvod: 'Důvod' };
const VOLBY = { stul: 'Platí stůl', karta: 'Platí karta', jinak: 'Jinak', odlozit: 'Odložit' };
const datumCesky = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m ? `${Number(m[3])}. ${Number(m[2])}. ${m[1]}` : String(iso ?? '');
};

function odkazPoslech(d) {
  const q = new URLSearchParams({ cislo: stav.cislo, cas: d.cas });
  if (d.blok) q.set('blok', d.blok);
  return `${PREPIS}/?${q}`;
}

function htmlDukazu(o) {
  if (!o.dukaz.length) return '';
  const polozky = o.dukaz.map((d) => {
    const citat = d.citat ? ` „${esc(d.citat)}“` : '';
    if (d.dm) return `<span title="Rozhodnutí DM mimo nahrávku">DM ${esc(datumCesky(d.dm))}</span>${citat}`;
    return `<a href="${esc(odkazPoslech(d))}" target="prepis" title="Otevře místo v přepisovém nástroji">▶ ${esc(d.cas)}</a>${citat}`;
  });
  return `<div class="dukazy">Důkaz: ${polozky.join(' · ')}</div>`;
}

function htmlUkazky(o) {
  const u = o.ukazka;
  if (!u) return '';
  if (u.chyba) return `<div class="problemy">Ukázku nejde spočítat: ${esc(u.chyba)}</div>`;
  const neplatne = u.neplatne ? `<div class="ukazka jedna"><div><div class="popisek">Do oddílu Neplatné na konci karty</div><pre class="neplatne">${esc(u.neplatne)}</pre></div></div>` : '';
  if (u.pred !== undefined) {
    return `<div class="ukazka"><div><div class="popisek">Teď${u.soubor ? ` · ${esc(u.soubor)}` : ''}</div><pre class="pred">${esc(u.pred)}</pre></div>
      <div><div class="popisek">Po zápisu</div><pre class="po">${esc(u.po)}</pre></div></div>${neplatne}`;
  }
  if (u.po) {
    return `<div class="ukazka jedna"><div><div class="popisek">${u.soubor && o.op !== 'vyradit' ? `Nový soubor ${esc(u.soubor)}` : 'Po zápisu'}</div><pre class="po">${esc(u.po)}</pre></div></div>${neplatne}`;
  }
  return neplatne;
}

/** Karta rozporu: co říká karta a co zaznělo u stolu, tlačítka Platí stůl / Platí karta / Jinak / Odložit. */
function htmlRozporu(o) {
  const r = o.rozpor;
  const zapsany = o.stav === 'zapsano';
  const reseni = r.reseni;
  const cisloR = r.r ?? r.navrzeneR;
  let rozhodnuti = '';
  if (reseni) {
    const text = reseni.volba === 'jinak' ? reseni.text : VOLBY[reseni.volba];
    const bezR = reseni.volba === 'karta' && r.bezR;
    rozhodnuti = `<p class="rozhodnuti"><strong>${reseni.volba === 'odlozit' ? 'Odloženo' : 'Rozhodnuto'}:</strong> ${esc(text)}
      ${bezR ? '<span class="tlumeny">· bez čísla R, do zápisu sezení jde jen řádek</span>' : cisloR ? `<span class="tlumeny">· ${zapsany ? '' : 'dostane '}${esc(cisloR)}</span>` : '<span class="tlumeny">· číslo R přidělí Hub při zápisu</span>'}</p>`;
  }
  const navazujici = r.navazujici.length
    ? `<p class="tlumeny">Navazující operace: ${r.navazujici.map((id) => `<a href="#op-${esc(id)}">${esc(id)}</a>`).join(', ')}. Zapíšou se jen, když platí stůl nebo Jinak.</p>` : '';
  let akce = '';
  if (!zapsany) {
    if (stav.jinak === o.id) {
      akce = `<label>Jak to je (zapíše se do registru rozporů)<textarea data-jinak rows="3">${esc(reseni?.volba === 'jinak' ? reseni.text : '')}</textarea></label>
        <div class="akce"><button class="hlavni" data-akce="reseni" data-volba="jinak" data-id="${esc(o.id)}">Uložit rozhodnutí</button>
        <button data-akce="zrusit-jinak">Zrušit</button></div>`;
    } else {
      const tlacitka = Object.entries(VOLBY).map(([volba, nazev]) => {
        const vybrano = reseni?.volba === volba;
        const predvolba = !reseni && r.vychozi === volba;
        return `<button class="${vybrano || predvolba ? 'hlavni' : ''}" data-akce="${volba === 'jinak' ? 'jinak' : 'reseni'}" data-volba="${volba}" data-id="${esc(o.id)}"
          ${o.problemy.length ? 'disabled' : ''} aria-pressed="${vybrano}" title="${predvolba ? 'Výchozí řešení pro tento druh rozporu' : ''}">${nazev}${predvolba ? ' (výchozí)' : ''}</button>`;
      }).join('');
      akce = `<div class="akce">${tlacitka}${reseni ? `<button class="tiche" data-akce="reseni-zrusit" data-id="${esc(o.id)}">Vrátit mezi nerozhodnuté</button>` : ''}</div>`;
    }
  }
  return `<div class="ukazka"><div><div class="popisek">Karta říká</div><pre class="pred">${esc(o.data.karta_tvrzeni)}</pre></div>
      <div><div class="popisek">U stolu zaznělo</div><pre class="po">${esc(o.data.prepis_tvrzeni)}</pre></div></div>
    ${r.navrh ? `<p class="tlumeny">Návrh: ${esc(r.navrh)}</p>` : ''}
    ${rozhodnuti}${navazujici}${akce}`;
}

function htmlOperace(o) {
  const jeRozpor = o.op === 'rozpor';
  const nazevStavu = jeRozpor
    ? (o.stav === 'zapsano' ? 'Zapsáno' : o.rozpor.reseni ? (o.rozpor.reseni.volba === 'odlozit' ? 'Odloženo' : 'Rozhodnuto') : 'Čeká na rozhodnutí')
    : NAZVY_STAVU[o.stav];
  const stitky = [
    `<span class="stitek-n ${o.stav === 'schvaleno' || o.stav === 'zapsano' ? 'ok' : ''}">${nazevStavu}</span>`,
    jeRozpor ? `<span class="stitek-n">${esc(o.rozpor.nazevDruhu)}</span>` : `<span class="stitek-n ${o.jistota === 'jista' ? '' : 'pozor'}">${o.jistota === 'jista' ? 'jisté' : 'nutno potvrdit'}</span>`,
    o.z_rozporu ? `<a class="stitek-n" href="#op-${esc(o.z_rozporu)}">k rozporu ${esc(o.z_rozporu)}</a>` : '',
    o.automaticky ? '<span class="stitek-n">zamítl Hub podle rozporu</span>' : '',
    o.upraveno ? '<span class="stitek-n pozor">upraveno tebou</span>' : '',
    o.problemy.length ? `<span class="stitek-n chyba">${o.problemy.length} ${o.problemy.length === 1 ? 'chyba' : 'chyby'}</span>` : '',
    o.dukazy && !o.dukazy.ok ? '<span class="stitek-n pozor">důkaz nesedí</span>' : '',
    o.dukazy && o.dukazy.ok ? '<span class="stitek-n ok">důkaz ověřen v přepisu</span>' : '',
  ].join('');
  const problemy = o.problemy.map((p) => `<div class="problemy">✖ ${esc(p)}</div>`).join('');
  const varovani = [
    ...(o.blokuje && o.stav !== 'zapsano' ? [o.blokuje] : []),
    ...o.varovani,
    ...(o.dukazy && !o.dukazy.ok ? o.dukazy.problemy.map((p) => `kontrola v přepisu: ${p.text}`) : []),
  ].map((p) => `<div class="varovani">⚠ ${esc(p)}</div>`).join('');
  const obsah = jeRozpor ? htmlRozporu(o) : htmlUkazky(o);
  const upravit = !jeRozpor && stav.upravuji === o.id ? o.upravitelne.map((pole) => `<label>${esc(POPISKY_POLI[pole] ?? pole)}
      <textarea data-pole="${esc(pole)}" rows="${pole === 'telo' || pole === 'obsah' ? 10 : 4}">${esc(o.data[pole])}</textarea></label>`).join('') : '';
  let akce = '';
  if (!jeRozpor && o.stav !== 'zapsano') {
    const nejdeSchvalit = o.problemy.length ? 'Nejdřív oprav chyby (Upravit), nebo operaci zamítni.' : o.blokuje;
    akce = stav.upravuji === o.id
      ? `<button class="hlavni" data-akce="ulozit-upravu" data-id="${esc(o.id)}">Uložit úpravu</button>
         <button data-akce="zrusit-upravu">Zrušit</button>
         ${o.upraveno ? `<button class="tiche" data-akce="vratit-upravu" data-id="${esc(o.id)}">Vrátit původní text návrhu</button>` : ''}`
      : `${o.stav !== 'schvaleno' ? `<button class="hlavni" data-akce="stav" data-stav="schvaleno" data-id="${esc(o.id)}" ${nejdeSchvalit ? `disabled title="${esc(nejdeSchvalit)}"` : ''}>Schválit</button>` : ''}
         ${o.stav !== 'zamitnuto' ? `<button data-akce="stav" data-stav="zamitnuto" data-id="${esc(o.id)}">Zamítnout</button>` : ''}
         ${o.stav !== 'nerozhodnuto' ? `<button class="tiche" data-akce="stav" data-stav="nerozhodnuto" data-id="${esc(o.id)}">Vrátit mezi čekající</button>` : ''}
         ${o.upravitelne.length ? `<button class="tiche" data-akce="upravit" data-id="${esc(o.id)}">Upravit</button>` : ''}`;
  }
  return `<article class="op${jeRozpor ? ' rozpor' : ''}" data-stav="${esc(o.stav)}" data-op="${esc(o.op)}" id="op-${esc(o.id)}">
    <h3><span class="id-op">${esc(o.id)}</span> ${esc(o.popis)}</h3>
    <div class="stitky">${stitky}</div>
    ${problemy}${varovani}${htmlDukazu(o)}${obsah}${upravit}
    ${akce ? `<div class="akce">${akce}</div>` : ''}
  </article>`;
}

const jeJista = (o) => o.stav === 'nerozhodnuto' && o.jistota === 'jista' && !o.problemy.length && !o.blokuje
  && !['rozpor', 'smazat'].includes(o.op) && (!o.dukazy || o.dukazy.ok);
const kZapisu = (d) => d.operace.filter((o) => o.stav === 'schvaleno' && o.op !== 'rozpor').length
  + d.operace.filter((o) => o.op === 'rozpor' && o.stav !== 'zapsano' && o.rozpor.reseni).length;

function vykreslit() {
  const d = stav.detail;
  if (!d) return;
  const p = d.pocty;
  const jiste = d.operace.filter(jeJista);
  const nerozhodnuteRozpory = d.operace.filter((o) => o.op === 'rozpor' && !o.rozpor.reseni && o.stav !== 'zapsano').length;
  $('#hlaseni').innerHTML = [
    d.brana ? `<div class="brana">🔒 ${esc(d.brana)}</div>` : '',
    ...d.varovani.map((v) => `<div class="varovani">⚠ ${esc(v)}</div>`),
  ].join('');
  const n = kZapisu(d);
  $('#souhrn').innerHTML = `
    <span class="stitek-n">${d.operace.length - d.rozpory.celkem} operací</span>
    <span class="stitek-n">${p.nerozhodnuto} čeká</span>
    <span class="stitek-n ok">${p.schvaleno} schváleno</span>
    <span class="stitek-n">${p.zamitnuto} zamítnuto</span>
    ${p.zapsano ? `<span class="stitek-n ok">${p.zapsano} zapsáno</span>` : ''}
    ${d.rozpory.celkem ? `<a class="stitek-n ${nerozhodnuteRozpory ? 'pozor' : 'ok'}" href="#prvni-rozpor">rozpory: ${d.rozpory.rozhodnuto} rozhodnuto, ${d.rozpory.odlozeno} odloženo, ${nerozhodnuteRozpory} čeká</a>` : ''}
    <span class="mezera" style="flex:1"></span>
    <button data-akce="schvalit-jiste" ${jiste.length ? '' : 'disabled'} title="Jisté operace bez chyb, jejichž důkaz přepis potvrdil (mimo smazání)">Schválit jisté (${jiste.length})</button>
    <button class="hlavni" data-akce="zapsat" ${n && !d.brana ? '' : 'disabled'} title="${d.brana ? 'Předběžný návrh nejde zapsat.' : ''}">Zapsat schválené (${n})</button>`;
  $('#operace').innerHTML = d.operace.length ? d.operace.map(htmlOperace).join('') : '<p class="prazdno">Návrh nemá žádné operace.</p>';
  const prvni = document.querySelector('.op.rozpor:not([data-stav="zapsano"])');
  if (prvni) prvni.insertAdjacentHTML('beforebegin', '<span id="prvni-rozpor"></span>');
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

function popisNavrhu(n) {
  if (n.chyba) return `${n.cislo} · chyba v návrhu`;
  const nazev = n.cislo.startsWith('revize-') ? `revize ${datumCesky(n.cislo.slice(7))}` : `sezení ${Number(n.cislo.slice(1))}`;
  return `${nazev}${n.stav === 'predbezny' ? ' (předběžný)' : ''} · ${n.operaci} operací, ${n.nerozhodnuto ?? 0} čeká`;
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
    $('#operace').innerHTML = `<p class="prazdno">Zatím tu žádný návrh není. Vznikne po schválení scénáře v přepisovém nástroji:
      nástroj připraví podklad, Claude podle něj napíše návrh do hub/.stav/navrhy/ a ten se ukáže tady.</p>`;
    return;
  }
  const z = new URLSearchParams(location.search).get('sezeni');
  $('#vyber').innerHTML = seznam.map((n) => `<option value="${esc(n.cislo)}">${esc(popisNavrhu(n))}</option>`).join('');
  const sezeni = seznam.filter((n) => !n.cislo.startsWith('revize-'));
  const cislo = seznam.some((n) => n.cislo === z) ? z : (sezeni.at(-1) ?? seznam.at(-1)).cislo;
  $('#vyber').value = cislo;
  await nacist(cislo);
}

$('#vyber').addEventListener('change', (e) => {
  history.replaceState(null, '', `?sezeni=${e.target.value}`);
  stav.upravuji = null;
  stav.jinak = null;
  nacist(e.target.value);
});

const operace = (id) => stav.detail.operace.find((o) => o.id === id);
const putOperace = (id, telo) => api(`/api/navrh-sezeni/${stav.cislo}/operace/${encodeURIComponent(id)}`, 'PUT', telo);

async function zapsat() {
  const k = await api(`/api/navrh-sezeni/${stav.cislo}/kontrola`);
  if (k.chyba) {
    alert(k.chyba);
    return;
  }
  if (k.kvalita.nove.length) {
    alert(`Zápis by přidal chyby Kvality kánonu, a to nejde (rozhodnutí 79):\n\n${k.kvalita.nove.map((x) => `• ${x.nazev}: ${x.nazevPravidla} — ${x.zprava}`).join('\n')}\n\nUprav nebo zamítni operace, které je způsobí.`);
    return;
  }
  const casti = [
    k.operaci ? `${k.operaci} změn v ${k.karet} kartách` : null,
    k.udalosti ? `${k.udalosti} událostí v kalendáři` : null,
    k.rozporu ? `${k.rozporu} rozhodnutí do registru rozporů (${k.cislaR.join(', ')})` : null,
  ].filter(Boolean);
  if (!confirm(`Zapsat do kánonu: ${casti.join(', ')}?\n\nHub zápis rovnou uloží na GitHub. Všechno jde vrátit přes Git.`)) return;
  const v = await api(`/api/navrh-sezeni/${stav.cislo}/zapsat`, 'POST', {});
  const ulozeni = v.ulozeno ? (v.odeslano ? ' Uloženo na GitHub.' : ` Uloženo lokálně. ${v.chybaUlozeni ?? ''}`) : ` ${v.chybaUlozeni ?? 'Ulož přes Systém → Aktualizovat.'}`;
  alert(`Zapsáno: ${v.operaci} operací v ${v.karet} kartách${v.udalosti ? `, ${v.udalosti} událostí v kalendáři` : ''}${v.rozporu ? `, rozhodnutí ${v.cislaR.join(', ')} v registru rozporů` : ''}.${v.odlozeno ? ` ${v.odlozeno} souborů bylo zamčených, Hub je zapíše, jakmile to půjde.` : ''}${ulozeni}`);
  await nacist(stav.cislo);
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-akce]');
  if (!t) return;
  const akce = t.dataset.akce;
  try {
    if (akce === 'stav') {
      const o = operace(t.dataset.id);
      if (t.dataset.stav === 'schvaleno' && o?.op === 'smazat') {
        if (!confirm('Smazat je jen pro chybu zápisu: věc, která u stolu nikdy nezazněla. Text z karty zmizí bez stopy v oddílu Neplatné (zůstane jen v historii Gitu). Opravdu?')) return;
        if (!confirm('Ještě jednou: smazat, ne vyřadit? Neplatný text, který u stolu zazněl, se vyřazuje (zůstane v oddílu Neplatné).')) return;
      }
      stav.detail = await putOperace(t.dataset.id, { stav: t.dataset.stav });
    } else if (akce === 'upravit') {
      stav.upravuji = t.dataset.id;
    } else if (akce === 'zrusit-upravu') {
      stav.upravuji = null;
    } else if (akce === 'ulozit-upravu' || akce === 'vratit-upravu') {
      const upraveno = akce === 'vratit-upravu' ? null
        : Object.fromEntries([...document.querySelectorAll(`#op-${CSS.escape(t.dataset.id)} textarea[data-pole]`)].map((x) => [x.dataset.pole, x.value]));
      stav.detail = await putOperace(t.dataset.id, { upraveno });
      stav.upravuji = null;
    } else if (akce === 'jinak') {
      stav.jinak = t.dataset.id;
    } else if (akce === 'zrusit-jinak') {
      stav.jinak = null;
    } else if (akce === 'reseni') {
      const volba = t.dataset.volba;
      const text = volba === 'jinak' ? document.querySelector(`#op-${CSS.escape(t.dataset.id)} textarea[data-jinak]`)?.value ?? '' : undefined;
      stav.detail = await putOperace(t.dataset.id, { reseni: { volba, ...(text !== undefined ? { text } : {}) } });
      stav.jinak = null;
    } else if (akce === 'reseni-zrusit') {
      stav.detail = await putOperace(t.dataset.id, { reseni: null });
    } else if (akce === 'schvalit-jiste') {
      const jiste = stav.detail.operace.filter(jeJista);
      if (!confirm(`Schválit ${jiste.length} jistých operací bez chyb? Zapíšou se až tlačítkem Zapsat schválené.`)) return;
      for (const o of jiste) stav.detail = await putOperace(o.id, { stav: 'schvaleno' });
    } else if (akce === 'zapsat') {
      await zapsat();
      return;
    } else return;
    vykreslit();
  } catch (err) {
    alert(err.message);
  }
});

start();
