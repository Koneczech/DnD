// Světla podle HP: rozpoznání postavy na tahu s málo HP a pulzování lampy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rozebratHp, kritickaPostava, idSetkani, SledovaniHp } from '../server/iniciativa-hp.js';

const setkani = (aktivni, lide) => ({
  encounterState: {
    ActiveCombatantId: aktivni,
    Combatants: lide.map(([Id, Name, HPDisplay, IsPlayerCharacter]) => ({ Id, Name, HPDisplay, IsPlayerCharacter })),
  },
});

test('HP z Player View: čísla, dočasné HP jako polštář, slovní popis se nepočítá', () => {
  assert.deepEqual(rozebratHp('16/24'), { hp: 16, max: 24 });
  assert.deepEqual(rozebratHp('3+5/24'), { hp: 8, max: 24 });
  assert.deepEqual(rozebratHp('-2/24'), { hp: -2, max: 24 });
  assert.equal(rozebratHp("<span class='healthyHP'>Healthy</span>"), null);
  assert.equal(idSetkani('https://improvedinitiative.app/p/sxda8g8n'), 'sxda8g8n');
});

test('kritická je jen postava hráče na tahu s 25 % a méně', () => {
  const lide = [['a', 'Leta', '6/24', true], ['b', 'Goblin', '1/7', false], ['c', 'Alba', '13/18', true]];
  assert.deepEqual(kritickaPostava(setkani('a', lide)), { jmeno: 'Leta', hp: 6, max: 24 });
  assert.equal(kritickaPostava(setkani('b', lide)), null, 'netvor ne');
  assert.equal(kritickaPostava(setkani('c', lide)), null, 'dost HP');
  assert.equal(kritickaPostava(setkani('a', [['a', 'Leta', '7/24', true]])), null, '29 % ne');
  assert.deepEqual(kritickaPostava(setkani('a', [['a', 'Leta', '0/24', true]])), { jmeno: 'Leta', hp: 0, max: 24 }, 'i v bezvědomí');
});

test('sledování ohlásí jen změnu a mimo souboj nic nečte', async () => {
  let stav = setkani('a', [['a', 'Leta', '20/24', true]]);
  let souboj = true;
  let cteni = 0;
  const s = new SledovaniHp({ odkaz: () => 'https://improvedinitiative.app/p/x1', aktivni: () => souboj, nacist: async () => { cteni++; return stav; } });
  const zmeny = [];
  s.on('zmena', (k) => zmeny.push(k));
  await s.krok();
  stav = setkani('a', [['a', 'Leta', '4/24', true]]);
  await s.krok();
  await s.krok();
  souboj = false;
  await s.krok();
  assert.deepEqual(zmeny, [{ jmeno: 'Leta', hp: 4, max: 24 }, null]);
  assert.equal(cteni, 3, 'mimo souboj se Player View nečte');
});

test('lampa pulzuje do červena jen s Řídit světla a pak se vrátí ke scéně', async () => {
  const { Svetla } = await import('../server/svetla.js');
  const os = await import('node:os');
  const path = await import('node:path');
  const prikazy = [];
  const pozadi = [];
  const wiz = ({ adresa }) => ({ nastavit: async (cil) => (adresa === '10.0.0.8' ? pozadi : prikazy).push(cil), stav: async () => ({}) });
  const svetla = new Svetla({
    cesty: { lokalniStav: path.join(os.tmpdir(), 'hub-hp-test'), kampan: path.join(os.tmpdir(), 'hub-hp-neni') },
    nastaveni: () => ({ SVETLA_LAMPA: 'wiz:10.0.0.9', SVETLA_POZADI: 'wiz:10.0.0.8' }),
    misto: () => null,
    scena: () => ({ varianta: 'den', pocasi: [], intenzita: 0, rezim: 'souboj' }),
    ovladace: { wiz },
  });
  svetla.sestavitZarizeni();
  svetla.nastavitKritickeHp({ jmeno: 'Leta', hp: 4, max: 24 });
  assert.equal(prikazy.length, 0, 'bez Řídit světla lampa nepulzuje');
  svetla.mistni.ridit = true;
  svetla.nastavitKritickeHp(null);
  svetla.nastavitKritickeHp({ jmeno: 'Leta', hp: 4, max: 24 });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(prikazy.at(-1).rgb, [255, 0, 0], 'lampa začne červenou');
  assert.deepEqual(pozadi.at(-1).rgb, [255, 0, 0], 'pozadí červeně');
  assert.equal(svetla.verejny().kritickeHp.jmeno, 'Leta');
  const pred = prikazy.length;
  await svetla.aplikovat();
  assert.equal(prikazy.length, pred, 'scéna lampu během pulzu nepřepíše');
  svetla.nastavitKritickeHp(null);
  await svetla.fronta;
  assert.notDeepEqual(prikazy.at(-1).rgb, [255, 0, 0], 'po tahu lampa zpět ke scéně');
  assert.notDeepEqual(pozadi.at(-1).rgb, [255, 0, 0], 'po tahu pozadí zpět ke scéně');
  assert.equal(svetla.verejny().kritickeHp, null);
  svetla.zastavit();
});

