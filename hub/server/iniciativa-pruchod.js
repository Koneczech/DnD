// Průchod k Improved Initiative s přihlášením (otevřený bod 70). Vložený Improved Initiative se sám
// nepřihlásí: jeho cookie relace nemá SameSite, a prohlížeč ji do stránky vložené na jiném webu nepošle.
// Průchod běží jen na tomto počítači (127.0.0.1, port Hubu + 1), posílá požadavky na improvedinitiative.app
// a přidává k nim relaci DM (connect.sid z hub/.env). Prohlížeč relaci nikdy nedostane.
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { EventEmitter } from 'node:events';

export const CIL = 'improvedinitiative.app';
const COOKIE = 'connect.sid';

/**
 * Smí požadavek projít? Jen z tohoto počítače, s Host průchodu (proti DNS rebindingu) a bez akcí,
 * které by účet poškodily: odhlášení zruší relaci, DELETE /my smaže účet.
 */
export function povolitPozadavek({ adresa, host, origin, metoda, cesta }, port) {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(adresa)) return 'Jen z tohoto počítače.';
  const nase = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (!nase.has(String(host ?? ''))) return 'Neznámá adresa průchodu.';
  // Origin posílá prohlížeč u změn a WebSocketu; cizí stránka tudy relaci DM nepoužije.
  if (origin && ![...nase].some((h) => origin === `http://${h}`)) return 'Požadavek z cizí stránky.';
  const p = String(cesta ?? '').split('?')[0];
  if (/^\/logout\b/i.test(p)) return 'Odhlášení průchod nepustí (zrušilo by relaci v Hubu).';
  if (metoda === 'DELETE' && /^\/my\/?$/i.test(p)) return 'Smazání účtu průchod nepustí.';
  return null;
}

