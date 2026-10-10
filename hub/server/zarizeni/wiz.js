// WiZ lampa: lokální ovládání přes UDP (port 38899, JSON setPilot / getPilot), bez bridge a bez knihovny.
// V aplikaci WiZ musí být zapnuté „Allow local communication“ a lampa má mít pevnou IP.
// UDP nemá potvrzení doručení: každý příkaz čeká na odpověď a při jejím chybění se zopakuje.
import dgram from 'node:dgram';

/** Vestavěné dynamické scény WiZ (sceneId). Vlastní scény z aplikace lokálně nejdou. */
export const WIZ_SCENY = Object.freeze({
  ocean: 1, romance: 2, sunset: 3, party: 4, fireplace: 5, cozy: 6, forest: 7, pastel: 8,
  wakeup: 9, bedtime: 10, warmwhite: 11, daylight: 12, coolwhite: 13, nightlight: 14, focus: 15,
  relax: 16, truecolors: 17, tvtime: 18, plantgrowth: 19, spring: 20, summer: 21, fall: 22,
  deepdive: 23, jungle: 24, mojito: 25, club: 26, christmas: 27, halloween: 28, candlelight: 29,
  goldenwhite: 30, pulse: 31, steampunk: 32,
});

/** Bílá podle teploty (WiZ v režimu bílé vrací jen temp): přibližně mezi 2200 K a 6500 K. */
function teplotaNaRgb(k) {
  const t = Math.max(0, Math.min(1, (k - 2200) / 4300));
  return [255, Math.round(150 + t * 100), Math.round(70 + t * 180)];
}

const chyba = (zprava) => Object.assign(new Error(zprava), { status: 503 });

export class Wiz {
  /**
   * @param {object} volby
   * @param {string} volby.adresa IP lampy
   * @param {number} [volby.port] výchozí 38899 (testy používají falešnou lampu na jiném portu)
   */
  constructor({ adresa, port = 38899, limitMs = 400, pokusu = 3 }) {
    this.adresa = adresa;
    this.port = port;
    this.limitMs = limitMs;
    this.pokusu = pokusu;
    this.fronta = Promise.resolve();
  }

  /** Jeden dotaz s čekáním na odpověď; příkazy na jednu lampu jdou za sebou. */
  poslat(metoda, params = {}) {
    const vysledek = this.fronta.catch(() => {}).then(() => this.poslatTed(metoda, params));
    this.fronta = vysledek.catch(() => {});
    return vysledek;
  }

  async poslatTed(metoda, params) {
    const zprava = Buffer.from(JSON.stringify({ method: metoda, params }));
    let posledni;
    for (let i = 0; i < this.pokusu; i++) {
      try {
        return await this.jedenPokus(zprava);
      } catch (e) {
        posledni = e;
      }
    }
    throw chyba(`WiZ lampa ${this.adresa} neodpovídá (${posledni?.message ?? 'bez odpovědi'}).`);
  }

  jedenPokus(zprava) {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket('udp4');
      const konec = (fn, hodnota) => {
        clearTimeout(casovac);
        socket.close();
        fn(hodnota);
      };
      const casovac = setTimeout(() => konec(reject, new Error('bez odpovědi')), this.limitMs);
      socket.on('error', (e) => konec(reject, e));
      socket.on('message', (data) => {
        try {
          const odpoved = JSON.parse(String(data));
          if (odpoved.error) konec(reject, new Error(odpoved.error.message ?? 'chyba lampy'));
          else konec(resolve, odpoved.result ?? {});
        } catch {
          konec(reject, new Error('nečitelná odpověď'));
        }
      });
      socket.send(zprava, this.port, this.adresa, (e) => e && konec(reject, e));
    });
  }

  /**
   * Nastaví lampu podle stavu role: {zap, rgb:[r,g,b], jas:0–100, scena, rychlost}.
   * WiZ přijímá jas 10–100; pod 10 se lampa vypne.
   */
  async nastavit(cil) {
    if (!cil.zap || cil.jas < 1) return this.poslat('setPilot', { state: false });
    const dimming = Math.max(10, Math.min(100, Math.round(cil.jas)));
    if (cil.scena && WIZ_SCENY[cil.scena]) {
      return this.poslat('setPilot', { state: true, sceneId: WIZ_SCENY[cil.scena], speed: Math.max(10, Math.min(200, cil.rychlost ?? 100)), dimming });
    }
    const [r, g, b] = cil.rgb ?? [255, 214, 170];
    return this.poslat('setPilot', { state: true, r, g, b, dimming });
  }

  /** Aktuální stav lampy (Zachytit světla). */
  async stav() {
    const p = await this.poslat('getPilot', {});
    const scena = Object.entries(WIZ_SCENY).find(([, id]) => id === p.sceneId)?.[0] ?? null;
    return {
      zap: p.state !== false,
      jas: p.dimming ?? 100,
      ...(scena ? { scena, rychlost: p.speed ?? 100 } : { rgb: p.r == null && p.temp ? teplotaNaRgb(p.temp) : [p.r ?? 255, p.g ?? 214, p.b ?? 170] }),
    };
  }
}