test('nastavení málo HP: kontrola hodnot a nejkratší fáze', async () => {
  const { normalizujHp, VYCHOZI_HP } = await import('../server/svetla.js');
  assert.deepEqual(normalizujHp(), structuredClone(VYCHOZI_HP));
  const v = normalizujHp({ rezim: 'intenzita', a: { jas: 90 }, pozadi: { rgb: [200, 0, 0] } });
  assert.equal(v.rezim, 'intenzita');
  assert.equal(v.a.jas, 90);
  assert.deepEqual(v.a.rgb, [255, 0, 0], 'nezadané zůstává');
  assert.deepEqual(v.pozadi.rgb, [200, 0, 0]);
  assert.throws(() => normalizujHp({ b: { s: 0.2 } }), /0.5–30/, 'rychleji než 2 změny za sekundu ne');
  assert.throws(() => normalizujHp({ a: { rgb: [300, 0, 0] } }), /barva/);
  assert.throws(() => normalizujHp({ rezim: 'disko' }), /Režim/);
});

test('WiZ lampa se mezi fázemi přelévá po krocích, Hue jedním příkazem s přechodem', async () => {
  const { Svetla } = await import('../server/svetla.js');
  const os = await import('node:os');
  const path = await import('node:path');
  const wizPrikazy = [];
  const huePrikazy = [];
  const svetla = new Svetla({
    cesty: { lokalniStav: path.join(os.tmpdir(), 'hub-hp-test2'), kampan: path.join(os.tmpdir(), 'hub-hp-neni') },
    nastaveni: () => ({ SVETLA_LAMPA: 'wiz:10.0.0.9' }),
    misto: () => null,
    scena: () => ({ varianta: 'den', pocasi: [], intenzita: 0 }),
    ovladace: { wiz: () => ({ nastavit: async (cil) => wizPrikazy.push(cil), stav: async () => ({}) }) },
  });
  svetla.sestavitZarizeni();
  svetla.pulzBezi = true;
  const z = [...svetla.zarizeni.values()][0];
  svetla.prelit(z, { zap: true, jas: 100, rgb: [255, 0, 0] }, { zap: true, jas: 70, rgb: [255, 110, 0] }, 600);
  await new Promise((r) => setTimeout(r, 800));
  assert.ok(wizPrikazy.length >= 3, `víc kroků (${wizPrikazy.length})`);
  const zelene = wizPrikazy.map((p) => p.rgb[1]);
  assert.deepEqual(zelene, [...zelene].sort((a, b) => a - b), 'barva jde jedním směrem, bez skoků zpět');
  assert.deepEqual(wizPrikazy.at(-1).rgb, [255, 110, 0], 'skončí přesně v cílové barvě');
  const hue = { typ: 'hue', id: 'x', ovladac: { nastavit: async (id, cil, ms) => huePrikazy.push(ms) } };
  svetla.prelit(hue, { zap: true, jas: 100, rgb: [255, 0, 0] }, { zap: true, jas: 70, rgb: [255, 110, 0] }, 1500);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(huePrikazy, [1500]);
  svetla.pulzBezi = false;
  svetla.zastavit();
});

test('pomalá WiZ lampa: kroky pulzu se nehromadí a po konci pulzu nic nedobíhá', async () => {
  const { Svetla } = await import('../server/svetla.js');
  const os = await import('node:os');
  const path = await import('node:path');
  const prikazy = [];
  const svetla = new Svetla({
    cesty: { lokalniStav: path.join(os.tmpdir(), 'hub-hp-test3'), kampan: path.join(os.tmpdir(), 'hub-hp-neni') },
    nastaveni: () => ({ SVETLA_LAMPA: 'wiz:10.0.0.9' }),
    misto: () => null,
    scena: () => ({ varianta: 'den', pocasi: [], intenzita: 0 }),
    // Lampa odpovídá za 400 ms, krok přelévání je 150 ms.
    ovladace: { wiz: () => ({ nastavit: async (cil) => { prikazy.push(cil); await new Promise((r) => setTimeout(r, 400)); }, stav: async () => ({}) }) },
  });
  svetla.sestavitZarizeni();
  svetla.pulzBezi = true;
  const z = [...svetla.zarizeni.values()][0];
  svetla.prelit(z, { zap: true, jas: 100, rgb: [255, 0, 0] }, { zap: true, jas: 70, rgb: [255, 110, 0] }, 1500);
  await new Promise((r) => setTimeout(r, 1700));
  assert.ok(prikazy.length <= 6, `jen tolik příkazů, kolik lampa stihne (${prikazy.length})`);
  svetla.pulzBezi = false;
  clearInterval(z.prelivani);
  z.pulzCeka = null;
  const poKonci = prikazy.length;
  await new Promise((r) => setTimeout(r, 900));
  assert.ok(prikazy.length - poKonci <= 0, 'po konci pulzu už lampa nedostává staré kroky');
  svetla.zastavit();
});

