// Stav převodu kánonu (Blok 3): npm run kanon [-- <skupina>] [-- --json]
// Bez skupiny vypíše přehled všech skupin, se skupinou podrobný report (co chybí, co je navíc,
// soubory bez `zdroj`, hlášení Kontroly dat). Nic nezapisuje.
import path from 'node:path';
import { korenRepa } from '../server/cesty.js';
import { nacistMapu, reportPrevodu } from '../server/kanon.js';

const argumenty = process.argv.slice(2);
const json = argumenty.includes('--json');
const jenSkupina = argumenty.find((a) => !a.startsWith('--')) ?? null;
const koren = korenRepa();
const souborMapy = path.join(koren, 'reference', 'kanon-mapa.yaml');

let mapa;
try {
  mapa = await nacistMapu(souborMapy);
} catch (e) {
  console.error(`Mapu převodu nejde přečíst (${souborMapy}): ${e.message}`);
  process.exit(1);
}
const report = await reportPrevodu({ koren, mapa });
if (jenSkupina && !report.skupiny.some((s) => s.id === jenSkupina)) {
  console.error(`Skupina „${jenSkupina}“ v mapě není. Skupiny: ${report.skupiny.map((s) => s.id).join(', ')}`);
  process.exit(1);
}
if (json) {
  console.log(JSON.stringify(jenSkupina ? report.skupiny.find((s) => s.id === jenSkupina) : report, null, 2));
  process.exit(0);
}

const radek = (bunky, sirky) => bunky.map((b, i) => String(b).padEnd(sirky[i])).join('  ');
for (const ch of report.mapa.chyby) console.log(`✗ Mapa: ${ch}`);
for (const v of report.mapa.varovani) console.log(`! Mapa: ${v}`);

if (!jenSkupina) {
  const sirky = [30, 6, 7, 6, 8, 8, 12];
  console.log(radek(['Skupina', 'Zdroj', 'Převést', 'Hotovo', 'Vynech.', 'Doplnit', 'Stav'], sirky));
  for (const s of report.skupiny) {
    console.log(radek([s.nazev, s.zdroj.celkem, s.zdroj.prevest, s.hotovo.length, s.zdroj.vynechat.length, s.zdroj.doplnit.length, s.stav], sirky));
  }
  console.log('\nPodrobnosti skupiny: npm run kanon -- <skupina>   (např. npm run kanon -- postavy)');
  process.exit(0);
}

const s = report.skupiny.find((x) => x.id === jenSkupina);
console.log(`${s.nazev}: ${s.stav}`);
console.log(`Ve zdroji ${s.zdroj.celkem}, převést ${s.zdroj.prevest}, v repu hotovo ${s.hotovo.length}, vynechat ${s.zdroj.vynechat.length}, doplnit ${s.zdroj.doplnit.length}.`);
const vypis = (nadpis, seznam, fn) => {
  if (!seznam.length) return;
  console.log(`\n${nadpis} (${seznam.length})`);
  for (const x of seznam) console.log(`  ${fn(x)}`);
};
vypis('Chybí v repu', s.chybi, (x) => `${x.id} → ${x.cil}${x.sloucit ? ' (sloučit do existujícího souboru)' : ''}`);
vypis('Bez odkazu na zdroj', s.bezZdroje, (x) => x.cil);
vypis('Nesedí s mapou', s.nesedi, (x) => `${x.cil}: ${x.zprava}`);
vypis('Kontrola dat', s.problemy, (x) => `${x.soubor}: ${x.zprava}`);
vypis('Vynecháno (vysvětlení rozdílu)', s.zdroj.vynechat, (x) => `${x.nazev}: ${x.proc}`);
vypis('Doplnit mimo Notion (čeká na DM)', s.zdroj.doplnit, (x) => `${x.nazev} (${x.zdroj})`);
vypis('V repu mimo mapu', s.navic, (x) => x);
