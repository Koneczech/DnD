// Karta sezení ve wiki (⚠ bod 158): dopočítané údaje, pohled družiny a části textu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Kanon } from '../server/kanon-modul.js';
import { Zapisovac } from '../server/zapis.js';
import { castiSezeni, stavZapisu, delkaMinut, delkaText, pocetPoznamek, bezPoznamekZeStolu } from '../sdilene/sezeni-karta.js';
import { docasneRepo } from './pomoc.js';

async function zapsat(koren, rel, text) {
  const cesta = path.join(koren, ...rel.split('/'));
  await fs.mkdir(path.dirname(cesta), { recursive: true });
  await fs.writeFile(cesta, text);
}

const SEZENI_2 = `---
schema: 1
id: s02
typ: sezeni
nazev: "Sezení 2 — Long Road"
verejne: false
cislo: 2
datum_realne: 2026-09-11
zacatek: "2026-09-11T18:49"
konec: "2026-09-11T22:56"
pritomni: [Martin, Zaky]
harptos_zacatek: { rok: 1491, mesic: Eleint, den: 13 }
harptos_konec: { rok: 1491, mesic: Eleint, den: 15 }
vazby: ["[[jorun]]", "[[tusker]]"]
---
# Sezení 2 — Long Road

## Shrnutí

Šli po cestě.

## Tajemství a stopy

- [x] Jorun cinká
- [ ] Jorun něco skrývá

## DM — Co fungovalo

Pomalé.
`;

const SEZENI_3 = `---
schema: 1
id: s03
typ: sezeni
nazev: Sezení 3
verejne: false
cislo: 3
datum_realne: 2026-10-24
zacatek: 2026-10-24T12:20
konec: 2026-10-24T16:45
pritomni: [Martin]
harptos_zacatek: { rok: 1491, mesic: Eleint, den: 19 }
harptos_konec: { rok: 1491, mesic: Eleint, den: 20 }
---
# Sezení 3

## Poznámky ze stolu

- 12:20 (19. Eleint) — Začátek sezení
- 16:45 (20. Eleint) — Konec sezení (doplněno podle záznamu Hubu)
`;

const kanon = (id, sezeni, verejne, vazby, doresit = false) => `---
schema: 1
id: ${id}
typ: kanon
nazev: "Záznam ${id}"
verejne: ${verejne}
sezeni: ${sezeni}
kdo: [parta]
doresit: ${doresit}
vazby: ${JSON.stringify(vazby)}
---
## Co se stalo

Něco.

## Důsledek

Nic.
`;

async function repoSeSezenim() {
  const repo = await docasneRepo();
  await zapsat(repo.koren, 'kampan/sezeni/s02/s02.md', SEZENI_2);
  await zapsat(repo.koren, 'kampan/sezeni/s03/s03.md', SEZENI_3);
  await zapsat(repo.koren, 'kampan/postavy/tusker/tusker.md', '---\nschema: 1\nid: tusker\ntyp: postava\nnazev: Tusker\nverejne: true\nhrac: Martin\n---\n# Tusker\n');
  await zapsat(repo.koren, 'kampan/npc/jorun/jorun.md', '---\nschema: 1\nid: jorun\ntyp: npc\nnazev: Jorun\nverejne: true\n---\n# Jorun\n');
  await zapsat(repo.koren, 'kampan/npc/tajny/tajny.md', '---\nschema: 1\nid: tajny\ntyp: npc\nnazev: Tajný\nverejne: false\n---\n# Tajný\n');
  await zapsat(repo.koren, 'kampan/mista/brod/brod.md', '---\nschema: 1\nid: brod\ntyp: misto\nnazev: Brod\nverejne: true\n---\n# Brod\n');
  await zapsat(repo.koren, 'kampan/kanon/s02-brod.md', kanon('s02-brod', 's02', true, ['[[brod]]', '[[s02]]'], true));
  await zapsat(repo.koren, 'kampan/kanon/s02-tajne.md', kanon('s02-tajne', 's02', false, ['[[tajny]]']));
  return repo;
}

test('karta sezení: údaje, hráčský kánon, kdo a kde, předchozí a další, zápis', async () => {
  const repo = await repoSeSezenim();
  try {
    const k = new Kanon({ cesty: repo.c, zapisovac: new Zapisovac() });
    await k.nacist();
    const s2 = k.karta('s02', 'dm').sezeni;
    assert.equal(s2.cislo, 2);
    assert.deepEqual(s2.hrano, { datum: '11. 9. 2026', od: '18:49', do: '22:56', minut: 247 });
    assert.deepEqual(s2.veHre, { text: '13.–15. Eleint 1491 DR', dni: 3 });
    assert.equal(s2.predchozi, null);
    assert.equal(s2.dalsi.id, 's03');
    assert.deepEqual(s2.kanon.map((x) => [x.id, x.doresit, x.verejne]), [['s02-brod', true, true], ['s02-tajne', false, false]]);
    assert.equal(s2.druzinaVidi, 1);
    // Kdo a kde: vazby sezení a jeho kánonu, bez postav hráčů a sezení samotného.
    assert.deepEqual(s2.kdoAKde.map((x) => x.id), ['brod', 'jorun', 'tajny']);
    assert.deepEqual(s2.uStolu, [{ hrac: 'Martin', postava: { id: 'tusker', nazev: 'Tusker' } }, { hrac: 'Zaky', postava: null }]);
    assert.equal(s2.zapis.stav, 'zapsano');

    const s3 = k.karta('s03', 'dm').sezeni;
    assert.equal(s3.zapis.stav, 'ceka');
    assert.equal(s3.zapis.navrh, null);
    assert.equal(s3.zapis.poznamek, 2);
    assert.equal(s3.predchozi.id, 's02');
    // Nezapsané sezení s3 nemá v Kvalitě kánonu chybu („doplněno“ je v Poznámkách ze stolu).
    assert.deepEqual(k.kvalita().karty.find((x) => x.id === 's03')?.problemy ?? [], []);
  } finally {
    await repo.smazat();
  }
});

