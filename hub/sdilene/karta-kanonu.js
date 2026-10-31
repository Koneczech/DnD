// Karta kánonu jako text: čtení hlavičky a těla, oddíl Co ví družina, pohled družiny a kontrola
// polí z editoru. Bez Node.js, takže ho používá server (kanon-modul.js) i čtecí verze na GitHub
// Pages, která karty upravuje přes GitHub (⚠ bod 148). Jedna pravidla pro obě místa.
import { rozebrat, odkazy } from './frontmatter.js';
import { idZOdkazu, normalizujVztah, TEXTOVA_POLE, ODKAZOVA_KLICE } from './hlavicka.js';
import { TYPY_SLOZEK, OSUDY, ODKAZOVA_POLE, POLE_TYPU, STAVY_ROZHODNUTI } from './typy-karet.js';
import { textDruziny, blokyTextu } from './odkryvani.js';
import { jeNadpisDm } from './oddil-dm.js';

export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const STITEK_VE_HRE = 'aktualni';
export const ODDIL_DRUZINY = 'Co ví družina';
const OBRAZEK = /\.(png|jpe?g|webp)$/i;

const chyba = (zprava, status = 400) => Object.assign(new Error(zprava), { status });
const bezDiakritiky = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Slug pro jméno nástěnky. */
export function slugNastenky(text) {
  return bezDiakritiky(text).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/**
 * Oddíly těla karty podle nadpisů ## (a ###…). Text před prvním nadpisem je oddíl bez nadpisu.
 * Bloky kódu (```) se nerozdělují.
 * @returns {Array<{nadpis: string|null, uroven: number, text: string}>}
 */
export function oddily(telo) {
  const vysledek = [];
  let aktualni = { nadpis: null, uroven: 0, radky: [] };
  let vKodu = false;
  for (const radek of String(telo ?? '').split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(radek)) vKodu = !vKodu;
    const m = !vKodu && /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(radek);
    if (m) {
      vysledek.push(aktualni);
      aktualni = { nadpis: m[2], uroven: m[1].length, radky: [radek] };
    } else {
      aktualni.radky.push(radek);
    }
  }
  vysledek.push(aktualni);
  return vysledek.map((o) => ({ nadpis: o.nadpis, uroven: o.uroven, text: o.radky.join('\n') })).filter((o) => o.nadpis !== null || o.text.trim());
}

/** Je nadpis oddílu jen pro DM? (`## DM`, `## DM — co postava neví`, `## Neplatné`; ZADANI.md, Oddíly karty) */
export const jeOddilDm = jeNadpisDm;

const jeOddilDruziny = (nadpis) => bezDiakritiky(String(nadpis ?? '').trim()) === bezDiakritiky(ODDIL_DRUZINY);

/** Značka odkryté odrážky: komentář Obsidianu, v náhledu není vidět. */
export const ZNACKA_ZNA = '%%zná%%';
const ZNACKA = /[ \t]*%%\s*zn[aá]\s*%%/gi;
const ma = (text) => /%%\s*zn[aá]\s*%%/i.test(text);
export const bezZnacek = (text) => String(text ?? '').replace(ZNACKA, '');
/** Komentáře Obsidianu %%…%% se nikde neukazují (ani v pohledu družiny). */
export const bezKomentaru = (text) => String(text ?? '').replace(/%%[\s\S]*?%%/g, '').replace(/[ \t]+$/gm, '');

const NADPIS = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const ODRAZKA = /^( ?)([-*+]|\d+[.)])\s+/;

