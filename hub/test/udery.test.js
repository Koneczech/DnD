// Animace zásahu: rozpoznání zásahu ze dvou stavů Player View, sdílené čtení a zprávy pro výstup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meritko, mistniObrazek, zjistitUdery, simulovatPlayerView, rezimHp, karta, REZIMY_HP } from '../sdilene/udery.js';
import { Udery } from '../server/udery.js';
import { CteniPlayerView } from '../server/iniciativa-cteni.js';
import { SledovaniHp } from '../server/iniciativa-hp.js';

const ZAKLAD = [
  { id: 'tusker', jmeno: 'Tusker', hp: 30, max: 30, hrac: true, iniciativa: 15 },
  { id: 'leta', jmeno: 'Leta', hp: 20, max: 20, hrac: true, iniciativa: 18 },
  { id: 'b1', jmeno: 'Bandita 1', hp: 11, max: 11, iniciativa: 12 },
  { id: 'b2', jmeno: 'Bandita 2', hp: 11, max: 11, iniciativa: 9 },
];

/** Stav setkání: kdo je na tahu, úpravy HP podle id, režim HP pro nestvůry a hráče. */
function setkani(naTahu, hp = {}, { nestvury = 'Actual HP', hraci = 'Actual HP', kolo = 1 } = {}) {
  return {
    encounterState: {
      ActiveCombatantId: naTahu,
      RoundCounter: kolo,
      Combatants: ZAKLAD.map((b) => simulovatPlayerView({ ...b, hp: hp[b.id] ?? b.hp }, b.hrac ? hraci : nestvury)),
    },
    settings: null,
  };
}

test('měřítko HP pro každý režim zobrazení v Improved Initiative', () => {
  const b = { id: 'x', jmeno: 'X', hp: 5, max: 11 };
  assert.deepEqual(meritko(simulovatPlayerView(b, 'Actual HP')), { druh: 'cisla', hodnota: 5, hp: 5, docasne: 0, max: 11 });
  assert.deepEqual(meritko(simulovatPlayerView({ ...b, docasne: 3 }, 'Actual HP')), { druh: 'cisla', hodnota: 8, hp: 5, docasne: 3, max: 11 });
  assert.deepEqual(meritko(simulovatPlayerView(b, 'Damage Taken')), { druh: 'ztrata', hodnota: -6 });
  assert.deepEqual(meritko(simulovatPlayerView(b, 'Colored Label')), { druh: 'barva', hodnota: 77 });
  assert.deepEqual(meritko(simulovatPlayerView(b, 'Monochrome Label')), { druh: 'stav', hodnota: 1 });
  assert.equal(meritko(simulovatPlayerView(b, 'Hide All')), null);
});

test('ilustrace z repa jdou přes Hub, cizí https zůstanou, ostatní nic', () => {
  assert.equal(mistniObrazek('https://raw.githubusercontent.com/Koneczech/DnD/main/monsters/bandit.png'), '/monsters/bandit.png');
  assert.equal(mistniObrazek('https://raw.githubusercontent.com/Koneczech/DnD/main/Tusker.png'), '/Tusker.png');
  assert.equal(mistniObrazek('https://raw.githubusercontent.com/Koneczech/DnD/refs/heads/main/kampan/postavy/alba/zlovlk.png'), '/kampan/postavy/alba/zlovlk.png');
  assert.equal(mistniObrazek('https://raw.githubusercontent.com/Koneczech/DnD/main/hub/server/app.js'), 'https://raw.githubusercontent.com/Koneczech/DnD/main/hub/server/app.js', 'přes Hub jdou jen obrázky');
  assert.equal(mistniObrazek('https://raw.githubusercontent.com/Koneczech/DnD/main/Apps/x.png'), 'https://raw.githubusercontent.com/Koneczech/DnD/main/Apps/x.png', 'mimo složky Hubu zůstane z GitHubu');
  assert.equal(mistniObrazek('https://i.imgur.com/abc.png'), 'https://i.imgur.com/abc.png');
  assert.equal(mistniObrazek('javascript:alert(1)'), null);
  assert.equal(mistniObrazek(''), null);
  const alba = karta({ Id: 'a', Name: 'Alba', ImageURL: 'https://raw.githubusercontent.com/Koneczech/DnD/main/Alba.png', Tags: [{ Text: 'Zlovlk' }] });
  assert.equal(alba.obrazek, '/kampan/postavy/alba/zlovlk.png', 'podoba podle tagu jako v carouselu (bod 74)');
});

