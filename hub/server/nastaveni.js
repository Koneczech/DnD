// Konfigurace v hub/.env (rozhodnutí 13). Soubor je mimo Git a ručně se needituje;
// vyplňuje se v panelu na obrazovce Nastavení.
import fs from 'node:fs/promises';
import { zapsatAtomicky } from './zapis.js';

export const VYCHOZI = Object.freeze({
  HUB_PORT: '7420',
  OBS_URL: 'ws://127.0.0.1:4455',
  OBS_HESLO: '',
  OBS_SCENA_SOUBOJ: '',
  DOMACI_SIT: '0',
  PIN: '',
});

/** Klíče, jejichž hodnoty jsou tajné: nikdy neopustí server a hook je hlídá v commitech. */
export const TAJNE_KLICE = Object.freeze(['OBS_HESLO', 'PIN', 'OPENAI_API_KEY']);

export function rozebratEnv(text) {
  const vysledek = {};
  for (const radek of text.split(/\r?\n/)) {
    const m = radek.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let hodnota = m[2];
    if (/^".*"$/.test(hodnota)) hodnota = JSON.parse(hodnota);
    else if (/^'.*'$/.test(hodnota)) hodnota = hodnota.slice(1, -1);
    vysledek[m[1]] = hodnota;
  }
  return vysledek;
}

export function slozitEnv(hodnoty) {
  const radky = [
    '# DM Hub — místní nastavení. NIKDY NECOMMITOVAT (je v .gitignore).',
    '# Upravuj v panelu na obrazovce Nastavení, ne ručně.',
  ];
  for (const [k, v] of Object.entries(hodnoty)) radky.push(`${k}=${JSON.stringify(String(v ?? ''))}`);
  return radky.join('\n') + '\n';
}

export class Nastaveni {
  constructor(cesta) {
    this.cesta = cesta;
    this.hodnoty = { ...VYCHOZI };
    this.existuje = false;
  }

  async nacist() {
    try {
      const text = await fs.readFile(this.cesta, 'utf8');
      this.hodnoty = { ...VYCHOZI, ...rozebratEnv(text) };
      this.existuje = true;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      this.hodnoty = { ...VYCHOZI };
      this.existuje = false;
    }
    return this;
  }

  get port() {
    const p = Number(this.hodnoty.HUB_PORT);
    return Number.isInteger(p) && p > 0 && p < 65536 ? p : Number(VYCHOZI.HUB_PORT);
  }

  get domaciSit() {
    return this.hodnoty.DOMACI_SIT === '1' && Boolean(this.hodnoty.PIN);
  }

  /** Tajné hodnoty, které se nesmí objevit v žádném commitu (pro pre-commit hook). */
  tajneHodnoty() {
    return TAJNE_KLICE.map((k) => this.hodnoty[k]).filter((v) => v && String(v).length >= 4);
  }

  /** Co smí vidět panel: hesla jen jako „nastaveno / nenastaveno“. */
  verejne() {
    return {
      existuje: this.existuje,
      port: this.port,
      obsUrl: this.hodnoty.OBS_URL,
      obsHesloNastaveno: Boolean(this.hodnoty.OBS_HESLO),
      scenaSouboj: this.hodnoty.OBS_SCENA_SOUBOJ || '',
      domaciSit: this.hodnoty.DOMACI_SIT === '1',
      pinNastaven: Boolean(this.hodnoty.PIN),
    };
  }

  /**
   * Změna z panelu. Prázdné heslo = beze změny (panel heslo nikdy nezná).
   * @param {{obsUrl?:string, obsHeslo?:string, port?:number, domaciSit?:boolean, pin?:string}} z
   */
  async ulozit(z) {
    const nove = { ...this.hodnoty };
    if (z.obsUrl !== undefined) {
      if (!/^wss?:\/\/[^\s]+$/.test(z.obsUrl)) throw Object.assign(new Error('Adresa OBS musí začínat ws:// nebo wss://'), { status: 400 });
      nove.OBS_URL = z.obsUrl;
    }
    if (z.obsHeslo) nove.OBS_HESLO = String(z.obsHeslo);
    if (z.smazatObsHeslo) nove.OBS_HESLO = '';
    if (z.scenaSouboj !== undefined) {
      const scena = String(z.scenaSouboj).trim();
      if (scena.length > 200) throw Object.assign(new Error('Název scény je příliš dlouhý'), { status: 400 });
      nove.OBS_SCENA_SOUBOJ = scena;
    }
    if (z.port !== undefined) {
      const p = Number(z.port);
      if (!Number.isInteger(p) || p < 1024 || p > 65535) throw Object.assign(new Error('Port musí být číslo 1024–65535'), { status: 400 });
      nove.HUB_PORT = String(p);
    }
    if (z.pin) {
      if (!/^\d{4,8}$/.test(String(z.pin))) throw Object.assign(new Error('PIN musí mít 4–8 číslic'), { status: 400 });
      nove.PIN = String(z.pin);
    }
    if (z.domaciSit !== undefined) {
      if (z.domaciSit && !nove.PIN) throw Object.assign(new Error('Přístup z domácí sítě vyžaduje PIN'), { status: 400 });
      nove.DOMACI_SIT = z.domaciSit ? '1' : '0';
    }
    await zapsatAtomicky(this.cesta, slozitEnv(nove));
    this.hodnoty = nove;
    this.existuje = true;
  }
}
