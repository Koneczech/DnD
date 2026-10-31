// Návrh po sezení (⚠ bod 153): doplňování karet, zápis sezení, nové karty, kontrola návrhu a zápis.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  doplnitTelo, zapsatSezeni, textNoveKarty, upravitExistujici, overitNavrh, normalizujNavrh,
} from '../sdilene/navrh-sezeni.js';
import { nacistEntitu } from '../sdilene/karta-kanonu.js';
import { Kanon } from '../server/kanon-modul.js';
import { NavrhSezeni } from '../server/navrh-sezeni.js';
import { Zapisovac } from '../server/zapis.js';
import { docasneRepo } from './pomoc.js';

const JORUN = `---
schema: 1
id: jorun
typ: npc
nazev: Jorun
verejne: true
druh: člověk
osud: zije
kde: "[[longsaddle]]"
vazby: ["[[longsaddle]]"] # komentář u vazeb
---
# Jorun

Cinkající kupec.

## Co ví družina

- Najal družinu jako doprovod. %%zná%%

## Příběh

Kupec z Mirabaru.

## DM

Tajemství.
`;

const LONGSADDLE = `---
schema: 1
id: longsaddle
typ: misto
nazev: Longsaddle
verejne: true
vazby: []
---
# Longsaddle
`;

const TUSKER = `---
schema: 1
id: tusker
typ: postava
nazev: Tusker
verejne: true
vazby: []
---
# Tusker
`;

const S03 = `---
schema: 1
id: s03
typ: sezeni
nazev: Sezení 3
verejne: false
cislo: 3
---

# Sezení 3

## Poznámky ze stolu

- 12:20 (19. Eleint) — Začátek sezení

## Shrnutí

## Otevřené nitky

- stará nitka
`;

const UM_JORUN = { slozka: 'npc', soubor: 'kampan/npc/jorun/jorun.md', slozkaEntity: true };
const dukaz = [{ cas: 'd1 0:42:02', citat: 'něco' }];