test('zásah s čísly: cíl, útočník na tahu, o kolik', () => {
  const u = zjistitUdery(setkani('tusker'), setkani('tusker', { b1: 4 }));
  assert.equal(u.utocnik.id, 'tusker');
  assert.equal(u.cile.length, 1);
  assert.deepEqual([u.cile[0].id, u.cile[0].druh, u.cile[0].o, u.cile[0].padl], ['b1', 'zasah', 7, false]);
  assert.deepEqual(u.cile[0].hp, { hp: 4, docasne: 0, max: 11 });
  assert.equal(u.kolo, 1);
});

test('každý režim HP: co z něj jde poznat', () => {
  const zasah = (rezim, z, na) => zjistitUdery(setkani('leta', { b1: z }, { nestvury: rezim }), setkani('leta', { b1: na }, { nestvury: rezim }));
  assert.equal(zasah('Colored Label', 11, 10).cile[0].o, null, 'barva: zásah bez čísla');
  assert.equal(zasah('Colored Label', 11, 10).cile[0].druh, 'zasah');
  assert.equal(zasah('Damage Taken', 11, 8).cile[0].o, 3);
  assert.equal(zasah('Monochrome Label', 10, 9), null, 'Hurt → Hurt nejde poznat');
  assert.equal(zasah('Monochrome Label', 9, 5).cile[0].druh, 'zasah', 'Hurt → Bloodied ano');
  assert.equal(zasah('Hide All', 11, 1), null);
});

test('posunutý tah ve stejné změně: útočil ten, kdo byl na tahu předtím', () => {
  const u = zjistitUdery(setkani('leta'), setkani('b1', { b2: 2 }));
  assert.equal(u.utocnik.id, 'leta');
});

test('plošný zásah, léčení, pád a vstání', () => {
  const plosny = zjistitUdery(setkani('b1'), setkani('b1', { tusker: 22, leta: 13 }));
  assert.deepEqual(plosny.cile.map((c) => [c.id, c.o]), [['tusker', 8], ['leta', 7]]);
  assert.equal(plosny.utocnik.id, 'b1');

  const pad = zjistitUdery(setkani('tusker', { b2: 3 }), setkani('tusker', { b2: 0 }));
  assert.equal(pad.cile[0].padl, true);

  const leceni = zjistitUdery(setkani('leta', { tusker: 0 }), setkani('leta', { tusker: 6 }));
  assert.deepEqual([leceni.cile[0].druh, leceni.cile[0].o, leceni.cile[0].vstal], ['leceni', 6, true]);
  assert.equal(leceni.utocnik.id, 'leta', 'léčitel je ten, kdo je na tahu');
});

test('kdo je mezi cíli, není útočník; mimo běžící setkání a při změně režimu nic', () => {
  assert.equal(zjistitUdery(setkani('tusker'), setkani('tusker', { tusker: 25 })).utocnik, null, 'zranil se sám');
  assert.equal(zjistitUdery(setkani(null), setkani(null, { b1: 2 })), null, 'souboj nezačal');
  assert.equal(zjistitUdery(setkani('leta', {}, { nestvury: 'Actual HP' }), setkani('leta', { b1: 2 }, { nestvury: 'Colored Label' })), null, 'jiné nastavení HP');
  const novy = setkani('leta', { b1: 2 });
  assert.equal(zjistitUdery({ encounterState: { ActiveCombatantId: 'leta', Combatants: [] } }, novy), null, 'nově přidaný bojovník není zásah');
  assert.equal(zjistitUdery(setkani('leta'), setkani('leta')), null, 'beze změny');
});

