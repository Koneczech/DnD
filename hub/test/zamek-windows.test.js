// Skutečný zámek souboru na Windows (rozhodnutí 28, Výroba a ověřování v ZADANI.md).
//
// Zámek drží PowerShell přes [System.IO.File]::Open(..., 'None'), tedy bez sdílení,
// stejně jako antivir nebo indexer. Zámek z Node.js by test znehodnotil: Node otevírá
// soubory se sdíleným režimem, který přejmenování povoluje.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { zapsatAtomicky, Zapisovac, ZamcenySouborError } from '../server/zapis.js';
import { docasneRepo, dokud } from './pomoc.js';

const jeWindows = process.platform === 'win32';

/** Zamkne soubor bez sdílení na `ms` milisekund. Vrátí promise, která se splní, až je zámek aktivní. */
function zamknout(soubor, ms) {
  const cesta = soubor.replace(/'/g, "''");
  const skript =
    `$f = [System.IO.File]::Open('${cesta}', 'Open', 'ReadWrite', 'None'); ` +
    `[Console]::Out.WriteLine('zamceno'); [Console]::Out.Flush(); ` +
    `Start-Sleep -Milliseconds ${ms}; $f.Close(); [Console]::Out.WriteLine('uvolneno')`;
  const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', skript], { windowsHide: true });
  let vystup = '';
  const uvolneno = new Promise((resolve, reject) => {
    ps.on('exit', (kod) => (kod === 0 ? resolve() : reject(new Error(`PowerShell skončil kódem ${kod}: ${vystup}`))));
  });
  const zamceno = new Promise((resolve, reject) => {
    ps.stdout.on('data', (d) => {
      vystup += d;
      if (vystup.includes('zamceno')) resolve();
    });
    ps.stderr.on('data', (d) => (vystup += d));
    ps.on('error', reject);
    ps.on('exit', () => reject(new Error(`Zámek se nepodařilo získat: ${vystup}`)));
  });
  return { zamceno, uvolneno };
}

test('Windows: zámek bez sdílení opravdu blokuje přejmenování (kontrola testu)', { skip: !jeWindows && 'jen na Windows' }, async () => {
  const { koren, smazat } = await docasneRepo();
  try {
    const soubor = path.join(koren, 'kampan', 'stav.md');
    const { zamceno, uvolneno } = zamknout(soubor, 3000);
    await zamceno;
    await assert.rejects(zapsatAtomicky(soubor, 'x', { pokusu: 1 }), ZamcenySouborError);
    await uvolneno;
  } finally {
    await smazat();
  }
});

test('Windows: krátký zámek (uvolněný do 1 s) zápis přečká opakováním', { skip: !jeWindows && 'jen na Windows' }, async () => {
  const { koren, smazat } = await docasneRepo();
  try {
    const soubor = path.join(koren, 'kampan', 'stav.md');
    const { zamceno, uvolneno } = zamknout(soubor, 300);
    await zamceno;
    const { pokusu } = await zapsatAtomicky(soubor, 'po krátkém zámku');
    assert.ok(pokusu > 1, 'první pokus měl narazit na zámek');
    assert.equal(await fs.readFile(soubor, 'utf8'), 'po krátkém zámku');
    await uvolneno;
  } finally {
    await smazat();
  }
});

test('Windows: dlouhý zámek skončí odloženým zápisem, soubor zůstane celý a po uvolnění se zápis dokončí', { skip: !jeWindows && 'jen na Windows' }, async () => {
  const { koren, smazat } = await docasneRepo();
  const z = new Zapisovac({ intervalOpakovaniMs: 250, zurnal: path.join(koren, 'hub', '.stav', 'odlozene-zapisy') });
  try {
    const soubor = path.join(koren, 'kampan', 'stav.md');
    const pred = await fs.readFile(soubor, 'utf8');
    const { zamceno, uvolneno } = zamknout(soubor, 2500);
    await zamceno;

    const zacatek = Date.now();
    const { vysledek } = await z.zapsat(soubor, 'po dlouhém zámku');
    assert.equal(vysledek, 'odlozeno');
    assert.ok(Date.now() - zacatek <= 1200, 'odložení nastalo v limitu 1 s');

    await uvolneno;
    const hned = await fs.readFile(soubor, 'utf8');
    assert.ok([pred, 'po dlouhém zámku'].includes(hned), 'soubor je vždy celý: buď původní, nebo nový obsah');
    await dokud(async () => (await fs.readFile(soubor, 'utf8')) === 'po dlouhém zámku', 3000);
    assert.equal(z.cekajici(soubor), undefined);
  } finally {
    await z.dokoncit();
    await smazat();
  }
});
