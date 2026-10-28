// Kvalita kánonu (⚠ bod 154): měřitelná kritéria, podle kterých je kánon „na 100 %“. Hub je
// počítá nad načtenými kartami a ukazuje je DM na přehledu wiki a u každé karty. Nic nemění.
//
// Úroveň „chyba“ se počítá do procenta (karta bez chyby = hotová), „doporučení“ jen radí.
import { oddily, jeOddilDm, bezKomentaru } from './karta-kanonu.js';
import { chybejiciOddily } from './typy-karet.js';

export const PRAVIDLA = Object.freeze({
  poznamky: {
    nazev: 'Poznámky z přípravy v textu',
    uroven: 'chyba',
    rada: 'Text karty popisuje svět, jak teď je. Poznámky o převodu (R1…), variantách, „doplněno“ a „doplnit“ patří do registru rozhodnutí, nebo pryč.',
  },
  terminy: {
    nazev: 'Anglické herní termíny',
    uroven: 'chyba',
    rada: 'Herní termíny česky podle PHB 2024 (reference/prekladovy-klic-cz.md).',
  },
  popis: {
    nazev: 'Prázdná karta',
    uroven: 'chyba',
    rada: 'Karta potřebuje aspoň pár vět o tom, co to je (mimo oddíly DM a Co ví družina).',
  },
  druzina: {
    nazev: 'Družina to zná, ale nic nevidí',
    uroven: 'chyba',
    rada: 'Postava hráče a každá karta, na kterou odkazuje hráčský kánon, má být pro družinu viditelná a mít odkrytou aspoň jednu odrážku.',
  },
  sezeni: {
    nazev: 'Neúplné sezení',
    uroven: 'chyba',
    rada: 'Odehrané sezení má datum, shrnutí a aspoň jeden záznam hráčského kánonu.',
  },
  oddily: {
    nazev: 'Chybí doporučené oddíly',
    uroven: 'doporuceni',
    rada: 'Karty stejného typu mají stejnou kostru (šablony v sablony/). Vlastní oddíly patří pod ni.',
  },
  odkazy: {
    nazev: 'Zmínka bez odkazu',
    uroven: 'doporuceni',
    rada: 'Jiná karta zmíněná v textu má být odkaz [[id|Jméno]], aby se na ni dalo kliknout.',
  },
  zdroj: {
    nazev: 'Chybí zdroj',
    uroven: 'doporuceni',
    rada: 'Pole zdroj říká, odkud text karty pochází (sezení, přepis, Notion).',
  },
});

/** Karty, které popisují něco ve světě (ne záznam, sezení ani rozhodnutí). */
export const TYPY_SVETA = Object.freeze(['postava', 'npc', 'padouch', 'frakce', 'misto', 'predmet', 'bytost']);
/** Nejkratší popis karty světa (znaků bez oddílů DM a Co ví družina). */
export const MIN_POPIS = 200;
/** Delší rozdíl začátku a konce sezení je nejspíš zapomenuté Ukončit sezení. */
const MAX_DELKA_SEZENI_H = 24;

const PISMENO = '[\\p{L}\\p{N}]';
const slovo = (zdroj, priznaky = '') => new RegExp(`(?<!${PISMENO})(?:${zdroj})(?!${PISMENO})`, `u${priznaky}`);
const ODKAZ = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;

