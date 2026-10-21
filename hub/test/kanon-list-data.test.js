// List postavy jako data (⚠ bod 151): list.yaml vedle karty, odvozené hodnoty podle pravidel
// 2024 a rozpory s původním listem (stated).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { spocitatList, listProDruzinu, zdatnostniBonus, oprava, znamenko } from '../sdilene/list-postavy-data.js';
import { Kanon, listVPohledu } from '../server/kanon-modul.js';
import { Zapisovac } from '../server/zapis.js';
import { kontrolaDat } from '../server/data.js';
import { docasneRepo } from './pomoc.js';

const KOREN_REPA = path.resolve(import.meta.dirname, '..', '..');

const ZAKLAD = {
  schema: 1,
  classes: [{ name: 'Bard', level: 3, subclass: 'College of Lore' }],
  species: 'Dwarf',
  background: 'Noble',
  abilities: { str: 7, dex: 14, con: 12, int: 15, wis: 15, cha: 16 },
  saves: { proficient: ['dex', 'cha'] },
  skills: { proficient: ['Perception', 'History'], expertise: ['Persuasion', 'sleight-of-hand'], jack_of_all_trades: true },
  combat: { ac: 13, hp: 20, speed: { walk: 30 } },
  spellcasting: [{ class: 'Bard', spells: [{ name: 'Mage Hand', level: 0 }, { name: 'Shatter', level: 2 }, { name: 'Speak with Animals', level: 1, ritual: true }] }],
};

test('list: základní výpočty podle pravidel 2024', () => {
  assert.equal(oprava(7), -2);
  assert.equal(oprava(10), 0);
  assert.equal(oprava(17), 3);
  assert.deepEqual([1, 4, 5, 9, 13, 17, 20].map(zdatnostniBonus), [2, 2, 3, 4, 5, 6, 6]);
  assert.equal(znamenko(-1), '−1');
  assert.equal(znamenko(0), '+0');
});

test('list: záchrany, dovednosti s expertizou a Jack of All Trades, pasivní hodnoty', () => {
  const l = spocitatList(ZAKLAD);
  assert.deepEqual(l.chyby, []);
  assert.deepEqual(l.rozpory, []);
  assert.equal(l.hlava.tridy, 'Bard 3 (College of Lore)');
  assert.equal(l.zb, 2);
  assert.deepEqual(l.vlastnosti.map((v) => [v.zkratka, v.oprava, v.zachrana, v.zdatnaZachrana]), [
    ['STR', -2, -2, false], ['DEX', 2, 4, true], ['CON', 1, 1, false], ['INT', 2, 2, false], ['WIS', 2, 2, false], ['CHA', 3, 5, true],
  ]);
  const dov = Object.fromEntries(l.dovednosti.map((s) => [s.nazev, [s.bonus, s.stupen]]));
  assert.equal(l.dovednosti.length, 18);
  assert.deepEqual(dov.Persuasion, [7, 2]);
  assert.deepEqual(dov['Sleight of Hand'], [6, 2]);
  assert.deepEqual(dov.Perception, [4, 1]);
  assert.deepEqual(dov.Athletics, [-1, 0.5]); // −2 + ½ ZB
  assert.deepEqual(l.pasivni.map((p) => p.hodnota), [14, 13, 13]);
  assert.equal(l.iniciativa, 2);
  assert.equal(l.kostky, '3d8');
  // Kouzla: SO a útok z CHA, pozice plného sesilatele 3. úrovně, seskupení podle úrovně.
  const k = l.kouzla[0];
  assert.deepEqual([k.vlastnost, k.so, k.utok], ['CHA', 13, 5]);
  assert.deepEqual(k.pozice.map((p) => p.pocet), [4, 2]);
  assert.deepEqual(k.podleUrovne.map((u) => [u.nazev, u.pozice, u.kouzla.map((x) => x.nazev)]), [
    ['Cantrips', null, ['Mage Hand']], ['1st Level', 4, ['Speak with Animals']], ['2nd Level', 2, ['Shatter']],
  ]);
  assert.equal(k.podleUrovne[1].kouzla[0].ritual, true);
});

