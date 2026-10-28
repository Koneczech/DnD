// Kvalita kánonu (⚠ bod 154): npm run kvalita [-- --json] [-- <pravidlo>]
// Vypíše, kolik karet splňuje kritéria „kánonu na 100 %“ a co kde opravit. Nic nezapisuje.
import { cesty, korenRepa } from '../server/cesty.js';
import { Kanon } from '../server/kanon-modul.js';
import { PRAVIDLA } from '../sdilene/kvalita-kanonu.js';

const argumenty = process.argv.slice(2);
const json = argumenty.includes('--json');
const jenPravidlo = argumenty.find((a) => !a.startsWith('--')) ?? null;
if (jenPravidlo && !PRAVIDLA[jenPravidlo]) {
  console.error(`Pravidlo „${jenPravidlo}“ neexistuje. Pravidla: ${Object.keys(PRAVIDLA).join(', ')}`);
  process.exit(1);
}

const kanon = new Kanon({ cesty: cesty(korenRepa()), zapisovac: null });
await kanon.nacist();
const k = kanon.kvalita();
if (json) {
  console.log(JSON.stringify(k, null, 2));
  process.exit(0);
}

console.log(`Kvalita kánonu: ${k.procento} % (${k.bezChyb} z ${k.karet} karet bez chyby)\n`);
for (const p of k.pravidla) console.log(`${p.uroven === 'chyba' ? '✗' : '·'} ${p.nazev.padEnd(34)} ${String(p.karet).padStart(4)} karet`);
console.log('\n✗ = chyba (počítá se do procenta), · = doporučení');

const vypsat = k.karty
  .map((x) => ({ ...x, problemy: x.problemy.filter((p) => (jenPravidlo ? p.pravidlo === jenPravidlo : p.uroven === 'chyba')) }))
  .filter((x) => x.problemy.length);
if (vypsat.length) console.log(`\n${jenPravidlo ? PRAVIDLA[jenPravidlo].nazev : 'Chyby'} po kartách:`);
for (const x of vypsat) {
  console.log(`\n${x.nazev} (${x.id})`);
  for (const p of x.problemy) console.log(`  ${p.uroven === 'chyba' ? '✗' : '·'} ${PRAVIDLA[p.pravidlo].nazev}: ${p.zprava}`);
}
if (!jenPravidlo) console.log('\nDoporučení po kartách: npm run kvalita -- <pravidlo> (např. odkazy)');
