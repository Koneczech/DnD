// Ověří, že .nvmrc a engines v hub/package.json ukazují na stejnou verzi Node.js (rozhodnutí 29).
// Volitelně porovná i právě běžící Node: node skripty/check-node.js --runtime
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hub = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nvmrc = fs.readFileSync(path.join(hub, '..', '.nvmrc'), 'utf8').trim().replace(/^v/, '');
const engines = JSON.parse(fs.readFileSync(path.join(hub, 'package.json'), 'utf8')).engines?.node ?? '';

const hlavni = (v) => String(v).match(/\d+/)?.[0];
const chyby = [];
if (!/^\d+(\.\d+){0,2}$/.test(nvmrc)) chyby.push(`.nvmrc obsahuje „${nvmrc}“, čeká se číslo verze (např. 24)`);
if (engines !== `${hlavni(nvmrc)}.x`) chyby.push(`engines.node je „${engines}“, ale .nvmrc říká ${nvmrc} (čeká se „${hlavni(nvmrc)}.x“)`);
if (process.argv.includes('--runtime') && hlavni(process.version) !== hlavni(nvmrc)) {
  chyby.push(`běží Node ${process.version}, ale .nvmrc říká ${nvmrc}`);
}
if (chyby.length) {
  for (const ch of chyby) console.error('Verze Node.js nesedí: ' + ch);
  process.exit(1);
}
console.log(`Verze Node.js sedí: .nvmrc ${nvmrc}, engines ${engines}.`);