/** Řádky oddílu Co ví družina v těle karty: { od (nadpis), do, uroven }, nebo null. */
export function najitOddilDruziny(radky) {
  let od = -1;
  let uroven = 0;
  let vKodu = false;
  for (let i = 0; i < radky.length; i++) {
    if (/^\s*(```|~~~)/.test(radky[i])) vKodu = !vKodu;
    const m = !vKodu && NADPIS.exec(radky[i]);
    if (!m) continue;
    if (od >= 0 && m[1].length <= uroven) return { od, do: i, uroven };
    if (od < 0 && jeOddilDruziny(m[2])) {
      od = i;
      uroven = m[1].length;
    }
  }
  return od >= 0 ? { od, do: radky.length, uroven } : null;
}

/**
 * Bloky oddílu Co ví družina (rozhodnutí DM 20. 10. 2026): každá odrážka a každý odstavec se
 * odkrývá zvlášť. Odkrytý blok má na prvním řádku značku %%zná%%, bez ní ho družina nevidí.
 * Pododdíl s nadpisem DM… je vždy jen pro DM.
 * @returns {Array<{index: number, druh: 'odrazka'|'odstavec'|'nadpis', od: number, do: number, text: string, zna: boolean, dm: boolean, uroven?: number}>}
 *   od/do = řádky v těle karty, index = pořadí mezi bloky, které jde odkrýt
 */
export function blokyDruziny(telo) {
  const radky = String(telo ?? '').split('\n');
  const oddil = najitOddilDruziny(radky);
  if (!oddil) return [];
  const bloky = [];
  let blok = null;
  let dmUroven = 0;
  let index = 0;
  const ukoncit = (i) => {
    if (!blok) return;
    blok.do = i;
    const text = radky.slice(blok.od, i).join('\n');
    blok.zna = !blok.dm && ma(text);
    blok.text = bezZnacek(text).replace(/\s+$/, '');
    if (blok.druh === 'odrazka') blok.text = blok.text.replace(ODRAZKA, '');
    // Samotný komentář Obsidianu (nápověda ze šablony) není nic, co by se dalo odkrýt.
    if (bezKomentaru(blok.text).trim()) bloky.push(blok);
    else if (blok.index >= 0) index--;
    blok = null;
  };
  for (let i = oddil.od + 1; i < oddil.do; i++) {
    const r = radky[i];
    const nadpis = NADPIS.exec(r);
    if (nadpis) {
      ukoncit(i);
      const uroven = nadpis[1].length;
      if (dmUroven && uroven <= dmUroven) dmUroven = 0;
      if (!dmUroven && jeOddilDm(nadpis[2])) dmUroven = uroven;
      bloky.push({ index: -1, druh: 'nadpis', od: i, do: i + 1, text: nadpis[2], uroven, zna: false, dm: Boolean(dmUroven) });
      continue;
    }
    if (!r.trim()) {
      ukoncit(i);
      continue;
    }
    if (ODRAZKA.test(r)) {
      ukoncit(i);
      blok = { index: dmUroven ? -1 : index++, druh: 'odrazka', od: i, dm: Boolean(dmUroven) };
      continue;
    }
    // Pokračování odrážky (odsazený řádek nebo vnořená odrážka) zůstává v ní.
    if (blok && (blok.druh === 'odstavec' || /^\s{2,}/.test(r))) continue;
    ukoncit(i);
    blok = { index: dmUroven ? -1 : index++, druh: 'odstavec', od: i, dm: Boolean(dmUroven) };
  }
  ukoncit(oddil.do);
  return bloky;
}

/** Odkryje nebo skryje jeden blok Co ví družina; vrátí nové tělo. */
export function prepnoutBlok(telo, index, zna) {
  const blok = blokyDruziny(telo).find((b) => b.index === index);
  if (!blok) throw chyba('Tahle část oddílu Co ví družina neexistuje (karta se mezitím změnila?).', 409);
  const radky = String(telo).split('\n');
  for (let i = blok.od; i < blok.do; i++) radky[i] = bezZnacek(radky[i]);
  if (zna) radky[blok.od] = `${radky[blok.od].replace(/\s+$/, '')} ${ZNACKA_ZNA}`;
  return radky.join('\n');
}

/** Přidá odrážku na konec oddílu Co ví družina (oddíl založí, když chybí). */
export function pridatBlok(telo, text, zna) {
  const cisty = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!cisty) throw chyba('Napiš, co družina ví.');
  if (cisty.length > 600) throw chyba('Odrážka je příliš dlouhá (nejvýš 600 znaků).');
  const radek = `- ${cisty}${zna ? ` ${ZNACKA_ZNA}` : ''}`;
  const radky = String(telo ?? '').split('\n');
  const oddil = najitOddilDruziny(radky);
  if (!oddil) {
    const zaklad = String(telo ?? '').replace(/\s+$/, '');
    return `${zaklad}${zaklad ? '\n\n' : ''}## ${ODDIL_DRUZINY}\n\n${radek}\n`;
  }
  // Na konec hlavní části oddílu: před první pododdíl (ten může být DM…), za poslední neprázdný řádek.
  let kam = oddil.do;
  for (let i = oddil.od + 1; i < oddil.do; i++) {
    if (NADPIS.test(radky[i])) {
      kam = i;
      break;
    }
  }
  while (kam > oddil.od + 1 && !radky[kam - 1].trim()) kam--;
  const predchozi = radky[kam - 1] ?? '';
  const vlozit = kam === oddil.od + 1 || (!ODRAZKA.test(predchozi) && !/^\s{2,}/.test(predchozi)) ? ['', radek] : [radek];
  radky.splice(kam, 0, ...vlozit);
  return radky.join('\n');
}

/**
 * Text, který smí vidět družina. Z oddílu Co ví družina jen odkryté bloky (a nadpisy nad nimi),
 * nic jiného. Hráčský kánon (typ kanon) je záznam toho, co družina zažila: ukáže se celý kromě
 * oddílů DM. Komentáře Obsidianu %%…%% se vynechají vždy.
 */
export function teloDruziny(telo, typ) {
  if (typ === 'kanon') {
    const vystup = [];
    let vynechUroven = 0;
    for (const o of oddily(telo)) {
      if (o.nadpis !== null) {
        if (vynechUroven && o.uroven <= vynechUroven) vynechUroven = 0;
        if (!vynechUroven && jeOddilDm(o.nadpis)) vynechUroven = o.uroven;
      }
      if (!vynechUroven) vystup.push(o.text);
    }
    return bezKomentaru(vystup.join('\n')).trim();
  }
  const radky = String(telo ?? '').split('\n');
  const oddil = najitOddilDruziny(radky);
  if (!oddil) return '';
  const bloky = blokyDruziny(telo);
  if (!bloky.some((b) => b.zna)) return '';
  const vystup = [radky[oddil.od], ''];
  bloky.forEach((b, i) => {
    if (b.druh === 'nadpis') {
      // Nadpis jen tehdy, když pod ním (před dalším nadpisem stejné nebo vyšší úrovně) je něco odkrytého.
      const dalsi = bloky.slice(i + 1);
      const konec = dalsi.findIndex((x) => x.druh === 'nadpis' && x.uroven <= b.uroven);
      if (!b.dm && (konec === -1 ? dalsi : dalsi.slice(0, konec)).some((x) => x.zna)) vystup.push('', radky[b.od]);
      return;
    }
    if (!b.zna) return;
    vystup.push(...(b.druh === 'odstavec' ? ['', bezKomentaru(radky.slice(b.od, b.do).join('\n'))] : [bezKomentaru(radky.slice(b.od, b.do).join('\n'))]));
  });
  return vystup.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Tělo bez oddílu Co ví družina (wiki ho ukazuje zvlášť, po odrážkách). */
export function teloBezDruziny(telo) {
  const radky = String(telo ?? '').split('\n');
  const oddil = najitOddilDruziny(radky);
  if (!oddil) return String(telo ?? '');
  radky.splice(oddil.od, oddil.do - oddil.od);
  return radky.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** Krátký popis do seznamu karet: první odstavec textu bez formátování. */
export function kratkyPopis(text, max = 170) {
  for (const odstavec of String(text ?? '').split(/\n\s*\n/)) {
    const t = bezKomentaru(odstavec)
      .split('\n')
      .filter((r) => r.trim() && !NADPIS.test(r) && !/^\s*(```|~~~|\||---)/.test(r))
      .map((r) => r.replace(/^\s*(>\s*)+/, '').replace(ODRAZKA, ''))
      .join(' ')
      .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, id, popisek) => popisek ?? id)
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*_~`]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (t) return t.length > max ? `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : t;
  }
  return '';
}

/** Ilustrace z hlavičky → adresa obrázku přes Hub (stejné cesty jako jinde v Hubu). */
function adresaObrazku(il, entita) {
  const soubor = String(il?.soubor ?? '');
  if (!soubor || !OBRAZEK.test(soubor)) return null;
  if (soubor.startsWith('/')) return soubor;
  if (!entita.slozkaEntity) return null; // záznam (jeden soubor) nemá vlastní obrázky
  return `/kampan/${entita.slozka}/${encodeURIComponent(entita.id)}/${soubor.split('/').map(encodeURIComponent).join('/')}`;
}

/** Obrázky karty: portréty a ilustrace scén (bez skrytých, ty patří jen DM). */
function obrazky(data, entita) {
  const seznam = (Array.isArray(data.ilustrace) ? data.ilustrace : [])
    .map((il) => ({
      url: adresaObrazku(il, entita),
      ucel: ['portret', 'scena', 'token', 'karta'].includes(il?.ucel) ? il.ucel : 'scena',
      varianta: typeof il?.varianta === 'string' ? il.varianta : null,
      stav: typeof il?.stav === 'string' && il.stav !== 'vychozi' ? il.stav : null,
      skryta: il?.skryta === true,
      soubor: String(il?.soubor ?? ''),
    }))
    .filter((il) => il.url);
  return seznam;
}

/**
 * Nadřazené místo (`lezi_v: "[[mirabar]]"`, ⚠ bod 116). Jen u místa; jiný tvar se ignoruje
 * (Kontrola dat ho ohlásí).
 */
export function leziV(d) {
  if (d?.typ !== 'misto' || typeof d.lezi_v !== 'string') return null;
  const id = odkazy(d.lezi_v)[0] ?? '';
  return SLUG.test(id) && id !== d.id ? id : null;
}

const textovePole = (x) => (typeof x === 'string' ? x : Number.isFinite(x) ? String(x) : null);

/** Karta ze souboru v jednotném tvaru pro panel. */
export function nacistEntitu(text, { slozka, soubor, slozkaEntity, upraveno = null }) {
  const r = rozebrat(text);
  if (r.chyba) throw new Error(r.chyba);
  if (!r.maHlavicku) throw new Error('Chybí hlavička YAML');
  const d = r.data;
  const id = String(d.id ?? '');
  if (!SLUG.test(id)) throw new Error(`id „${id}“ není slug`);
  const entita = {
    id,
    typ: String(d.typ ?? TYPY_SLOZEK[slozka]),
    slozka,
    slozkaEntity,
    soubor,
    nazev: String(d.nazev ?? id),
    verejne: d.verejne === true,
    ikona: typeof d.ikona === 'string' ? d.ikona : '',
    aliases: (Array.isArray(d.aliases) ? d.aliases : []).map(String).filter(Boolean),
    tags: (Array.isArray(d.tags) ? d.tags : []).map(String).filter(Boolean),
    vazby: [...new Set(odkazy(JSON.stringify(d.vazby ?? [])))],
    vztahy: (Array.isArray(d.vztahy) ? d.vztahy : []).map(normalizujVztah).filter(Boolean),
    leziV: leziV(d),
    odkazyVTextu: [...new Set(odkazy(r.telo))],
    udaje: {},
    pole: {},
    telo: r.telo,
    upraveno,
    // Celá hlavička pro Kvalitu kánonu (datum sezení, zdroj); pohledy ji nepředávají dál.
    hlavicka: d,
  };
  entita.aktualni = entita.tags.includes(STITEK_VE_HRE);
  // Vyřazená karta (rozhodnutí 77): `platnost: vyrazeno`, `vyrazeno: R17`. Zmizí z pohledu družiny,
  // mapy a hledání; v pohledu DM ji vrátí filtr Vyřazené.
  entita.vyrazeno = d.platnost === 'vyrazeno' ? (/^R\d+$/.test(String(d.vyrazeno ?? '')) ? String(d.vyrazeno) : true) : null;
  entita.obrazky = obrazky(d, entita);
  // Hlavní údaje z hlavičky podle typu (karta je ukáže pod názvem).
  for (const pole of ['hrac', 'druh', 'povolani', 'role', 'osud', 'stav', 'oblast', 'zaznamenano', 'sezeni', 'cislo']) {
    const h = textovePole(d[pole]);
    if (h) entita.udaje[pole] = h;
  }
  // Živý je výchozí osud, boční panel ho neukazuje (rozhodnutí 74).
  if (entita.udaje.osud === 'zije') delete entita.udaje.osud;
  // Odkazová pole (kde, sidlo, u_koho): id cílové karty.
  entita.odkazyPole = {};
  for (const pole of ODKAZOVA_KLICE) {
    if (typeof d[pole] !== 'string') continue;
    const cil = odkazy(d[pole])[0] ?? '';
    if (SLUG.test(cil) && cil !== id) entita.odkazyPole[pole] = cil;
  }
  if (Array.isArray(d.kdo) && d.kdo.length) entita.udaje.kdo = d.kdo.map(String).join(', ');
  if (typeof d.doresit === 'boolean') entita.udaje.doresit = d.doresit ? 'ano' : 'ne';
  // Pole pro editor karty (surové hodnoty z hlavičky).
  for (const pole of TEXTOVA_POLE) if (pole in d) entita.pole[pole] = textovePole(d[pole]) ?? '';
  for (const pole of ODKAZOVA_KLICE) if (pole in d) entita.pole[pole] = entita.odkazyPole[pole] ?? '';
  if ('doresit' in d) entita.pole.doresit = d.doresit === true;
  if ('kdo' in d) entita.pole.kdo = (Array.isArray(d.kdo) ? d.kdo : []).map(String);
  entita.kdo = (Array.isArray(d.kdo) ? d.kdo : []).map(String).filter(Boolean);
  // Kolik z oddílu Co ví družina je odkryté (mapa: rozložení Co družina ví).
  const bloky = blokyDruziny(r.telo).filter((b) => b.index >= 0);
  entita.odkryto = { zna: bloky.filter((b) => b.zna).length, celkem: bloky.length };
  entita.popis = kratkyPopis(teloBezDruziny(r.telo));
  // Popisek dlaždice pro družinu: z Co ví družina, jinak z odkrytého textu karty (rozhodnutí 75).
  entita.popisDruziny = kratkyPopis(teloDruziny(r.telo, entita.typ)) || (entita.typ === 'kanon' ? '' : kratkyPopis(textDruziny(r.telo)));
  entita.odkrytoTextu = entita.typ === 'kanon' ? 0 : blokyTextu(r.telo).filter((b) => b.zna).length;
  return entita;
}

/** Portrét do uzlu mapy: první portrét, jinak první ilustrace scény. */
function obrazekUzlu(obrazky) {
  return obrazky.find((o) => o.ucel === 'portret' && !o.varianta) ?? obrazky.find((o) => o.ucel === 'portret') ?? obrazky.find((o) => o.ucel === 'scena') ?? null;
}

/**
 * Entita pro daný pohled. Pohled družiny (rozhodnutí 71) je filtr, ne ochrana (rozhodnutí 2):
 * jen entity s `verejne: true`, vztahy s `verejne: true` k veřejným entitám, žádné holé vazby,
 * přezdívky, štítky ani údaje z hlavičky; z obrázků jen neskryté.
 * @param {object} e entita z nacistEntitu
 * @param {(id: string) => object|undefined} najit
 */
export function vPohledu(e, pohled, najit) {
  if (pohled !== 'druzina') {
    const obrazky = e.obrazky;
    return {
      id: e.id, typ: e.typ, nazev: e.nazev, verejne: e.verejne, ikona: e.ikona, aliases: e.aliases, tags: e.tags,
      aktualni: e.aktualni, vazby: e.vazby, vztahy: e.vztahy, leziV: e.leziV, udaje: e.udaje, odkazyPole: e.odkazyPole ?? {}, soubor: e.soubor,
      kdo: e.kdo ?? [], odkryto: e.odkryto ?? { zna: 0, celkem: 0 }, odkrytoTextu: e.odkrytoTextu ?? 0,
      obrazek: obrazekUzlu(obrazky)?.url ?? null, portret: obrazekUzlu(obrazky)?.ucel === 'portret', obrazky,
      popis: e.popis, upraveno: e.upraveno, vyrazeno: e.vyrazeno ?? null,
    };
  }
  if (!e.verejne || e.vyrazeno) return null;
  const obrazky = e.obrazky.filter((o) => !o.skryta);
  const vztahy = e.vztahy.filter((v) => v.verejne && najit(v.s)?.verejne && !najit(v.s)?.vyrazeno);
  return {
    id: e.id, typ: e.typ, nazev: e.nazev, verejne: true, ikona: e.ikona, aliases: [], tags: [], aktualni: false,
    vazby: vztahy.map((v) => v.s), vztahy, udaje: {}, odkazyPole: {}, soubor: null,
    // Hráčský kánon je celý pro družinu, včetně toho, koho se týká.
    kdo: e.typ === 'kanon' ? e.kdo ?? [] : [], odkryto: null,
    // Kde místo leží, družina ví, když zná obě místa.
    leziV: e.leziV && najit(e.leziV)?.verejne && !najit(e.leziV)?.vyrazeno ? e.leziV : null,
    obrazek: obrazekUzlu(obrazky)?.url ?? null, portret: obrazekUzlu(obrazky)?.ucel === 'portret', obrazky,
    popis: e.popisDruziny, upraveno: null, vyrazeno: null,
  };
}

/** Odkaz Otevřít v Obsidianu (bod 101). */
export function odkazObsidian(trezor, soubor) {
  return `obsidian://open?vault=${encodeURIComponent(trezor)}&file=${encodeURIComponent(soubor)}`;
}

/** Nástěnka ze souboru v jednotném tvaru. Rozbité položky se tiše vynechají. */
export function normalizujNastenku(id, d) {
  const entity = [];
  const videno = new Set();
  for (const x of Array.isArray(d?.entity) ? d.entity : []) {
    const eid = idZOdkazu(x?.id);
    if (!SLUG.test(eid) || videno.has(eid) || !Number.isFinite(Number(x?.x)) || !Number.isFinite(Number(x?.y))) continue;
    videno.add(eid);
    entity.push({ id: eid, x: Math.round(Number(x.x)), y: Math.round(Number(x.y)) });
  }
  return {
    id,
    nazev: typeof d?.nazev === 'string' && d.nazev.trim() ? d.nazev.trim() : id,
    pohled: d?.pohled === 'druzina' ? 'druzina' : 'dm',
    jen_tyto: d?.jen_tyto === true,
    entity,
  };
}

/**
 * Pole hlavičky z editoru (název, ikona, hráč, druh, stav …) po kontrole. Vrátí jen změněná pole.
 * @param {object} e karta z nacistEntitu
 * @param {(id: string) => object|undefined} najit karta podle id (odkazová pole)
 */
export function overitPole(e, telo, najit) {
  const z = {};
  for (const pole of TEXTOVA_POLE) {
    if (!(pole in telo)) continue;
    const t = String(telo[pole] ?? '').replace(/\s+/g, ' ').trim();
    if (pole === 'nazev' && !t) throw chyba('Karta potřebuje název.');
    if (t.length > (pole === 'nazev' ? 120 : 200)) throw chyba(`Pole ${pole} je příliš dlouhé.`);
    if (pole === 'ikona' && [...t].length > 4) throw chyba('Ikona je jeden emoji znak.');
    if (pole === 'stav' && e.typ === 'rozhodnuti' && !STAVY_ROZHODNUTI.includes(t)) throw chyba(`Stav rozhodnutí je ${STAVY_ROZHODNUTI.join(', ')}.`);
    if (pole === 'oblast' && t && !SLUG.test(t)) throw chyba('Oblast je kampan, nebo id postavy.');
    if (pole === 'osud' && t && !(t in OSUDY)) throw chyba(`Osud je ${Object.keys(OSUDY).join(', ')}.`);
    if ((e.pole[pole] ?? '') !== t) z[pole] = t;
  }
  // Odkazová pole (kde, sidlo, u_koho): id karty povoleného typu, prázdné = odebrat.
  for (const pole of ODKAZOVA_KLICE) {
    if (!(pole in telo)) continue;
    const t = idZOdkazu(String(telo[pole] ?? ''));
    if (t) {
      if (!(POLE_TYPU[e.typ] ?? []).includes(pole)) throw chyba(`Pole ${pole} karta typu ${e.typ} nemá.`);
      if (!SLUG.test(t) || t === e.id) throw chyba(`Neplatný odkaz v poli ${pole}.`);
      const cil = najit(t);
      if (!cil) throw chyba(`Karta „${t}“ neexistuje.`, 404);
      if (!ODKAZOVA_POLE[pole].cil.includes(cil.typ)) throw chyba(`${cil.nazev} sem nepatří (pole ${pole} vede na: ${ODKAZOVA_POLE[pole].cil.join(', ')}).`);
    }
    if ((e.pole[pole] ?? '') !== t) z[pole] = t;
  }
  if ('doresit' in telo) {
    if (typeof telo.doresit !== 'boolean') throw chyba('doresit musí být true nebo false.');
    if (telo.doresit !== (e.pole.doresit ?? false)) z.doresit = telo.doresit;
  }
  if ('kdo' in telo) {
    if (!Array.isArray(telo.kdo)) throw chyba('Kdo musí být seznam.');
    const kdo = [...new Set(telo.kdo.map((x) => String(x ?? '').trim()).filter(Boolean))].slice(0, 20);
    if (kdo.some((x) => x.length > 60)) throw chyba('Položka Kdo je příliš dlouhá.');
    if (JSON.stringify(kdo) !== JSON.stringify(e.pole.kdo ?? [])) z.kdo = kdo;
  }
  return z;
}

export const MAX_ALIASU = 20;

/**
 * Změny hlavičky z rychlých úprav karty (Družina zná, Ve hře, přezdívky, pole editoru) po kontrole.
 * Vrátí změny pro upravitKartu, nebo null, když už karta tak vypadá.
 * @param {object} e karta z nacistEntitu (aktuální obsah souboru)
 * @param {{verejne?: boolean, aktualni?: boolean, aliases?: string[]}} telo
 * @param {(id: string) => object|undefined} najit
 */
export function zmenyKarty(e, telo, najit) {
  if ('verejne' in telo && typeof telo.verejne !== 'boolean') throw chyba('verejne musí být true nebo false.');
  let aliasy = null;
  if ('aliases' in telo) {
    if (!Array.isArray(telo.aliases)) throw chyba('Přezdívky musí být seznam.');
    aliasy = [];
    for (const a of telo.aliases) {
      const t = String(a ?? '').replace(/\s+/g, ' ').trim();
      if (!t) continue;
      if (t.length > 80) throw chyba('Přezdívka je příliš dlouhá (nejvýš 80 znaků).');
      if (!aliasy.includes(t)) aliasy.push(t);
    }
    if (aliasy.length > MAX_ALIASU) throw chyba(`Nejvýš ${MAX_ALIASU} přezdívek.`);
  }
  if ('aktualni' in telo && typeof telo.aktualni !== 'boolean') throw chyba('aktualni musí být true nebo false.');
  const maPole = [...TEXTOVA_POLE, ...ODKAZOVA_KLICE, 'doresit', 'kdo'].some((k) => k in telo);
  if (!('verejne' in telo) && !aliasy && !('aktualni' in telo) && !maPole) throw chyba('Není co změnit.');
  const z = maPole ? overitPole(e, telo, najit) : {};
  if ('verejne' in telo && telo.verejne !== e.verejne) z.verejne = telo.verejne;
  if (aliasy && JSON.stringify(aliasy) !== JSON.stringify(e.aliases)) z.aliases = aliasy;
  if ('aktualni' in telo && telo.aktualni !== e.aktualni) {
    z.tags = telo.aktualni ? [...e.tags, STITEK_VE_HRE] : e.tags.filter((t) => t !== STITEK_VE_HRE);
  }
  return Object.keys(z).length ? z : null;
}

/**
 * Text karty pro wiki v daném pohledu: tělo bez oddílu Co ví družina a ten oddíl po odrážkách
 * (DM vidí všechny, družina jen odkryté). Družině tělo ukáže jen hráčský kánon.
 */
export function textKarty(e, p) {
  // Oddíl Co ví družina wiki ukazuje po odrážkách; DM vidí všechny, družina jen odkryté.
  const bloky = blokyDruziny(e.telo);
  const druzina = (p === 'dm' ? bloky : bloky.filter((b) => b.zna || (b.druh === 'nadpis' && !b.dm))).map((b) => ({
    index: b.index, druh: b.druh, text: b.druh === 'nadpis' || p === 'dm' ? b.text : bezKomentaru(b.text), zna: b.zna, dm: b.dm, uroven: b.uroven,
  }));
  // Družině nadpisy bez odkrytého obsahu pod sebou nic neřeknou.
  const druzinaCista = p === 'dm'
    ? druzina
    : druzina.filter((b, i) => {
      if (b.druh !== 'nadpis') return true;
      const dalsi = druzina.slice(i + 1);
      const konec = dalsi.findIndex((x) => x.druh === 'nadpis' && x.uroven <= b.uroven);
      return (konec === -1 ? dalsi : dalsi.slice(0, konec)).some((x) => x.druh !== 'nadpis');
    });
  let telo;
  if (p === 'dm') telo = teloBezDruziny(e.telo);
  // Družina vidí z textu karty jen odkryté odstavce a odrážky (rozhodnutí 75).
  else telo = e.typ === 'kanon' ? teloDruziny(e.telo, e.typ) : textDruziny(e.telo);
  return { telo, druzina: druzinaCista, maOddilDruziny: Boolean(najitOddilDruziny(e.telo.split('\n'))) };
}
