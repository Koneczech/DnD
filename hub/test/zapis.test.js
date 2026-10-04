import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { zapsatAtomicky, Zapisovac, ZamcenySouborError, PRIPONA_DOCASNA } from '../server/zapis.js';
import { docasneRepo, dokud } from './pomoc.js';

const chybaZamku = (kod = 'EBUSY') => Object.assign(new Error(`${kod}: resource busy or locked`), { code: kod });

async function docasneSoubory(slozka) {
  return (await fs.readdir(slozka)).filter((s) => s.endsWith(PRIPONA_DOCASNA));
}

test('atomický zápis přepíše soubor a nenechá dočasné soubory', async () => {
  const { koren, smazat } = await docasneRepo();
  try {
    const soubor = path.join(koren, 'kampan', 'stav.md');
    const { pokusu } = await zapsatAtomicky(soubor, 'nový obsah');
    assert.equal(pokusu, 1);
    assert.equal(await fs.readFile(soubor, 'utf8'), 'nový obsah');
    assert.deepEqual(await docasneSoubory(path.dirname(soubor)), []);
  } finally {
    await smazat();
  }
});

test('zámek uvolněný během limitu: zápis projde opakováním', async (t) => {
  const { koren, smazat } = await docasneRepo();
  const puvodni = fs.rename;
  let selhani = 0;
  t.after(() => mock.restoreAll());
  mock.method(fs, 'rename', async (...a) => {
    if (selhani < 2) {
      selhani++;
      throw chybaZamku('EPERM');
    }
    return puvodni(...a);
  });
  try {
    const soubor = path.join(koren, 'kampan', 'stav.md');
    const { pokusu } = await zapsatAtomicky(soubor, 'po opakování');
    assert.equal(pokusu, 3);
    assert.equal(await fs.readFile(soubor, 'utf8'), 'po opakování');
  } finally {
    mock.restoreAll();
    await smazat();
  }
});

test('trvalý zámek: nejvýš 5 pokusů do 1 s, soubor zůstane nepoškozený', async (t) => {
  const { koren, smazat } = await docasneRepo();
  t.after(() => mock.restoreAll());
  const rename = mock.method(fs, 'rename', async () => {
    throw chybaZamku('EBUSY');
  });
  try {
    const soubor = path.join(koren, 'kampan', 'stav.md');
    const pred = await fs.readFile(soubor, 'utf8');
    const zacatek = Date.now();
    await assert.rejects(zapsatAtomicky(soubor, 'nesmí se zapsat'), ZamcenySouborError);
    const trvani = Date.now() - zacatek;
    assert.ok(trvani <= 1100, `trvalo ${trvani} ms`);
    assert.ok(rename.mock.callCount() <= 5, `pokusů ${rename.mock.callCount()}`);
    mock.restoreAll();
    assert.equal(await fs.readFile(soubor, 'utf8'), pred);
    assert.deepEqual(await docasneSoubory(path.dirname(soubor)), []);
  } finally {
    mock.restoreAll();
    await smazat();
  }
});

test('jiná chyba než zámek se neopakuje a vyhodí se', async (t) => {
  const { koren, smazat } = await docasneRepo();
  t.after(() => mock.restoreAll());
  const rename = mock.method(fs, 'rename', async () => {
    throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
  });
  try {
    await assert.rejects(zapsatAtomicky(path.join(koren, 'kampan', 'stav.md'), 'x'), /disk full/);
    assert.equal(rename.mock.callCount(), 1);
  } finally {
    mock.restoreAll();
    await smazat();
  }
});

