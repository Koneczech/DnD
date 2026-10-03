// Markdown s hlavičkou YAML (frontmatter), jak ji používá Obsidian.
import YAML from 'yaml';

const OTEVRENI = /^---\r?\n/;

/**
 * Rozdělí text na hlavičku a tělo. Nikdy nevyhodí výjimku; chybu vrátí v poli `chyba`.
 * @returns {{data: object|null, telo: string, chyba: string|null, maHlavicku: boolean, dokument: YAML.Document|null}}
 */
export function rozebrat(text) {
  const t = text.startsWith('﻿') ? text.slice(1) : text;
  if (!OTEVRENI.test(t)) {
    return { data: null, telo: t, chyba: null, maHlavicku: false, dokument: null };
  }
  const zbytek = t.replace(OTEVRENI, '');
  const konec = zbytek.search(/^---[ \t]*(\r?\n|$)/m);
  if (konec === -1) {
    return { data: null, telo: t, chyba: 'Hlavička nemá ukončovací řádek ---', maHlavicku: true, dokument: null };
  }
  const yamlText = zbytek.slice(0, konec);
  const telo = zbytek.slice(konec).replace(/^---[ \t]*\r?\n?/, '');
  const dokument = YAML.parseDocument(yamlText);
  if (dokument.errors.length) {
    const e = dokument.errors[0];
    return { data: null, telo, chyba: `Chyba v YAML: ${e.message.split('\n')[0]}`, maHlavicku: true, dokument: null };
  }
  const data = dokument.toJS() ?? {};
  if (typeof data !== 'object' || Array.isArray(data)) {
    return { data: null, telo, chyba: 'Hlavička musí být mapa klíč: hodnota', maHlavicku: true, dokument: null };
  }
  return { data, telo, chyba: null, maHlavicku: true, dokument };
}

/** Složí hlavičku a tělo zpět do textu. */
export function slozit(data, telo = '') {
  const yamlText = YAML.stringify(data, { lineWidth: 0 });
  return `---\n${yamlText}---\n${telo}`;
}

/**
 * Upraví jen zadané klíče hlavičky a zachová komentáře, pořadí i tělo souboru
 * (aby úpravy z panelu nepřepisovaly to, co DM napsal v Obsidianu).
 * @param {string} text původní obsah souboru
 * @param {object} zmeny klíč -> nová hodnota
 */
export function upravitHlavicku(text, zmeny) {
  const r = rozebrat(text);
  if (r.chyba) throw new Error(r.chyba);
  if (!r.maHlavicku) return slozit(zmeny, r.telo);
  for (const [klic, hodnota] of Object.entries(zmeny)) {
    if (hodnota && typeof hodnota === 'object' && !Array.isArray(hodnota)) {
      // Malá mapa (datum Harptosu) se zapíše na jeden řádek a převezme komentář z původního řádku.
      const puvodni = r.dokument.get(klic, true);
      const uzel = r.dokument.createNode(hodnota);
      uzel.flow = true;
      if (puvodni?.comment) uzel.comment = puvodni.comment;
      r.dokument.set(klic, uzel);
    } else {
      r.dokument.set(klic, hodnota);
    }
  }
  const yamlText = r.dokument.toString({ lineWidth: 0 });
  return `---\n${yamlText}---\n${r.telo}`;
}

/** Vytáhne id z odkazů [[id]] (i ve tvaru [[id|popisek]] a [[id#nadpis]]). */
export function odkazy(text) {
  const vysledek = [];
  const re = /\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g;
  let m;
  while ((m = re.exec(String(text)))) vysledek.push(m[1].trim());
  return vysledek;
}

/**
 * Úprava hlavičky přímo v dokumentu YAML: `uprava(dokument)` smí měnit uzly.
 * Komentáře, pořadí klíčů i tělo souboru zůstanou (např. odkrytí jedné ilustrace v seznamu).
 */
export function upravitDokument(text, uprava) {
  const r = rozebrat(text);
  if (r.chyba) throw new Error(r.chyba);
  if (!r.maHlavicku) throw new Error('Soubor nemá hlavičku YAML');
  uprava(r.dokument);
  const yamlText = r.dokument.toString({ lineWidth: 0 });
  return `---\n${yamlText}---\n${r.telo}`;
}
