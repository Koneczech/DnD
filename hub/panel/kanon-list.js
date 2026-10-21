// List postavy z dat list.yaml (⚠ bod 151): rozvržení podle D&D Beyond, celé anglicky
// (DM 21. 10. 2026). Nahoře hlavička, pak pás šesti vlastností a bojových hodnot, pod ním tři
// sloupce: záchrany, smysly, obrana a zdatnosti; dovednosti; záložky Actions, Spells, Inventory,
// Features & Traits a Notes (jen DM). Sloupce se řídí šířkou listu (container queries ve styly.css).
// Hodnoty počítá sdilene/list-postavy-data.js na serveru; tady se jen kreslí.
// Rozpory s původním listem (pole stated) vidí DM jako jantarovou hodnotu s ⚠.
import { el } from '/panel/kanon-spolecne.js';

/** Poslední otevřená záložka listu pro každou postavu (jen v paměti stránky). */
const zalozky = new Map();

const ZALOZKY = [
  ['actions', 'Actions'],
  ['spells', 'Spells'],
  ['inventory', 'Inventory'],
  ['features', 'Features & Traits'],
  ['notes', 'Notes'],
];

const titulekRozporu = (r) => (r ? `Original sheet: ${r.uvedeno} · by the rules: ${r.spocteno}` : null);

/** Hodnota s případným rozporem (jen DM ho dostane od serveru). */
function hodnota(text, rozpor, trida = '') {
  return el('span', { className: `${trida}${rozpor ? ' ls-rozpor' : ''}`.trim(), title: titulekRozporu(rozpor) }, text, rozpor ? el('sup', { className: 'ls-rozpor-znak', textContent: '⚠' }) : null);
}

/** Tečka zdatnosti: prázdná, poloviční (Jack of All Trades), plná, dvojitá (expertiza). */
function tecka(stupen) {
  const druh = stupen >= 2 ? 'expertiza' : stupen >= 1 ? 'zdatnost' : stupen > 0 ? 'polovicni' : 'zadna';
  const popis = { expertiza: 'Expertise', zdatnost: 'Proficient', polovicni: 'Half proficiency (Jack of All Trades)', zadna: 'Not proficient' }[druh];
  return el('span', { className: `ls-tecka ${druh}`, title: popis, 'aria-label': popis });
}

const karticka = (nadpis, ...obsah) => el('section', { className: 'ls-karta' }, el('h3', { className: 'ls-nadpis', textContent: nadpis }), ...obsah);
const poznamky = (seznam, trida = 'ls-poznamka') => (seznam?.length ? seznam.map((t) => el('p', { className: trida, textContent: t })) : []);

/** Bojová dlaždice v pásu nahoře. */
function dlazdice(popisek, obsah, { velka = false, pod = null, title = null } = {}) {
  return el('div', { className: `ls-dlazdice${velka ? ' velka' : ''}`, title },
    el('span', { className: 'ls-popisek', textContent: popisek }),
    el('strong', { className: 'ls-cislo' }, obsah),
    pod ? el('span', { className: 'ls-pod', textContent: pod }) : null);
}

function hlavicka(l, e, portret) {
  const radek = [l.hlava.druh, l.hlava.zazemi ? `${l.hlava.zazemi} background` : '', `Level ${l.hlava.uroven}`, l.hlava.xp ? `XP: ${l.hlava.xp}` : '']
    .filter(Boolean).join(' · ');
  return el('header', { className: 'ls-hlava' },
    portret ? el('img', { className: 'ls-portret', src: portret, alt: '' }) : null,
    // Jméno je v hlavičce stránky nad záložkami, list začíná povoláním.
    el('div', { className: 'ls-jmeno' },
      el('p', { className: 'ls-tridy', textContent: l.hlava.tridy }),
      el('p', { className: 'ls-radek', textContent: radek })),
    e.udaje?.hrac ? el('div', { className: 'ls-hrac' }, el('span', { className: 'ls-popisek', textContent: 'Player' }), el('strong', { textContent: e.udaje.hrac })) : null);
}

function bojovyPas(l) {
  const rychlost = l.rychlost.map((r) => (r.druh ? `${r.druh} ${r.ft} ft` : `${r.ft} ft`));
  return el('div', { className: 'ls-boj' },
    dlazdice('Armor Class', String(l.oc ?? '—'), { velka: true, title: l.ocPoznamky.join('\n') || null, pod: l.ocPoznamky.length > 1 ? `${l.ocPoznamky.length} variants` : null }),
    dlazdice('Hit Points', String(l.bv ?? '—'), { velka: true, pod: 'max' }),
    dlazdice('Initiative', hodnota(znamenko(l.iniciativa), l.iniciativaRozpor)),
    dlazdice('Speed', rychlost[0] ?? '—', { pod: rychlost.slice(1).join(', ') || null, title: l.rychlostPoznamka || null }),
    dlazdice('Proficiency', hodnota(znamenko(l.zb), l.zbRozpor), { pod: 'bonus' }),
    dlazdice('Hit Dice', hodnota(l.kostky || '—', l.kostkyRozpor)));
}

