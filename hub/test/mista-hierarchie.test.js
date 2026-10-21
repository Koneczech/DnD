// Hierarchie míst: pole `lezi_v` (⚠ bod 116). Místo leží v jiném místě (hospoda v Mirabaru,
// tábor u Longsaddle); Kánon, Místa, U stolu a dílna z toho skládají strom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { upravitKartu } from '../sdilene/hlavicka.js';
import { Kanon, leziV } from '../server/kanon-modul.js';
import { Zapisovac } from '../server/zapis.js';
import { kontrolaDat } from '../server/data.js';
import { sestavPrompt } from '../server/dilna.js';
import { Hub } from '../server/app.js';
import { rozlozit } from '../sdilene/sit.js';
import { docasneRepo, dokud, FalesnyObs } from './pomoc.js';

const misto = (id, nazev, { verejne = false, radky = [] } = {}) => `---
schema: 1
id: ${id}
typ: misto
nazev: "${nazev}"
verejne: ${verejne}
${radky.join('\n')}${radky.length ? '\n' : ''}aliases: []
vazby: []
tags: []
---
# ${nazev}

Text karty.
`;

async function repoSMisty() {
  const repo = await docasneRepo();
  const zapsat = async (slozka, id, text) => {
    await fs.mkdir(path.join(repo.c.kampan, slozka, id), { recursive: true });
    await fs.writeFile(path.join(repo.c.kampan, slozka, id, `${id}.md`), text);
  };
  await zapsat('mista', 'mirabar', misto('mirabar', 'Mirabar', { verejne: true, radky: ['popis_obrazu: "a dwarven mining city of grey stone"'] }));
  await zapsat('mista', 'komora', misto('komora', 'Komora nad koželužnou', { radky: ['lezi_v: "[[mirabar]]"'] }));
  await zapsat('mista', 'trh', misto('trh', 'Trh', { verejne: true, radky: ['lezi_v: "[[mirabar]]"'] }));
  await zapsat('mista', 'longsaddle', misto('longsaddle', 'Longsaddle'));
  await zapsat('npc', 'ilma', `---
schema: 1
id: ilma
typ: npc
nazev: Ilma
verejne: false
---
Hostinská.
`);
  return repo;
}

const radky = (text) => text.split('\n');

