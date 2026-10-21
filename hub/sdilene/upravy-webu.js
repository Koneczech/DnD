// Úpravy kánonu z čtecí verze na GitHub Pages (⚠ bod 146). Server tu není, takže soubor karty
// se načte z GitHubu, upraví se stejnými funkcemi jako v Hubu (karta-kanonu.js, hlavicka.js)
// a uloží se zpátky jako commit do main přes GitHub API s osobním tokenem DM.
//
// Umí jen to, co se týká textu jedné karty: editor (text a pole hlavičky), přezdívky, Ve hře,
// Družina zná a odrážky Co ví družina. Ostatní (nová karta, vazby, portrét …) zůstává Hubu.
import { nacistEntitu, vPohledu, textKarty, zmenyKarty, overitPole, prepnoutBlok, pridatBlok } from './karta-kanonu.js';
import { teloKarty, nahraditTelo, upravitKartu } from './hlavicka.js';

const chyba = (zprava, status = 400, navic = {}) => Object.assign(new Error(zprava), { status, ...navic });

/** UTF-8 text ↔ base64, jak ho chce GitHub API (bez Bufferu, běží i v prohlížeči). */
export function doBase64(text) {
  const bajty = new TextEncoder().encode(text);
  let binarni = '';
  for (let i = 0; i < bajty.length; i += 0x8000) binarni += String.fromCharCode(...bajty.subarray(i, i + 0x8000));
  return btoa(binarni);
}
export function zBase64(data) {
  return new TextDecoder().decode(Uint8Array.from(atob(String(data).replace(/\s/g, '')), (z) => z.charCodeAt(0)));
}

/** Cesta v repu pro adresu API: každý díl zvlášť (diakritika, mezery). */
const cestaApi = (cesta) => cesta.split('/').map(encodeURIComponent).join('/');

/**
 * Soubory repa přes GitHub REST API (contents). Pamatuje si, co sám zapsal: GitHub chvíli po
 * zápisu může vrátit ještě starou verzi a ta by se tvářila jako cizí změna.
 */
export class GitHubSoubory {
  /**
   * @param {{repo: string, vetev?: string, token: () => string, fetch?: typeof fetch}} volby
   */
  constructor({ repo, vetev = 'main', token, fetch: f = globalThis.fetch.bind(globalThis) }) {
    this.repo = repo;
    this.vetev = vetev;
    this.token = token;
    this.fetch = f;
    this.zapsane = new Map(); // cesta → { text, sha, predchozi }
  }

  async pozadavek(metoda, cesta, telo) {
    const token = this.token();
    if (!token) throw chyba('Chybí token GitHubu.', 401, { kod: 'token' });
    let odpoved;
    try {
      odpoved = await this.fetch(`https://api.github.com/repos/${this.repo}/contents/${cestaApi(cesta)}${metoda === 'GET' ? `?ref=${encodeURIComponent(this.vetev)}` : ''}`, {
        method: metoda,
        cache: 'no-store',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(telo ? { 'Content-Type': 'application/json' } : {}),
        },
        body: telo ? JSON.stringify(telo) : undefined,
      });
    } catch {
      throw chyba('GitHub není dostupný (internet nebo síť v práci).', 503);
    }
    const data = await odpoved.json().catch(() => ({}));
    if (odpoved.ok) return data;
    if (odpoved.status === 401) throw chyba('Token GitHubu neplatí (vypršel nebo byl zrušen). Zadej nový.', 401, { kod: 'token' });
    if (odpoved.status === 409 || (odpoved.status === 422 && /sha/i.test(data.message ?? ''))) {
      throw chyba('Karta se mezitím změnila jinde.', 409, { kod: 'konflikt-github' });
    }
    if (odpoved.status === 403 || odpoved.status === 404) {
      if (/rate limit/i.test(data.message ?? '')) throw chyba('GitHub teď odmítá další požadavky (limit). Zkus to za pár minut.', 429);
      throw chyba(metoda === 'GET'
        ? 'Soubor karty na GitHubu není, nebo k němu token nemá přístup.'
        : 'Token nemá právo zapisovat do repa (potřebuje Contents: Read and write pro repo DnD).', 403, { kod: 'token' });
    }
    throw chyba(`GitHub vrátil ${odpoved.status}: ${data.message ?? 'neznámá chyba'}`, 502);
  }

  /** @returns {Promise<{text: string, sha: string}>} */
  async cist(cesta) {
    const data = await this.pozadavek('GET', cesta);
    const moje = this.zapsane.get(cesta);
    if (moje && data.sha === moje.predchozi) return { text: moje.text, sha: moje.sha };
    return { text: zBase64(data.content ?? ''), sha: data.sha };
  }

  /** @returns {Promise<{sha: string}>} */
  async zapsat(cesta, text, sha, zprava) {
    const data = await this.pozadavek('PUT', cesta, { message: zprava, content: doBase64(text), sha, branch: this.vetev });
    const nova = data.content?.sha;
    this.zapsane.set(cesta, { text, sha: nova, predchozi: sha });
    return { sha: nova };
  }
}