test('režim HP z nastavení Player View, jinak odhad z bojovníků', () => {
  const s = setkani('leta', {}, { nestvury: 'Colored Label', hraci: 'Actual HP' });
  assert.deepEqual(rezimHp(s), { nestvury: { rezim: 'Colored Label', zdroj: 'odhad' }, hraci: { rezim: 'Actual HP', zdroj: 'odhad' } });
  s.settings = { MonsterHPVerbosity: 'Monochrome Label', PlayerHPVerbosity: 'Actual HP' };
  assert.equal(rezimHp(s).nestvury.rezim, 'Monochrome Label');
  assert.equal(rezimHp(s).nestvury.zdroj, 'nastavení');
  for (const r of REZIMY_HP) {
    const odhad = rezimHp(setkani('leta', {}, { nestvury: r })).nestvury.rezim;
    // I s plnými HP se režimy liší: Damage Taken ukazuje „0“, Monochrome Label nemá barvu.
    assert.equal(odhad, r, r);
  }
});

test('Udery: první stav je výchozí bod, zásah dostane číslo a čas, nové setkání začíná znovu', () => {
  let cas = 1000;
  const u = new Udery({ ted: () => cas });
  const zpravy = [];
  u.on('uder', (z) => zpravy.push(z));
  const stavy = [];
  u.on('stav', (s) => stavy.push(s));
  assert.equal(u.zpracovat('abc', setkani('tusker', { b1: 11 })), null);
  assert.equal(stavy.at(-1).souboj, true, 'po prvním stavu už Hub souboj sleduje');
  assert.equal(stavy.at(-1).rezim.nestvury.rezim, 'Actual HP');
  u.zpracovat('abc', setkani('tusker', { b1: 5 }));
  cas = 2000;
  u.zpracovat('abc', setkani('tusker', { b1: 0 }));
  assert.deepEqual(zpravy.map((z) => [z.cislo, z.cas, z.cile[0].o, z.cile[0].padl]), [[1, 1000, 6, false], [2, 2000, 5, true]]);
  u.zpracovat('jine', setkani('tusker', { b1: 11 }));
  assert.equal(zpravy.length, 2, 'jiné setkání: jen výchozí bod');
  u.zpracovat(null, null);
  assert.equal(u.verejny().souboj, false);
});

test('jedno čtení Player View: jen v souboji, při výpadku drží poslední stav, světla z něj čtou', async () => {
  let souboj = true;
  let selhat = false;
  let cteni = 0;
  let hp = { leta: 20 };
  const c = new CteniPlayerView({
    odkaz: () => 'https://improvedinitiative.app/p/x1',
    aktivni: () => souboj,
    nacist: async (id) => {
      assert.equal(id, 'x1');
      cteni++;
      if (selhat) throw new Error('výpadek');
      return setkani('leta', hp);
    },
  });
  const stavy = [];
  const chyby = [];
  c.on('stav', (id, s) => stavy.push(id && s.encounterState.ActiveCombatantId));
  c.on('chyba', (t) => chyby.push(t));
  const hpSvetla = new SledovaniHp({ odkaz: () => 'https://improvedinitiative.app/p/x1', aktivni: () => souboj, nacist: () => c.posledni() });
  const kriticke = [];
  hpSvetla.on('zmena', (k) => kriticke.push(k));

  await c.krok();
  hp = { leta: 3 };
  await c.krok();
  await hpSvetla.krok();
  selhat = true;
  await c.krok();
  await hpSvetla.krok();
  assert.deepEqual(kriticke, [{ jmeno: 'Leta', hp: 3, max: 20 }], 'při výpadku lampa pulzuje dál');
  assert.equal(chyby.length, 1);
  souboj = false;
  selhat = false;
  await c.krok();
  await c.krok();
  assert.deepEqual(stavy, ['leta', 'leta', null]);
  assert.equal(cteni, 3, 'mimo souboj se Player View nečte');
  assert.equal(await c.posledni(), null);
});

test('čtení Player View: zaseknutý dotaz nezastaví další čtení', async () => {
  const { CteniPlayerView } = await import('../server/iniciativa-cteni.js');
  let volani = 0;
  const c = new CteniPlayerView({
    odkaz: () => 'https://improvedinitiative.app/p/x1',
    aktivni: () => true,
    limitMs: 100,
    nacist: () => (++volani === 1 ? new Promise(() => {}) : Promise.resolve({ encounterState: { Combatants: [] } })),
  });
  const chyby = [];
  c.on('chyba', (t) => t && chyby.push(t));
  await c.krok();
  assert.match(chyby[0], /čas vypršel/);
  await c.krok();
  assert.equal(volani, 2);
  assert.ok(c.stav, 'druhé čtení prošlo');
});