test('doplnit: odrážka do Co ví družina na konec hlavní části, odkrytá podle zna', () => {
  const telo = JORUN.split('---\n').slice(2).join('---\n');
  const novy = doplnitTelo(telo, { oddil: 'Co ví družina', typ_bloku: 'odrazka', text: 'Zůstal v Longsaddle.', zna: true }, 'npc');
  assert.match(novy, /- Najal družinu jako doprovod\. %%zná%%\n- Zůstal v Longsaddle\. %%zná%%\n\n## Příběh/);
  // Bez zna zůstane skrytá.
  assert.match(doplnitTelo(telo, { oddil: 'Co ví družina', typ_bloku: 'odrazka', text: 'Tajně.' }, 'npc'), /- Tajně\.\n/);
});

test('doplnit: odstavec do existujícího oddílu, existující text zůstane', () => {
  const telo = JORUN.split('---\n').slice(2).join('---\n');
  const novy = doplnitTelo(telo, { oddil: 'Příběh', typ_bloku: 'odstavec', text: 'Na cestě\nk Triboaru.' }, 'npc');
  assert.match(novy, /## Příběh\n\nKupec z Mirabaru\.\n\nNa cestě k Triboaru\.\n\n## DM/);
  assert.ok(novy.includes('Cinkající kupec.'));
});

test('doplnit: chybějící oddíl vznikne na správném místě (před DM) a část zachová řádky', () => {
  const telo = '# X\n\n## Co ví družina\n\n- a\n\n## DM\n\nb\n';
  const novy = doplnitTelo(telo, { oddil: 'Jak ho hrát', typ_bloku: 'cast', text: 'Mluví pomalu.\n\n- Cinká.' }, 'npc');
  assert.match(novy, /## Co ví družina\n\n- a\n\n## Jak ho hrát\n\nMluví pomalu\.\n\n- Cinká\.\n\n## DM/);
});

test('doplnit: oddíl DM nejde odkrýt družině', () => {
  assert.throws(() => doplnitTelo('## DM\n\nx\n', { oddil: 'DM', typ_bloku: 'odrazka', text: 'y', zna: true }, 'npc'), /DM/);
});

test('zápis sezení: doplní prázdný oddíl, chybějící založí v pořadí šablony a poznámky zůstanou', () => {
  const telo = S03.split('---\n').slice(2).join('---\n');
  let novy = zapsatSezeni(telo, 'shrnuti', '1. Boj v táboře.');
  assert.match(novy, /## Shrnutí\n\n1\. Boj v táboře\.\n\n## Otevřené nitky/);
  novy = zapsatSezeni(novy, 'poklady', '- 30 zl');
  assert.match(novy, /1\. Boj v táboře\.\n\n## Poklady\n\n- 30 zl\n\n## Otevřené nitky/);
  novy = zapsatSezeni(novy, 'otevrene_nitky', '- nová nitka');
  assert.match(novy, /- stará nitka\n\n- nová nitka\n$/);
  assert.ok(novy.includes('- 12:20 (19. Eleint) — Začátek sezení'));
});

test('nová karta: hlavička podle typu, vazby, zdroj a důkaz, tělo z návrhu', () => {
  const k = textNoveKarty({
    op: 'nova_karta', typ: 'npc', karta_id: 'kapitan-zrzek', nazev: 'Kapitán Zrzek',
    hlavicka: { druh: 'člověk', kde: '[[longsaddle]]' }, vazby: ['[[longsaddle]]'],
    telo: '## Co ví družina\n\n- Vede lupiče. %%zná%%', dukaz,
  }, { sablona: null, dnes: '2026-10-28', zdroj: 'sezení 3 (24. 10. 2026), přepis nahrávky' });
  assert.equal(k.soubor, 'kampan/npc/kapitan-zrzek/kapitan-zrzek.md');
  const e = nacistEntitu(k.text, { slozka: 'npc', soubor: k.soubor, slozkaEntity: true });
  assert.equal(e.nazev, 'Kapitán Zrzek');
  assert.equal(e.verejne, false);
  assert.deepEqual(e.vazby, ['longsaddle']);
  assert.equal(e.odkazyPole.kde, 'longsaddle');
  assert.match(k.text, /^dukaz: \["d1 0:42:02"\]$/m);
  assert.match(k.text, /^zdroj: "sezení 3/m);
  assert.match(k.text, /- Vede lupiče\. %%zná%%\n$/);
});

test('hráčský kánon: sezení, kdo, dořešit a oddíly Co se stalo a Důsledek', () => {
  const k = textNoveKarty({
    op: 'kanon', karta_id: 's03-boj-v-tabore', nazev: 'Družina přepadla tábor', kdo: ['parta'],
    doresit: true, vazby: ['[[s03]]'], co_se_stalo: 'Zaútočili za úsvitu.', dusledek: 'Malk dostal zásilku.', dukaz,
  }, { sablona: null, dnes: '2026-10-28', cislo: 's03' });
  assert.equal(k.soubor, 'kampan/kanon/s03-boj-v-tabore.md');
  const e = nacistEntitu(k.text, { slozka: 'kanon', soubor: k.soubor, slozkaEntity: false });
  assert.equal(e.typ, 'kanon');
  assert.equal(e.verejne, true);
  assert.equal(e.udaje.sezeni, 's03');
  assert.equal(e.udaje.doresit, 'ano');
  assert.match(k.text, /## Co se stalo\n\nZaútočili za úsvitu\.\n\n## Důsledek\n\nMalk dostal zásilku\.\n$/);
});

test('úprava karty: pole hlídá původní hodnotu, vazba přidá vazbu i vztah, zbytek hlavičky zůstane', () => {
  const najit = (id) => ({ longsaddle: { id, typ: 'misto', nazev: 'Longsaddle' }, tusker: { id, typ: 'postava', nazev: 'Tusker' } })[id];
  assert.throws(() => upravitExistujici(JORUN, [{ op: 'pole', pole: 'osud', puvodni: 'mrtvy', nove: 'nezvestny' }], UM_JORUN, najit), /má teď „zije“/);
  const novy = upravitExistujici(JORUN, [
    { op: 'pole', pole: 'osud', puvodni: 'zije', nove: 'nezvestny' },
    { op: 'vazba', cil: '[[tusker]]', popis: 'najal ho', postoj: 1 },
  ], UM_JORUN, najit);
  assert.match(novy, /^osud: nezvestny$/m);
  assert.match(novy, /^vazby: \["\[\[longsaddle\]\]", "\[\[tusker\]\]"\] # komentář u vazeb$/m);
  assert.match(novy, /s: "\[\[tusker\]\]", popis: "najal ho", postoj: 1/);
  assert.match(novy, /^druh: člověk$/m);
  assert.ok(novy.endsWith('Tajemství.\n'));
});

test('kontrola návrhu: neexistující karta, chybějící důkaz, dvojí id, id kánonu a nová karta v témže návrhu', () => {
  const karty = { jorun: { id: 'jorun', typ: 'npc', nazev: 'Jorun', pole: { osud: 'zije' } }, tusker: { id: 'tusker', typ: 'postava', nazev: 'Tusker', pole: {} }, s03: { id: 's03', typ: 'sezeni', pole: {} } };
  const navrh = normalizujNavrh({
    schema: 1, sezeni: 's03', operace: [
      { id: 'o1', op: 'doplnit', karta_id: 'neni', oddil: 'Příběh', typ_bloku: 'odstavec', text: 'x', dukaz, jistota: 'jista' },
      { id: 'o2', op: 'doplnit', karta_id: 'jorun', oddil: 'Příběh', typ_bloku: 'odstavec', text: 'x', jistota: 'jista' },
      { id: 'o2', op: 'kanon', karta_id: 'boj', nazev: 'Boj', kdo: ['tusker'], co_se_stalo: 'x', dukaz, jistota: 'jista' },
      { id: 'o4', op: 'nova_karta', typ: 'npc', karta_id: 'zrzek', nazev: 'Zrzek', dukaz, jistota: 'jista' },
      { id: 'o5', op: 'doplnit', karta_id: 'zrzek', oddil: 'Co ví družina', typ_bloku: 'odrazka', text: 'Vede lupiče.', zna: true, dukaz, jistota: 'jista' },
      { id: 'o6', op: 'pole', karta_id: 'jorun', pole: 'osud', puvodni: 'zije', nove: 'mrtvy', dukaz, jistota: 'nutno_potvrdit' },
      { id: 'o7', op: 'sezeni', sekce: 'shrnuti', obsah: '1. …', dukaz, jistota: 'jista' },
    ],
  });
  const r = overitNavrh(navrh, { cislo: 's03', najit: (id) => karty[id] });
  assert.match(r[0].problemy.join(), /karta „neni“ neexistuje/);
  assert.match(r[1].problemy.join(), /chybí důkaz/);
  assert.match(r[2].problemy.join(), /dvakrát/);
  assert.match(r[2].problemy.join(), /začínat „s03-“/);
  assert.deepEqual(r[3].problemy, []);
  assert.deepEqual(r[4].problemy, []);
  assert.deepEqual(r[5].problemy, []);
  assert.deepEqual(r[6].problemy, []);
});

async function zapsatSoubor(koren, rel, text) {
  const cesta = path.join(koren, ...rel.split('/'));
  await fs.mkdir(path.dirname(cesta), { recursive: true });
  await fs.writeFile(cesta, text);
}

test('Návrh po sezení: rozhodnutí DM, zápis jen schválených, opakování nic nezdvojí', async () => {
  const repo = await docasneRepo();
  try {
    await zapsatSoubor(repo.koren, 'kampan/npc/jorun/jorun.md', JORUN);
    await zapsatSoubor(repo.koren, 'kampan/mista/longsaddle/longsaddle.md', LONGSADDLE);
    await zapsatSoubor(repo.koren, 'kampan/postavy/tusker/tusker.md', TUSKER);
    await zapsatSoubor(repo.koren, 'kampan/sezeni/s03/s03.md', S03);
    await zapsatSoubor(repo.koren, 'hub/.stav/navrhy/s03.yaml', `schema: 2
sezeni: s03
stav: finalni
scenar_verze: 47
zdroj: "sezení 3 (24. 10. 2026), přepis nahrávky"
operace:
  - id: o1
    op: doplnit
    karta_id: jorun
    oddil: Co ví družina
    typ_bloku: odrazka
    text: Zůstal v Longsaddle.
    zna: true
    dukaz: [{ cas: "d2 0:03:39", citat: "Jorun zůstal" }]
    jistota: jista
  - id: o2
    op: kanon
    karta_id: s03-boj-v-tabore
    nazev: Družina přepadla tábor
    kdo: [tusker]
    vazby: ["[[tusker]]", "[[s03]]"]
    co_se_stalo: Zaútočili za úsvitu.
    dusledek: Tábor padl.
    dukaz: [{ cas: "d2 1:00:00", citat: "útok" }]
    jistota: jista
  - id: o3
    op: sezeni
    sekce: shrnuti
    obsah: "1. Boj v táboře."
    dukaz: [{ cas: "d2 0:00:10", citat: "začínáme" }]
    jistota: jista
  - id: o4
    op: udalost
    datum: { rok: 1491, mesic: Eleint, den: 20 }
    text: Přepadení tábora lupičů
    vazby: ["[[s03-boj-v-tabore]]"]
    dukaz: [{ cas: "d2 1:00:00", citat: "útok" }]
    jistota: jista
  - id: o5
    op: pole
    karta_id: jorun
    pole: osud
    puvodni: zije
    nove: mrtvy
    dukaz: [{ cas: "d2 1:10:00", citat: "?" }]
    jistota: nutno_potvrdit
`);
    const zapisovac = new Zapisovac();
    const kanon = new Kanon({ cesty: repo.c, zapisovac });
    await kanon.nacist();
    const pridane = [];
    const kalendar = { overUdalost: (v) => v, pridat: async (v) => { pridane.push(v); return { vysledek: 'zapsano' }; } };
    const n = new NavrhSezeni({ cesty: repo.c, kanon, kalendar, zapisovac });

    const d = await n.nacist('s03');
    assert.equal(d.operace.length, 5);
    assert.ok(d.operace.every((o) => o.problemy.length === 0), JSON.stringify(d.operace.map((o) => o.problemy)));
    assert.match(d.operace[0].ukazka.po, /Zůstal v Longsaddle\. %%zná%%/);
    assert.equal(d.pocty.nerozhodnuto, 5);

    // DM upraví text o1 a schválí o1–o4; o5 zamítne.
    await n.rozhodnout('s03', 'o1', { stav: 'schvaleno', upraveno: { text: 'Jorun zůstal v Longsaddle.' } });
    for (const id of ['o2', 'o3', 'o4']) await n.rozhodnout('s03', id, { stav: 'schvaleno' });
    await n.rozhodnout('s03', 'o5', { stav: 'zamitnuto' });
    await assert.rejects(n.rozhodnout('s03', 'o1', { upraveno: { dukaz: 'x' } }), /upravit nejde/);

    const v = await n.zapsat('s03');
    assert.equal(v.operaci, 4);
    const jorun = await fs.readFile(path.join(repo.koren, 'kampan/npc/jorun/jorun.md'), 'utf8');
    assert.match(jorun, /- Jorun zůstal v Longsaddle\. %%zná%%/);
    assert.match(jorun, /^osud: zije$/m, 'zamítnutá změna osudu se nezapsala');
    const kanonText = await fs.readFile(path.join(repo.koren, 'kampan/kanon/s03-boj-v-tabore.md'), 'utf8');
    assert.match(kanonText, /^dukaz: \["d2 1:00:00"\]$/m);
    const sezeni = await fs.readFile(path.join(repo.koren, 'kampan/sezeni/s03/s03.md'), 'utf8');
    assert.match(sezeni, /## Shrnutí\n\n1\. Boj v táboře\.\n\n## Otevřené nitky/);
    assert.ok(sezeni.includes('- 12:20 (19. Eleint) — Začátek sezení'));
    assert.deepEqual(pridane.map((u) => u.vazby), [['s03-boj-v-tabore']]);
    const zapsano = JSON.parse(await fs.readFile(path.join(repo.koren, 'hub/.stav/navrhy/s03.zapsano.json'), 'utf8'));
    assert.deepEqual(zapsano.zapsane.sort(), ['o1', 'o2', 'o3', 'o4']);
    assert.deepEqual(zapsano.zamitnute, ['o5']);
    assert.deepEqual(zapsano.upravene, ['o1']);
    assert.match(zapsano.navrh_hash, /^[0-9a-f]{16}$/);
    assert.ok(kanon.entity.has('s03-boj-v-tabore'));

    // Podruhé už není co zapsat a zapsanou operaci nejde měnit.
    await assert.rejects(n.zapsat('s03'), /Není schválená žádná operace/);
    await assert.rejects(n.rozhodnout('s03', 'o1', { stav: 'zamitnuto' }), /už je zapsaná/);
    const znovu = await n.nacist('s03');
    assert.equal(znovu.pocty.zapsano, 4);
  } finally {
    await repo.smazat();
  }
});

test('Návrh po sezení: schválená operace s chybou zastaví celý zápis dřív, než se cokoli zapíše', async () => {
  const repo = await docasneRepo();
  try {
    await zapsatSoubor(repo.koren, 'kampan/npc/jorun/jorun.md', JORUN);
    await zapsatSoubor(repo.koren, 'kampan/mista/longsaddle/longsaddle.md', LONGSADDLE);
    await zapsatSoubor(repo.koren, 'hub/.stav/navrhy/s03.yaml', `schema: 2
sezeni: s03
stav: finalni
operace:
  - { id: o1, op: doplnit, karta_id: jorun, oddil: Příběh, typ_bloku: odstavec, text: Nový odstavec., dukaz: [{ cas: "d1 0:00:01" }], jistota: jista }
  - { id: o2, op: doplnit, karta_id: neexistuje, oddil: Příběh, typ_bloku: odstavec, text: x, dukaz: [{ cas: "d1 0:00:01" }], jistota: jista }
`);
    const zapisovac = new Zapisovac();
    const kanon = new Kanon({ cesty: repo.c, zapisovac });
    await kanon.nacist();
    const n = new NavrhSezeni({ cesty: repo.c, kanon, kalendar: null, zapisovac });
    await n.rozhodnout('s03', 'o1', { stav: 'schvaleno' });
    await n.rozhodnout('s03', 'o2', { stav: 'schvaleno' });
    await assert.rejects(n.zapsat('s03'), /o2/);
    assert.equal(await fs.readFile(path.join(repo.koren, 'kampan/npc/jorun/jorun.md'), 'utf8'), JORUN);
  } finally {
    await repo.smazat();
  }
});
