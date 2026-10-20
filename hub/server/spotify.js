// Spotify (DM 20. 10. 2026, ⚠ návrh): Hub řídí, co hraje aplikace Spotify na tomto PC (Web API,
// účet Premium). Zvuk aplikace jde do virtuálního kabelu (VB-CABLE) a stránka Zvuk u stolu ho bere
// jako vstup, takže na hudbu ze Spotify fungují efekty Hubu: ucpané uši, uhnutí, Ticho a prolnutí.
//
// Přihlášení: Authorization Code s PKCE (aplikace DM na developer.spotify.com, bez tajného klíče).
// Client ID a obnovovací token jsou v hub/.env; přístupový token jen v paměti.
// Přepnutí playlistu: stránka hudbu ztlumí (prolnutí), Hub pak přepne playlist a ohlásí, že hraje;
// stránka ji zase plynule zesílí. Nová hudba tak nikdy nevskočí doprostřed staré.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

export const SPOTIFY_UCTY = 'https://accounts.spotify.com';
export const SPOTIFY_API = 'https://api.spotify.com/v1';
export const OPRAVNENI = Object.freeze(['user-read-playback-state', 'user-modify-playback-state', 'playlist-read-private', 'playlist-read-collaborative']);
/** Když Spotify žádná scéna nechce, Hub ho za tuhle dobu pozastaví (krátké přepnutí ho nezastaví). */
export const PAUZA_PO_MS = 60000;
/** Jak často Hub ověří, že aplikace Spotify na PC běží. */
export const OVERENI_MS = 30000;
/** Hlasitost normalizace Spotify (nastavení Normální) v LUFS: k ní se dorovná hladina hudby Hubu. */
export const SPOTIFY_LUFS = -14;

const chyba = (zprava, status = 400, kod) => Object.assign(new Error(zprava), { status, ...(kod ? { kod } : {}) });
const base64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Odkaz na playlist nebo album ze Spotify → URI (`spotify:playlist:<id>`), jinak null.
 * Bere URI, odkaz z „Sdílet → Kopírovat odkaz“ (i s ?si=… a /intl-cs/) i holé ID playlistu.
 */