test('list: bonusy, Alert (pb), víc povolání a poloviční sesilatel', () => {
  const l = spocitatList({
    ...ZAKLAD,
    classes: [{ name: 'Paladin', level: 5 }, { name: 'Barbarian', level: 2 }],
    abilities: { str: 16, dex: 12, con: 14, int: 8, wis: 10, cha: 14 },
    skills: { proficient: ['Athletics'], bonus: { Nature: 2, athletics: 'pb' } },
    combat: { ac: 18, hp: 60, speed: { walk: 30, climb: '30 ft' }, initiative_bonus: 'pb' },
    spellcasting: [{ class: 'Paladin', spells: ['Bless'] }],
  });
  assert.deepEqual(l.chyby, []);
  assert.equal(l.hlava.uroven, 7);
  assert.equal(l.zb, 3);
  assert.equal(l.iniciativa, 4); // DEX +1 + ZB 3
  assert.equal(l.kostky, '2d12 + 5d10');
  assert.deepEqual(l.rychlost, [{ druh: '', ft: 30 }, { druh: 'climb', ft: 30 }]);
  const dov = Object.fromEntries(l.dovednosti.map((s) => [s.nazev, s.bonus]));
  assert.equal(dov.Athletics, 3 + 3 + 3);
  assert.equal(dov.Nature, -1 + 2);
  // Paladin 5 = úroveň sesilatele 3 (zaokrouhleno nahoru), SO z CHA.
  assert.deepEqual(l.kouzla[0].pozice.map((p) => p.pocet), [4, 2]);
  assert.equal(l.kouzla[0].so, 8 + 3 + 2);
});

test('list: rozpory s původním listem (stated) a chyby v datech', () => {
  const l = spocitatList({ ...ZAKLAD, stated: { 'save.cha': '+3', 'skill.persuasion': 7, 'passive.perception': 14, 'spell_dc': 12, 'neco.jineho': 1 }, combat: { ...ZAKLAD.combat, hit_dice: '3d6' } });
  assert.deepEqual(l.rozpory.map((r) => [r.klic, r.uvedeno, r.spocteno]), [
    ['save.cha', '+3', '+5'], ['combat.hit_dice', '3d6', '3d8'], ['spell_dc', '12', '13'],
  ]);
  assert.equal(l.vlastnosti.find((v) => v.klic === 'cha').rozpor.uvedeno, '+3');
  assert.equal(l.dovednosti.find((s) => s.nazev === 'Persuasion').rozpor, null); // shoda = žádný rozpor
  assert.deepEqual(l.chyby, ['stated.neco.jineho: Hub tuto hodnotu nepočítá, nemá s čím ji porovnat']);

  const spatny = spocitatList({ abilities: { str: 10, sila: 3, dex: 'x' }, skills: { proficient: ['Lockpicking'] } });
  assert.ok(spatny.chyby.some((c) => /classes/.test(c)));
  assert.ok(spatny.chyby.some((c) => /neznámá vlastnost „sila“/.test(c)));
  assert.ok(spatny.chyby.some((c) => /abilities.dex/.test(c)));
  assert.ok(spatny.chyby.some((c) => /abilities: chybí con/.test(c)));
  assert.ok(spatny.chyby.some((c) => /neznámá dovednost „Lockpicking“/.test(c)));
  assert.ok(spatny.chyby.some((c) => /combat.ac/.test(c)));
  assert.equal(spocitatList('text').prazdny, true);
});

test('list: výbava a útoky z krátkého zápisu', () => {
  const l = spocitatList({ ...ZAKLAD, equipment: { items: ['Rope', 'Arrows x20', { name: 'Oil', qty: 2 }], coins: { gp: 48 } }, attacks: [{ name: 'Dagger', count: 2, hit: 4, damage: '1d4+2', type: 'Piercing', range: '20/60' }] });
  assert.deepEqual(l.vybava.polozky.map((p) => [p.nazev, p.pocet]), [['Rope', 1], ['Arrows', 20], ['Oil', 2]]);
  assert.deepEqual(l.vybava.mince, [{ mena: 'GP', pocet: 48 }]);
  assert.deepEqual(l.utoky.map((a) => [a.nazev, a.pocet, a.zasah, a.zraneni]), [['Dagger', 2, '+4', '1d4+2']]);
});

