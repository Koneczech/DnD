// List postavy jako data (⚠ bod 151, DM 21. 10. 2026): kampan/postavy/<id>/list.yaml.
// Soubor drží jen to, co se nedá spočítat (vlastnosti, úrovně, zdatnosti, OČ, BV, výbava,
// útoky, kouzla, rysy). Opravy, záchrany, všech 18 dovedností, pasivní hodnoty, zdatnostní
// bonus, iniciativu, SO a útok kouzlem, kostky obnovy a pozice kouzel dopočítá Hub podle
// pravidel 2024. Pole `stated` drží hodnoty z původního listu, které s výpočtem nesedí:
// list je ukáže jako ⚠ rozpor, dokud je DM nevyřeší (smazáním řádku nebo opravou dat).
//
// Klíče souboru jsou anglicky jako list sám (DM 21. 10. 2026: celý list anglicky).
// Poznámky DM do listu nepatří (DM 21. 10. 2026, ⚠ bod 152): list vidí i družina, poznámky
// patří do karty postavy. Pole pro ně (source, notes, hp_note…) Kontrola dat ohlásí jako chybu.
// Sdílí ho server (karta, Kontrola dat) i prohlížeč (web), proto bez importů z Node.

export const SOUBOR_LISTU = 'list.yaml';

/** Vlastnosti v pořadí listu. */
export const VLASTNOSTI = Object.freeze([
  { klic: 'str', nazev: 'Strength', zkratka: 'STR' },
  { klic: 'dex', nazev: 'Dexterity', zkratka: 'DEX' },
  { klic: 'con', nazev: 'Constitution', zkratka: 'CON' },
  { klic: 'int', nazev: 'Intelligence', zkratka: 'INT' },
  { klic: 'wis', nazev: 'Wisdom', zkratka: 'WIS' },
  { klic: 'cha', nazev: 'Charisma', zkratka: 'CHA' },
]);

/** Dovednosti podle PHB 2024 a vlastnost, ze které se počítají. */
export const DOVEDNOSTI = Object.freeze([
  ['Acrobatics', 'dex'], ['Animal Handling', 'wis'], ['Arcana', 'int'], ['Athletics', 'str'],
  ['Deception', 'cha'], ['History', 'int'], ['Insight', 'wis'], ['Intimidation', 'cha'],
  ['Investigation', 'int'], ['Medicine', 'wis'], ['Nature', 'int'], ['Perception', 'wis'],
  ['Performance', 'cha'], ['Persuasion', 'cha'], ['Religion', 'int'], ['Sleight of Hand', 'dex'],
  ['Stealth', 'dex'], ['Survival', 'wis'],
].map(([nazev, vlastnost]) => Object.freeze({ nazev, vlastnost, klic: klicNazvu(nazev) })));

/** Pasivní hodnoty (10 + dovednost). */
const PASIVNI = ['Perception', 'Insight', 'Investigation'];

/** Kostka obnovy povolání. */
const KOSTKY = {
  barbarian: 12, fighter: 10, paladin: 10, ranger: 10,
  artificer: 8, bard: 8, cleric: 8, druid: 8, monk: 8, rogue: 8, warlock: 8,
  sorcerer: 6, wizard: 6,
};

