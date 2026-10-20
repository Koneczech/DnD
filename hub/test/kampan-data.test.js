// Skutečná data kampaně v repu: každý YAML (hlavičky karet i soubory .yaml) jde přečíst.
// Chytí třeba zdvojený klíč po sloučení dvou úprav stejného řádku (20. 10. 2026: tábor lupičů).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const KAMPAN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'kampan');

async function soubory(slozka) {
  const vysledek = [];
  for (const p of await fs.readdir(slozka, { withFileTypes: true })) {
    const cesta = path.join(slozka, p.name);
    if (p.isDirectory()) vysledek.push(...(await soubory(cesta)));
    else if (/\.(md|ya?ml)$/i.test(p.name)) vysledek.push(cesta);
  }
  return vysledek;
}

test('data kampaně: všechny YAML hlavičky a soubory .yaml jdou přečíst (žádný zdvojený klíč)', async () => {
  const chyby = [];
  for (const f of await soubory(KAMPAN)) {
    const text = (await fs.readFile(f, 'utf8')).replace(/\r\n/g, '\n');
    let yaml = text;
    if (f.endsWith('.md')) {
      const m = text.match(/^---\n([\s\S]*?)\n---(\n|$)/);
      if (!m) continue;
      yaml = m[1];
    }
    const dok = YAML.parseDocument(yaml, { uniqueKeys: true });
    for (const e of dok.errors) chyby.push(`${path.relative(KAMPAN, f)}: ${e.message.split('\n')[0]}`);
  }
  assert.deepEqual(chyby, []);
});
