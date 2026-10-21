// List postavy jako vlastní záložka stránky postavy (rozhodnutí 76, DM 21. 10. 2026).
// Oddíl `## List postavy` se z textu karty vyjme a wiki ho ukáže zvlášť: nahoře souhrn
// (vlastnosti, OČ, BV, iniciativa…) vytažený z listu, pod ním pododdíly listu jako karty.
// Text listu se nemění; souhrn se jen čte z tabulky Ability Scores a odrážek Combat.

const NADPIS = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const bezDiakritiky = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
/** Značka bloku pro odkrývání (sdilene/odkryvani.js) se při čtení hodnot nebere v úvahu. */
const bezZnacek = (t) => String(t ?? '').replace(/\u0005\d+\u0005/g, '').replace(/[ \t]*%%[\s\S]*?%%/g, '');

export const NAZEV_LISTU = 'List postavy';

/**
 * Rozdělí text karty na list postavy a zbytek. Oddíl končí dalším nadpisem stejné nebo vyšší
 * úrovně. Bez oddílu vrátí list null.
 * @returns {{zbytek: string, list: string|null}}
 */
export function oddelitList(md) {
  const radky = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
  let od = -1;
  let uroven = 0;
  let vKodu = false;
  for (let i = 0; i < radky.length; i++) {
    if (/^\s*(```|~~~)/.test(radky[i])) vKodu = !vKodu;
    const n = !vKodu && NADPIS.exec(radky[i]);
    if (!n) continue;
    if (od >= 0 && n[1].length <= uroven) {
      return { zbytek: [...radky.slice(0, od), ...radky.slice(i)].join('\n'), list: radky.slice(od + 1, i).join('\n') };
    }
    if (od < 0 && bezDiakritiky(n[2]) === bezDiakritiky(NAZEV_LISTU)) {
      od = i;
      uroven = n[1].length;
    }
  }
  if (od < 0) return { zbytek: radky.join('\n'), list: null };
  return { zbytek: radky.slice(0, od).join('\n'), list: radky.slice(od + 1).join('\n') };
}

/** Vlastnosti podle překladového klíče (reference/prekladovy-klic-cz.md). */
const VLASTNOSTI = [
  ['strength', 'SIL', 'Síla'], ['dexterity', 'OBR', 'Obratnost'], ['constitution', 'ODL', 'Odolnost'],
  ['intelligence', 'INT', 'Inteligence'], ['wisdom', 'MDR', 'Moudrost'], ['charisma', 'CHA', 'Charisma'],
];

/** Hodnoty z odrážek Combat: klíč v listu (anglicky) → zkratka a název podle klíče. */
const BOJ = [
  ['armor class', 'OČ', 'Obranné číslo', /^\d+/],
  ['max hp', 'BV', 'Body výdrže', /^\d+/],
  ['initiative', 'Iniciativa', 'Iniciativa', /^[+\-−]?\d+/],
  ['speed', 'Rychlost', 'Rychlost', /^\d+\s*ft/],
  ['proficiency bonus', 'ZB', 'Zdatnostní bonus', /^[+\-−]?\d+/],
  ['hit dice', 'Kostky obnovy', 'Kostky obnovy', /^\d+d\d+/],
];

/**
 * Souhrn listu: vlastnosti (hodnota, opravy), bojové hodnoty, pasivní vnímání a kouzla.
 * Co v listu není, v souhrnu chybí (nic se nedopočítává).
 * @returns {{vlastnosti: {zkratka, nazev, hodnota, oprava}[], boj: {zkratka, nazev, hodnota}[], kouzla: string|null}}
 */
export function souhrnListu(list) {
  const radky = bezZnacek(list).split('\n');
  const vlastnosti = [];
  for (const [klic, zkratka, nazev] of VLASTNOSTI) {
    const r = radky.find((x) => /^\s*\|/.test(x) && bezDiakritiky(x.split('|')[1]) === klic);
    if (!r) continue;
    const bunky = r.split('|').slice(1, -1).map((b) => b.trim());
    if (!/^\d+$/.test(bunky[1] ?? '')) continue;
    vlastnosti.push({ zkratka, nazev, hodnota: Number(bunky[1]), oprava: (bunky[2] ?? '').replace('-', '−') });
  }
  const boj = [];
  for (const [klic, zkratka, nazev, vzor] of BOJ) {
    const r = radky.find((x) => new RegExp(`^\\s*[-*]\\s+${klic}\\s*:`, 'i').test(x));
    const hodnota = r && vzor.exec(r.replace(/^[^:]*:\s*/, '').trim())?.[0];
    if (hodnota) boj.push({ zkratka, nazev, hodnota: hodnota.replace(/^-/, '−').replace(/\s*ft$/, ' ft') });
  }
  const pasivni = /Passive Perception\s+(\d+)/i.exec(radky.join('\n'));
  if (pasivni) boj.push({ zkratka: 'Pas. vnímání', nazev: 'Pasivní vnímání', hodnota: pasivni[1] });
  const kouzla = radky.map((r) => /^#{2,6}\s+Spells\s*\(([^)]*)\)/i.exec(r)).find(Boolean);
  let textKouzel = null;
  if (kouzla) {
    const so = /Spell DC\s*(\d+)/i.exec(kouzla[1]);
    const utok = /Spell Attack\s*([+\-−]?\d+)/i.exec(kouzla[1]);
    textKouzel = [so ? `SO ${so[1]}` : null, utok ? `útok kouzlem ${utok[1].replace(/^-/, '−')}` : null].filter(Boolean).join(' · ') || null;
  }
  return { vlastnosti, boj, kouzla: textKouzel };
}

/**
 * Pododdíly listu (### nadpisy) pro vykreslení jako karty. Text před prvním pododdílem je
 * úvod listu. Tabulku Ability Scores souhrn ukazuje sám, proto `vynechat` (název pododdílu).
 * @returns {{uvod: string, oddily: {nadpis: string, text: string}[]}}
 */
export function oddilyListu(list) {
  const radky = String(list ?? '').split('\n');
  const uroven = Math.min(...radky.map((r) => NADPIS.exec(r)?.[1].length ?? 9));
  const oddily = [];
  const uvod = [];
  let vKodu = false;
  for (const r of radky) {
    if (/^\s*(```|~~~)/.test(r)) vKodu = !vKodu;
    const n = !vKodu && NADPIS.exec(r);
    if (n && n[1].length === uroven) {
      oddily.push({ nadpis: n[2], text: [] });
      continue;
    }
    (oddily.at(-1)?.text ?? uvod).push(r);
  }
  return { uvod: uvod.join('\n').trim(), oddily: oddily.map((o) => ({ nadpis: o.nadpis, text: o.text.join('\n').trim() })) };
}

/** Pododdíl s tabulkou vlastností (souhrn ho nahradí dlaždicemi). */
export const jeTabulkaVlastnosti = (nadpis) => /^ability scores$|^vlastnosti$/.test(bezDiakritiky(nadpis));