test('Zapisovač: zamčený soubor skončí odloženým zápisem a dokončí se po uvolnění', async (t) => {
  const { koren, smazat } = await docasneRepo();
  const puvodni = fs.rename;
  let zamceno = true;
  t.after(() => mock.restoreAll());
  mock.method(fs, 'rename', async (z, na) => {
    if (zamceno && !String(na).endsWith('.json')) throw chybaZamku('EBUSY');
    return puvodni(z, na);
  });
  const zurnal = path.join(koren, 'hub', '.stav', 'odlozene-zapisy');
  const z = new Zapisovac({ intervalOpakovaniMs: 50, volbyZapisu: { prodlevyMs: [0, 5] }, zurnal });
  try {
    const soubor = path.join(koren, 'kampan', 'stav.md');
    const pred = await fs.readFile(soubor, 'utf8');
    const udalosti = [];
    z.on('odlozeno', () => udalosti.push('odlozeno'));
    z.on('dokonceno', () => udalosti.push('dokonceno'));

    assert.deepEqual(await z.zapsat(soubor, 'první'), { vysledek: 'odlozeno' });
    assert.deepEqual(await z.zapsat(soubor, 'druhý'), { vysledek: 'odlozeno' });
    assert.equal(z.cekajici(soubor), 'druhý', 'novější změna nahradí starší');
    assert.equal(await fs.readFile(soubor, 'utf8'), pred, 'soubor zůstal nepoškozený');
    assert.equal((await fs.readdir(zurnal)).length, 1, 'odložený zápis je v žurnálu');

    zamceno = false;
    await dokud(async () => (await fs.readFile(soubor, 'utf8')) === 'druhý', 2000);
    // „dokonceno“ přijde až po smazání žurnálu, chvíli po přejmenování souboru.
    await dokud(() => udalosti.length === 2, 2000);
    assert.deepEqual(udalosti, ['odlozeno', 'dokonceno']);
    assert.equal(z.cekajici(soubor), undefined);
    assert.equal((await fs.readdir(zurnal)).length, 0, 'žurnál je po dokončení prázdný');
  } finally {
    await z.dokoncit();
    mock.restoreAll();
    await smazat();
  }
});

test('Zapisovač: odložený zápis přežije pád serveru (obnova ze žurnálu)', async (t) => {
  const { koren, smazat } = await docasneRepo();
  const puvodni = fs.rename;
  t.after(() => mock.restoreAll());
  mock.method(fs, 'rename', async (z, na) => {
    if (!String(na).endsWith('.json')) throw chybaZamku('EBUSY');
    return puvodni(z, na);
  });
  const zurnal = path.join(koren, 'hub', '.stav', 'odlozene-zapisy');
  const soubor = path.join(koren, 'kampan', 'stav.md');
  const prvni = new Zapisovac({ intervalOpakovaniMs: 60000, volbyZapisu: { prodlevyMs: [0] }, zurnal });
  try {
    await prvni.zapsat(soubor, 'změna před pádem');
    prvni.removeAllListeners();
    clearInterval(prvni.casovac); // „pád“: proces skončí bez dokončení
    mock.restoreAll();

    const druhy = new Zapisovac({ zurnal });
    // Soubor na disku je starší než záznam v žurnálu, takže se zápis obnoví.
    const minulost = new Date(Date.now() - 60000);
    await fs.utimes(soubor, minulost, minulost);
    const { obnoveno } = await druhy.obnovit();
    assert.equal(obnoveno.length, 1);
    assert.equal(await fs.readFile(soubor, 'utf8'), 'změna před pádem');
    await druhy.dokoncit();
  } finally {
    mock.restoreAll();
    await smazat();
  }
});

test('Zapisovač: změna souboru zvenku má přednost před odloženým zápisem', async (t) => {
  const { koren, smazat } = await docasneRepo();
  t.after(() => mock.restoreAll());
  mock.method(fs, 'rename', async () => {
    throw chybaZamku('EPERM');
  });
  const z = new Zapisovac({ intervalOpakovaniMs: 60000, volbyZapisu: { prodlevyMs: [0] } });
  try {
    const soubor = path.join(koren, 'kampan', 'stav.md');
    await z.zapsat(soubor, 'z panelu');
    let zahozeno = false;
    z.on('zahozeno', () => (zahozeno = true));
    await z.zrusit(soubor);
    assert.ok(zahozeno);
    assert.equal(z.cekajici(soubor), undefined);
  } finally {
    await z.dokoncit();
    mock.restoreAll();
    await smazat();
  }
});

test('Zapisovač pozná vlastní zápis (ozvěnu z hlídání souborů)', async () => {
  const { koren, smazat } = await docasneRepo();
  const z = new Zapisovac();
  try {
    const soubor = path.join(koren, 'kampan', 'stav.md');
    await z.zapsat(soubor, 'můj obsah');
    assert.ok(z.jeVlastniZapis(soubor, 'můj obsah'));
    assert.ok(!z.jeVlastniZapis(soubor, 'cizí obsah'));
  } finally {
    await smazat();
  }
});

