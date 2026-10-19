// Malý převod markdownu karet (Obsidian) na HTML pro kartu v panelu (Blok 3, modul Kánon).
// Bez knihoven a bez internetu. Všechen text se nejdřív escapuje, HTML z karty se neprovede.
// Umí: nadpisy, odstavce, tučné a kurzívu, `kód`, bloky kódu, citace, odrážky a číslované seznamy
// (i úkoly - [x]), vodorovnou čáru, tabulky s |, odkazy [[id|popisek]] a [text](https://…).

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapovat = (s) => String(s ?? '').replace(/[&<>"']/g, (z) => ESC[z]);

/** Je nadpis oddílu jen pro DM? (`## DM`, `## DM — co postava neví`) */
export const jeNadpisDm = (nadpis) => /^DM(\b|\s|—|-|:|$)/.test(String(nadpis ?? '').trim());

/**
 * Řádkové formátování. Odkazy [[id]] dostanou data-id, panel na ně reaguje klikem.
 * @param {(id: string) => boolean} [existuje] neexistující cíl se vykreslí jako prostý text
 */
export function radek(text, existuje = () => true) {
  const kody = [];
  // `kód` se vyjme dřív, aby se v něm nic dalšího neformátovalo.
  let t = String(text).replace(/`([^`]+)`/g, (_, k) => `\u0000${kody.push(k) - 1}\u0000`);
  const odkazy = [];
  t = t.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, id, popisek) => {
    odkazy.push({ id: id.trim(), popisek: (popisek ?? id).trim() });
    return `\u0001${odkazy.length - 1}\u0001`;
  });
  const vnejsi = [];
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, popisek, url) => {
    vnejsi.push({ popisek, url });
    return `\u0002${vnejsi.length - 1}\u0002`;
  });
  t = escapovat(t)
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)(.+?)(?<=\S)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?=\S)(.+?)(?<=\S)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_(?=\S)(.+?)(?<=\S)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '<del>$1</del>');
  t = t.replace(/\u0001(\d+)\u0001/g, (_, i) => {
    const o = odkazy[i];
    const popisek = escapovat(o.popisek);
    return existuje(o.id) ? `<a href="#kanon/${encodeURIComponent(o.id)}" class="odkaz-entity" data-id="${escapovat(o.id)}">${popisek}</a>` : `<span class="odkaz-chybi" title="Karta [[${escapovat(o.id)}]] neexistuje">${popisek}</span>`;
  });
  t = t.replace(/\u0002(\d+)\u0002/g, (_, i) => `<a href="${escapovat(vnejsi[i].url)}" target="_blank" rel="noopener noreferrer">${escapovat(vnejsi[i].popisek)}</a>`);
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${escapovat(kody[i])}</code>`);
}

const bunky = (r) => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((b) => b.trim());

/**
 * Markdown → HTML.
 * @param {string} md
 * @param {{existuje?: (id: string) => boolean, vynechatNadpis?: string, oznacitDm?: boolean}} [volby]
 *   vynechatNadpis: první nadpis # se stejným textem se vynechá (karta už název ukazuje)
 *   oznacitDm: oddíly s nadpisem „DM…“ se zabalí do <section class="oddil-dm">
 */