function vlastnosti(l) {
  return el('div', { className: 'ls-vlastnosti' }, l.vlastnosti.map((v) => el('div', { className: 'ls-vlastnost', title: v.nazev },
    // Na úzkém listu (telefon) zkratka, jinak celý název.
    el('span', { className: 'ls-popisek' }, el('span', { className: 'ls-dlouhy', textContent: v.nazev }), el('span', { className: 'ls-kratky', textContent: v.zkratka })),
    el('strong', { className: 'ls-oprava', textContent: v.oprava === null ? '—' : znamenko(v.oprava) }),
    el('span', { className: 'ls-skore', textContent: v.hodnota ?? '—' }))));
}

function zachrany(l) {
  return karticka('Saving Throws',
    el('ul', { className: 'ls-radky' }, l.vlastnosti.map((v) => el('li', {},
      tecka(v.zdatnaZachrana ? 1 : 0), el('span', { className: 'ls-zkratka', textContent: v.zkratka }), el('span', { className: 'ls-nazev', textContent: v.nazev }), hodnota(znamenko(v.zachrana), v.rozpor, 'ls-bonus')))),
    poznamky(l.zachranyPoznamky, 'ls-vyhoda'));
}

function smysly(l) {
  return karticka('Senses',
    el('ul', { className: 'ls-radky' }, l.pasivni.map((p) => el('li', {}, el('span', { className: 'ls-nazev', textContent: p.nazev }), hodnota(String(p.hodnota), p.rozpor, 'ls-bonus')))),
    l.smysly.length ? el('p', { className: 'ls-seznam', textContent: l.smysly.join(', ') }) : null);
}

function obrana(l) {
  if (!l.odolnosti.length && !l.imunity.length && !l.ocPoznamky.length) return null;
  return karticka('Defenses',
    l.ocPoznamky.length ? el('div', { className: 'ls-zdatnost' }, el('span', { className: 'ls-popisek', textContent: 'Armor Class' }),
      el('ul', { className: 'ls-varianty' }, l.ocPoznamky.map((t) => el('li', { textContent: t })))) : null,
    l.odolnosti.length ? el('p', { className: 'ls-seznam' }, el('b', { textContent: 'Resistances: ' }), l.odolnosti.join(', ')) : null,
    l.imunity.length ? el('p', { className: 'ls-seznam' }, el('b', { textContent: 'Immunities: ' }), l.imunity.join(', ')) : null);
}

function zdatnosti(l) {
  if (!l.zdatnosti.length) return null;
  return karticka('Proficiencies & Training', l.zdatnosti.map((z) => el('div', { className: 'ls-zdatnost' },
    el('span', { className: 'ls-popisek', textContent: z.nazev }), el('p', { textContent: z.polozky.join(', ') }))));
}

function dovednosti(l, dm) {
  return karticka('Skills',
    el('ul', { className: 'ls-radky ls-dovednosti' }, l.dovednosti.map((s) => el('li', { className: s.stupen >= 1 ? 'zdatna' : '' },
      tecka(s.stupen), el('span', { className: 'ls-zkratka', textContent: s.vlastnost }), el('span', { className: 'ls-nazev', textContent: s.nazev, title: s.extra ? `includes ${znamenko(s.extra)} bonus` : null }),
      hodnota(znamenko(s.bonus), s.rozpor, 'ls-bonus')))),
    el('p', { className: 'ls-legenda' },
      el('span', {}, tecka(1), 'proficient'),
      el('span', {}, tecka(2), 'expertise'),
      l.vsestrannost ? el('span', {}, tecka(0.5), 'Jack of All Trades') : null),
    dm ? poznamky(l.dovednostiPoznamky) : null);
}

function utoky(l) {
  const radky = l.utoky.map((a) => el('tr', {},
    el('td', {}, el('strong', { textContent: a.nazev }), a.pocet > 1 ? el('span', { className: 'ls-pocet', textContent: ` ×${a.pocet}` }) : null),
    el('td', { textContent: a.dosah ? `${a.dosah} ft` : '—' }),
    el('td', {}, a.zasah ? el('span', { className: 'ls-zasah', textContent: a.zasah }) : '—'),
    el('td', {}, el('span', { className: 'ls-zraneni', textContent: a.zraneni || '—' }), a.druh ? el('span', { className: 'ls-druh', textContent: ` ${a.druh}` }) : null),
    el('td', { className: 'ls-vlastnosti-zbrane', textContent: a.poznamka || '' })));
  const sesilani = l.kouzla.map((k) => el('p', { className: 'ls-sesilani' },
    el('b', { textContent: k.trida || 'Spellcasting' }), ` · ${k.vlastnost} · Spell Attack `, hodnota(znamenko(k.utok), k.utokRozpor), ' · Save DC ', hodnota(String(k.so), k.soRozpor)));
  return [
    l.utoky.length
      ? el('div', { className: 'ls-tabulka' }, el('table', {},
        el('thead', {}, el('tr', {}, ['Attack', 'Range', 'Hit', 'Damage', 'Notes'].map((t) => el('th', { textContent: t })))),
        el('tbody', {}, radky)))
      : el('p', { className: 'ls-prazdne', textContent: 'No attacks on the sheet.' }),
    sesilani,
  ];
}

