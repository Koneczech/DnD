// Hlídání souborů v kampan/. Změna z Obsidianu nebo editoru se do 1 s promítne do panelu i výstupů.
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { watch } from 'chokidar';
import { PRIPONA_DOCASNA } from './zapis.js';

/**
 * Události: 'zmena' { soubor, druh: 'add'|'change'|'unlink' }, 'pripraveno', 'chyba'
 */
export class Hlidac extends EventEmitter {
  constructor(slozka, { stabilitaMs = 100 } = {}) {
    super();
    this.slozka = slozka;
    this.stabilitaMs = stabilitaMs;
    this.watcher = null;
  }

  spustit() {
    this.watcher = watch(this.slozka, {
      ignoreInitial: true,
      // Ignoruj skryté soubory a dočasné soubory atomického zápisu.
      ignored: (cesta) => {
        const jmeno = path.basename(cesta);
        return jmeno.endsWith(PRIPONA_DOCASNA) || (jmeno.startsWith('.') && cesta !== this.slozka);
      },
      // Počká, až soubor přestane růst; editory zapisují po částech.
      awaitWriteFinish: { stabilityThreshold: this.stabilitaMs, pollInterval: 25 },
      atomic: 50,
    });
    for (const druh of ['add', 'change', 'unlink']) {
      this.watcher.on(druh, (soubor) => this.emit('zmena', { soubor: path.resolve(soubor), druh }));
    }
    this.watcher.on('error', (chyba) => this.emit('chyba', chyba));
    return new Promise((resolve) => {
      this.watcher.once('ready', () => {
        this.emit('pripraveno');
        resolve();
      });
    });
  }

  async zastavit() {
    await this.watcher?.close();
    this.watcher = null;
  }
}