test('hlavička: lezi_v se vloží za přezdívky, přepíše jeden řádek a odebere se i s řádkem', () => {
  const puvodni = misto('komora', 'Komora');
  const s = upravitKartu(puvodni, { lezi_v: 'mirabar' });
  assert.deepEqual(radky(s).filter((r) => !radky(puvodni).includes(r)), ['lezi_v: "[[mirabar]]"']);
  assert.ok(s.indexOf('lezi_v') > s.indexOf('aliases') && s.indexOf('lezi_v') < s.indexOf('vazby'));
  const s2 = upravitKartu(s, { lezi_v: 'longsaddle' });
  assert.deepEqual(radky(s2).filter((r) => !radky(s).includes(r)), ['lezi_v: "[[longsaddle]]"']);
  assert.equal(radky(s2).length, radky(s).length);
  assert.equal(upravitKartu(s2, { lezi_v: null }), puvodni);
  // Odebrání neexistujícího klíče nic nezmění.
  assert.equal(upravitKartu(puvodni, { lezi_v: null }), puvodni);
  // Prázdné pole ze šablony: hodnota se doplní za dvojtečku, nápověda v komentáři zůstane na řádku.
  const zeSablony = misto('a', 'A', { radky: ['lezi_v: # "[[mirabar]]" = místo, ve kterém leží'] });
  const vyplnene = upravitKartu(zeSablony, { lezi_v: 'mirabar' });
  assert.match(vyplnene, /^lezi_v: "\[\[mirabar\]\]" # "\[\[mirabar\]\]" = místo, ve kterém leží$/m);
  assert.equal(radky(vyplnene).length, radky(zeSablony).length);
});

test('lezi_v se čte jen u místa a jen jako odkaz', () => {
  assert.equal(leziV({ id: 'a', typ: 'misto', lezi_v: '[[mirabar]]' }), 'mirabar');
  assert.equal(leziV({ id: 'a', typ: 'misto', lezi_v: '[[mirabar|Mirabar]]' }), 'mirabar');
  assert.equal(leziV({ id: 'a', typ: 'misto', lezi_v: 'mirabar' }), null);
  assert.equal(leziV({ id: 'a', typ: 'npc', lezi_v: '[[mirabar]]' }), null);
  assert.equal(leziV({ id: 'a', typ: 'misto', lezi_v: '[[a]]' }), null);
  assert.equal(leziV({ id: 'a', typ: 'misto' }), null);
});

test('Kánon: Leží v se nastaví, změní a zruší; jen místo v místě, bez kruhu', async () => {
  const repo = await repoSMisty();
  try {
    const k = new Kanon({ cesty: repo.c, zapisovac: new Zapisovac() });
    await k.nacist();
    assert.equal(k.entity.get('komora').leziV, 'mirabar');
    assert.equal(k.seznam('dm').entity.find((e) => e.id === 'komora').leziV, 'mirabar');

    const soubor = path.join(repo.c.kampan, 'mista', 'longsaddle', 'longsaddle.md');
    const puvodni = await fs.readFile(soubor, 'utf8');
    const r = await k.nastavitLeziV('longsaddle', 'mirabar');
    assert.equal(r.karta.leziV, 'mirabar');
    assert.match(await fs.readFile(soubor, 'utf8'), /^lezi_v: "\[\[mirabar\]\]"$/m);
    await k.nastavitLeziV('longsaddle', null);
    assert.equal(await fs.readFile(soubor, 'utf8'), puvodni);

    await assert.rejects(k.nastavitLeziV('mirabar', 'komora'), /nemůže být zároveň naopak/);
    await k.nastavitLeziV('longsaddle', 'komora');
    await assert.rejects(k.nastavitLeziV('mirabar', 'longsaddle'), /naopak/); // kruh přes dvě úrovně
    await assert.rejects(k.nastavitLeziV('mirabar', 'mirabar'), /sama na sebe/);
    await assert.rejects(k.nastavitLeziV('mirabar', 'ilma'), /jen v jiném místě/);
    await assert.rejects(k.nastavitLeziV('ilma', 'mirabar'), /jen u místa/);
    await assert.rejects(k.nastavitLeziV('mirabar', 'nikde'), /neexistuje/);
  } finally {
    await repo.smazat();
  }
});

test('pohled družiny: Leží v jen mezi místy, která družina zná', async () => {
  const repo = await repoSMisty();
  try {
    const k = new Kanon({ cesty: repo.c, zapisovac: new Zapisovac() });
    await k.nacist();
    const d = k.seznam('druzina');
    assert.equal(d.entity.find((e) => e.id === 'trh').leziV, 'mirabar');
    assert.equal(d.entity.find((e) => e.id === 'komora'), undefined);
    await k.nastavitLeziV('mirabar', 'longsaddle'); // Longsaddle družina nezná
    assert.equal(k.seznam('druzina').entity.find((e) => e.id === 'mirabar').leziV, null);
  } finally {
    await repo.smazat();
  }
});

test('Kontrola dat: lezi_v jen odkaz na existující místo, ne u jiného typu, bez kruhu', async () => {
  const repo = await repoSMisty();
  try {
    const prepsat = (slozka, id, text) => fs.writeFile(path.join(repo.c.kampan, slozka, id, `${id}.md`), text);
    await prepsat('mista', 'longsaddle', misto('longsaddle', 'Longsaddle', { radky: ['lezi_v: "[[nikde]]"'] }));
    await prepsat('npc', 'ilma', `---\nschema: 1\nid: ilma\ntyp: npc\nnazev: Ilma\nverejne: false\nlezi_v: "[[mirabar]]"\n---\n`);
    const hlaseni = async () => (await kontrolaDat(repo.c)).problemy.map((p) => `${path.basename(p.soubor)}: ${p.zprava}`);
    let p = await hlaseni();
    assert.ok(p.includes('longsaddle.md: lezi_v vede na neexistující místo [[nikde]]'), p.join('\n'));
    assert.ok(p.includes('ilma.md: lezi_v má smysl jen u místa (typ misto)'));
    assert.ok(!p.some((x) => x.startsWith('komora.md') || x.startsWith('trh.md')));

    await prepsat('mista', 'longsaddle', misto('longsaddle', 'Longsaddle', { radky: ['lezi_v: "[[ilma]]"'] }));
    await prepsat('mista', 'mirabar', misto('mirabar', 'Mirabar', { radky: ['lezi_v: mirabar'] }));
    p = await hlaseni();
    assert.ok(p.includes('longsaddle.md: lezi_v [[ilma]] není místo'));
    assert.ok(p.includes('mirabar.md: lezi_v musí být odkaz na místo, např. "[[mirabar]]"'));

    // Kruh: Mirabar v komoře, komora v Mirabaru
    await prepsat('mista', 'mirabar', misto('mirabar', 'Mirabar', { radky: ['lezi_v: "[[komora]]"'] }));
    p = await hlaseni();
    assert.ok(p.includes('mirabar.md: lezi_v tvoří kruh (místo nakonec leží samo v sobě)'));
    assert.ok(p.includes('komora.md: lezi_v tvoří kruh (místo nakonec leží samo v sobě)'));
  } finally {
    await repo.smazat();
  }
});

test('dílna: prompt nové kompozice dostane popis místa, ve kterém místo leží', () => {
  const styl = { styl: '', technika: '' };
  const rodic = { nazev: 'Mirabar', popisObrazu: 'a dwarven mining city of grey stone' };
  const p = sestavPrompt({ misto: { nazev: 'Komora', popisObrazu: 'a tiny attic room' }, rodic, styl });
  assert.match(p, /a tiny attic room/);
  assert.match(p, /It is located in Mirabar: a dwarven mining city of grey stone/);
  // Varianta podle předlohy kompozici nemění, okolí nepotřebuje.
  assert.doesNotMatch(sestavPrompt({ misto: { nazev: 'Komora' }, rodic, styl, predloha: true }), /located/);
  assert.doesNotMatch(sestavPrompt({ misto: { nazev: 'Komora' }, rodic: { nazev: 'X', popisObrazu: '' }, styl }), /located/);
});

test('API: Leží v z Kánonu se hned ukáže i v Místech a v promptu dílny', async () => {
  const repo = await repoSMisty();
  const hub = new Hub({ cesty: repo.c, obsKlient: new FalesnyObs(), gitSit: false, port: 0 });
  await hub.spustit();
  const poslat = async (cesta, metoda = 'GET', telo) => {
    const o = await fetch(hub.adresa + cesta, { method: metoda, headers: telo ? { 'Content-Type': 'application/json' } : {}, body: telo ? JSON.stringify(telo) : undefined });
    return { status: o.status, data: await o.json() };
  };
  try {
    const r = await poslat('/api/kanon/entita/longsaddle/lezi-v', 'PUT', { cil: 'mirabar' });
    assert.equal(r.status, 200);
    assert.equal(r.data.karta.leziV, 'mirabar');
    assert.equal(hub.mista.get('longsaddle').leziV, 'mirabar');
    const prompt = await poslat('/api/dilna/prompt?misto=longsaddle');
    assert.match(prompt.data.prompt, /located in Mirabar/);
    assert.equal((await poslat('/api/kanon/entita/mirabar/lezi-v', 'PUT', { cil: 'longsaddle' })).status, 400);
    const zrus = await poslat('/api/kanon/entita/longsaddle/lezi-v', 'PUT', { cil: null });
    assert.equal(zrus.data.karta.leziV, null);
    assert.equal(hub.mista.get('longsaddle').leziV, null);
    await dokud(async () => !(await poslat('/api/kontrola')).data.problemy.some((p) => p.soubor.includes('mista')));
  } finally {
    await hub.zastavit();
    await repo.smazat();
  }
});

test('síť: místo se drží u místa, ve kterém leží', () => {
  const uzly = [{ id: 'mirabar', typ: 'misto' }, { id: 'komora', typ: 'misto' }, { id: 'leta', typ: 'postava' }, { id: 'a', typ: 'npc' }, { id: 'b', typ: 'npc' }];
  const bezPevne = rozlozit(uzly, [['komora', 'mirabar'], ['komora', 'leta'], ['leta', 'a'], ['leta', 'b']]);
  const sPevnou = rozlozit(uzly, [['komora', 'mirabar', 'lezi_v'], ['komora', 'leta'], ['leta', 'a'], ['leta', 'b']]);
  const vzdal = (p, a, b) => Math.hypot(p.get(a).x - p.get(b).x, p.get(a).y - p.get(b).y);
  assert.ok(vzdal(sPevnou, 'komora', 'mirabar') < vzdal(bezPevne, 'komora', 'mirabar'));
});
