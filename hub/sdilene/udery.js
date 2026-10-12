// Rozpoznání zásahů ze stavu Player View (otevřený bod 75). Sdílený modul: server porovnává stavy
// přečtené z /playerviews, zkouška ve výstupu uder.html pouští stejnou logiku nad vymyšlenými stavy.
//
// Improved Initiative neposílá, kdo na koho útočil. Pozná se to ze dvou po sobě jdoucích stavů:
// komu ubyly body výdrže, je cíl; kdo je na tahu, je útočník.

/** Režimy zobrazení HP v Improved Initiative (Settings → Player View) a co z nich jde poznat. */
export const REZIMY_HP = ['Actual HP', 'Colored Label', 'Monochrome Label', 'Damage Taken', 'Hide All'];

export const ROZPOZNANI = {
  'Actual HP': 'každý zásah i s číslem',
  'Damage Taken': 'každý zásah i s číslem',
  'Colored Label': 'každý zásah, bez čísla',
  'Monochrome Label': 'jen přechody Healthy / Hurt / Bloodied / Defeated',
  'Hide All': 'nic, zásahy nejdou poznat',
};

const STAVY = { defeated: 0, bloodied: 1, hurt: 2, healthy: 3 };

/**
 * Co o životech bojovníka prozrazuje Player View. Podle nastavení HP je to:
 * - `cisla`: „16/24“ nebo „3+5/24“ (Actual HP), dočasné HP se počítají jako polštář
 * - `ztrata`: „-8“ (Damage Taken: aktuální − maximum)
 * - `barva`: zelená složka HPColor = ⌊HP / max × 170⌋ (Colored Label), mění se skoro s každým bodem
 * - `stav`: jen Healthy / Hurt / Bloodied / Defeated (Monochrome Label)
 * Hide All neprozradí nic (null).
 */
export function meritko(c) {
  const text = String(c?.HPDisplay ?? '').trim();
  let m = text.match(/^(-?\d+)(?:\+(\d+))?\/(\d+)$/);
  if (m) {
    const hp = Number(m[1]);
    const docasne = Number(m[2] ?? 0);
    return { druh: 'cisla', hodnota: hp + docasne, hp, docasne, max: Number(m[3]) };
  }
  if (/^-?\d+$/.test(text)) return { druh: 'ztrata', hodnota: Number(text) };
  m = String(c?.HPColor ?? '').match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*0\s*\)$/);
  if (m) return { druh: 'barva', hodnota: Number(m[2]) };
  if (c?.HealthState in STAVY) return { druh: 'stav', hodnota: STAVY[c.HealthState] };
  return null;
}

/** Režim zobrazení HP odhadnutý z jednoho bojovníka (když nastavení Player View chybí). */
export function odhadnoutRezim(c) {
  const m = meritko(c);
  if (!m) return 'Hide All';
  return { cisla: 'Actual HP', ztrata: 'Damage Taken', barva: 'Colored Label', stav: 'Monochrome Label' }[m.druh];
}

/** Režim HP nestvůr a hráčů: z nastavení Player View, jinak odhad z bojovníků. */
export function rezimHp(stav) {
  const s = stav?.encounterState ?? stav;
  const nastaveni = stav?.settings;
  const prvni = (hrac) => (s?.Combatants ?? []).find((c) => Boolean(c.IsPlayerCharacter) === hrac);
  const rezim = (zNastaveni, hrac) => {
    if (REZIMY_HP.includes(zNastaveni)) return { rezim: zNastaveni, zdroj: 'nastavení' };
    const c = prvni(hrac);
    return c ? { rezim: odhadnoutRezim(c), zdroj: 'odhad' } : null;
  };
  return { nestvury: rezim(nastaveni?.MonsterHPVerbosity, false), hraci: rezim(nastaveni?.PlayerHPVerbosity, true) };
}

