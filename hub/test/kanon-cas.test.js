// Kánon v čase (⚠ návrh): pořadí událostí v rámci dne, hráčský kánon seřazený podle událostí
// z Kalendáře (předtím / potom) a místo, které ukáže i to, co se stalo v místech uvnitř.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { Kanon } from '../server/kanon-modul.js';
import { Zapisovac } from '../server/zapis.js';
import { Kalendar } from '../server/kalendar.js';
import { Hub } from '../server/app.js';
import { docasneRepo, FalesnyObs } from './pomoc.js';

const karta = (typ, id, nazev, radky = []) => `---\nschema: 1\nid: ${id}\ntyp: ${typ}\nnazev: "${nazev}"\nverejne: true\n${radky.join('\n')}${radky.length ? '\n' : ''}---\n# ${nazev}\n`;

async function repo() {
  const r = await docasneRepo();
  const zapsat = async (rel, text) => {
    await fs.mkdir(path.dirname(path.join(r.c.kampan, rel)), { recursive: true });
    await fs.writeFile(path.join(r.c.kampan, rel), text);
  };
  await zapsat('mista/cesta/cesta.md', karta('misto', 'cesta', 'Cesta'));
  await zapsat('mista/usek/usek.md', karta('misto', 'usek', 'Úsek', ['lezi_v: "[[cesta]]"']));
  await zapsat('mista/previs/previs.md', karta('misto', 'previs', 'Převis', ['lezi_v: "[[usek]]"']));
  await zapsat('kanon/k-kradez.md', karta('kanon', 'k-kradez', 'Krádež na trhu'));
  await zapsat('kanon/k-boj.md', karta('kanon', 'k-boj', 'Boj v táboře'));
  await zapsat('kanon/k-cesta.md', karta('kanon', 'k-cesta', 'Jdou spolu na jih', ['vazby: ["[[previs]]"]']));
  await zapsat('kanon/k-bez.md', karta('kanon', 'k-bez', 'Bez události', ['vazby: ["[[cesta]]"]']));
  await zapsat('kalendar/udalosti.yaml', `schema: 1
udalosti:
  - id: u-tabor
    datum: { rok: 1491, mesic: Eleint, den: 13 }
    text: První tábor
    verejna: true
    vazby: ["[[k-cesta]]", "[[previs]]"]
  - id: u-odchod
    datum: { rok: 1491, mesic: Eleint, den: 12 }
    text: Opuštění Mirabaru
    verejna: true
    vazby: ["[[k-kradez]]"]
  - id: u-torva
    datum: { rok: 1491, mesic: Eleint, den: 13 }
    text: Setkání s Torvou
    verejna: true
    vazby: ["[[k-boj]]"]
`);
  return r;
}

function sestavit(r) {
  const zapisovac = new Zapisovac();
  const kalendar = new Kalendar({ cesty: r.c, data: { stav: { datum: null }, zacatek: () => null }, zapisovac });
  return { kalendar, kanon: new Kanon({ cesty: r.c, zapisovac, kalendar }) };
}

test('pořadí v dni: podle zápisu, posun dřív a později prohodí sousedy téhož dne', async () => {
  const r = await repo();
  try {
    const { kalendar, kanon } = sestavit(r);
    await kalendar.nacist();
    await kanon.nacist();
    const ud = () => kanon.udalosti('dm').map((u) => `${u.id}:${u.vDni}/${u.vDniPocet}`);
    assert.deepEqual(ud(), ['u-odchod:1/1', 'u-tabor:1/2', 'u-torva:2/2']);
    await kalendar.posunoutVDni('u-torva', -1);
    assert.deepEqual(ud(), ['u-odchod:1/1', 'u-torva:1/2', 'u-tabor:2/2']);
    // V souboru se jen prohodí pořadí, nic dalšího se nezmění.
    const yaml = YAML.parse(await fs.readFile(path.join(r.c.kampan, 'kalendar', 'udalosti.yaml'), 'utf8'));
    assert.deepEqual(yaml.udalosti.map((u) => u.id), ['u-torva', 'u-odchod', 'u-tabor']);
    await assert.rejects(kalendar.posunoutVDni('u-torva', -1), /už první/);
    await assert.rejects(kalendar.posunoutVDni('u-odchod', 1), /už poslední/);
    await assert.rejects(kalendar.posunoutVDni('u-odchod', 2), /Směr/);
    await assert.rejects(kalendar.posunoutVDni('nic', 1), /neexistuje/);
  } finally {
    await r.smazat();
  }
});

