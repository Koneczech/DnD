// Kontroly prostředí na PC: OneDrive (rozhodnutí 32) a instalace pre-commit hooku (rozhodnutí 31).
import fs from 'node:fs/promises';
import path from 'node:path';
import { git } from './git.js';

/**
 * Leží klon v OneDrive? OneDrive soubory průběžně zamyká a hlídání souborů pak hlásí
 * falešné změny. Kontroluje proměnné prostředí OneDrive a jména složek v cestě.
 */
export function jeVOneDrive(cesta, env = process.env) {
  const normal = (p) => path.resolve(p).toLowerCase();
  const cilova = normal(cesta);
  const koreny = ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']
    .map((k) => env[k])
    .filter(Boolean)
    .map(normal);
  if (koreny.some((k) => cilova === k || cilova.startsWith(k + path.sep))) return true;
  return cilova.split(/[\\/]/).some((cast) => /^onedrive( - .+)?$/.test(cast));
}

export const ZNACKA_HOOKU = 'DM Hub pre-commit hook';

/** Obsah hooku: krátký shell skript s LF konci, logika je v Node.js. */
export const OBSAH_HOOKU =
  '#!/bin/sh\n' +
  `# ${ZNACKA_HOOKU} — instaluje ho Hub při startu. Logika: hub/hooks/pre-commit.js\n` +
  'exec node "$(git rev-parse --show-toplevel)/hub/hooks/pre-commit.js"\n';

/**
 * Nainstaluje pre-commit hook, pokud tam ještě není. Cizí hook nepřepíše.
 * @returns {Promise<'nainstalovano'|'aktualni'|'cizi-hook'|'bez-gitu'>}
 */
export async function nainstalovatHook(koren) {
  let slozka;
  try {
    slozka = await git(koren, ['rev-parse', '--git-path', 'hooks']);
  } catch {
    return 'bez-gitu';
  }
  const hooks = path.resolve(koren, slozka);
  const cesta = path.join(hooks, 'pre-commit');
  let stavajici = null;
  try {
    stavajici = await fs.readFile(cesta, 'utf8');
  } catch {
    stavajici = null;
  }
  if (stavajici === OBSAH_HOOKU) return 'aktualni';
  if (stavajici !== null && !stavajici.includes(ZNACKA_HOOKU)) return 'cizi-hook';
  await fs.mkdir(hooks, { recursive: true });
  await fs.writeFile(cesta, OBSAH_HOOKU, { encoding: 'utf8', mode: 0o755 });
  await fs.chmod(cesta, 0o755).catch(() => {});
  return 'nainstalovano';
}