function kouzla(l, dm) {
  if (!l.kouzla.length) return el('p', { className: 'ls-prazdne', textContent: 'No spellcasting.' });
  return l.kouzla.map((k) => el('div', { className: 'ls-kouzla' },
    el('div', { className: 'ls-sesilani-hlava' },
      dlazdice('Ability', k.vlastnost || '—'),
      dlazdice('Spell Attack', hodnota(znamenko(k.utok), k.utokRozpor)),
      dlazdice('Save DC', hodnota(String(k.so), k.soRozpor)),
      el('p', { className: 'ls-trida-kouzel', textContent: k.trida })),
    k.podleUrovne.map((u) => {
      const pozice = k.pozice.find((p) => p.uroven === u.uroven);
      return el('div', { className: 'ls-uroven-kouzel' },
        el('h4', {}, u.nazev, pozice ? el('span', { className: 'ls-pozice' }, hodnota(`${pozice.pocet} slot${pozice.pocet === 1 ? '' : 's'}`, pozice.rozpor), ' ', el('span', { className: 'ls-krouzky', 'aria-hidden': 'true', textContent: '○'.repeat(pozice.pocet) })) : u.uroven === 0 ? el('span', { className: 'ls-pozice', textContent: 'at will' }) : null),
        el('ul', { className: 'ls-seznam-kouzel' }, u.kouzla.map((s) => el('li', {},
          el('strong', { textContent: s.nazev }),
          s.ritual ? el('span', { className: 'ls-znacka', title: 'Ritual', textContent: 'R' }) : null,
          s.zdroj ? el('span', { className: 'ls-zdroj', textContent: s.zdroj }) : null,
          s.poznamka ? el('span', { className: 'ls-pozn-kouzla', textContent: s.poznamka }) : null))));
    }),
    // Pozice bez kouzel dané úrovně (Druid vybírá připravená kouzla po odpočinku).
    k.pozice.filter((p) => !k.podleUrovne.some((u) => u.uroven === p.uroven)).length
      ? el('p', { className: 'ls-seznam' }, el('b', { textContent: 'Other slots: ' }), k.pozice.filter((p) => !k.podleUrovne.some((u) => u.uroven === p.uroven)).map((p) => `level ${p.uroven}: ${p.pocet}`).join(', '))
      : null,
    dm ? poznamky(k.poznamky) : null));
}

function vybava(l, dm) {
  const v = l.vybava;
  return [
    v.mince.length ? el('div', { className: 'ls-mince' }, v.mince.map((m) => el('span', { className: 'ls-minca' }, el('strong', { textContent: m.pocet }), ` ${m.mena}`))) : null,
    v.polozky.length
      ? el('ul', { className: 'ls-vybava' }, v.polozky.map((p) => el('li', { title: p.poznamka || null }, el('span', { textContent: p.nazev }), p.pocet > 1 ? el('span', { className: 'ls-pocet', textContent: `×${p.pocet}` }) : null)))
      : el('p', { className: 'ls-prazdne', textContent: 'No equipment on the sheet.' }),
    dm ? poznamky(l.vybavaPoznamky) : null,
  ];
}

function rysy(l) {
  if (!l.rysy.length) return el('p', { className: 'ls-prazdne', textContent: 'No features on the sheet.' });
  return l.rysy.map((g) => el('div', { className: 'ls-skupina-rysu' },
    g.nazev ? el('h4', { textContent: g.nazev }) : null,
    el('ul', { className: 'ls-rysy' }, g.polozky.map((r) => el('li', {}, el('strong', { textContent: r.nazev }), r.text ? el('span', { textContent: ` ${r.text}` }) : null)))));
}

function poznamkyDm(l) {
  const bloky = [
    ['Source', l.zdroj ? [l.zdroj] : []],
    ['Hit Points', l.bvPoznamka ? [l.bvPoznamka] : []],
    ['Skills', l.dovednostiPoznamky],
    ['Spells', l.kouzla.flatMap((k) => k.poznamky)],
    ['Inventory', l.vybavaPoznamky],
    ['Other', l.poznamky],
  ].filter(([, t]) => t.length);
  if (!bloky.length) return el('p', { className: 'ls-prazdne', textContent: 'No notes.' });
  return bloky.map(([nadpis, t]) => el('div', { className: 'ls-podkarta' }, el('h4', { textContent: nadpis }), poznamky(t)));
}