test('chronologie: hráčský kánon podle událostí, předtím a potom, karta bez události mimo řadu', async () => {
  const r = await repo();
  try {
    const { kalendar, kanon } = sestavit(r);
    await kalendar.nacist();
    await kanon.nacist();
    assert.deepEqual(kanon.chronologie('dm').map((x) => x.id), ['k-kradez', 'k-cesta', 'k-boj']);
    const c = kanon.karta('k-cesta', 'dm').chronologie;
    assert.equal(c.udalost.text, 'První tábor');
    assert.equal(c.udalost.vDni, 1);
    assert.equal(c.predtim.id, 'k-kradez');
    assert.equal(c.potom.id, 'k-boj');
    assert.equal(kanon.karta('k-kradez', 'dm').chronologie.predtim, null);
    assert.deepEqual(kanon.karta('k-bez', 'dm').chronologie, { udalost: null, predtim: null, potom: null });
    assert.equal(kanon.karta('cesta', 'dm').chronologie, null);
    // Po přehození pořadí v dni se změní i řada kánonu.
    await kalendar.posunoutVDni('u-torva', -1);
    assert.deepEqual(kanon.chronologie('dm').map((x) => x.id), ['k-kradez', 'k-boj', 'k-cesta']);
  } finally {
    await r.smazat();
  }
});

test('místo: události a hráčský kánon i z míst uvnitř (i hlouběji), s cestou přes podmísto', async () => {
  const r = await repo();
  try {
    const { kalendar, kanon } = sestavit(r);
    await kalendar.nacist();
    await kanon.nacist();
    const cesta = kanon.karta('cesta', 'dm');
    assert.deepEqual(cesta.zde.map((x) => [x.id, x.pres]), [['k-cesta', 'previs'], ['k-bez', null]]);
    assert.equal(cesta.zde[0].udalost.text, 'První tábor');
    assert.deepEqual(cesta.udalosti.map((u) => [u.id, u.pres]), [['u-tabor', 'previs']]);
    const previs = kanon.karta('previs', 'dm');
    assert.deepEqual(previs.udalosti.map((u) => [u.id, u.pres]), [['u-tabor', null]]);
    assert.deepEqual(previs.zde.map((x) => x.id), ['k-cesta']);
    // Jiné typy než místo nic nesčítají.
    assert.equal(kanon.karta('k-boj', 'dm').zde, null);
  } finally {
    await r.smazat();
  }
});

test('API: pořadí události v dni', async () => {
  const r = await repo();
  const hub = new Hub({ cesty: r.c, obsKlient: new FalesnyObs(), gitSit: false, port: 0 });
  await hub.spustit();
  try {
    const poslat = (smer) => fetch(`${hub.adresa}/api/kalendar/udalosti/u-torva/poradi`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ smer }) });
    assert.equal((await poslat(-1)).status, 200);
    const k = await (await fetch(`${hub.adresa}/api/kalendar`)).json();
    assert.deepEqual(k.udalosti.map((u) => u.id), ['u-odchod', 'u-torva', 'u-tabor']);
    const znovu = await poslat(-1);
    assert.equal(znovu.status, 409);
    const seznam = await (await fetch(`${hub.adresa}/api/kanon`)).json();
    assert.deepEqual(seznam.udalosti.map((u) => u.vDni), [1, 1, 2]);
  } finally {
    await hub.zastavit();
    await r.smazat();
  }
});
