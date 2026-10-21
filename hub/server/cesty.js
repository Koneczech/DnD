// Cesty, se kterými Hub pracuje. Vždy přes node:path, nikdy ručně.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tentoSoubor = fileURLToPath(import.meta.url);

/** Složka hub/ */
export const HUB_DIR = path.resolve(path.dirname(tentoSoubor), '..');

/**
 * Kořen repa. Testy ho přesměrují přes proměnnou DMHUB_REPO na dočasnou složku,
 * aby nikdy nesahaly na skutečná data kampaně.
 */
export function korenRepa() {
  return process.env.DMHUB_REPO ? path.resolve(process.env.DMHUB_REPO) : path.resolve(HUB_DIR, '..');
}

export function cesty(koren = korenRepa()) {
  const kampan = path.join(koren, 'kampan');
  return {
    koren,
    kampan,
    stav: path.join(kampan, 'stav.md'),
    kampanYaml: path.join(kampan, 'kampan.yaml'),
    env: process.env.DMHUB_ENV ? path.resolve(process.env.DMHUB_ENV) : path.join(koren, 'hub', '.env'),
    lokalniStav: path.join(koren, 'hub', '.stav'),
    panel: path.join(HUB_DIR, 'panel'),
    vystupy: path.join(HUB_DIR, 'vystupy'),
  };
}

// Složky entit a typy jsou ve sdíleném modulu (čte je i čtecí verze v prohlížeči).
import { TYPY_SLOZEK } from '../sdilene/typy-karet.js';

export { TYPY_SLOZEK };

export const TYPY = Object.freeze(Object.values(TYPY_SLOZEK));
