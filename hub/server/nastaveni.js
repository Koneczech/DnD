// Konfigurace v hub/.env (rozhodnutí 13). Soubor je mimo Git a ručně se needituje;
// vyplňuje se v panelu na obrazovce Nastavení.
import fs from 'node:fs/promises';
import path from 'node:path';
import { zapsatAtomicky } from './zapis.js';

export const VYCHOZI = Object.freeze({
  HUB_PORT: '7420',
  OBS_URL: 'ws://127.0.0.1:4455',
  OBS_HESLO: '',
  OBS_SCENA_START: '',
  OBS_SCENA_SOUBOJ: '',
  OBS_SCENA_PO_ODPOCTU: '',
  OBS_SCENA_OBCHOD: '',
  OBS_SCENA_MISTO: '',
  DOMACI_SIT: '0',
  PIN: '',
  HUE_BRIDGE: '',
  HUE_KLIC: '',
  HUE_OTISK: '',
  SVETLA_HLAVNI: '',
  SVETLA_POZADI: '',
  SVETLA_LAMPA: '',
  BLESKY: '1',
  ZVUK_SLOZKA: '',
  ZVUK_OTEVRIT: '1',
});

/** Klíče, jejichž hodnoty jsou tajné: nikdy neopustí server a hook je hlídá v commitech. */
export const TAJNE_KLICE = Object.freeze(['OBS_HESLO', 'PIN', 'OPENAI_API_KEY', 'HUE_KLIC']);

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
/** Zařízení role: hue:<id světla na bridgi> nebo wiz:<IP lampy>. */
export const ZARIZENI_SVETLA = /^(hue:[0-9a-f-]{8,64}|wiz:(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3})$/;

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
      scenaStart: this.hodnoty.OBS_SCENA_START || '',
      scenaSouboj: this.hodnoty.OBS_SCENA_SOUBOJ || '',
      scenaPoOdpoctu: this.hodnoty.OBS_SCENA_PO_ODPOCTU || '',
      scenaObchod: this.hodnoty.OBS_SCENA_OBCHOD || '',
      scenaMisto: this.hodnoty.OBS_SCENA_MISTO || '',
      domaciSit: this.hodnoty.DOMACI_SIT === '1',
      pinNastaven: Boolean(this.hodnoty.PIN),
      // Světla (Blok 4): klíč Hue nikdy, jen jestli je bridge spárovaný.
      hueBridge: this.hodnoty.HUE_BRIDGE || '',
      hueSparovano: Boolean(this.hodnoty.HUE_KLIC),
      svetlaHlavni: this.hodnoty.SVETLA_HLAVNI || '',
      svetlaPozadi: this.hodnoty.SVETLA_POZADI || '',
      svetlaLampa: this.hodnoty.SVETLA_LAMPA || '',
      blesky: this.hodnoty.BLESKY !== '0',
      // Zvuk (Blok 5): složka mimo repo, prázdná = Dokumenty\DnD\audio.
      zvukSlozka: this.hodnoty.ZVUK_SLOZKA || '',
      zvukOtevrit: this.hodnoty.ZVUK_OTEVRIT !== '0',
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
    for (const [pole, klic] of [['scenaStart', 'OBS_SCENA_START'], ['scenaSouboj', 'OBS_SCENA_SOUBOJ'], ['scenaPoOdpoctu', 'OBS_SCENA_PO_ODPOCTU'], ['scenaObchod', 'OBS_SCENA_OBCHOD'], ['scenaMisto', 'OBS_SCENA_MISTO']]) {
      if (z[pole] === undefined) continue;
      const scena = String(z[pole]).trim();
      if (scena.length > 200) throw Object.assign(new Error('Název scény je příliš dlouhý'), { status: 400 });
      nove[klic] = scena;
    }
    if (z.port !== undefined) {
      const p = Number(z.port);
      if (!Number.isInteger(p) || p < 1024 || p > 65535) throw Object.assign(new Error('Port musí být číslo 1024–65535'), { status: 400 });
      nove.HUB_PORT = String(p);
    }
    if (z.pin) {
      // Nový PIN aspoň 6 číslic: 4 číslice jdou v domácí síti uhodnout i s omezením pokusů (audit S5).
      if (!/^\d{6,8}$/.test(String(z.pin))) throw Object.assign(new Error('PIN musí mít 6–8 číslic'), { status: 400 });
      nove.PIN = String(z.pin);
    }
    if (z.domaciSit !== undefined) {
      if (z.domaciSit && !nove.PIN) throw Object.assign(new Error('Přístup z domácí sítě vyžaduje PIN'), { status: 400 });
      nove.DOMACI_SIT = z.domaciSit ? '1' : '0';
    }
    if (z.hueBridge !== undefined) {
      const b = String(z.hueBridge).trim();
      if (b && !IPV4.test(b)) throw Object.assign(new Error('Adresa Hue bridge je IP v domácí síti, např. 192.168.1.20'), { status: 400 });
      if (b !== nove.HUE_BRIDGE) {
        // Jiný bridge = jiný klíč i certifikát: spárovat znovu.
        nove.HUE_KLIC = '';
        nove.HUE_OTISK = '';
      }
      nove.HUE_BRIDGE = b;
    }
    if (z.hueSparovani) {
      // Jen ze serveru po úspěšném spárování (panel klíč nikdy nepošle ani nedostane).
      nove.HUE_KLIC = String(z.hueSparovani.klic);
      nove.HUE_OTISK = String(z.hueSparovani.otisk ?? '');
    }
    for (const [pole, klic] of [['svetlaHlavni', 'SVETLA_HLAVNI'], ['svetlaPozadi', 'SVETLA_POZADI'], ['svetlaLampa', 'SVETLA_LAMPA']]) {
      if (z[pole] === undefined) continue;
      const seznam = String(z[pole]).split(/[,\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
      const spatne = seznam.find((x) => !ZARIZENI_SVETLA.test(x));
      if (spatne) throw Object.assign(new Error(`Neznámé zařízení „${spatne.slice(0, 60)}“. Piš hue:<id světla> nebo wiz:<IP lampy>.`), { status: 400 });
      if (seznam.length > 8) throw Object.assign(new Error('Role má nejvýš 8 světel.'), { status: 400 });
      nove[klic] = seznam.join(',');
    }
    if (z.blesky !== undefined) nove.BLESKY = z.blesky ? '1' : '0';
    if (z.zvukSlozka !== undefined) {
      const s = String(z.zvukSlozka).trim().replace(/^"(.*)"$/, '$1');
      if (s && (!path.isAbsolute(s) || s.length > 400 || /[\0\r\n]/.test(s))) {
        throw Object.assign(new Error('Složka zvuku musí být celá cesta, např. C:\\Users\\Matej\\Documents\\DnD\\audio'), { status: 400 });
      }
      nove.ZVUK_SLOZKA = s;
    }
    if (z.zvukOtevrit !== undefined) nove.ZVUK_OTEVRIT = z.zvukOtevrit ? '1' : '0';
    await zapsatAtomicky(this.cesta, slozitEnv(nove));
    this.hodnoty = nove;
    this.existuje = true;
  }
}