/** Údaje o souboru karty ze seznamu: kampan/<složka>/<id>/<id>.md nebo kampan/<složka>/<soubor>.md. */
function umisteni(e) {
  const casti = String(e?.soubor ?? '').split('/');
  if (casti[0] !== 'kampan' || casti.length < 3 || !casti.at(-1).endsWith('.md')) throw chyba('Karta nemá soubor v kampan/.', 404);
  return { soubor: e.soubor, slozka: casti[1], slozkaEntity: casti.length === 4 };
}

/** Pole, která čtecí verze přepisuje na adresy webu nebo repa: zůstávají z posledního sestavení. */
const OBRAZKOVA = ['obrazek', 'portret', 'obrazky'];
const bezObrazku = (x) => Object.fromEntries(Object.entries(x).filter(([k]) => !OBRAZKOVA.includes(k)));

/**
 * Náhrada zapisujících adres API Hubu pro modul Kánon.
 * @param {{soubory: GitHubSoubory, balik: () => {seznam: object, karty: object}, poZmene?: () => void}} volby
 * @returns {(cesta: string, volby: {metoda?: string, telo?: object}) => Promise<object|undefined>} undefined = adresa sem nepatří
 */
export function vytvoritUpravyWebu({ soubory, balik, poZmene = () => {} }) {
  const entita = (id) => {
    const e = balik().seznam.entity.find((x) => x.id === id);
    if (!e) throw chyba('Karta v kánonu není.', 404);
    return e;
  };
  const najit = (id) => balik().seznam.entity.find((x) => x.id === id);

  /** Po zápisu: seznam a karta z nového textu, dokud web nesestaví novou verzi. */
  function obnovit(id, text) {
    const b = balik();
    const kde = umisteni(entita(id));
    const e = nacistEntitu(text, kde);
    const pohled = bezObrazku(vPohledu(e, 'dm', najit));
    const i = b.seznam.entity.findIndex((x) => x.id === id);
    b.seznam.entity[i] = { ...b.seznam.entity[i], ...pohled, upraveno: new Date().toISOString() };
    const existuje = (x) => b.seznam.entity.some((y) => y.id === x);
    b.karty[id] = {
      ...b.karty[id], ...pohled, ...textKarty(e, 'dm'), pole: e.pole, odkazyVTextu: e.odkazyVTextu.filter(existuje), obsidian: null,
    };
    b.seznam.verze = `web-${Date.now()}`;
    poZmene();
    return b.karty[id];
  }

  /**
   * Načte soubor, upraví ho a uloží. Když ho mezitím změnil někdo jiný, zkusí to jednou znovu
   * nad novou verzí (úprava se počítá z aktuálního textu, stejně jako v Hubu z disku).
   */
  async function upravitSoubor(id, uprava, zprava) {
    const kde = umisteni(entita(id));
    for (let pokus = 0; ; pokus++) {
      const { text, sha } = await soubory.cist(kde.soubor);
      const novy = uprava(text, nacistEntitu(text, kde));
      if (novy === text) return { vysledek: 'beze-zmeny', karta: obnovit(id, text), sha };
      try {
        const r = await soubory.zapsat(kde.soubor, novy, sha, zprava);
        return { vysledek: 'ulozeno', karta: obnovit(id, novy), sha: r.sha, obsah: novy };
      } catch (e) {
        if (e.kod !== 'konflikt-github' || pokus > 0) throw e;
      }
    }
  }

  const nazev = (id) => najit(id)?.nazev ?? id;

  return async function api(cesta, { metoda = 'GET', telo = {} } = {}) {
    const p = new URL(cesta, 'http://x').pathname;
    let m = /^\/api\/kanon\/entita\/([a-z0-9-]{1,80})\/zdroj$/.exec(p);
    if (m && metoda === 'GET') {
      const e = entita(m[1]);
      const kde = umisteni(e);
      const { text, sha } = await soubory.cist(kde.soubor);
      const aktualni = nacistEntitu(text, kde);
      return { id: e.id, typ: aktualni.typ, telo: teloKarty(text), hash: sha, pole: aktualni.pole, aliases: aktualni.aliases, slozkaEntity: kde.slozkaEntity };
    }
    if (m && metoda === 'PUT') {
      const id = m[1];
      if (telo.telo !== undefined && typeof telo.telo !== 'string') throw chyba('Text karty musí být text.');
      if ((telo.telo ?? '').length > 400000) throw chyba('Text karty je příliš dlouhý.');
      const kde = umisteni(entita(id));
      const { text, sha } = await soubory.cist(kde.soubor);
      // Hash v editoru je sha souboru na GitHubu: jiná verze = někdo kartu mezitím změnil (Hub doma, jiné zařízení).
      if (!telo.prepsat && telo.zaklad && telo.zaklad !== sha) {
        throw chyba('Karta se mezitím změnila jinde (Hub doma, jiné zařízení). Načti její novou podobu, nebo ji přepiš svou.', 409, { kod: 'konflikt', telo: teloKarty(text), hash: sha });
      }
      const aktualni = nacistEntitu(text, kde);
      let novy = telo.telo !== undefined ? nahraditTelo(text, telo.telo) : text;
      if (telo.pole) {
        const z = overitPole(aktualni, telo.pole, najit);
        if (Object.keys(z).length) novy = upravitKartu(novy, z);
      }
      if (novy === text) return { vysledek: 'beze-zmeny', hash: sha, karta: obnovit(id, text), nazev: nazev(id) };
      let r;
      try {
        r = await soubory.zapsat(kde.soubor, novy, sha, `Web: ${nazev(id)} (text karty)`);
      } catch (e) {
        if (e.kod !== 'konflikt-github') throw e;
        const cerstvy = await soubory.cist(kde.soubor);
        throw chyba('Karta se mezitím změnila jinde. Načti její novou podobu, nebo ji přepiš svou.', 409, { kod: 'konflikt', telo: teloKarty(cerstvy.text), hash: cerstvy.sha });
      }
      return { vysledek: 'ulozeno', hash: r.sha, karta: obnovit(id, novy), nazev: nazev(id) };
    }
    m = /^\/api\/kanon\/entita\/([a-z0-9-]{1,80})$/.exec(p);
    if (m && metoda === 'PUT') {
      const id = m[1];
      zmenyKarty(entita(id), telo, najit); // chyba dřív, než se sáhne na GitHub
      const co = 'verejne' in telo ? (telo.verejne ? 'družina zná' : 'jen DM') : 'aktualni' in telo ? (telo.aktualni ? 've hře' : 'mimo hru') : 'aliases' in telo ? 'přezdívky' : 'hlavička';
      const r = await upravitSoubor(id, (text, e) => {
        const z = zmenyKarty(e, telo, najit);
        return z ? upravitKartu(text, z) : text;
      }, `Web: ${nazev(id)} (${co})`);
      return { vysledek: r.vysledek, karta: r.karta };
    }
    m = /^\/api\/kanon\/entita\/([a-z0-9-]{1,80})\/druzina\/(\d{1,4})$/.exec(p);
    if (m && metoda === 'PUT') {
      if (typeof telo.zna !== 'boolean') throw chyba('zna musí být true nebo false.');
      const r = await upravitSoubor(m[1], (text) => nahraditTelo(text, prepnoutBlok(teloKarty(text), Number(m[2]), telo.zna)), `Web: ${nazev(m[1])} (${telo.zna ? 'odkryto' : 'skryto'} v Co ví družina)`);
      return { vysledek: r.vysledek, karta: r.karta };
    }
    m = /^\/api\/kanon\/entita\/([a-z0-9-]{1,80})\/druzina$/.exec(p);
    if (m && metoda === 'POST') {
      const zna = telo.zna ?? true;
      if (typeof zna !== 'boolean') throw chyba('zna musí být true nebo false.');
      const r = await upravitSoubor(m[1], (text) => nahraditTelo(text, pridatBlok(teloKarty(text), telo.text, zna)), `Web: ${nazev(m[1])} (nová odrážka Co ví družina)`);
      return { vysledek: r.vysledek, karta: r.karta };
    }
    return undefined;
  };
}