/** Sesílací vlastnost povolání (výchozí, když ji list neuvede). */
const SESILACI = { artificer: 'int', bard: 'cha', cleric: 'wis', druid: 'wis', paladin: 'cha', ranger: 'wis', sorcerer: 'cha', warlock: 'cha', wizard: 'int' };
/** Plní sesilatelé (úroveň sesilatele = úroveň povolání) a poloviční (zaokrouhleno nahoru, PHB 2024). */
const PLNI = new Set(['bard', 'cleric', 'druid', 'sorcerer', 'wizard']);
const POLOVICNI = new Set(['paladin', 'ranger', 'artificer']);
/** Pozice kouzel podle úrovně sesilatele (tabulka sesilatelů s více povoláními, PHB 2024). */
const POZICE = [
  null,
  [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

/** „Animal Handling“, „animal-handling“, „animal_handling“ → „animalhandling“. */
export function klicNazvu(t) {
  return String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Číslo s pevným znaménkem: +2, −1, +0 (typografické minus jako zbytek panelu). */
export function znamenko(n) {
  if (!Number.isFinite(n)) return '';
  return n < 0 ? `−${Math.abs(n)}` : `+${n}`;
}

export const oprava = (hodnota) => Math.floor((hodnota - 10) / 2);
export const zdatnostniBonus = (uroven) => 2 + Math.floor((Math.max(1, Math.min(20, uroven)) - 1) / 4);

const jeMapa = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = (x) => (x === null || x === undefined ? '' : String(x).trim());
const seznam = (x) => (Array.isArray(x) ? x : x === null || x === undefined || x === '' ? [] : [x]);
const texty = (x) => seznam(x).map(text).filter(Boolean);
/** „+4“, 4, „−1“ → číslo; jinak null. */
function cislo(x) {
  if (typeof x === 'number' && Number.isFinite(x)) return x;
  const m = /^\s*([+\-−]?)\s*(\d+)\s*$/.exec(String(x ?? ''));
  if (!m) return null;
  return (m[1] === '-' || m[1] === '−' ? -1 : 1) * Number(m[2]);
}
const klicVlastnosti = (x) => {
  const k = klicNazvu(x);
  return VLASTNOSTI.find((v) => v.klic === k || klicNazvu(v.nazev) === k)?.klic ?? null;
};
const nazevUrovne = (u) => (u === 0 ? 'Cantrip' : `${u}${['', 'st', 'nd', 'rd'][u] ?? 'th'} Level`);

/**
 * Položka výbavy: „Rope“, „Arrows x20“, { name: Arrows, qty: 20 }.
 * @returns {{nazev: string, pocet: number, poznamka: string}|null}
 */
function polozkaVybavy(x) {
  if (jeMapa(x)) {
    const nazev = text(x.name);
    if (!nazev) return null;
    return { nazev, pocet: Math.max(1, cislo(x.qty) ?? 1), poznamka: text(x.note) };
  }
  const t = text(x);
  if (!t) return null;
  const m = /^(.*?)\s*[x×]\s*(\d+)$/i.exec(t);
  return m ? { nazev: m[1], pocet: Number(m[2]), poznamka: '' } : { nazev: t, pocet: 1, poznamka: '' };
}

/** Rys: „Wild Shape: 2/Long Rest“, { name, text }. */
function polozkaRysu(x) {
  if (jeMapa(x)) {
    const nazev = text(x.name);
    return nazev || text(x.text) ? { nazev, text: text(x.text) } : null;
  }
  const t = text(x);
  if (!t) return null;
  const i = t.indexOf(':');
  return i > 0 && i < 60 ? { nazev: t.slice(0, i).trim(), text: t.slice(i + 1).trim() } : { nazev: t, text: '' };
}

/**
 * Spočítá list postavy z dat list.yaml. Nikdy nevyhodí výjimku: chyby dat vrátí v `chyby`
 * (Kontrola dat je ohlásí jako chyby), rozpory s původním listem v `rozpory` (varování).
 * @param {object} d obsah list.yaml
 * @returns {object} list připravený k vykreslení
 */
export function spocitatList(d) {
  const chyby = [];
  const rozpory = [];
  if (!jeMapa(d)) return { chyby: ['list.yaml musí být mapa klíč: hodnota'], rozpory, prazdny: true };
  if (d.schema !== undefined && d.schema !== 1) chyby.push(`Neznámá verze schématu ${d.schema}`);
  // Poznámky DM do listu nepatří (⚠ bod 152).
  const poleDm = [
    ['source', d.source], ['notes', d.notes],
    ['combat.hp_note', jeMapa(d.combat) ? d.combat.hp_note : undefined],
    ['skills.notes', jeMapa(d.skills) ? d.skills.notes : undefined],
    ['equipment.notes', jeMapa(d.equipment) ? d.equipment.notes : undefined],
    ...seznam(d.spellcasting).filter(jeMapa).map((s) => ['spellcasting.notes', s.notes]),
  ].filter(([, x]) => (Array.isArray(x) ? x.length : text(x))).map(([pole]) => pole);
  for (const pole of new Set(poleDm)) {
    chyby.push(`${pole}: poznámky do listu nepatří, list vidí i družina; napiš je do karty postavy (oddíl DM)`);
  }

  // Povolání a úroveň
  const tridy = [];
  for (const t of seznam(d.classes)) {
    const nazev = text(jeMapa(t) ? t.name : t);
    const uroven = cislo(jeMapa(t) ? t.level : null);
    if (!nazev) continue;
    if (!uroven || uroven < 1 || uroven > 20) chyby.push(`classes: ${nazev} potřebuje level 1–20`);
    tridy.push({ nazev, uroven: uroven && uroven > 0 ? Math.min(uroven, 20) : 1, podtrida: text(jeMapa(t) ? t.subclass : '') });
  }
  if (!tridy.length) chyby.push('Chybí classes (povolání a úroveň), např. - { name: Druid, level: 3 }');
  const uroven = Math.max(1, tridy.reduce((s, t) => s + t.uroven, 0));
  const zb = zdatnostniBonus(uroven);

  // Vlastnosti
  const hodnoty = {};
  const vstupVlastnosti = jeMapa(d.abilities) ? d.abilities : {};
  for (const [k, v] of Object.entries(vstupVlastnosti)) {
    const klic = klicVlastnosti(k);
    if (!klic) chyby.push(`abilities: neznámá vlastnost „${k}“ (str, dex, con, int, wis, cha)`);
    else if (cislo(v) === null || cislo(v) < 1 || cislo(v) > 30) chyby.push(`abilities.${k} musí být číslo 1–30`);
    else hodnoty[klic] = cislo(v);
  }
  for (const v of VLASTNOSTI) if (!(v.klic in hodnoty)) chyby.push(`abilities: chybí ${v.klic}`);
  const op = (klic) => (klic in hodnoty ? oprava(hodnoty[klic]) : 0);

  /** Bonus z dat: číslo, „pb“ (zdatnostní bonus) nebo „half pb“. */
  const bonus = (x, kde) => {
    if (x === undefined || x === null || x === '') return 0;
    const k = klicNazvu(x);
    if (k === 'pb') return zb;
    if (k === 'halfpb') return Math.floor(zb / 2);
    const n = cislo(x);
    if (n === null) chyby.push(`${kde}: bonus musí být číslo nebo pb`);
    return n ?? 0;
  };

  const uvedeno = jeMapa(d.stated) ? d.stated : {};
  const uvedenoKlice = new Map(Object.keys(uvedeno).map((k) => [klicNazvu(k), k]));
  const pouziteUvedene = new Set();
  /** Hodnota z původního listu ke klíči (save.cha, skill.persuasion…); nesedí-li, zapíše rozpor. */
  const porovnat = (klic, nazev, spocteno, format = znamenko) => {
    const k = uvedenoKlice.get(klicNazvu(klic));
    if (k === undefined) return null;
    pouziteUvedene.add(k);
    const puvodni = uvedeno[k];
    const shoda = typeof spocteno === 'number' ? cislo(puvodni) === spocteno : klicNazvu(puvodni) === klicNazvu(spocteno);
    if (shoda) return null;
    const r = { klic: k, nazev, uvedeno: typeof spocteno === 'number' && cislo(puvodni) !== null ? format(cislo(puvodni)) : text(puvodni), spocteno: typeof spocteno === 'number' ? format(spocteno) : String(spocteno) };
    rozpory.push(r);
    return r;
  };

  const zbRozpor = porovnat('proficiency_bonus', 'Proficiency Bonus', zb);

  // Záchrany
  const zachrany = jeMapa(d.saves) ? d.saves : {};
  const zdatneZachrany = new Set();
  for (const x of seznam(zachrany.proficient)) {
    const k = klicVlastnosti(x);
    if (k) zdatneZachrany.add(k);
    else chyby.push(`saves.proficient: neznámá vlastnost „${x}“`);
  }
  const bonusZachran = jeMapa(zachrany.bonus) ? zachrany.bonus : {};
  const vlastnosti = VLASTNOSTI.map((v) => {
    const extra = Object.entries(bonusZachran).filter(([k]) => klicVlastnosti(k) === v.klic).reduce((s, [, b]) => s + bonus(b, `saves.bonus.${v.klic}`), 0);
    const zachrana = op(v.klic) + (zdatneZachrany.has(v.klic) ? zb : 0) + extra;
    return {
      ...v,
      hodnota: hodnoty[v.klic] ?? null,
      oprava: v.klic in hodnoty ? op(v.klic) : null,
      zachrana,
      zdatnaZachrana: zdatneZachrany.has(v.klic),
      rozpor: porovnat(`save.${v.klic}`, `${v.nazev} save`, zachrana),
    };
  });

  // Dovednosti
  const dov = jeMapa(d.skills) ? d.skills : {};
  const najitDovednost = (x, kde) => {
    const k = klicNazvu(x);
    const s = DOVEDNOSTI.find((s) => s.klic === k);
    if (!s) chyby.push(`${kde}: neznámá dovednost „${x}“`);
    return s?.klic;
  };
  const zdatne = new Set(seznam(dov.proficient).map((x) => najitDovednost(x, 'skills.proficient')).filter(Boolean));
  const expertiza = new Set(seznam(dov.expertise).map((x) => najitDovednost(x, 'skills.expertise')).filter(Boolean));
  const vsestrannost = dov.jack_of_all_trades === true;
  const bonusDovednosti = {};
  for (const [k, b] of Object.entries(jeMapa(dov.bonus) ? dov.bonus : {})) {
    const s = najitDovednost(k, 'skills.bonus');
    if (s) bonusDovednosti[s] = (bonusDovednosti[s] ?? 0) + bonus(b, `skills.bonus.${k}`);
  }
  const dovednosti = DOVEDNOSTI.map((s) => {
    const stupen = expertiza.has(s.klic) ? 2 : zdatne.has(s.klic) ? 1 : vsestrannost ? 0.5 : 0;
    const hodnota = op(s.vlastnost) + Math.floor(zb * stupen) + (bonusDovednosti[s.klic] ?? 0);
    return {
      nazev: s.nazev,
      klic: s.klic,
      vlastnost: VLASTNOSTI.find((v) => v.klic === s.vlastnost).zkratka,
      stupen,
      bonus: hodnota,
      extra: bonusDovednosti[s.klic] ?? 0,
      rozpor: porovnat(`skill.${s.klic}`, s.nazev, hodnota),
    };
  });
  const pasivni = PASIVNI.map((n) => {
    const s = dovednosti.find((x) => x.nazev === n);
    const hodnota = 10 + s.bonus;
    return { nazev: `Passive ${n}`, hodnota, rozpor: porovnat(`passive.${klicNazvu(n)}`, `Passive ${n}`, hodnota, String) };
  });

  // Boj
  const boj = jeMapa(d.combat) ? d.combat : {};
  const iniciativa = op('dex') + bonus(boj.initiative_bonus, 'combat.initiative_bonus');
  const iniciativaRozpor = porovnat('initiative', 'Initiative', iniciativa);
  const oc = cislo(boj.ac);
  if (oc === null) chyby.push('combat.ac: chybí obranné číslo (číslo)');
  const bv = cislo(boj.hp);
  if (bv === null) chyby.push('combat.hp: chybí maximum bodů výdrže (číslo)');
  const rychlost = [];
  const vstupRychlosti = jeMapa(boj.speed) ? boj.speed : boj.speed !== undefined ? { walk: boj.speed } : {};
  for (const [druh, ft] of Object.entries(vstupRychlosti)) {
    const n = cislo(String(ft).replace(/\s*ft\.?$/i, ''));
    if (n === null) chyby.push(`combat.speed.${druh} musí být číslo (stopy)`);
    else rychlost.push({ druh: druh === 'walk' ? '' : druh, ft: n });
  }
  if (!rychlost.length) chyby.push('combat.speed: chybí rychlost, např. speed: { walk: 30 }');
  // Kostky obnovy podle povolání; neznámé povolání bere hodnotu z dat.
  const kostkyPodle = new Map();
  let kostkyZnami = true;
  for (const t of tridy) {
    const k = KOSTKY[klicNazvu(t.nazev)];
    if (!k) kostkyZnami = false;
    else kostkyPodle.set(k, (kostkyPodle.get(k) ?? 0) + t.uroven);
  }
  const kostkyVypoctene = [...kostkyPodle].sort((a, b) => b[0] - a[0]).map(([k, n]) => `${n}d${k}`).join(' + ');
  const kostky = text(boj.hit_dice) && !kostkyZnami ? text(boj.hit_dice) : kostkyVypoctene || text(boj.hit_dice);
  const kostkyRozpor = kostkyZnami && text(boj.hit_dice) && klicNazvu(boj.hit_dice) !== klicNazvu(kostkyVypoctene)
    ? (rozpory.push({ klic: 'combat.hit_dice', nazev: 'Hit Dice', uvedeno: text(boj.hit_dice), spocteno: kostkyVypoctene }), rozpory.at(-1))
    : null;

  // Kouzla
  const kouzla = [];
  const urovenSesilatele = tridy.reduce((s, t) => s + (PLNI.has(klicNazvu(t.nazev)) ? t.uroven : POLOVICNI.has(klicNazvu(t.nazev)) ? Math.ceil(t.uroven / 2) : 0), 0);
  const poziceVypoctene = urovenSesilatele ? POZICE[Math.min(20, urovenSesilatele)] : null;
  const sesileni = seznam(d.spellcasting).filter(jeMapa);
  sesileni.forEach((s, i) => {
    const trida = text(s.class);
    const vl = klicVlastnosti(s.ability) ?? SESILACI[klicNazvu(trida)] ?? null;
    if (!vl) chyby.push(`spellcasting${sesileni.length > 1 ? `[${i}]` : ''}: chybí ability (sesílací vlastnost)`);
    const so = 8 + zb + (vl ? op(vl) : 0);
    const utok = zb + (vl ? op(vl) : 0);
    const pripona = sesileni.length > 1 ? `.${klicNazvu(trida)}` : '';
    // Pozice: z tabulky sesilatelů; vlastní (`slots`) jen tam, kde tabulka nic neříká (Warlock…).
    const vlastniPozice = jeMapa(s.slots) ? s.slots : {};
    const pozice = [];
    if (poziceVypoctene && i === 0) {
      poziceVypoctene.forEach((pocet, j) => pozice.push({ uroven: j + 1, pocet, rozpor: porovnat(`slots.${j + 1}`, `${nazevUrovne(j + 1)} slots`, pocet, String) }));
    } else {
      for (const [u, pocet] of Object.entries(vlastniPozice)) if (cislo(u) && cislo(pocet) !== null) pozice.push({ uroven: cislo(u), pocet: cislo(pocet), rozpor: null });
    }
    const seznamKouzel = [];
    for (const k of seznam(s.spells)) {
      const nazev = text(jeMapa(k) ? k.name : k);
      if (!nazev) continue;
      const u = jeMapa(k) ? cislo(k.level) ?? 0 : 0;
      if (u < 0 || u > 9) chyby.push(`spellcasting: ${nazev} má level mimo 0–9`);
      seznamKouzel.push({
        nazev,
        uroven: Math.max(0, Math.min(9, u)),
        zdroj: text(jeMapa(k) ? k.source : ''),
        ritual: jeMapa(k) && k.ritual === true,
        poznamka: text(jeMapa(k) ? k.note : ''),
      });
    }
    const urovne = [...new Set(seznamKouzel.map((k) => k.uroven))].sort((a, b) => a - b);
    kouzla.push({
      trida,
      vlastnost: vl ? VLASTNOSTI.find((v) => v.klic === vl).zkratka : '',
      so,
      utok,
      soRozpor: porovnat(`spell_dc${pripona}`, `${trida} Spell Save DC`, so, String),
      utokRozpor: porovnat(`spell_attack${pripona}`, `${trida} Spell Attack`, utok),
      pozice,
      podleUrovne: urovne.map((u) => ({ uroven: u, nazev: u === 0 ? 'Cantrips' : nazevUrovne(u), pozice: pozice.find((p) => p.uroven === u)?.pocet ?? null, kouzla: seznamKouzel.filter((k) => k.uroven === u) })),
    });
  });

  // Útoky (stejné řádky se sloučí do jednoho s počtem)
  const utoky = [];
  for (const a of seznam(d.attacks).filter(jeMapa)) {
    const nazev = text(a.name);
    if (!nazev) continue;
    const zasah = cislo(a.hit);
    utoky.push({
      nazev,
      pocet: Math.max(1, cislo(a.count) ?? 1),
      zasah: zasah !== null ? znamenko(zasah) : text(a.hit),
      zraneni: text(a.damage),
      druh: text(a.type),
      dosah: text(a.range),
      poznamka: text(a.notes),
    });
  }

  // Zdatnosti, rysy, výbava
  const zd = jeMapa(d.proficiencies) ? d.proficiencies : {};
  const zdatnosti = [['Armor', zd.armor], ['Weapons', zd.weapons], ['Tools', zd.tools], ['Languages', zd.languages]]
    .map(([nazev, x]) => ({ nazev, polozky: texty(x) }))
    .filter((z) => z.polozky.length);
  const rysy = seznam(d.features).filter(jeMapa).map((g) => ({
    nazev: text(g.group),
    polozky: seznam(g.items).map(polozkaRysu).filter(Boolean),
  })).filter((g) => g.nazev || g.polozky.length);
  const vyb = jeMapa(d.equipment) ? d.equipment : { items: d.equipment };
  const vybava = {
    polozky: seznam(vyb.items).map(polozkaVybavy).filter(Boolean),
    mince: Object.entries(jeMapa(vyb.coins) ? vyb.coins : {}).map(([k, v]) => ({ mena: k.toUpperCase(), pocet: cislo(v) })).filter((m) => m.pocet !== null),
  };

  for (const k of Object.keys(uvedeno)) {
    if (!pouziteUvedene.has(k) && k !== 'combat.hit_dice') chyby.push(`stated.${k}: Hub tuto hodnotu nepočítá, nemá s čím ji porovnat`);
  }

  return {
    chyby,
    rozpory,
    verejne: d.public === true,
    hlava: {
      tridy: tridy.map((t) => `${t.nazev} ${t.uroven}${t.podtrida ? ` (${t.podtrida})` : ''}`).join(' / '),
      tridyKratce: tridy.map((t) => `${t.nazev} ${t.uroven}`).join(' / '),
      podtridy: tridy.map((t) => t.podtrida).filter(Boolean),
      uroven,
      druh: text(d.species),
      zazemi: text(d.background),
      xp: text(d.xp),
    },
    zb,
    zbRozpor,
    iniciativa,
    iniciativaRozpor,
    oc,
    ocPoznamky: texty(boj.ac_notes),
    bv,
    kostky,
    kostkyRozpor,
    rychlost,
    rychlostPoznamka: text(boj.speed_note),
    odolnosti: texty(boj.resistances),
    imunity: texty(boj.immunities),
    vlastnosti,
    zachranyPoznamky: texty(zachrany.notes),
    dovednosti,
    vsestrannost,
    pasivni,
    smysly: texty(d.senses),
    zdatnosti,
    rysy,
    vybava,
    utoky,
    kouzla,
  };
}

/**
 * List pro pohled družiny: bez chyb v souboru a rozporů s původním listem (to je práce DM).
 * Družina list vidí jen s `public: true` (rozhoduje volající).
 */
export function listProDruzinu(l) {
  const bez = (x) => ({ ...x, rozpor: null });
  return {
    ...l,
    chyby: [], rozpory: [],
    zbRozpor: null, iniciativaRozpor: null, kostkyRozpor: null,
    vlastnosti: l.vlastnosti.map(bez), dovednosti: l.dovednosti.map(bez), pasivni: l.pasivni.map(bez),
    kouzla: l.kouzla.map((k) => ({ ...k, soRozpor: null, utokRozpor: null, pozice: k.pozice.map(bez) })),
  };
}
