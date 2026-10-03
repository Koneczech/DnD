import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Sezeni, radekPoznamky, idSezeni, casIso } from '../server/sezeni.js';
import { DataKampane, kontrolaDat } from '../server/data.js';
import { Zapisovac } from '../server/zapis.js';
import { rozebrat } from '../server/frontmatter.js';
import { docasneRepo } from './pomoc.js';

async function priprava() {
  const repo = await docasneRepo();
  await fs.appendFile(repo.c.kampanYaml, 'hraci:\n  - jmeno: Martin\n    postava: Tusker\n  - jmeno: Anna\n');
  const zapisovac = new Zapisovac();
  const data = new DataKampane({ cesty: repo.c, zapisovac });
  await data.nacist();
  const sezeni = new Sezeni({ cesty: repo.c, data, zapisovac });
  return { ...repo, data, sezeni };
}

const kdy = new Date(2026, 9, 3, 18, 5);

test('id sezení a řádek poznámky', () => {
  assert.equal(idSezeni(3), 's03');
  assert.equal(idSezeni(12), 's12');
  assert.equal(radekPoznamky('Tusker padl', kdy), '- 18:05 — Tusker padl\n');
  assert.equal(radekPoznamky('první\ndruhý', kdy), '- 18:05 — první\n  druhý\n');
  assert.equal(casIso(kdy), '2026-10-03T18:05');
});

test('Zahájit sezení zvýší číslo, založí soubor sezení a projde Kontrolou dat', async () => {
  const { c, data, sezeni, smazat } = await priprava();
  try {
    const r = await sezeni.zahajit({ pritomni: ['Martin', 'Anna'], kdy });
    assert.equal(r.cislo, 2);
    assert.equal(r.soubor, 'kampan/sezeni/s02/s02.md');
    assert.equal(data.stav.sezeni, 2);
    assert.equal(data.stav.sezeniBezi, true);
    const stavMd = rozebrat(await fs.readFile(c.stav, 'utf8'));
    assert.equal(stavMd.data.sezeni_bezi, true);
    assert.match(stavMd.telo, /Tělo souboru/);

    const s = rozebrat(await fs.readFile(path.join(c.kampan, 'sezeni', 's02', 's02.md'), 'utf8'));
    assert.deepEqual(
      { id: s.data.id, typ: s.data.typ, cislo: s.data.cislo, datum: s.data.datum_realne, zacatek: s.data.zacatek, pritomni: s.data.pritomni, verejne: s.data.verejne },
      { id: 's02', typ: 'sezeni', cislo: 2, datum: '2026-10-03', zacatek: '2026-10-03T18:05', pritomni: ['Martin', 'Anna'], verejne: false },
    );
    assert.match(s.telo, /- 18:05 — Začátek sezení/);
    assert.deepEqual((await kontrolaDat(c)).problemy, []);

    await assert.rejects(sezeni.zahajit({ kdy }), /už běží/);
    assert.deepEqual((await sezeni.verejne()).hraci, [{ jmeno: 'Martin', postava: 'Tusker' }, { jmeno: 'Anna', postava: null }]);
  } finally {
    await smazat();
  }
});

test('Poznámky jdou do běžícího sezení, mimo sezení do priprava.md', async () => {
  const { c, sezeni, smazat } = await priprava();
  try {
    const mimo = await sezeni.poznamka('Připravit tábor', { kdy });
    assert.equal(mimo.soubor, 'kampan/sezeni/priprava.md');
    await sezeni.zahajit({ kdy });
    // Souběžné poznámky se nesmí přepsat
    await Promise.all([1, 2, 3].map((n) => sezeni.poznamka(`poznámka ${n}`, { kdy })));
    const text = await fs.readFile(path.join(c.kampan, 'sezeni', 's02', 's02.md'), 'utf8');
    for (const n of [1, 2, 3]) assert.match(text, new RegExp(`- 18:05 — poznámka ${n}`));
    assert.match(await fs.readFile(path.join(c.kampan, 'sezeni', 'priprava.md'), 'utf8'), /Připravit tábor/);
    await assert.rejects(sezeni.poznamka('   '), /prázdná/);
    assert.deepEqual((await kontrolaDat(c)).problemy, []);
  } finally {
    await smazat();
  }
});

test('Ukončit sezení zapíše konec a vypne příznak; bez sezení vrátí chybu', async () => {
  const { c, data, sezeni, smazat } = await priprava();
  try {
    await assert.rejects(sezeni.ukoncit(), /Žádné sezení/);
    await sezeni.zahajit({ kdy });
    await sezeni.poznamka('boj v táboře', { kdy });
    const r = await sezeni.ukoncit({ kdy: new Date(2026, 9, 3, 22, 41) });
    assert.equal(r.cislo, 2);
    assert.equal(data.stav.sezeniBezi, false);
    const s = rozebrat(await fs.readFile(path.join(c.kampan, 'sezeni', 's02', 's02.md'), 'utf8'));
    assert.equal(s.data.konec, '2026-10-03T22:41');
    assert.match(s.telo, /boj v táboře\n- 22:41 — Konec sezení\n$/);
    // Další sezení dostane další číslo
    assert.equal((await sezeni.zahajit({ kdy })).cislo, 3);
  } finally {
    await smazat();
  }
});

test('Zahájit odmítne přepsat existující soubor sezení', async () => {
  const { c, sezeni, smazat } = await priprava();
  try {
    await fs.mkdir(path.join(c.kampan, 'sezeni', 's02'), { recursive: true });
    await fs.writeFile(path.join(c.kampan, 'sezeni', 's02', 's02.md'), 'cizí obsah');
    await assert.rejects(sezeni.zahajit({ kdy }), /už existuje/);
    assert.equal(await fs.readFile(path.join(c.kampan, 'sezeni', 's02', 's02.md'), 'utf8'), 'cizí obsah');
  } finally {
    await smazat();
  }
});
