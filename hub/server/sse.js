// Živé změny pro panel i výstupy v OBS.
//
// Hlavní cesta je WebSocket (/api/zive). Prohlížeč (a OBS, který všechny Browser Sources
// pouští v jednom prohlížeči) drží na jeden server nejvýš 6 běžných spojení; trvalá spojení SSE
// je vyčerpala a obrázky se pak nenačetly (audit K1). Na WebSockety se tento limit nevztahuje.
// SSE (/api/udalosti) zůstává kvůli zpětné kompatibilitě, Hub ho sám už nepoužívá.
//
// Každý klient si může říct, které události chce (?udalosti=scena,kalendar). Výstupy tak
// dostávají jen svoje data, ne celý stav panelu (audit N9).
import { WebSocketServer } from 'ws';

const NAZEV_UDALOSTI = /^[a-z][a-z-]{0,29}$/;

/** Množina událostí z ?udalosti=…, nebo null = všechny (panel). */
export function filtrUdalosti(url) {
  const seznam = String(url.searchParams.get('udalosti') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => NAZEV_UDALOSTI.test(s))
    .slice(0, 20);
  return seznam.length ? new Set(seznam) : null;
}

// „verze“ (otisk kódu panelu a výstupů) dostává každý klient: po změně kódu se stránka sama obnoví.
const chce = (filtr, udalost) => !filtr || udalost === 'verze' || filtr.has(udalost);

export class Vysilac {
  constructor({ srdceMs = 15000 } = {}) {
    /** @type {Set<{res: import('node:http').ServerResponse, filtr: Set<string>|null}>} */
    this.klienti = new Set();
    /** @type {Set<{ws: import('ws').WebSocket, filtr: Set<string>|null, zivy: boolean}>} */
    this.wsKlienti = new Set();
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
    this.posledni = new Map(); // událost -> poslední data, pošlou se novému klientovi hned
    this.srdce = setInterval(() => this.tep(), srdceMs);
    this.srdce.unref?.();
  }

  /** SSE: zachováno kvůli zpětné kompatibilitě. */
  pripojit(req, res, filtr = null) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // Při výpadku zkus znovu za 1 s (výchozí hodnota prohlížeče bývá 3 s).
    res.write('retry: 1000\n\n');
    for (const [udalost, data] of this.posledni) if (chce(filtr, udalost)) res.write(Vysilac.zprava(udalost, data));
    const klient = { res, filtr };
    this.klienti.add(klient);
    req.on('close', () => this.klienti.delete(klient));
  }

  /** WebSocket: req a socket z události 'upgrade' HTTP serveru (oprávnění už ověřil Hub). */
  pripojitWs(req, socket, head, filtr = null) {
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      const klient = { ws, filtr, zivy: true };
      ws.on('pong', () => (klient.zivy = true));
      ws.on('close', () => this.wsKlienti.delete(klient));
      ws.on('error', () => this.wsKlienti.delete(klient));
      // Klient nic posílat nemusí; zprávy od něj se ignorují.
      this.wsKlienti.add(klient);
      for (const [udalost, data] of this.posledni) if (chce(filtr, udalost)) ws.send(Vysilac.zpravaWs(udalost, data));
    });
  }

  static zprava(udalost, data) {
    return `event: ${udalost}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  static zpravaWs(udalost, data) {
    return JSON.stringify({ u: udalost, d: data });
  }

  vyslat(udalost, data) {
    this.posledni.set(udalost, data);
    let sse;
    for (const k of this.klienti) if (chce(k.filtr, udalost)) k.res.write((sse ??= Vysilac.zprava(udalost, data)));
    let ws;
    for (const k of this.wsKlienti) {
      if (chce(k.filtr, udalost) && k.ws.readyState === 1) k.ws.send((ws ??= Vysilac.zpravaWs(udalost, data)));
    }
  }

  /** Udržuje spojení naživu a odpojí klienty, kteří přestali odpovídat (uspaný notebook, zavřený OBS). */
  tep() {
    for (const k of this.klienti) k.res.write(': srdce\n\n');
    for (const k of this.wsKlienti) {
      if (!k.zivy) {
        k.ws.terminate();
        this.wsKlienti.delete(k);
        continue;
      }
      k.zivy = false;
      try {
        k.ws.ping();
      } catch {
        /* spojení se právě zavírá */
      }
    }
  }

  get pocetKlientu() {
    return this.klienti.size + this.wsKlienti.size;
  }

  zavrit() {
    clearInterval(this.srdce);
    for (const k of this.klienti) k.res.end();
    this.klienti.clear();
    for (const k of this.wsKlienti) k.ws.terminate();
    this.wsKlienti.clear();
    this.wss.close();
  }
}