export function naHtml(md, { existuje, vynechatNadpis, oznacitDm = false } = {}) {
  const radky = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
  const vystup = [];
  let odstavec = [];
  let seznam = null; // { typ: 'ul'|'ol', polozky: [] }
  let citace = null;
  let dmUroven = 0;
  let prvniNadpis = true;

  const ukoncitOdstavec = () => {
    if (odstavec.length) vystup.push(`<p>${odstavec.map((r) => radek(r, existuje)).join('<br>')}</p>`);
    odstavec = [];
  };
  const ukoncitSeznam = () => {
    if (seznam) vystup.push(`<${seznam.typ}>${seznam.polozky.map((p) => `<li${p.ukol !== null ? ' class="ukol"' : ''}>${p.ukol !== null ? `<input type="checkbox" disabled${p.ukol ? ' checked' : ''}> ` : ''}${radek(p.text, existuje)}</li>`).join('')}</${seznam.typ}>`);
    seznam = null;
  };
  const ukoncitCitaci = () => {
    if (citace) vystup.push(`<blockquote>${naHtml(citace.join('\n'), { existuje })}</blockquote>`);
    citace = null;
  };
  const ukoncitVse = () => {
    ukoncitOdstavec();
    ukoncitSeznam();
    ukoncitCitaci();
  };

  for (let i = 0; i < radky.length; i++) {
    const r = radky[i];
    const plot = /^\s*(```|~~~)/.exec(r);
    if (plot) {
      ukoncitVse();
      const kod = [];
      for (i++; i < radky.length && !radky[i].trim().startsWith(plot[1]); i++) kod.push(radky[i]);
      vystup.push(`<pre><code>${escapovat(kod.join('\n'))}</code></pre>`);
      continue;
    }
    if (citace && /^\s*>/.test(r)) {
      citace.push(r.replace(/^\s*> ?/, ''));
      continue;
    }
    if (/^\s*>/.test(r)) {
      ukoncitOdstavec();
      ukoncitSeznam();
      citace = [r.replace(/^\s*> ?/, '')];
      continue;
    }
    ukoncitCitaci();
    if (!r.trim()) {
      ukoncitOdstavec();
      ukoncitSeznam();
      continue;
    }
    const nadpis = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(r);
    if (nadpis) {
      ukoncitVse();
      const uroven = nadpis[1].length;
      const text = nadpis[2];
      if (prvniNadpis && uroven === 1 && vynechatNadpis && text.trim() === vynechatNadpis.trim()) {
        prvniNadpis = false;
        continue;
      }
      prvniNadpis = false;
      if (oznacitDm) {
        if (dmUroven && uroven <= dmUroven) {
          vystup.push('</section>');
          dmUroven = 0;
        }
        if (!dmUroven && jeNadpisDm(text)) {
          vystup.push('<section class="oddil-dm"><p class="oddil-dm-stitek">Jen pro DM</p>');
          dmUroven = uroven;
        }
      }
      // Nadpisy karty začínají o úroveň níž (h3…), h2 je název karty.
      const h = Math.min(6, uroven + 2);
      vystup.push(`<h${h}>${radek(text, existuje)}</h${h}>`);
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(r)) {
      ukoncitVse();
      vystup.push('<hr>');
      continue;
    }
    // Tabulka: řádek s | a pod ním oddělovač |---|
    if (r.includes('|') && i + 1 < radky.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(radky[i + 1])) {
      ukoncitVse();
      const hlavicka = bunky(r);
      const telo = [];
      for (i += 2; i < radky.length && radky[i].includes('|') && radky[i].trim(); i++) telo.push(bunky(radky[i]));
      i--;
      vystup.push(`<table><thead><tr>${hlavicka.map((b) => `<th>${radek(b, existuje)}</th>`).join('')}</tr></thead><tbody>${telo.map((rr) => `<tr>${rr.map((b) => `<td>${radek(b, existuje)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const polozka = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(r);
    if (polozka) {
      ukoncitOdstavec();
      const typ = /\d/.test(polozka[1]) ? 'ol' : 'ul';
      if (seznam && seznam.typ !== typ) ukoncitSeznam();
      if (!seznam) seznam = { typ, polozky: [] };
      const ukol = /^\[([ xX])\]\s+(.*)$/.exec(polozka[2]);
      seznam.polozky.push({ text: ukol ? ukol[2] : polozka[2], ukol: ukol ? ukol[1] !== ' ' : null });
      continue;
    }
    if (seznam && /^\s{2,}\S/.test(r)) {
      // Pokračování položky na dalším řádku
      seznam.polozky.at(-1).text += ` ${r.trim()}`;
      continue;
    }
    ukoncitSeznam();
    odstavec.push(r.trim());
  }
  ukoncitVse();
  if (dmUroven) vystup.push('</section>');
  return vystup.join('\n');
}