/** Vzory poznámek z přípravy a převodu: [vzor, popis]. */
const POZNAMKY = [
  [slovo('R\\d{1,2}'), 'odkaz na rozpor z převodu'],
  // „Neplatí“ jen jako poznámka „(Neplatí …)“ nebo „Neplatí: …“, ne ve větě („za odřezky se neplatí“).
  [/\(\s*[Nn]eplatí|[Nn]eplatí:/, '„neplatí“'],
  [slovo('[Dd]oplněno'), '„doplněno“'],
  [slovo('[Dd]oplnit'), '„doplnit“'],
  [slovo('[Zz] přípravy'), '„z přípravy“'],
  [slovo('[Oo]praveno z'), '„opraveno z“'],
  [slovo('variant[auyěo]?(?: [A-C])?', 'i'), 'varianta'],
  [slovo('Notion\\p{L}*'), 'Notion'],
  [/TODO|TBD|\?\?\?/, 'TODO'],
];

/** Oddíly klíče, ze kterých se berou termíny (první sloupec anglicky, druhý česky). */
/** Slova z klíče, která se v textu objevují jako součást jmen (Campaign Database). */
const NEHLEDAT = new Set(['campaign']);
const ODDILY_KLICE = ['Dovednosti', 'Stavy', 'Typy zranění', 'Akce', 'Slovníček pravidel', 'Kouzla', 'Nestvůry v dodatku B'];

/**
 * Termíny z reference/prekladovy-klic-cz.md. Kratší než 4 znaky se nehledají (Spy, Hit), aby
 * kontrola nehlásila náhody.
 * @returns {Array<{en: string, cs: string, vzor: RegExp}>}
 */
export function nacistTerminy(text) {
  const terminy = new Map();
  let oddil = null;
  for (const radek of String(text ?? '').split(/\r?\n/)) {
    const nadpis = /^##\s+(.+?)\s*$/.exec(radek);
    if (nadpis) {
      oddil = ODDILY_KLICE.includes(nadpis[1]) ? nadpis[1] : null;
      continue;
    }
    if (!oddil || !radek.startsWith('|') || /^\|\s*-/.test(radek)) continue;
    const bunky = radek.split('|').slice(1, -1).map((b) => b.replace(/[⚠*_`]/g, '').replace(/\(.*?\)/g, '').trim());
    const [en, cs] = bunky;
    if (!en || !cs || en.length < 4 || /^anglicky|^english/i.test(en) || !/^[A-Za-z][A-Za-z' -]+$/.test(en)) continue;
    if (en.toLowerCase() === cs.toLowerCase() || NEHLEDAT.has(en.toLowerCase())) continue;
    terminy.set(en.toLowerCase(), { en, cs });
  }
  return [...terminy.values()].map((t) => ({ ...t, vzor: slovo(t.en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'), 'i') }));
}

const bezDiakritiky = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const vyrez = (radek, index, delka) => {
  const od = Math.max(0, index - 40);
  const doKonce = Math.min(radek.length, index + delka + 40);
  return `${od ? '…' : ''}${radek.slice(od, doKonce).trim()}${doKonce < radek.length ? '…' : ''}`;
};

/** Text karty, který se počítá do popisu: bez DM oddílů, Co ví družina, nadpisů a komentářů. */
function popisKarty(telo) {
  let dmUroven = 0;
  let druzinaUroven = 0;
  const casti = [];
  for (const o of oddily(telo)) {
    if (o.nadpis !== null) {
      if (dmUroven && o.uroven <= dmUroven) dmUroven = 0;
      if (druzinaUroven && o.uroven <= druzinaUroven) druzinaUroven = 0;
      if (!dmUroven && jeOddilDm(o.nadpis)) dmUroven = o.uroven;
      if (!druzinaUroven && bezDiakritiky(o.nadpis) === 'co vi druzina') druzinaUroven = o.uroven;
    }
    if (dmUroven || druzinaUroven) continue;
    casti.push(o.text.replace(/^#{1,6}\s.*$/gm, ''));
  }
  return bezKomentaru(casti.join('\n')).replace(ODKAZ, (_, id, jmeno) => jmeno ?? id).replace(/[*_>#|`-]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Řádky těla bez komentářů %%…%% a bez bloků kódu, s číslem řádku. */
function radkyTextu(telo) {
  const vysledek = [];
  let vKodu = false;
  const radky = bezKomentaru(telo).split('\n');
  for (let i = 0; i < radky.length; i++) {
    if (/^\s*(```|~~~)/.test(radky[i])) vKodu = !vKodu;
    else if (!vKodu && radky[i].trim()) vysledek.push(radky[i]);
  }
  return vysledek;
}

const jeDatum = (x) => typeof x === 'string' ? /^\d{4}-\d{2}-\d{2}/.test(x) : x instanceof Date;
const datum = (x) => (x instanceof Date ? x : typeof x === 'string' ? new Date(x) : null);

/**
 * Zkontroluje kánon.
 * @param {Iterable<object>} entity karty z nacistEntitu (s polem hlavicka)
 * @param {{terminy?: Array<{en: string, cs: string, vzor: RegExp}>}} [volby]
 */
export function zkontrolovatKvalitu(entity, { terminy = [] } = {}) {
  const karty = [...entity];
  const podleId = new Map(karty.map((e) => [e.id, e]));
  const problemy = new Map(karty.map((e) => [e.id, []]));
  const pridej = (id, pravidlo, zprava) => problemy.get(id).push({ pravidlo, uroven: PRAVIDLA[pravidlo].uroven, zprava });

  // Co družina potkala: postavy hráčů a všechno, na co odkazuje hráčský kánon. Ten je celý pro
  // družinu, takže odkaz z něj na skrytou kartu vede v pohledu družiny do prázdna. (Zápis sezení
  // je poznámka DM a smí odkazovat i na to, co družina nezná.)
  const potkala = new Map();
  for (const e of karty) {
    if (e.typ !== 'kanon') continue;
    for (const cil of [...e.vazby, ...e.odkazyVTextu, ...(e.kdo ?? [])]) {
      if (cil !== e.id && !potkala.has(cil)) potkala.set(cil, e);
    }
  }
  // Jména karet světa pro zmínky bez odkazu (vlastní jména od 4 znaků, s velkým písmenem).
  const jmena = [];
  for (const e of karty) {
    if (!TYPY_SVETA.includes(e.typ)) continue;
    for (const j of new Set([e.nazev, ...e.aliases])) {
      if (j.length >= 4 && /^\p{Lu}/u.test(j)) jmena.push({ id: e.id, jmeno: j, vzor: slovo(`${j.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\p{L}{0,4}`) });
    }
  }
  const jmenaKaret = karty.map((e) => [e.nazev, ...e.aliases].join(' ').toLowerCase()).join(' ');
  const pouziteTerminy = terminy.filter((t) => !jmenaKaret.includes(t.en.toLowerCase()));
  const sezeni = karty.filter((e) => e.typ === 'sezeni' && Number.isFinite(Number(e.hlavicka?.cislo)));
  const nejvyssiSezeni = Math.max(0, ...sezeni.map((e) => Number(e.hlavicka.cislo)));

  for (const e of karty) {
    const h = e.hlavicka ?? {};
    const radky = radkyTextu(e.telo);

    if (e.typ !== 'rozhodnuti') {
      for (const r of radky) {
        // Ve výřezu jméno místo [[id|Jméno]], ať se dá číst.
        const cisty = r.replace(ODKAZ, (_, id, jmeno) => jmeno ?? id);
        for (const [vzor, popis] of POZNAMKY) {
          const m = vzor.exec(cisty);
          if (m) {
            pridej(e.id, 'poznamky', `${popis}: ${vyrez(cisty, m.index, m[0].length)}`);
            break;
          }
        }
      }
    }

    const nalezene = new Map();
    for (const r of radky) {
      const bezOdkazu = r.replace(ODKAZ, ' ');
      for (const t of pouziteTerminy) if (!nalezene.has(t.en) && t.vzor.test(bezOdkazu)) nalezene.set(t.en, t.cs);
    }
    if (nalezene.size) pridej(e.id, 'terminy', [...nalezene].map(([en, cs]) => `${en} → ${cs}`).join(', '));

    if (TYPY_SVETA.includes(e.typ)) {
      const delka = popisKarty(e.telo).length;
      if (delka < MIN_POPIS) pridej(e.id, 'popis', delka ? `Popis má jen ${delka} znaků (nejméně ${MIN_POPIS}).` : 'Karta nemá žádný popis.');
      const zdroj = potkala.get(e.id);
      if (e.typ === 'postava' || zdroj) {
        const odkud = e.typ === 'postava' ? 'Postava hráče' : `Zmiňuje ji hráčský kánon („${zdroj.nazev}“)`;
        const odkryto = (e.odkryto?.zna ?? 0) + (e.odkrytoTextu ?? 0);
        if (!e.verejne) pridej(e.id, 'druzina', `${odkud}, ale karta je pro družinu skrytá (verejne: false).`);
        else if (!odkryto) pridej(e.id, 'druzina', `${odkud}, ale v Co ví družina není odkrytá žádná odrážka.`);
      }
      if (!String(h.zdroj ?? '').trim()) pridej(e.id, 'zdroj', 'Karta nemá pole zdroj.');
    }

    if (TYPY_SVETA.includes(e.typ) || e.typ === 'kanon') {
      const chybi = chybejiciOddily(e.typ, e.telo).filter((o) => bezDiakritiky(o) !== 'co vi druzina');
      if (chybi.length) pridej(e.id, 'oddily', chybi.join(', '));
    }

    if (e.typ === 'sezeni' && sezeni.includes(e)) {
      const cislo = Number(h.cislo);
      const odehrane = Boolean(h.konec) || cislo < nejvyssiSezeni;
      if (!jeDatum(h.datum_realne)) pridej(e.id, 'sezeni', 'Chybí datum sezení (datum_realne).');
      if (odehrane) {
        const shrnuti = oddily(e.telo).find((o) => bezDiakritiky(o.nadpis) === 'shrnuti');
        if (!shrnuti || !bezKomentaru(shrnuti.text.replace(/^#.*$/m, '')).trim()) pridej(e.id, 'sezeni', 'Chybí shrnutí (oddíl Shrnutí).');
        if (!karty.some((k) => k.typ === 'kanon' && k.udaje?.sezeni === e.id)) pridej(e.id, 'sezeni', 'Sezení nemá žádný záznam hráčského kánonu.');
      }
      const zacatek = datum(h.zacatek);
      const konec = datum(h.konec);
      if (zacatek && konec && !Number.isNaN(zacatek.getTime()) && !Number.isNaN(konec.getTime())) {
        const hodin = (konec - zacatek) / 36e5;
        if (hodin > MAX_DELKA_SEZENI_H) pridej(e.id, 'sezeni', `Konec je ${Math.round(hodin / 24)} dní po začátku. Nezůstalo sezení omylem běžet?`);
      }
    }

    // Zmínky bez odkazu: jméno jiné karty světa v textu, na kterou text nikde neodkazuje.
    const odkazuje = new Set(e.odkazyVTextu);
    const text = radky.filter((r) => !/^#{1,6}\s/.test(r)).join('\n').replace(ODKAZ, ' ');
    const zminene = new Map();
    for (const j of jmena) {
      if (j.id === e.id || odkazuje.has(j.id) || zminene.has(j.id)) continue;
      if (j.vzor.test(text)) zminene.set(j.id, podleId.get(j.id).nazev);
    }
    if (zminene.size) pridej(e.id, 'odkazy', [...zminene.values()].join(', '));
  }

  const vysledekKaret = karty
    .map((e) => ({ id: e.id, nazev: e.nazev, typ: e.typ, problemy: problemy.get(e.id) }))
    .filter((k) => k.problemy.length);
  const sChybou = new Set(vysledekKaret.filter((k) => k.problemy.some((p) => p.uroven === 'chyba')).map((k) => k.id));
  const pravidla = Object.entries(PRAVIDLA).map(([id, p]) => ({
    id,
    ...p,
    karet: vysledekKaret.filter((k) => k.problemy.some((x) => x.pravidlo === id)).length,
  }));
  const vaha = (k) => k.problemy.filter((p) => p.uroven === 'chyba').length * 100 + k.problemy.length;
  return {
    karet: karty.length,
    bezChyb: karty.length - sChybou.size,
    procento: karty.length ? Math.floor(((karty.length - sChybou.size) / karty.length) * 100) : 100,
    pravidla,
    karty: vysledekKaret.sort((a, b) => vaha(b) - vaha(a) || a.nazev.localeCompare(b.nazev, 'cs')),
  };
}