test('list: pohled družiny jen s public: true a bez poznámek DM', () => {
  const data = { ...ZAKLAD, source: 'Notion', notes: ['tajné'], stated: { 'save.cha': 3 } };
  assert.equal(listVPohledu({ data, chyba: null }, 'druzina'), null);
  assert.equal(listVPohledu({ data: null, chyba: 'Chyba v YAML' }, 'druzina'), null);
  assert.deepEqual(listVPohledu({ data: null, chyba: 'Chyba v YAML' }, 'dm'), { chybaSouboru: 'Chyba v YAML' });
  assert.equal(listVPohledu({ data, chyba: null }, 'dm').rozpory.length, 1);
  const druzina = listVPohledu({ data: { ...data, public: true }, chyba: null }, 'druzina');
  assert.equal(druzina.zdroj, '');
  assert.deepEqual(druzina.poznamky, []);
  assert.deepEqual(druzina.rozpory, []);
  assert.equal(druzina.vlastnosti.find((v) => v.klic === 'cha').rozpor, null);
  assert.deepEqual(listProDruzinu(spocitatList(ZAKLAD)).vlastnosti.map((v) => v.zachrana), spocitatList(ZAKLAD).vlastnosti.map((v) => v.zachrana));
});

test('list: Kánon načte list.yaml ke kartě, změna karty ho neztratí, Kontrola dat hlásí rozpory', async () => {
  const r = await docasneRepo();
  const slozka = path.join(r.koren, 'kampan', 'postavy', 'koudur');
  await fs.mkdir(slozka, { recursive: true });
  await fs.writeFile(path.join(slozka, 'koudur.md'), '---\nschema: 1\nid: koudur\ntyp: postava\nnazev: Koudur\nverejne: true\n---\n# Koudur\n\nText.\n');
  await fs.writeFile(path.join(slozka, 'list.yaml'), YAML.stringify({ ...ZAKLAD, stated: { 'save.cha': 3 } }));
  const kanon = new Kanon({ cesty: r.c, zapisovac: new Zapisovac() });
  await kanon.nacist();
  assert.equal(kanon.karta('koudur', 'dm').list.vlastnosti.find((v) => v.klic === 'cha').zachrana, 5);
  assert.equal(kanon.karta('koudur', 'druzina').list, null);
  await kanon.nastavit('koudur', { aktualni: true });
  assert.ok(kanon.karta('koudur', 'dm').list, 'list po úpravě hlavičky zůstal');

  let k = await kontrolaDat(r.c);
  assert.deepEqual(k.problemy.filter((p) => p.soubor.endsWith('list.yaml')).map((p) => [p.uroven, p.zprava]), [
    ['varovani', 'Rozpor s původním listem: Charisma save — v listu +3, podle pravidel +5 (stated.save.cha)'],
  ]);
  await fs.writeFile(path.join(slozka, 'list.yaml'), 'abilities: [\n');
  k = await kontrolaDat(r.c);
  assert.equal(k.problemy.find((p) => p.soubor.endsWith('list.yaml'))?.uroven, 'chyba');
  await kanon.nacist();
  assert.match(kanon.karta('koudur', 'dm').list.chybaSouboru, /Chyba v YAML/);
});

test('list: postavy v kampani se dají spočítat bez chyb a sedí s původním listem', async () => {
  const rozpory = {};
  for (const id of ['alba', 'koudur', 'leta', 'tusker']) {
    const l = spocitatList(YAML.parse(await fs.readFile(path.join(KOREN_REPA, 'kampan', 'postavy', id, 'list.yaml'), 'utf8')));
    assert.deepEqual(l.chyby, [], id);
    assert.equal(l.verejne, false, `${id}: list je zatím jen pro DM`);
    if (l.rozpory.length) rozpory[id] = l.rozpory.map((r) => r.klic);
  }
  // Jediný rozpor při převodu: Koudur má zdatnost v záchraně na CHA, list uváděl +3.
  assert.deepEqual(rozpory, { koudur: ['save.cha'] });
});