test('Zapisovač: po uvolnění zámku zůstane nejnovější změna, ne ta odložená jako první (audit S1)', async (t) => {
  const { koren, smazat } = await docasneRepo();
  const puvodni = fs.rename;
  let zamceno = true;
  t.after(() => mock.restoreAll());
  mock.method(fs, 'rename', async (z, na) => {
    if (zamceno && na.endsWith('stav.md')) throw chybaZamku();
    // Starší obsah se přejmenovává pomaleji (antivir ho ještě drží): bez fronty by doběhl až po novějším.
    const obsah = await fs.readFile(z, 'utf8').catch(() => '');
    await new Promise((r) => setTimeout(r, obsah === 'A' ? 60 : 5));
    return puvodni(z, na);
  });
  const z = new Zapisovac({ intervalOpakovaniMs: 5, volbyZapisu: { limitMs: 0 } });
  try {
    const soubor = path.join(koren, 'kampan', 'stav.md');
    assert.equal((await z.zapsat(soubor, 'A')).vysledek, 'odlozeno');
    zamceno = false;
    // Opakování odloženého A a nový zápis B běží současně.
    await Promise.all([z.zopakuj(), z.zapsat(soubor, 'B')]);
    await dokud(() => z.seznamOdlozenych().length === 0);
    assert.equal(await fs.readFile(soubor, 'utf8'), 'B');
    assert.ok(z.jeVlastniZapis(soubor, 'B'));
  } finally {
    await z.dokoncit();
    mock.restoreAll();
    await smazat();
  }
});

test('Zapisovač.upravit: souběžné úpravy jednoho souboru se nepřepíšou (audit N1)', async () => {
  const { koren, smazat } = await docasneRepo();
  const z = new Zapisovac();
  try {
    const soubor = path.join(koren, 'kampan', 'pocitadlo.txt');
    await z.zapsat(soubor, '');
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        z.upravit(soubor, async (text) => {
          await new Promise((r) => setTimeout(r, 2));
          return `${text}${i},`;
        }),
      ),
    );
    const cisla = (await fs.readFile(soubor, 'utf8')).split(',').filter(Boolean);
    assert.equal(cisla.length, 20, 'žádná úprava se neztratila');
  } finally {
    await smazat();
  }
});

test('Zapisovač.upravit: zamčený soubor čte odložený obsah, takže druhá úprava nezahodí první (audit S1)', async (t) => {
  const { koren, smazat } = await docasneRepo();
  t.after(() => mock.restoreAll());
  mock.method(fs, 'rename', async () => {
    throw chybaZamku();
  });
  const z = new Zapisovac({ intervalOpakovaniMs: 60000, volbyZapisu: { limitMs: 0 } });
  try {
    const soubor = path.join(koren, 'kampan', 'stav.md');
    const puvodni = await fs.readFile(soubor, 'utf8');
    await z.upravit(soubor, (text) => `${text}prvni\n`);
    const { vysledek, obsah } = await z.upravit(soubor, (text) => `${text}druha\n`);
    assert.equal(vysledek, 'odlozeno');
    assert.equal(obsah, `${puvodni}prvni\ndruha\n`);
    assert.equal(z.cekajici(soubor), obsah);
  } finally {
    await z.dokoncit().catch(() => {});
    mock.restoreAll();
    await smazat();
  }
});

test('Zapisovač: opožděná ozvěna staršího vlastního zápisu se nepovažuje za cizí změnu', async () => {
  const { koren, smazat } = await docasneRepo();
  const z = new Zapisovac();
  try {
    const soubor = path.join(koren, 'kampan', 'stav.md');
    await z.zapsat(soubor, 'A');
    await z.zapsat(soubor, 'B');
    // Hlídání souborů přečetlo soubor ještě s A a ohlásí ho až teď.
    assert.ok(z.jeVlastniZapis(soubor, 'A'));
    assert.ok(z.jeVlastniZapis(soubor, 'B'));
    assert.ok(!z.jeVlastniZapis(soubor, 'cizí změna'));
  } finally {
    await smazat();
  }
});