// Ilustrace z veřejného repa má Hub i u sebe: výstup je bere lokálně a nepotřebuje internet (audit N7).
const Z_REPA = /^https:\/\/raw\.githubusercontent\.com\/Koneczech\/DnD\/(?:refs\/heads\/)?main\/([^?#]+)$/i;

/** Adresa ilustrace pro výstup: z repa přes Hub (kořen, monsters/, kampan/), jinak původní https. */
export function mistniObrazek(url) {
  const u = String(url ?? '').trim();
  const m = u.match(Z_REPA);
  if (m && /\.(png|jpe?g|webp)$/i.test(m[1]) && (!m[1].includes('/') || /^(monsters|kampan)\//i.test(m[1]))) return `/${m[1]}`;
  return /^https:\/\//i.test(u) ? u : null;
}

/**
 * Podoby postav podle tagu v Improved Initiative (otevřený bod 74): stejný obrázek, jaký ukazuje
 * carousel přes vlastní CSS.
 */
export const PODOBY = { zlovlk: '/kampan/postavy/alba/zlovlk.png' };

const tagy = (c) => (c?.Tags ?? []).map((t) => String(t?.Text ?? '').trim().toLowerCase()).filter(Boolean);

/** Bojovník zúžený na to, co výstup kreslí na kartu. */
export function karta(c) {
  if (!c) return null;
  const m = meritko(c);
  const t = tagy(c);
  const podoba = t.map((x) => PODOBY[x]).find(Boolean);
  return {
    id: String(c.Id),
    jmeno: String(c.Name ?? ''),
    obrazek: podoba ?? mistniObrazek(c.ImageURL),
    iniciativa: Number.isFinite(c.Initiative) ? c.Initiative : null,
    hrac: Boolean(c.IsPlayerCharacter),
    tagy: t,
    hp: m?.druh === 'cisla' ? { hp: m.hp, docasne: m.docasne, max: m.max } : null,
    barvaHp: /^rgb\(/.test(String(c.HPColor ?? '')) ? c.HPColor : null,
  };
}

function padly(c, m) {
  return c?.HealthState === 'defeated' || (m?.druh === 'cisla' && m.hp <= 0);
}

/**
 * Porovná dva stavy setkání a vrátí, co se stalo, nebo null.
 * - cíl: bojovník, jehož měřítko HP kleslo (zásah) nebo stouplo (léčení); jen když obě měřítka
 *   mají stejný druh (změna nastavení HP mezi stavy není zásah)
 * - útočník: kdo je na tahu; když se ve stejné změně posunul tah (DM zapsal zranění a hned dal
 *   Další), útočil ten, kdo byl na tahu předtím
 * - kdo je mezi cíli, útočník není (zranil se sám, léčil se sám, plošné kouzlo zasáhlo i sesilatele)
 * - mimo běžící setkání (nikdo na tahu) se nic nehlásí: DM tam jen upravuje životy
 */
export function zjistitUdery(stary, novy) {
  const a = stary?.encounterState ?? stary;
  const b = novy?.encounterState ?? novy;
  if (!a || !b || !b.ActiveCombatantId) return null;
  const predtim = new Map((a.Combatants ?? []).map((c) => [c.Id, c]));
  const cile = [];
  for (const c of b.Combatants ?? []) {
    const p = predtim.get(c.Id);
    if (!p) continue;
    const mp = meritko(p);
    const mc = meritko(c);
    if (!mp || !mc || mp.druh !== mc.druh) continue;
    const rozdil = mc.hodnota - mp.hodnota;
    if (!rozdil) continue;
    const presne = mc.druh === 'cisla' || mc.druh === 'ztrata';
    cile.push({
      ...karta(c),
      druh: rozdil < 0 ? 'zasah' : 'leceni',
      o: presne ? Math.abs(rozdil) : null,
      padl: padly(c, mc) && !padly(p, mp),
      vstal: padly(p, mp) && !padly(c, mc),
    });
  }
  if (!cile.length) return null;
  const idUtocnika = a.ActiveCombatantId && a.ActiveCombatantId !== b.ActiveCombatantId ? a.ActiveCombatantId : b.ActiveCombatantId;
  const naTahu = (b.Combatants ?? []).find((c) => c.Id === idUtocnika) ?? (a.Combatants ?? []).find((c) => c.Id === idUtocnika);
  const utocnik = naTahu && !cile.some((c) => c.id === String(idUtocnika)) ? karta(naTahu) : null;
  return { utocnik, cile, kolo: Number.isFinite(b.RoundCounter) ? b.RoundCounter : null };
}

/**
 * Bojovník tak, jak ho Improved Initiative pošle do Player View při daném nastavení HP
 * (podle ToPlayerViewCombatantState.ts). Pro zkoušku ve výstupu a pro testy.
 * @param {{id: string, jmeno: string, hp: number, max: number, docasne?: number, iniciativa?: number,
 *   hrac?: boolean, obrazek?: string, tagy?: string[]}} b
 */
export function simulovatPlayerView(b, rezim) {
  const { hp, max } = b;
  const docasne = b.docasne ?? 0;
  const stav = hp <= 0 ? 'defeated' : hp < max / 2 ? 'bloodied' : hp < max ? 'hurt' : 'healthy';
  const popisky = { defeated: 'Defeated', bloodied: 'Bloodied', hurt: 'Hurt', healthy: 'Healthy' };
  let HPDisplay;
  if (rezim === 'Actual HP') HPDisplay = docasne ? `${hp}+${docasne}/${max}` : `${hp}/${max}`;
  else if (rezim === 'Hide All') HPDisplay = '';
  else if (rezim === 'Damage Taken') HPDisplay = String(hp - max);
  else HPDisplay = `<span class='${stav}HP'>${popisky[stav]}</span>`;
  const bezBarvy = ['Monochrome Label', 'Hide All', 'Damage Taken'].includes(rezim);
  return {
    Id: b.id,
    Name: b.jmeno,
    HPDisplay,
    HPColor: bezBarvy ? 'auto' : `rgb(${Math.floor(((max - hp) / max) * 170)},${Math.floor((hp / max) * 170)},0)`,
    HealthState: ['Hide All', 'Damage Taken'].includes(rezim) ? undefined : stav,
    Initiative: b.iniciativa ?? 0,
    IsPlayerCharacter: Boolean(b.hrac),
    ImageURL: b.obrazek ?? '',
    Tags: (b.tagy ?? []).map((Text) => ({ Text })),
  };
}