export function spotifyUri(x) {
  const t = String(x ?? '').trim();
  let m = t.match(/^spotify:(playlist|album):([A-Za-z0-9]{10,40})$/);
  if (m) return `spotify:${m[1]}:${m[2]}`;
  m = t.match(/^https:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(playlist|album)\/([A-Za-z0-9]{10,40})(?:[/?#].*)?$/);
  if (m) return `spotify:${m[1]}:${m[2]}`;
  return null;
}

/** Client ID aplikace ze Spotify: 32 hex znaků. */
export const platnyKlient = (x) => /^[0-9a-f]{32}$/i.test(String(x ?? '').trim());

/**
 * Události: 'stav' (veřejný stav pro panel a zvuk), 'obnova' (nový obnovovací token k uložení).
 */
export class Spotify extends EventEmitter {
  /**
   * @param {object} v
   * @param {() => Record<string,string>} v.nastaveni hodnoty z hub/.env
   * @param {(zmeny: object) => Promise<void>} v.ulozit zápis do hub/.env (Nastaveni.ulozit)
   * @param {() => number} v.port port Hubu (adresa pro návrat z přihlášení)
   * @param {() => number} [v.prolnutiMs] jak dlouho stránka hudbu ztlumuje před přepnutím
   */
  constructor({ nastaveni, ulozit, port, prolnutiMs = () => 2000, fetch: f = globalThis.fetch, hodiny = () => Date.now(), cekat }) {
    super();
    this.nastaveni = nastaveni;
    this.ulozit = ulozit;
    this.port = port;
    this.prolnutiMs = prolnutiMs;
    this.fetch = f;
    this.hodiny = hodiny;
    this.cekat = cekat ?? ((ms) => new Promise((r) => setTimeout(r, ms).unref?.()));
    this.pristup = null; // { token, do }
    this.cekajici = null; // { verifier, state, do } rozdělané přihlášení
    this.uzivatel = null;
    this.zarizeni = null; // { id, nazev }
    this.chyba = null;
    this.cil = null; // URI, které chce Hub hrát (null = nic)
    this.hraje = null; // URI, které Spotify na pokyn Hubu opravdu hraje
    this.selhalo = null; // URI, které se nepodařilo pustit (zvuk pak hraje zálohu ze složky)
    this.hlasitostNastavena = null; // ID zařízení, kterému Hub nastavil hlasitost 100 %
    this.fronta = Promise.resolve();
    this.casovacPauzy = null;
    this.casovacOvereni = null;
    this.posledniStav = null;
  }

  get klient() {
    const k = String(this.nastaveni().SPOTIFY_KLIENT ?? '').trim();
    return platnyKlient(k) ? k : null;
  }

  get prihlaseno() {
    return Boolean(this.klient && this.nastaveni().SPOTIFY_OBNOVA);
  }

  /** Adresa pro návrat z přihlášení; přesně tuhle DM zapíše v aplikaci na developer.spotify.com. */
  get presmerovani() {
    return `http://127.0.0.1:${this.port()}/spotify/prihlaseni`;
  }

  /** Připraveno hrát: přihlášeno a aplikace Spotify na PC běží. */
  get pripraveno() {
    return this.prihlaseno && Boolean(this.zarizeni);
  }

  verejny() {
    return {
      klient: Boolean(this.klient),
      prihlaseno: this.prihlaseno,
      uzivatel: this.uzivatel,
      zarizeni: this.zarizeni?.nazev ?? null,
      pripraveno: this.pripraveno,
      chyba: this.chyba,
      cil: this.cil,
      hraje: this.hraje,
      selhalo: this.selhalo,
      presmerovani: this.presmerovani,
    };
  }

  oznam() {
    const v = this.verejny();
    const json = JSON.stringify(v);
    if (json === this.posledniStav) return;
    this.posledniStav = json;
    this.emit('stav', v);
  }

  nastavitChybu(text) {
    this.chyba = text;
    this.oznam();
  }

  spustit() {
    this.casovacOvereni = setInterval(() => this.overit().catch(() => {}), OVERENI_MS);
    this.casovacOvereni.unref?.();
    this.overit().catch(() => {});
  }

  zastavit() {
    clearInterval(this.casovacOvereni);
    clearTimeout(this.casovacPauzy);
  }

  /* ---------- Přihlášení (PKCE) ---------- */

  /** Adresa přihlášení ke Spotify (panel ji otevře v novém okně). */
  zacitPrihlaseni() {
    if (!this.klient) throw chyba('Nejdřív vlož Client ID aplikace ze Spotify (Nastavení → Zvuk → Spotify).');
    const verifier = base64url(crypto.randomBytes(48));
    const state = base64url(crypto.randomBytes(16));
    this.cekajici = { verifier, state, do: this.hodiny() + 10 * 60000 };
    const u = new URL(`${SPOTIFY_UCTY}/authorize`);
    u.searchParams.set('client_id', this.klient);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('redirect_uri', this.presmerovani);
    u.searchParams.set('scope', OPRAVNENI.join(' '));
    u.searchParams.set('state', state);
    u.searchParams.set('code_challenge_method', 'S256');
    u.searchParams.set('code_challenge', base64url(crypto.createHash('sha256').update(verifier).digest()));
    return u.toString();
  }

  /** Návrat ze Spotify s kódem: vymění ho za tokeny a obnovovací uloží do hub/.env. */
  async dokoncitPrihlaseni({ code, state, error }) {
    const c = this.cekajici;
    if (error) throw chyba(error === 'access_denied' ? 'Přihlášení ke Spotify jsi zrušil.' : `Spotify přihlášení odmítl (${String(error).slice(0, 60)}).`);
    if (!c || !state || state !== c.state || this.hodiny() > c.do) throw chyba('Přihlášení vypršelo nebo nepatří k tomuto Hubu. Klikni v Hubu znovu na Přihlásit ke Spotify.');
    this.cekajici = null;
    const d = await this.tokenovyPozadavek({ grant_type: 'authorization_code', code: String(code ?? ''), redirect_uri: this.presmerovani, code_verifier: c.verifier });
    if (!d.refresh_token) throw chyba('Spotify neposlal obnovovací token.', 502);
    await this.ulozit({ spotifyObnova: d.refresh_token });
    this.pristup = { token: d.access_token, do: this.hodiny() + (d.expires_in ?? 3600) * 1000 - 60000 };
    this.chyba = null;
    await this.overit();
    return this.verejny();
  }

  async odhlasit() {
    this.pristup = null;
    this.uzivatel = null;
    this.zarizeni = null;
    this.hraje = null;
    await this.ulozit({ smazatSpotify: true });
    this.chyba = null;
    this.oznam();
    return this.verejny();
  }

  async tokenovyPozadavek(parametry) {
    let r;
    try {
      r = await this.fetch(`${SPOTIFY_UCTY}/api/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: this.klient, ...parametry }).toString(),
        signal: AbortSignal.timeout(10000),
      });
    } catch (e) {
      throw chyba(`Spotify neodpovídá (${e.name === 'TimeoutError' ? 'vypršel čas' : e.message}).`, 502);
    }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (d.error === 'invalid_grant') {
        // Obnovovací token neplatí (DM přístup zrušil, změnil aplikaci): přihlásit znovu.
        await this.ulozit({ smazatSpotify: true }).catch(() => {});
        throw chyba('Přihlášení ke Spotify vypršelo. Přihlas se znovu v Nastavení → Zvuk → Spotify.', 401, 'prihlaseni');
      }
      if (d.error === 'invalid_client') throw chyba('Spotify nezná tohle Client ID. Zkontroluj ho v Nastavení → Zvuk → Spotify.', 400);
      throw chyba(`Spotify přihlášení selhalo (${d.error_description ?? d.error ?? r.status}).`, 502);
    }
    return d;
  }

  async token() {
    if (this.pristup && this.hodiny() < this.pristup.do) return this.pristup.token;
    const obnova = this.nastaveni().SPOTIFY_OBNOVA;
    if (!this.klient || !obnova) throw chyba('Hub není přihlášený ke Spotify.', 401, 'prihlaseni');
    const d = await this.tokenovyPozadavek({ grant_type: 'refresh_token', refresh_token: obnova });
    this.pristup = { token: d.access_token, do: this.hodiny() + (d.expires_in ?? 3600) * 1000 - 60000 };
    // Spotify u PKCE obnovovací token občas vymění: nový je potřeba uložit, starý přestane platit.
    if (d.refresh_token && d.refresh_token !== obnova) await this.ulozit({ spotifyObnova: d.refresh_token });
    return this.pristup.token;
  }

  /** Volání Web API. 204 = null. Neplatný token jednou obnoví. */
  async api(metoda, cesta, { telo, dotaz, znovu = true } = {}) {
    const u = new URL(`${SPOTIFY_API}${cesta}`);
    for (const [k, v] of Object.entries(dotaz ?? {})) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    let r;
    try {
      r = await this.fetch(u.toString(), {
        method: metoda,
        headers: { Authorization: `Bearer ${await this.token()}`, ...(telo ? { 'Content-Type': 'application/json' } : {}) },
        body: telo ? JSON.stringify(telo) : undefined,
        signal: AbortSignal.timeout(10000),
      });
    } catch (e) {
      if (e.status) throw e;
      throw chyba(`Spotify neodpovídá (${e.name === 'TimeoutError' ? 'vypršel čas' : e.message}).`, 502);
    }
    if (r.status === 401 && znovu) {
      this.pristup = null;
      return this.api(metoda, cesta, { telo, dotaz, znovu: false });
    }
    if (r.status === 204 || r.status === 202) return null;
    const d = await r.json().catch(() => null);
    if (r.ok) return d;
    const duvod = d?.error?.reason ?? '';
    if (r.status === 403 && /PREMIUM/i.test(duvod + (d?.error?.message ?? ''))) throw chyba('Ovládání přehrávání chce Spotify Premium.', 403, 'premium');
    if (r.status === 404 && /NO_ACTIVE_DEVICE/i.test(duvod)) throw chyba('Aplikace Spotify na tomto PC neběží.', 409, 'zarizeni');
    if (r.status === 404) throw chyba('Spotify tohle nenašel (playlist nebo zařízení).', 404, 'nenalezeno');
    if (r.status === 429) throw chyba('Spotify: příliš mnoho požadavků, zkusím to za chvíli.', 429);
    throw chyba(`Spotify vrátil chybu ${r.status}${d?.error?.message ? `: ${d.error.message}` : ''}.`, 502);
  }

  /** Zařízení Spotify, které má Hub ovládat: podle jména z Nastavení, jinak počítač. */
  vybratZarizeni(seznam = []) {
    const jmeno = String(this.nastaveni().SPOTIFY_ZARIZENI ?? '').trim().toLowerCase();
    const pouzitelna = seznam.filter((d) => d?.id && !d.is_restricted);
    const d = jmeno
      ? pouzitelna.find((x) => String(x.name ?? '').toLowerCase().includes(jmeno))
      : pouzitelna.find((x) => x.type === 'Computer' && x.is_active) ?? pouzitelna.find((x) => x.type === 'Computer');
    return d ? { id: d.id, nazev: String(d.name ?? 'Spotify') } : null;
  }

  /** Kdo je přihlášený a jestli aplikace Spotify na PC běží. */
  async overit() {
    if (!this.prihlaseno) {
      this.zarizeni = null;
      this.oznam();
      return this.verejny();
    }
    try {
      if (!this.uzivatel) {
        const ja = await this.api('GET', '/me');
        this.uzivatel = String(ja?.display_name ?? ja?.id ?? '').slice(0, 80) || null;
      }
      const d = await this.api('GET', '/me/player/devices');
      const pred = this.zarizeni?.id;
      this.zarizeni = this.vybratZarizeni(d?.devices);
      if (!this.zarizeni) this.hraje = null;
      this.chyba = this.zarizeni
        ? null
        : String(this.nastaveni().SPOTIFY_ZARIZENI ?? '').trim()
          ? `Zařízení Spotify „${this.nastaveni().SPOTIFY_ZARIZENI}“ není vidět. Spusť na něm Spotify a přihlas se stejným účtem.`
          : 'Aplikace Spotify na tomto PC neběží. Spusť ji a přihlas se stejným účtem.';
      // Aplikace se právě objevila (nebo od chyby uběhly 2 minuty): zkusit znovu i playlist, který nešel.
      if (this.zarizeni && (this.zarizeni.id !== pred || (this.selhalo && this.hodiny() - this.selhaloKdy > 120000))) {
        this.selhalo = null;
        if (this.cil && this.hraje !== this.cil) this.naplanovat();
      }
    } catch (e) {
      if (e.kod === 'prihlaseni') {
        this.uzivatel = null;
        this.zarizeni = null;
      }
      this.chyba = e.message;
    }
    this.oznam();
    return this.verejny();
  }

  /** Playlisty uživatele pro výběr v Místa → Zvuk. */
  async playlisty() {
    const vysledek = [];
    let dalsi = '/me/playlists';
    for (let strana = 0; dalsi && strana < 4; strana++) {
      const d = await this.api('GET', dalsi.replace(SPOTIFY_API, ''), strana === 0 ? { dotaz: { limit: 50 } } : {});
      for (const p of d?.items ?? []) if (p?.uri) vysledek.push({ uri: p.uri, nazev: String(p.name ?? p.uri).slice(0, 120) });
      dalsi = d?.next ?? null;
    }
    return vysledek;
  }

  /* ---------- Přehrávání ---------- */

  /**
   * Co má hrát (URI, nebo null = nic). Volá ho zvuk při každé změně scény; opakované volání se stejným
   * cílem nic nedělá. Přepnutí jde přes frontu, takže rychlé klikání nepošle Spotify zmatené pokyny.
   */
  chci(uri) {
    const cil = uri ?? null;
    if (cil === this.cil) return;
    this.cil = cil;
    clearTimeout(this.casovacPauzy);
    if (!cil) {
      // Nic ze Spotify: stránka hudbu ztlumila; po minutě se aplikace pozastaví (krátké přepnutí ne).
      this.casovacPauzy = setTimeout(() => this.naplanovat(), PAUZA_PO_MS);
      this.casovacPauzy.unref?.();
      this.oznam();
      return;
    }
    this.oznam();
    this.naplanovat();
  }

  naplanovat() {
    this.fronta = this.fronta.then(() => this.provest()).catch(() => {});
    return this.fronta;
  }

  async provest() {
    const cil = this.cil;
    if (!cil) {
      if (!this.hraje) return;
      try {
        await this.api('PUT', '/me/player/pause', { dotaz: { device_id: this.zarizeni?.id } });
      } catch {
        /* už nehraje nebo aplikace neběží */
      }
      this.hraje = null;
      this.oznam();
      return;
    }
    if (cil === this.hraje) return;
    if (!this.prihlaseno) return;
    if (!this.zarizeni) await this.overit();
    if (!this.zarizeni) return;
    // Hrála jiná hudba ze Spotify: stránka ji právě ztlumuje. Přepnout až potichu.
    if (this.hraje) {
      this.hraje = null;
      this.oznam();
      await this.cekat(this.prolnutiMs());
      if (this.cil !== cil) return;
    }
    const device_id = this.zarizeni.id;
    try {
      await this.api('PUT', '/me/player/play', { dotaz: { device_id }, telo: { context_uri: cil } });
      // Náhodné pořadí a hned další skladba: jinak by playlist začínal pořád stejnou písničkou.
      // Stránka má hudbu ještě ztlumenou, přeskočení není slyšet.
      await this.api('PUT', '/me/player/shuffle', { dotaz: { device_id, state: true } }).catch(() => {});
      await this.api('POST', '/me/player/next', { dotaz: { device_id } }).catch(() => {});
      if (this.hlasitostNastavena !== device_id) {
        // Hlasitost řídí Hub (posuvník Hudba); Spotify hraje naplno, ať je v kabelu dost signálu.
        await this.api('PUT', '/me/player/volume', { dotaz: { device_id, volume_percent: 100 } }).catch(() => {});
        this.hlasitostNastavena = device_id;
      }
      // I když mezitím Hub chce něco jiného, hraje teď tohle: další krok ve frontě to přepne nebo pozastaví.
      this.hraje = cil;
      this.selhalo = null;
      this.chyba = null;
    } catch (e) {
      this.hraje = null;
      this.selhalo = cil;
      this.selhaloKdy = this.hodiny();
      if (e.kod === 'zarizeni') this.zarizeni = null;
      this.chyba = e.message;
    }
    this.oznam();
  }
}
