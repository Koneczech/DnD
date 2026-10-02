#!/usr/bin/env node
// Pre-commit hook DM Hubu (rozhodnutí 13 a 31). Repo je veřejné, takže commit odmítne:
//  - soubor .env (kromě vzoru .env.example),
//  - obsah s hodnotami z hub/.env (heslo OBS, PIN, API klíč),
//  - řetězce, které vypadají jako známé typy klíčů a tokenů.
// Shell skript v .git/hooks/pre-commit jen zavolá tento soubor; logika se testuje na Linuxu i Windows.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rozebratEnv, TAJNE_KLICE } from '../server/nastaveni.js';

/** Vzory klíčů s rozpoznatelným formátem. */
export const VZORY_KLICU = Object.freeze([
  { nazev: 'GitHub token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/ },
  { nazev: 'GitHub token', re: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/ },
  { nazev: 'OpenAI klíč', re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}\b/ },
  { nazev: 'Anthropic klíč', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { nazev: 'AWS klíč', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { nazev: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { nazev: 'Google API klíč', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { nazev: 'Soukromý klíč', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  // Přiřazení tajné hodnoty ve stylu .env: OBS_HESLO=..., PIN=..., *_API_KEY=...
  { nazev: 'Tajná hodnota z .env', re: new RegExp(`^\\s*(?:${TAJNE_KLICE.join('|')}|[A-Z0-9_]*(?:API_KEY|SECRET|TOKEN))\\s*=\\s*["']?[^\\s"'#]{4,}`, 'm') },
]);

export function jeZakazanySoubor(cesta) {
  const jmeno = path.posix.basename(cesta.replace(/\\/g, '/'));
  if (jmeno === '.env.example') return false;
  return jmeno === '.env' || jmeno.startsWith('.env.');
}

/**
 * @param {Array<{cesta:string, obsah:string|null}>} soubory staged soubory (obsah null = binární)
 * @param {string[]} tajneHodnoty hodnoty z hub/.env
 * @returns {Array<{cesta:string, duvod:string}>}
 */
export function najdiProblemy(soubory, tajneHodnoty = []) {
  const problemy = [];
  const hodnoty = tajneHodnoty.filter((h) => h && String(h).length >= 4);
  for (const { cesta, obsah } of soubory) {
    if (jeZakazanySoubor(cesta)) {
      problemy.push({ cesta, duvod: 'soubor .env s tajnými hodnotami nesmí do Gitu' });
      continue;
    }
    if (obsah == null) continue;
    if (hodnoty.some((h) => obsah.includes(h))) {
      problemy.push({ cesta, duvod: 'obsahuje hodnotu z hub/.env (heslo OBS, PIN nebo klíč)' });
      continue;
    }
    for (const { nazev, re } of VZORY_KLICU) {
      if (re.test(obsah)) {
        problemy.push({ cesta, duvod: `vypadá jako ${nazev}` });
        break;
      }
    }
  }
  return problemy;
}

function jeBinarni(buffer) {
  return buffer.subarray(0, 8000).includes(0);
}

function main() {
  const koren = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const vystup = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { cwd: koren });
  const cesty = vystup.toString('utf8').split('\0').filter(Boolean);
  const soubory = cesty.map((cesta) => {
    if (jeZakazanySoubor(cesta)) return { cesta, obsah: null };
    const buffer = execFileSync('git', ['show', `:${cesta}`], { cwd: koren, maxBuffer: 64 * 1024 * 1024 });
    return { cesta, obsah: jeBinarni(buffer) ? null : buffer.toString('utf8') };
  });

  let tajne = [];
  try {
    const env = rozebratEnv(fs.readFileSync(path.join(koren, 'hub', '.env'), 'utf8'));
    tajne = TAJNE_KLICE.map((k) => env[k]).filter(Boolean);
  } catch {
    tajne = [];
  }

  const problemy = najdiProblemy(soubory, tajne);
  if (problemy.length) {
    console.error('\nDM Hub: commit zastaven, repo je veřejné.\n');
    for (const p of problemy) console.error(`  ${p.cesta}: ${p.duvod}`);
    console.error('\nOdeber soubor z commitu (git restore --staged <soubor>) nebo z něj tajnou hodnotu odstraň.\n');
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