/** Hlavičky pro improvedinitiative.app: Host, Origin a Referer jako by šly přímo, cookie jen relace DM. */
export function hlavickyNaCil(puvodni, relace, port) {
  const h = { ...puvodni };
  for (const k of ['host', 'cookie', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded']) delete h[k];
  h.host = CIL;
  if (h.origin) h.origin = `https://${CIL}`;
  if (h.referer) h.referer = String(h.referer).replace(new RegExp(`^http://(127\\.0\\.0\\.1|localhost):${port}`), `https://${CIL}`);
  if (relace) h.cookie = `${COOKIE}=${relace}`;
  return h;
}

/**
 * Hlavičky odpovědi pro prohlížeč: bez cookies (relaci drží Hub), bez zákazu vložení,
 * přesměrování na improvedinitiative.app zůstane v průchodu. Vrátí i obnovenou relaci, pokud ji server poslal.
 */
export function hlavickyZpet(puvodni, puvodHost) {
  const h = { ...puvodni };
  let novaRelace = null;
  const cookies = [].concat(h['set-cookie'] ?? []);
  for (const c of cookies) {
    const m = String(c).match(/^connect\.sid=([^;]+)/);
    if (m) novaRelace = m[1];
  }
  delete h['set-cookie'];
  delete h['x-frame-options'];
  delete h['content-security-policy'];
  delete h['strict-transport-security'];
  if (h.location) h.location = String(h.location).replace(new RegExp(`^https://${CIL.replace(/\./g, '\\.')}`), `http://${puvodHost}`);
  return { hlavicky: h, novaRelace };
}

/**
 * Skript na začátek stránky editoru: Improved Initiative čte nastavení jen z úložiště prohlížeče a vložená
 * stránka ho má vlastní (prázdné). Bez toho by do Player View poslala výchozí nastavení bez CSS a po uložení
 * by výchozí nastavení přepsalo i to v účtu. Skript před startem editoru zapíše nastavení z účtu (GET /my).
 */
export const SKRIPT_NASTAVENI = `<script>/* DM Hub: nastavení z účtu Epic */(function(){try{var x=new XMLHttpRequest();x.open('GET','/my',false);x.send();if(x.status!==200)return;var a=JSON.parse(x.responseText);if(!a||!a.settings)return;var k='ImprovedInitiative.User';var s=JSON.parse(localStorage.getItem(k)||'[]');if(s.indexOf('Settings')<0){s.push('Settings');localStorage.setItem(k,JSON.stringify(s));}localStorage.setItem(k+'.Settings',JSON.stringify(a.settings));}catch(e){console.warn('DM Hub: nastavení z účtu se nenačetlo',e);}})();</script>`;

/** Vloží skript hned za <head>; stránka bez <head> zůstane, jak je. */
export function vlozitSkript(html) {
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}${SKRIPT_NASTAVENI}`) : html;
}

/** Je to stránka editoru (pohled DM)? Jen ta potřebuje nastavení z účtu. */
const jeEditor = (metoda, cesta) => metoda === 'GET' && /^\/e(\/|\?|$)/.test(String(cesta ?? ''));

/** Události: 'relace' (server poslal obnovenou relaci), 'stav'. */
export class PruchodIniciativy extends EventEmitter {
  constructor({ port, relace, request = https.request, pripojit = tls.connect }) {
    super();
    this.port = port;
    this.relace = relace; // () => hodnota connect.sid nebo null
    this.request = request;
    this.pripojit = pripojit;
    this.server = null;
    this.prihlasen = null; // true / false / null (nezjištěno)
  }

  spustit() {
    this.server = http.createServer((req, res) => this.pozadavek(req, res));
    this.server.on('upgrade', (req, socket, head) => this.upgrade(req, socket, head));
    return new Promise((ok, chyba) => {
      this.server.once('error', chyba);
      this.server.listen(this.port, '127.0.0.1', () => ok(this));
    });
  }

  zastavit() {
    return new Promise((ok) => (this.server ? this.server.close(() => ok()) : ok()));
  }

  zkontrolovat(req) {
    return povolitPozadavek({
      adresa: req.socket.remoteAddress,
      host: req.headers.host,
      origin: req.headers.origin,
      metoda: req.method,
      cesta: req.url,
    }, this.port);
  }

  pozadavek(req, res) {
    const zamitnuto = this.zkontrolovat(req);
    if (zamitnuto) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(zamitnuto);
    }
    const editor = jeEditor(req.method, req.url);
    const hlavickyVen = hlavickyNaCil(req.headers, this.relace(), this.port);
    // Stránku editoru průchod upravuje, proto ji chce nekomprimovanou.
    if (editor) hlavickyVen['accept-encoding'] = 'identity';
    const ven = this.request({
      host: CIL,
      port: 443,
      servername: CIL,
      method: req.method,
      path: req.url,
      headers: hlavickyVen,
    }, (odpoved) => {
      const { hlavicky, novaRelace } = hlavickyZpet(odpoved.headers, req.headers.host);
      if (novaRelace && novaRelace !== this.relace()) this.emit('relace', novaRelace);
      const html = /text\/html/i.test(String(odpoved.headers['content-type'] ?? ''));
      if (!editor || !html || odpoved.headers['content-encoding']) {
        res.writeHead(odpoved.statusCode ?? 502, hlavicky);
        odpoved.pipe(res);
        return;
      }
      const casti = [];
      odpoved.on('data', (c) => casti.push(c));
      odpoved.on('end', () => {
        const telo = Buffer.from(vlozitSkript(Buffer.concat(casti).toString('utf8')), 'utf8');
        delete hlavicky['transfer-encoding'];
        hlavicky['content-length'] = String(telo.length);
        res.writeHead(odpoved.statusCode ?? 502, hlavicky);
        res.end(telo);
      });
    });
    ven.on('error', (e) => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`Improved Initiative neodpovídá: ${e.message}`);
    });
    req.pipe(ven);
  }

  /** WebSocket (socket.io synchronizuje Player View): tunel s přepsanými hlavičkami. */
  upgrade(req, socket, head) {
    const zamitnuto = this.zkontrolovat(req);
    if (zamitnuto) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const hlavicky = hlavickyNaCil(req.headers, this.relace(), this.port);
    const ven = this.pripojit({ host: CIL, port: 443, servername: CIL }, () => {
      const radky = [`${req.method} ${req.url} HTTP/1.1`, ...Object.entries(hlavicky).map(([k, v]) => `${k}: ${v}`), '', ''];
      ven.write(radky.join('\r\n'));
      if (head?.length) ven.write(head);
      ven.pipe(socket);
      socket.pipe(ven);
    });
    const zavrit = () => {
      ven.destroy();
      socket.destroy();
    };
    ven.on('error', zavrit);
    socket.on('error', zavrit);
  }

  /** Je relace platná? /my vrací 403 bez přihlášení (účet s úložištěm Epic). */
  async overit() {
    if (!this.relace()) {
      this.prihlasen = null;
      this.emit('stav');
      return null;
    }
    this.prihlasen = await new Promise((ok) => {
      const r = this.request({
        host: CIL, port: 443, servername: CIL, method: 'GET', path: '/my',
        headers: { host: CIL, cookie: `${COOKIE}=${this.relace()}`, accept: 'application/json' },
      }, (odpoved) => {
        odpoved.resume();
        ok(odpoved.statusCode === 200);
      });
      r.setTimeout(8000, () => r.destroy(new Error('čas vypršel')));
      r.on('error', () => ok(null));
      r.end();
    });
    this.emit('stav');
    return this.prihlasen;
  }
}
