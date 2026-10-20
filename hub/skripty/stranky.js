// Čtecí verze kánonu pro GitHub Pages: npm run stranky [-- <výstupní složka>]
// Výchozí složka je _site v kořeni repa (tu nahrává workflow .github/workflows/stranky.yml).
import path from 'node:path';
import { cesty, korenRepa } from '../server/cesty.js';
import { sestavitStranky } from '../server/stranky.js';

const koren = korenRepa();
const cil = path.resolve(process.argv[2] ?? path.join(koren, '_site'));
const vysledek = await sestavitStranky({ cesty: cesty(koren), cil });
console.log(`Čtecí verze: ${vysledek.entity} karet (družina zná ${vysledek.druzina}), ${vysledek.obrazky} obrázků → ${cil}`);
for (const o of vysledek.chybiObrazky) console.log(`! Obrázek chybí v repu: ${o}`);
