// Philips Hue: lokální CLIP API v2 přes HTTPS na bridgi v domácí síti.
// Bridge má vlastní certifikát (ne od veřejné autority), proto ho Hub neověřuje jménem, ale otiskem
// uloženým při spárování (HUE_OTISK v hub/.env): podvržený bridge v síti klíč nedostane.
// Limity bridge: ~10 příkazů/s na jedno světlo, ~1/s na skupinu. Hub posílá vždy na jednotlivá světla.
import https from 'node:https';
import tls from 'node:tls';
import { rgbNaXy, xyNaRgb } from './barvy.js';

const chyba = (zprava, status = 503) => Object.assign(new Error(zprava), { status });

/**
 * Spojení TLS s bridgem. Otisk certifikátu se ověří dřív, než odejde jediný bajt požadavku:
 * podvržený bridge tak klíč v hlavičce nikdy nedostane.
 */
function spojit({ bridge, port, otisk, limitMs }) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: bridge, port, rejectUnauthorized: false }); // ověří se otisk níž
    const casovac = setTimeout(() => socket.destroy(new Error('bez odpovědi')), limitMs);
    socket.once('secureConnect', () => {
      clearTimeout(casovac);
      const otiskBridge = socket.getPeerCertificate()?.fingerprint256 ?? null;
      if (otisk && otiskBridge !== otisk) {
        socket.destroy();
        reject(chyba('Certifikát Hue bridge nesedí s tím ze spárování. Spáruj bridge znovu v Nastavení.', 502));
        return;
      }
      resolve({ socket, otisk: otiskBridge });
    });
    socket.once('error', (e) => {
      clearTimeout(casovac);
      reject(chyba(`Hue bridge ${bridge} neodpovídá (${e.code ?? e.message}).`));
    });
  });
}

/** Jeden HTTPS požadavek na bridge. Vrací rozebraný JSON a otisk certifikátu. */
async function pozadavek({ bridge, port = 443, metoda = 'GET', cesta, telo, klic, otisk, limitMs = 3000 }) {
  const spojeni = await spojit({ bridge, port, otisk, limitMs });
  return new Promise((resolve, reject) => {
    const data = telo === undefined ? undefined : Buffer.from(JSON.stringify(telo));
    const req = https.request(
      {
        host: bridge,
        port,
        method: metoda,
        path: cesta,
        headers: {
          ...(klic ? { 'hue-application-key': klic } : {}),
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
          Connection: 'close',
        },
        createConnection: () => spojeni.socket, // bez agenta: použije se ověřené spojení
        timeout: limitMs,
      },
      (res) => {
        const casti = [];
        res.on('data', (c) => casti.push(c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(casti).toString('utf8') || 'null'), otisk: spojeni.otisk });
          } catch {
            reject(chyba('Hue bridge vrátil nečitelnou odpověď.'));
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('bez odpovědi')));
    req.on('error', (e) => reject(chyba(`Hue bridge ${bridge} neodpovídá (${e.code ?? e.message}).`)));
    req.end(data);
  });
}

export class Hue {
  /** @param {{bridge: string, klic: string, otisk?: string, port?: number}} volby */
  constructor({ bridge, klic, otisk = null, port = 443, limitMs = 3000 }) {
    Object.assign(this, { bridge, klic, otisk, port, limitMs });
  }

  /**
   * Spárování: na bridgi se musí do 30 s předtím stisknout kulaté tlačítko.
   * @returns {Promise<{klic: string, otisk: string}>}
   */
  static async sparovat({ bridge, port = 443 }) {
    const r = await pozadavek({ bridge, port, metoda: 'POST', cesta: '/api', telo: { devicetype: 'dm_hub#hub', generateclientkey: true } });
    const odpoved = Array.isArray(r.data) ? r.data[0] : null;
    if (odpoved?.success?.username) return { klic: odpoved.success.username, otisk: r.otisk };
    if (odpoved?.error?.type === 101) throw chyba('Stiskni kulaté tlačítko na Hue bridgi a do 30 s klikni na Spárovat znovu.', 409);
    throw chyba(`Spárování se nepodařilo: ${odpoved?.error?.description ?? 'neznámá odpověď bridge'}.`, 502);
  }

  async volat(metoda, cesta, telo) {
    const r = await pozadavek({ bridge: this.bridge, port: this.port, metoda, cesta, telo, klic: this.klic, otisk: this.otisk, limitMs: this.limitMs });
    if (r.status === 403 || r.status === 401) throw chyba('Hue bridge klíč nepřijal. Spáruj bridge znovu v Nastavení.', 502);
    const chyby = r.data?.errors ?? [];
    if (r.status >= 400) throw chyba(`Hue: ${chyby[0]?.description ?? `chyba ${r.status}`}`, 502);
    return r.data?.data ?? [];
  }

  /** Světla na bridgi: id, jméno a co umí (barvu, efekty). */
  async svetla() {
    const data = await this.volat('GET', '/clip/v2/resource/light');
    return data.map((l) => ({
      id: l.id,
      nazev: l.metadata?.name ?? l.id,
      barevne: Boolean(l.color),
      efekty: l.effects?.effect_values ?? [],
    }));
  }

  /**
   * Nastaví světlo podle stavu role: {zap, rgb, jas 0–100}. prechodMs = délka prolnutí na bridgi.
   */
  async nastavit(id, cil, prechodMs = 800) {
    const telo = cil.zap && cil.jas > 0
      ? { on: { on: true }, dimming: { brightness: Math.max(1, Math.min(100, cil.jas)) }, ...(cil.rgb ? { color: { xy: rgbNaXy(cil.rgb) } } : {}), dynamics: { duration: prechodMs } }
      : { on: { on: false }, dynamics: { duration: prechodMs } };
    await this.volat('PUT', `/clip/v2/resource/light/${encodeURIComponent(id)}`, telo);
  }

  /** Aktuální stav světla (Zachytit světla). */
  async stav(id) {
    const [l] = await this.volat('GET', `/clip/v2/resource/light/${encodeURIComponent(id)}`);
    if (!l) throw chyba('Světlo na bridgi není.', 404);
    return {
      zap: Boolean(l.on?.on),
      jas: Math.round(l.dimming?.brightness ?? 100),
      rgb: l.color?.xy ? xyNaRgb(l.color.xy) : [255, 214, 170],
    };
  }
}
