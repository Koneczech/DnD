// Čtecí verze kánonu pro GitHub Pages: npm run stranky [-- <výstupní složka>]
// Výchozí složka je _site v kořeni repa (tu nahrává workflow .github/workflows/stranky.yml).
// Heslo k pohledu DM je v proměnné STRANKY_HESLO (ve workflow z tajných hodnot repa);
// bez něj se pohled DM nepublikuje vůbec, jen pohled družiny.
import path from 'node:path';
import { cesty, korenRepa } from '../server/cesty.js';
import { sestavitStranky } from '../server/stranky.js';

const koren = korenRepa();
const cil = path.resolve(process.argv[2] ?? path.join(koren, '_site'));
const vysledek = await sestavitStranky({
  cesty: cesty(koren),
  cil,
  heslo: process.env.STRANKY_HESLO ?? '',
  repo: process.env.GITHUB_REPOSITORY || 'Koneczech/DnD',
  vetev: process.env.GITHUB_REF_NAME || 'main',
});
console.log(`Čtecí verze: družina zná ${vysledek.druzina} z ${vysledek.entity} karet, ${vysledek.obrazky} obrázků → ${cil}`);
console.log(vysledek.dm ? 'Pohled DM: zašifrovaný heslem.' : '! Pohled DM se nepublikoval: chybí heslo STRANKY_HESLO.');
for (const o of vysledek.chybiObrazky) console.log(`! Obrázek chybí v repu: ${o}`);