test('karta sezení: návrh po sezení v hub/.stav/navrhy/ mění stav zápisu a Kvalitu kánonu', async () => {
  const repo = await repoSeSezenim();
  try {
    const k = new Kanon({ cesty: repo.c, zapisovac: new Zapisovac() });
    await zapsat(repo.koren, 'hub/.stav/navrhy/s03.yaml', 'schema: 2\nstav: predbezny\noperace:\n  - { id: o1, op: doplnit }\n  - { id: o2, op: doplnit }\n');
    await k.nacist();
    assert.deepEqual(k.karta('s03', 'dm').sezeni.zapis.navrh, { stav: 'predbezny', operaci: 2 });
    assert.deepEqual(k.kvalita().karty.find((x) => x.id === 's03')?.problemy ?? [], []);
    await zapsat(repo.koren, 'hub/.stav/navrhy/s03.yaml', 'schema: 2\nstav: finalni\noperace: []\n');
    await k.obnovitNavrhy();
    assert.equal(k.karta('s03', 'dm').sezeni.zapis.navrh.stav, 'finalni');
    assert.match(k.kvalita().karty.find((x) => x.id === 's03').problemy.map((p) => p.zprava).join(' '), /Návrh po sezení je finální/);
  } finally {
    await repo.smazat();
  }
});

test('karta sezení: družina ji vidí podle hráčského kánonu, z textu nic', async () => {
  const repo = await repoSeSezenim();
  try {
    const k = new Kanon({ cesty: repo.c, zapisovac: new Zapisovac() });
    await k.nacist();
    const ids = k.seznam('druzina').entity.filter((e) => e.typ === 'sezeni').map((e) => e.id);
    assert.deepEqual(ids, ['s02'], 's03 nemá veřejný kánon, s02 má (verejne: false na kartě sezení nevadí)');
    const karta = k.karta('s02', 'druzina');
    assert.equal(karta.telo, '');
    assert.deepEqual(karta.druzina, []);
    assert.deepEqual(karta.sezeni.kanon.map((x) => x.id), ['s02-brod']);
    assert.deepEqual(karta.sezeni.kdoAKde.map((x) => x.id), ['brod'], 'jen karty, které družina zná, a ne holé vazby sezení');
    assert.deepEqual(karta.sezeni.uStolu, []);
    assert.equal(karta.sezeni.zapis, null);
    assert.equal(karta.sezeni.dalsi, null, 'sezení 3 družina nevidí');
    assert.throws(() => k.karta('s03', 'druzina'), /neexistuje/);
  } finally {
    await repo.smazat();
  }
});

test('části textu sezení: shrnutí, ostatní, DM a Poznámky ze stolu zvlášť', () => {
  const c = castiSezeni(SEZENI_2.split('---\n').slice(2).join('---\n') + '\n## Poznámky ze stolu\n\n- 18:49 — Začátek\n\n### Vnořené\n\nDál poznámky.\n');
  assert.match(c.uvod, /^# Sezení 2/);
  assert.match(c.shrnuti, /^## Shrnutí\n\nŠli po cestě\./);
  assert.match(c.ostatni, /Tajemství a stopy/);
  assert.doesNotMatch(c.ostatni, /Shrnutí|DM|Poznámky/);
  assert.match(c.dm, /^## DM — Co fungovalo/);
  assert.match(c.poznamky, /### Vnořené\n\nDál poznámky\./);
  assert.equal(pocetPoznamek(SEZENI_3), 2);
  assert.doesNotMatch(bezPoznamekZeStolu(SEZENI_3), /doplněno/);
});

test('stav zápisu a délka sezení', () => {
  assert.equal(stavZapisu({ zapsano: true, konec: false, posledni: true }), 'zapsano');
  assert.equal(stavZapisu({ zapsano: false, konec: false, posledni: true }), 'bezi');
  assert.equal(stavZapisu({ zapsano: false, konec: true, posledni: true }), 'ceka');
  assert.equal(stavZapisu({ zapsano: false, konec: false, posledni: false }), 'ceka');
  assert.equal(delkaMinut('2026-10-24T12:20', '2026-10-24T16:45'), 265);
  assert.equal(delkaMinut('2026-10-24T12:20', null), null);
  assert.equal(delkaText(265), '4 h 25 min');
  assert.equal(delkaText(240), '4 h');
  assert.equal(delkaText(45), '45 min');
});
