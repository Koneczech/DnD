// Živý náhled v editoru karty (⚠ bod 150): sestavený CodeMirror v repu a markdown, který z něj editor čte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { HUB_DIR } from '../server/cesty.js';

const BALIK = path.join(HUB_DIR, 'panel', 'vendor', 'codemirror.js');

test('panel/vendor/codemirror.js: v repu, s verzemi z package.json a se vším, co editor používá', async () => {
  const text = await fs.readFile(BALIK, 'utf8');
  const balicek = JSON.parse(await fs.readFile(path.join(HUB_DIR, 'package.json'), 'utf8'));
  for (const jmeno of ['@codemirror/state', '@codemirror/view', '@codemirror/language', '@codemirror/commands', '@lezer/markdown']) {
    assert.ok(text.slice(0, 600).includes(`${jmeno}@${balicek.devDependencies[jmeno]}`), `${jmeno} v hlavičce odpovídá devDependencies (jinak npm run vendor:editor)`);
  }
  const cm = await import(BALIK);
  const editor = await fs.readFile(path.join(HUB_DIR, 'panel', 'kanon-zivy-nahled.js'), 'utf8');
  const pouzite = /const \{([^}]+)\} = cm;/.exec(editor)[1].split(',').map((x) => x.trim()).filter(Boolean);
  for (const jmeno of pouzite) assert.ok(jmeno in cm, `balík exportuje ${jmeno}`);
});

test('markdown parser z balíku pozná prvky, které živý náhled formátuje', async () => {
  const { parserMarkdownu, GFM } = await import(BALIK);
  const md = '# Název\n\n**tučně** a *kurzíva* a `kód`\n\n- odrážka %%zná%%\n1. číslo\n\n> citace\n\n---\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n[web](https://x.cz)\n';
  const strom = parserMarkdownu.configure([GFM]).parse(md);
  const uzly = new Set();
  strom.iterate({ enter: (u) => { uzly.add(u.name); } });
  for (const n of ['ATXHeading1', 'HeaderMark', 'StrongEmphasis', 'Emphasis', 'EmphasisMark', 'InlineCode', 'ListMark', 'Blockquote', 'QuoteMark', 'HorizontalRule', 'Table', 'Link', 'URL']) {
    assert.ok(uzly.has(n), `uzel ${n}`);
  }
});
