// Pomocné funkce pro testy: dočasné repo s daty kampaně, čekání, falešný klient OBS.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { cesty } from '../server/cesty.js';

export const STAV_MD = `---
schema: 1
datum: "12. Eleint 1491 DR"   # komentář, který musí přežít zápis z panelu
misto: Mirabar
sezeni: 1
sezeni_bezi: false
---
Tělo souboru, které Hub nesmí přepsat.
`;

export const KAMPAN_YAML = 'schema: 1\nnazev: Testovací kampaň\n';

export async function docasneRepo() {
  const koren = await fs.mkdtemp(path.join(os.tmpdir(), 'dmhub-test-'));
  await fs.mkdir(path.join(koren, 'kampan'), { recursive: true });
  await fs.mkdir(path.join(koren, 'hub'), { recursive: true });
  await fs.writeFile(path.join(koren, 'kampan', 'stav.md'), STAV_MD);
  await fs.writeFile(path.join(koren, 'kampan', 'kampan.yaml'), KAMPAN_YAML);
  return { koren, c: cesty(koren), smazat: () => fs.rm(koren, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) };
}

export const cekej = (ms) => new Promise((r) => setTimeout(r, ms));

/** Čeká, dokud podmínka neplatí, nejdéle `limitMs`. Vrací uplynulý čas v ms. */
export async function dokud(podminka, limitMs = 3000, krokMs = 20) {
  const zacatek = Date.now();
  while (Date.now() - zacatek < limitMs) {
    if (await podminka()) return Date.now() - zacatek;
    await cekej(krokMs);
  }
  throw new Error(`Podmínka nesplněna do ${limitMs} ms`);
}

/** Falešný klient obs-websocket-js se scénami Mirabar, Souboj, Tábor. */
export class FalesnyObs extends EventEmitter {
  constructor({ heslo = 'spravne' } = {}) {
    super();
    this.heslo = heslo;
    this.volani = [];
    this.scena = 'Mirabar';
    this.pripojeno = false;
  }
  async connect(_url, heslo) {
    if (heslo !== this.heslo) {
      const e = new Error('Authentication failed');
      throw e;
    }
    this.pripojeno = true;
  }
  async disconnect() {
    if (this.pripojeno) {
      this.pripojeno = false;
      this.emit('ConnectionClosed', { code: 1000 });
    }
  }
  async call(pozadavek, data) {
    this.volani.push([pozadavek, data]);
    if (pozadavek === 'GetSceneList') {
      return {
        currentProgramSceneName: this.scena,
        scenes: [
          { sceneName: 'Tábor', sceneIndex: 0 },
          { sceneName: 'Souboj', sceneIndex: 1 },
          { sceneName: 'Mirabar', sceneIndex: 2 },
        ],
      };
    }
    if (pozadavek === 'SetCurrentProgramScene') {
      this.scena = data.sceneName;
      return {};
    }
    if (pozadavek === 'GetInputList') return { inputs: [{ inputName: 'Kalendář' }] };
    if (pozadavek === 'GetInputSettings') return { inputSettings: { url: 'http://127.0.0.1/', shutdown: true } };
    return {};
  }
}
