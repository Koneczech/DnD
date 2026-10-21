// Sestaví CodeMirror 6 pro editor karty do jednoho souboru panel/vendor/codemirror.js (⚠ bod 150).
// Panel nemá sestavovací krok: soubor je v repu hotový, tento skript ho jen obnoví po změně verze
// knihoven v devDependencies (npm run vendor:editor). Hub ani čtecí verze ho za běhu nesestavují.
import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { HUB_DIR } from '../server/cesty.js';

const BALICKY = ['@codemirror/state', '@codemirror/view', '@codemirror/language', '@codemirror/commands', '@lezer/markdown', '@lezer/highlight'];
const verzeBalicku = async (b) => JSON.parse(await fs.readFile(path.join(HUB_DIR, 'node_modules', ...b.split('/'), 'package.json'), 'utf8')).version;
const verze = (await Promise.all(BALICKY.map(async (b) => `${b}@${await verzeBalicku(b)}`))).join(', ');

const vstup = `
export { EditorState, EditorSelection, Transaction, Prec } from '@codemirror/state';
export { EditorView, Decoration, ViewPlugin, WidgetType, keymap, drawSelection, placeholder } from '@codemirror/view';
export { syntaxTree, HighlightStyle, syntaxHighlighting, indentUnit, Language, LanguageSupport, defineLanguageFacet } from '@codemirror/language';
// Markdown rovnou z @lezer/markdown: @codemirror/lang-markdown by přibalil i HTML, CSS a JS.
export { parser as parserMarkdownu, GFM } from '@lezer/markdown';
export { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands';
export { tags } from '@lezer/highlight';
`;

const vystup = await build({
  stdin: { contents: vstup, resolveDir: HUB_DIR, loader: 'js' },
  bundle: true, format: 'esm', minify: true, write: false, target: 'es2022', legalComments: 'eof',
});
const cil = path.join(HUB_DIR, 'panel', 'vendor', 'codemirror.js');
await fs.mkdir(path.dirname(cil), { recursive: true });
await fs.writeFile(cil, `/* CodeMirror 6 pro editor karty (MIT, https://codemirror.net). Sestaveno skripty/vendor-editor.js: ${verze} */\n${vystup.outputFiles[0].text}`);
console.log(`panel/vendor/codemirror.js: ${(vystup.outputFiles[0].contents.length / 1024).toFixed(0)} kB (${verze})`);