test('odpočet: světla se z aktuálního stavu přelévají do výchozího a po konci je převezme scéna', async () => {
  const { Svetla } = await import('../server/svetla.js');
  const os = await import('node:os');
  const path = await import('node:path');
  const prikazy = [];
  const svetla = new Svetla({
    cesty: { lokalniStav: path.join(os.tmpdir(), 'hub-nabeh-test'), kampan: path.join(os.tmpdir(), 'hub-hp-neni') },
    nastaveni: () => ({ SVETLA_LAMPA: 'wiz:10.0.0.9' }),
    misto: () => null,
    scena: () => ({ varianta: 'den', pocasi: [], intenzita: 0 }),
    ovladace: { wiz: () => ({ nastavit: async (cil) => prikazy.push(cil), stav: async () => ({ zap: true, jas: 100, rgb: [255, 255, 255] }) }) },
  });
  svetla.sestavitZarizeni();
  svetla.mistni.ridit = true;
  svetla.mistni.vychozi = { ...svetla.mistni.vychozi, lampa: { barva: [255, 120, 40], jas: 30 } };
  svetla.odpocet({ stav: 'bezi', konec: new Date(Date.now() + 3200).toISOString() });
  await new Promise((r) => setTimeout(r, 1200));
  assert.ok(svetla.nabeh, 'přelévání běží');
  await svetla.aplikovat({ cile: { lampa: { zap: true, jas: 90, rgb: [0, 0, 255] } } });
  assert.ok(!prikazy.some((p) => p.rgb[2] === 255 && p.rgb[0] === 0), 'scéna během odpočtu světla nepřebije');
  const jasy = prikazy.map((p) => p.jas);
  assert.ok(jasy.length >= 2 && jasy[0] > jasy.at(-1), `jas plynule klesá (${jasy})`);
  await new Promise((r) => setTimeout(r, 3000));
  assert.equal(svetla.nabeh, null, 'po konci odpočtu skončí');
  assert.ok(prikazy.some((p) => p.jas === 30 && p.rgb[0] === 255 && p.rgb[1] === 120), 'doběhne přesně do výchozího stavu');
  // Pauza zastaví, zrušení vrátí scénu.
  svetla.odpocet({ stav: 'bezi', konec: new Date(Date.now() + 10000).toISOString() });
  await new Promise((r) => setTimeout(r, 300));
  svetla.odpocet({ stav: 'pauza', konec: null });
  assert.equal(svetla.nabeh, null);
  svetla.mistni.nabehStartu = false;
  svetla.odpocet({ stav: 'bezi', konec: new Date(Date.now() + 10000).toISOString() });
  assert.equal(svetla.nabeh, null, 'vypnutý přepínač: nic');
  svetla.zastavit();
});

test('blesk: světlo se vrátí na stav scény a za 0,8 s ho Hub pošle ještě jednou', async () => {
  const { Svetla } = await import('../server/svetla.js');
  const os = await import('node:os');
  const path = await import('node:path');
  const prikazy = [];
  const svetla = new Svetla({
    cesty: { lokalniStav: path.join(os.tmpdir(), 'hub-blesk-test'), kampan: path.join(os.tmpdir(), 'hub-hp-neni') },
    nastaveni: () => ({ SVETLA_LAMPA: 'wiz:10.0.0.9' }),
    misto: () => null,
    scena: () => ({ varianta: 'den', pocasi: [], intenzita: 0, bourka: 'nad-nami' }),
    ovladace: { wiz: () => ({ nastavit: async (cil) => prikazy.push(cil), stav: async () => ({}) }) },
  });
  svetla.sestavitZarizeni();
  svetla.mistni.ridit = true;
  svetla.zablesky = [];
  await svetla.blesk({ vzdalenost: 'nad-nami' });
  const cil = svetla.cil().lampa;
  assert.deepEqual(prikazy[0].rgb, [235, 240, 255], 'záblesk');
  assert.deepEqual(prikazy[1], cil, 'návrat');
  await new Promise((r) => setTimeout(r, 1000));
  assert.deepEqual(prikazy.at(-1), cil, 'pojistka pošle stav scény znovu');
  assert.equal(prikazy.length, 3);
  // Při málo HP lampa pulzuje a blesk na ni nesahá.
  svetla.pulzBezi = true;
  prikazy.length = 0;
  svetla.zablesky = [];
  await svetla.blesk({ vzdalenost: 'nad-nami' });
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(prikazy.length, 0);
  svetla.pulzBezi = false;
  svetla.zastavit();
});
