// Živé spojení s Improved Initiative (zvuky tahů bez zpoždění). Player View na TV nedostává stav
// čtením po sekundách, ale přes socket.io: když DM v Improved Initiative posune tah, server hned pošle
// „encounter updated“ všem, kdo se k setkání připojili („join encounter“). Hub se připojí stejně jako
// Player View (bez přihlášení, jen ID setkání) a změnu má do desetin sekundy.
//
// Protokol: Engine.IO 4 přes WebSocket (Improved Initiative používá jen transport websocket):
//   server → „0{…}“ (otevřeno), klient → „40“ (připojit jmenný prostor /), server → „40{…}“,
//   klient → 42["join encounter","<id>"], server → 42["encounter updated",{…}], ping „2“ → pong „3“.
// Čtení po sekundách (iniciativa-cteni.js) běží dál jako pojistka, kdyby spojení vypadlo.
import { EventEmitter } from 'node:events';

export const ADRESA_ZIVE = 'wss://improvedinitiative.app/socket.io/?EIO=4&transport=websocket';
/** Po výpadku se spojení obnoví za 2 s, pak za 4, 8 … nejvýš 30 s. */
const OBNOVA_MS = Object.freeze({ prvni: 2000, max: 30000 });
/**
 * Spojení, které se do 10 s nepřipojí, se zavře a zkusí znovu. Bez limitu mohl pokus viset navždy
 * (sezení 24. 10. 2026: po výpadku ve 14:18 se Hub k Improved Initiative už nepřipojil).
 */
export const LIMIT_PRIPOJENI_MS = 10000;

/** Rozebere zprávu socket.io: { typ: 'udalost', nazev, data } | { typ: 'otevreno' | 'pripojeno' | 'ping' | 'odpojeno' } | null. */
export function rozebratZpravu(text) {
  const t = String(text ?? '');
  if (t === '2') return { typ: 'ping' };
  if (t.startsWith('0')) return { typ: 'otevreno' };
  if (t.startsWith('40')) return { typ: 'pripojeno' };
  if (t.startsWith('41')) return { typ: 'odpojeno' };
  if (t.startsWith('44')) return { typ: 'odpojeno' };
  if (t.startsWith('42')) {
    // 42[…] nebo 42<id potvrzení>[…]
    const json = t.slice(2).replace(/^\d+/, '');
    try {
      const pole = JSON.parse(json);
      if (Array.isArray(pole) && typeof pole[0] === 'string') return { typ: 'udalost', nazev: pole[0], data: pole[1] };
    } catch {
      /* nečitelná zpráva: přeskočit */
    }
  }
  return null;
}

/**
 * Události: 'stav' (id setkání, stav setkání ve tvaru Player View: { encounterState }), 'spojeni' (true/false).
 * `WebSocketTrida` jde podstrčit v testech; v Node 22+ je WebSocket vestavěný.
 */
export class ZivyPlayerView extends EventEmitter {
  constructor({ WebSocketTrida = globalThis.WebSocket, adresa = ADRESA_ZIVE, obnovaMs = OBNOVA_MS, limitPripojeniMs = LIMIT_PRIPOJENI_MS } = {}) {
    super();
    this.WebSocketTrida = WebSocketTrida;
    this.adresa = adresa;
    this.obnovaMs = obnovaMs;
    this.limitPripojeniMs = limitPripojeniMs;
    this.id = null; // setkání, které má Hub sledovat (null = nic)
    this.ws = null;
    this.pripojeno = false;
    this.casovacObnovy = null;
    this.pokusy = 0;
  }

  /** Sledovat setkání (nebo null = odpojit). Opakované volání se stejným ID nic nedělá. */
  sledovat(id) {
    if (id === this.id) return;
    this.id = id;
    this.zavrit();
    if (id) this.pripojit();
  }

  pripojit() {
    clearTimeout(this.casovacObnovy);
    if (!this.id || !this.WebSocketTrida) return;
    let ws;
    try {
      ws = new this.WebSocketTrida(this.adresa);
    } catch {
      this.naplanovatObnovu();
      return;
    }
    this.ws = ws;
    const id = this.id;
    let pripojeni = setTimeout(() => {
      // Pokus visí (žádné otevření ani chyba): zahodit a zkusit znovu.
      pripojeni = null;
      if (this.ws !== ws) return;
      this.ws = null;
      try {
        ws.close();
      } catch {
        /* už zavřené */
      }
      this.nastavitSpojeni(false);
      this.naplanovatObnovu();
    }, this.limitPripojeniMs);
    pripojeni.unref?.();
    const hotovo = () => {
      clearTimeout(pripojeni);
      pripojeni = null;
    };
    const poslat = (x) => {
      try {
        ws.send(x);
      } catch {
        /* spojení se zavírá */
      }
    };
    ws.addEventListener('message', (e) => {
      if (this.ws !== ws) return;
      const z = rozebratZpravu(typeof e.data === 'string' ? e.data : '');
      if (!z) return;
      if (z.typ === 'ping') poslat('3');
      else if (z.typ === 'otevreno') poslat('40');
      else if (z.typ === 'pripojeno') {
        hotovo();
        poslat(`42${JSON.stringify(['join encounter', id])}`);
        this.pokusy = 0;
        this.nastavitSpojeni(true);
      } else if (z.typ === 'odpojeno') ws.close();
      else if (z.typ === 'udalost' && z.nazev === 'encounter updated' && z.data && typeof z.data === 'object') {
        this.emit('stav', id, { encounterState: z.data });
      }
    });
    const konec = () => {
      hotovo();
      if (this.ws !== ws) return;
      this.ws = null;
      this.nastavitSpojeni(false);
      this.naplanovatObnovu();
    };
    ws.addEventListener('close', konec);
    ws.addEventListener('error', konec);
  }

  naplanovatObnovu() {
    if (!this.id) return;
    const ms = Math.min(this.obnovaMs.max, this.obnovaMs.prvni * 2 ** this.pokusy);
    this.pokusy++;
    this.casovacObnovy = setTimeout(() => this.pripojit(), ms);
    this.casovacObnovy.unref?.();
  }

  zavrit() {
    clearTimeout(this.casovacObnovy);
    const ws = this.ws;
    this.ws = null;
    this.pokusy = 0;
    this.nastavitSpojeni(false);
    try {
      ws?.close();
    } catch {
      /* už zavřené */
    }
  }

  nastavitSpojeni(ano) {
    if (ano === this.pripojeno) return;
    this.pripojeno = ano;
    this.emit('spojeni', ano);
  }

  zastavit() {
    this.id = null;
    this.zavrit();
  }
}
