// Server-Sent Events: server posílá změny panelu i výstupům v OBS.
// Prohlížeč (i Browser Source v OBS) se po výpadku sám znovu připojí.
export class Vysilac {
  constructor({ srdceMs = 15000 } = {}) {
    this.klienti = new Set();
    this.posledni = new Map(); // událost -> poslední data, pošlou se novému klientovi hned
    this.srdce = setInterval(() => this.posliVsem(': srdce\n\n'), srdceMs);
    this.srdce.unref?.();
  }

  pripojit(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // Při výpadku zkus znovu za 1 s (výchozí hodnota prohlížeče bývá 3 s).
    res.write('retry: 1000\n\n');
    for (const [udalost, data] of this.posledni) res.write(Vysilac.zprava(udalost, data));
    this.klienti.add(res);
    req.on('close', () => this.klienti.delete(res));
  }

  static zprava(udalost, data) {
    return `event: ${udalost}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  vyslat(udalost, data) {
    this.posledni.set(udalost, data);
    this.posliVsem(Vysilac.zprava(udalost, data));
  }

  posliVsem(text) {
    for (const res of this.klienti) res.write(text);
  }

  zavrit() {
    clearInterval(this.srdce);
    for (const res of this.klienti) res.end();
    this.klienti.clear();
  }
}