/** Upozornění pro DM: chyby v list.yaml a rozpory s původním listem (česky, je to práce Hubu). */
function upozorneni(l, souborListu, odkazUpravit) {
  if (!l.chyby?.length && !l.rozpory?.length) return null;
  return el('div', { className: 'ls-upozorneni', role: 'status' },
    l.chyby.length ? el('p', {}, el('strong', { textContent: `Chyba v listu (${l.chyby.length}): ` }), l.chyby.join(' · ')) : null,
    l.rozpory.length ? el('p', {}, el('strong', { textContent: `⚠ Rozpor s původním listem (${l.rozpory.length}): ` }),
      l.rozpory.map((r) => `${r.nazev} — v listu ${r.uvedeno}, podle pravidel ${r.spocteno}`).join(' · ')) : null,
    el('p', { className: 'ls-jak' }, `Hub ukazuje hodnotu podle pravidel. Až rozhodneš, smaž v ${souborListu} řádek pod stated (nebo oprav data). `,
      odkazUpravit ? el('a', { href: odkazUpravit, target: '_blank', rel: 'noopener', textContent: 'Upravit na GitHubu' }) : null));
}

/**
 * Celý list postavy.
 * @param {object} l list ze serveru (karta.list)
 * @param {{e: object, portret: string|null, dm: boolean, souborListu: string, odkazUpravit: string|null}} o
 */
export function vykreslitList(l, { e, portret, dm, souborListu, odkazUpravit }) {
  if (l.chybaSouboru) {
    return el('section', { className: 'ls' }, el('div', { className: 'ls-upozorneni', role: 'alert' },
      el('p', {}, el('strong', { textContent: 'List postavy nejde přečíst: ' }), l.chybaSouboru),
      el('p', { className: 'ls-jak', textContent: `Oprav soubor ${souborListu}; Systém → Kontrola dat ukáže, kde je chyba.` })));
  }
  const nabidka = ZALOZKY.filter(([id]) => id !== 'notes' || dm);
  let aktivni = zalozky.get(e.id);
  if (!nabidka.some(([id]) => id === aktivni)) aktivni = 'actions';
  const obsahZalozky = el('div', { className: 'ls-obsah-zalozky', role: 'tabpanel' });
  const tlacitka = nabidka.map(([id, nazev]) => el('button', { type: 'button', role: 'tab', className: 'ls-zalozka', textContent: nazev, 'data-zalozka': id }));
  const prepnout = (id) => {
    aktivni = id;
    zalozky.set(e.id, id);
    for (const t of tlacitka) {
      const ano = t.dataset.zalozka === id;
      t.classList.toggle('aktivni', ano);
      t.setAttribute('aria-selected', String(ano));
    }
    const kreslit = { actions: () => utoky(l), spells: () => kouzla(l, dm), inventory: () => vybava(l, dm), features: () => rysy(l), notes: () => poznamkyDm(l) }[id];
    obsahZalozky.replaceChildren(...[kreslit()].flat(2).filter(Boolean));
  };
  for (const t of tlacitka) t.addEventListener('click', () => prepnout(t.dataset.zalozka));
  prepnout(aktivni);
  return el('section', { className: 'ls', 'aria-label': 'Character sheet' },
    hlavicka(l, e, portret),
    dm ? upozorneni(l, souborListu, odkazUpravit) : null,
    // Na širokém listu vlastnosti a bojové hodnoty vedle sebe, na užším pod sebou.
    el('div', { className: 'ls-souhrn' }, vlastnosti(l), bojovyPas(l)),
    el('div', { className: 'ls-mrizka' },
      el('div', { className: 'ls-sloupec' }, zachrany(l), smysly(l), obrana(l), zdatnosti(l)),
      el('div', { className: 'ls-sloupec' }, dovednosti(l, dm)),
      el('div', { className: 'ls-sloupec ls-hlavni' },
        el('section', { className: 'ls-karta ls-zalozky-karta' }, el('div', { className: 'ls-zalozky', role: 'tablist' }, tlacitka), obsahZalozky))),
    dm ? el('p', { className: 'poznamka ls-zapati' }, `Data: ${souborListu}. Opravy, záchrany, dovednosti, pasivní hodnoty, iniciativu, SO a pozice kouzel Hub počítá podle pravidel 2024.`) : null);
}

function znamenko(n) {
  if (!Number.isFinite(n)) return '—';
  return n < 0 ? `−${Math.abs(n)}` : `+${n}`;
}
