// Světla scény (Blok 4, rozhodnutí 55–64): role hlavni / pozadi / lampa, skládání po vrstvách
// (místo + doba → počasí → intenzita → režim → pojistky), blesky při bouřce, Zachytit světla.
//
// Data kampaně (repo): světla místa v hlavičce místa (`svetla.den`, `svetla.noc`), vrstvy počasí
// a režimu v kampan/sceny/pocasi/<efekt>.yaml a kampan/sceny/rezim/<rezim>.yaml.
// Nastavení tohoto PC: zařízení a role v hub/.env, přepínač Řídit světla a výchozí stav
// v hub/.stav/svetla.json (mimo Git).
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import YAML from 'yaml';
import { zapsatAtomicky } from './zapis.js';
import { Hue } from './zarizeni/hue.js';
import { Wiz, WIZ_SCENY } from './zarizeni/wiz.js';
import { omezSytost, posunTeploty } from './zarizeni/barvy.js';
import { ZARIZENI_SVETLA as ZARIZENI } from './nastaveni.js';

export const ROLE = Object.freeze(['hlavni', 'pozadi', 'lampa']);
/** Pojistky hlavního světla (rozhodnutí 64): deníky musí jít číst. */
export const PODLAHA_JASU = 15;
export const STROP_SYTOSTI = 0.45;
/** Blesky nejvýš 3 záblesky za sekundu (hranice fotosenzitivity). */
export const MAX_ZABLESKU_ZA_S = 3;
/** Útlum při intenzitě 0–3 (stejně jako ztmavení obrazu). */
const UTLUM = [1, 0.85, 0.7, 0.55];
/** Průměrný odstup blesků v sekundách podle intenzity. */
const ODSTUP_BLESKU_S = [28, 20, 13, 8];
/** Kdo bliká a za jak dlouho přijde hrom (Blok 5) podle vzdálenosti bouřky. */
export const BLESKY = Object.freeze({
  daleko: { role: ['pozadi'], jas: 45, hrom: [4000, 8000] },
  blizko: { role: ['pozadi', 'hlavni'], jas: 85, hrom: [1000, 3000] },
  'nad-nami': { role: ['pozadi', 'hlavni', 'lampa'], jas: 100, hrom: [0, 1000], posunMs: 60 },
});

export const VYCHOZI_SVETLA = Object.freeze({
  hlavni: { barva: [255, 214, 170], jas: 70 },
  pozadi: { vypnuto: true },
  lampa: { barva: [255, 190, 120], jas: 50 },
});

const chyba = (zprava, status = 400) => Object.assign(new Error(zprava), { status });

/** Seznam zařízení role z hub/.env („hue:<id>,wiz:192.168.1.40“). */
export function rozebratZarizeni(text) {
  return String(text ?? '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => ZARIZENI.test(s));
}

/** Hodnota role z dat (hlavička místa, vrstva) v jednotném tvaru, nebo null. */
export function normalizujRoli(v) {
  if (!v || typeof v !== 'object') return null;
  if (v.vypnuto === true) return { zap: false, jas: 0 };
  const barva = Array.isArray(v.barva) && v.barva.length === 3 && v.barva.every((c) => Number.isFinite(c))
    ? v.barva.map((c) => Math.max(0, Math.min(255, Math.round(c))))
    : null;
  const scena = typeof v.wiz_scena === 'string' && WIZ_SCENY[v.wiz_scena] ? v.wiz_scena : null;
  const jas = Number.isFinite(v.jas) ? Math.max(0, Math.min(100, v.jas)) : 60;
  return { zap: jas > 0, jas, rgb: barva ?? [255, 214, 170], ...(scena ? { scena, rychlost: Number.isFinite(v.rychlost) ? v.rychlost : 100 } : {}) };
}

/** Úprava vrstvy (počasí, režim) na stav role: násobek jasu a posun teploty. */
function upravit(cil, uprava) {
  if (!uprava || !cil.zap) return cil;
  let { jas, rgb } = cil;
  if (Number.isFinite(uprava.jas_nasobek)) jas = jas * uprava.jas_nasobek;
  if (Number.isFinite(uprava.teplota_posun)) rgb = posunTeploty(rgb, uprava.teplota_posun);
  return { ...cil, jas, rgb };
}

/** Je hodnota úprava (násobek, posun), nebo celý nový stav role? */
const jeUprava = (v) => v && typeof v === 'object' && ('jas_nasobek' in v || 'teplota_posun' in v) && !('barva' in v) && !('vypnuto' in v) && !('wiz_scena' in v);

/**
 * Skládání světel po vrstvách (rozhodnutí 57). Čistá funkce, testuje se bez zařízení.
 * @param {object} p
 * @param {object|null} p.misto místo s polem `svetla` (z hlavičky)
 * @param {{varianta:string, pocasi:string[], intenzita:number, rezim:string}} p.scena
 * @param {{pocasi: object, rezim: object}} p.vrstvy
 * @param {object} p.vychozi výchozí stav rolí
 * @returns {{hlavni: object, pozadi: object, lampa: object}}
 */
export function slozitSvetla({ misto, scena, vrstvy, vychozi }) {
  const vysledek = {};
  const svetlaMista = misto?.svetla ?? null;
  for (const role of ROLE) {
    // 1. Místo pro denní dobu; chybí-li noc, den s polovičním jasem; jinak výchozí stav.
    let cil = normalizujRoli(svetlaMista?.[scena.varianta]?.[role]);
    if (!cil && scena.varianta === 'noc' && svetlaMista?.den?.[role]) {
      cil = normalizujRoli(svetlaMista.den[role]);
      if (cil) cil.jas *= 0.5;
    }
    cil ??= normalizujRoli(vychozi?.[role]) ?? normalizujRoli(VYCHOZI_SVETLA[role]);
    // 2. Počasí: úpravy se násobí.
    for (const efekt of scena.pocasi ?? []) {
      const v = vrstvy.pocasi?.[efekt]?.svetla;
      if (!v) continue;
      cil = upravit(cil, v.vsechny);
      cil = jeUprava(v[role]) ? upravit(cil, v[role]) : normalizujRoli(v[role]) ?? cil;
    }
    // 3. Intenzita.
    if (cil.zap) cil = { ...cil, jas: cil.jas * (UTLUM[scena.intenzita] ?? 1) };
    // 4. Režim (souboj) přepíše role, které definuje.
    const r = scena.rezim && scena.rezim !== 'pruzkum' ? vrstvy.rezim?.[scena.rezim]?.svetla : null;
    if (r) {
      cil = jeUprava(r[role]) ? upravit(cil, r[role]) : normalizujRoli(r[role]) ?? cil;
      cil = upravit(cil, r.vsechny);
    }
    vysledek[role] = cil;
  }
  return pojistky(vysledek);
}

/** 5. Pojistky hlavního světla (rozhodnutí 64): platí pro scénu i pro Světla normál. */
export function pojistky(cile) {
  const vysledek = { ...cile };
  const h = vysledek.hlavni ?? normalizujRoli(VYCHOZI_SVETLA.hlavni);
  vysledek.hlavni = { ...h, zap: true, jas: Math.max(PODLAHA_JASU, h.zap ? h.jas : 0), rgb: omezSytost(h.rgb ?? [255, 214, 170], STROP_SYTOSTI) };
  delete vysledek.hlavni.scena;
  for (const role of ROLE) if (vysledek[role]) vysledek[role] = { ...vysledek[role], jas: Math.round(vysledek[role].jas) };
  return vysledek;
}

/** Stav role pro uložení do dat (Zachytit světla). */
export function roleDoDat(stav) {
  if (!stav.zap) return { vypnuto: true };
  if (stav.scena) return { wiz_scena: stav.scena, rychlost: stav.rychlost ?? 100, jas: Math.round(stav.jas) };
  return { barva: stav.rgb, jas: Math.round(stav.jas) };
}

/**
 * Události: 'stav' (veřejný stav pro panel), 'blesk' ({vzdalenost, hromZaMs}) pro výstup a zvuk.
 */
export class Svetla extends EventEmitter {
  /**
   * @param {object} volby
   * @param {() => Record<string,string>} volby.nastaveni hodnoty z hub/.env
   * @param {(id: string) => object|null} volby.misto místo podle id
   * @param {() => object} volby.scena aktuální stav scény (varianta, pocasi, intenzita, rezim, bourka, misto)
   * @param {{hue?: Function, wiz?: Function}} [volby.ovladace] náhrada ovladačů (testy)
   */
  constructor({ cesty, nastaveni, misto, scena, ovladace = {}, nahodne = Math.random, opakovaniMs = 10000 }) {
    super();
    this.c = cesty;
    this.nastaveni = nastaveni;
    this.misto = misto;
    this.scena = scena;
    this.vytvorHue = ovladace.hue ?? ((v) => new Hue(v));
    this.vytvorWiz = ovladace.wiz ?? ((v) => new Wiz(v));
    this.nahodne = nahodne;
    this.opakovaniMs = opakovaniMs;
    this.soubor = path.join(cesty.lokalniStav, 'svetla.json');
    this.mistni = { ridit: false, vychozi: { ...VYCHOZI_SVETLA } };
    this.vrstvy = { pocasi: {}, rezim: {} };
    this.chybyVrstev = [];
    this.zarizeni = new Map(); // klic → { klic, role, typ, ovladac, id, ok, chyba, posledni }
    this.zablesky = [];
    this.casovacBlesku = null;
    this.casovacOpakovani = null;
    this.fronta = Promise.resolve();
  }

  async nacist() {
    try {
      const d = JSON.parse(await fs.readFile(this.soubor, 'utf8'));
      this.mistni = { ridit: d.ridit === true, vychozi: { ...VYCHOZI_SVETLA, ...(d.vychozi ?? {}) } };
    } catch {
      /* první spuštění: výchozí hodnoty */
    }
    await this.nacistVrstvy();
    this.sestavitZarizeni();
    this.casovacOpakovani = setInterval(() => this.opakovat(), this.opakovaniMs);
    this.casovacOpakovani.unref?.();
  }

  async ulozitMistni() {
    await fs.mkdir(path.dirname(this.soubor), { recursive: true });
    await zapsatAtomicky(this.soubor, JSON.stringify(this.mistni, null, 2));
  }

  async nacistVrstvy() {
    const vrstvy = { pocasi: {}, rezim: {} };
    const chyby = [];
    for (const druh of ['pocasi', 'rezim']) {
      const slozka = path.join(this.c.kampan, 'sceny', druh);
      let soubory = [];
      try {
        soubory = (await fs.readdir(slozka)).filter((s) => s.endsWith('.yaml'));
      } catch {
        continue;
      }
      for (const s of soubory) {
        try {
          vrstvy[druh][s.replace(/\.yaml$/, '')] = YAML.parse(await fs.readFile(path.join(slozka, s), 'utf8')) ?? {};
        } catch (e) {
          chyby.push({ soubor: `kampan/sceny/${druh}/${s}`, chyba: e.message.split('\n')[0] });
        }
      }
    }
    this.vrstvy = vrstvy;
    this.chybyVrstev = chyby;
  }

  /** Zařízení podle hub/.env; volá se při startu a po uložení Nastavení. */
  sestavitZarizeni() {
    const n = this.nastaveni();
    const stare = this.zarizeni;
    this.zarizeni = new Map();
    const hue = n.HUE_BRIDGE && n.HUE_KLIC ? this.vytvorHue({ bridge: n.HUE_BRIDGE, klic: n.HUE_KLIC, otisk: n.HUE_OTISK || null }) : null;
    for (const role of ROLE) {
      for (const klic of rozebratZarizeni(n[`SVETLA_${role.toUpperCase()}`])) {
        const [typ, id] = [klic.slice(0, 3).toLowerCase(), klic.slice(4)];
        const ovladac = typ === 'hue' ? hue : this.vytvorWiz({ adresa: id });
        this.zarizeni.set(klic, {
          klic, role, typ, id, ovladac,
          ok: ovladac ? stare.get(klic)?.ok ?? null : false,
          chyba: ovladac ? stare.get(klic)?.chyba ?? null : 'Hue bridge není spárovaný.',
          posledni: null,
        });
      }
    }
    this.oznam();
  }

  get bleskyZapnute() {
    return this.nastaveni().BLESKY !== '0';
  }

  verejny() {
    const n = this.nastaveni();
    return {
      ridit: this.mistni.ridit,
      blesky: this.bleskyZapnute,
      nastaveno: this.zarizeni.size > 0,
      hue: { bridge: n.HUE_BRIDGE || '', sparovano: Boolean(n.HUE_KLIC) },
      zarizeni: [...this.zarizeni.values()].map(({ klic, role, typ, id, ok, chyba: c }) => ({ klic, role, typ, id, ok, chyba: c })),
      cil: this.cil(),
      vychozi: this.mistni.vychozi,
      chybyVrstev: this.chybyVrstev,
    };
  }

  oznam() {
    this.emit('stav', this.verejny());
  }

  cil() {
    const s = this.scena();
    return slozitSvetla({ misto: s.misto ? this.misto(s.misto) : null, scena: s, vrstvy: this.vrstvy, vychozi: this.mistni.vychozi });
  }

  /** Pošle jen změněné stavy; příkazy na světla jdou za sebou. */
  aplikovat({ cile = this.cil(), vynutit = false, prechodMs = 800 } = {}) {
    const ukol = this.fronta.catch(() => {}).then(async () => {
      if (!this.mistni.ridit && !vynutit) return;
      await Promise.all(
        [...this.zarizeni.values()].map(async (z) => {
          const cil = cile[z.role];
          const json = JSON.stringify(cil);
          if (!vynutit && z.posledni === json && z.ok) return;
          await this.poslat(z, cil, prechodMs);
          if (z.ok) z.posledni = json;
        }),
      );
      this.oznam();
    });
    this.fronta = ukol.catch(() => {});
    return ukol;
  }

  async poslat(z, cil, prechodMs) {
    if (!z.ovladac) return;
    try {
      if (z.typ === 'hue') await z.ovladac.nastavit(z.id, cil, prechodMs);
      else await z.ovladac.nastavit(cil);
      z.ok = true;
      z.chyba = null;
    } catch (e) {
      z.ok = false;
      z.chyba = e.message;
      z.posledni = null;
    }
  }

  /** Zařízení, které neodpovídalo, dostane po návratu aktuální stav (do 10 s). */
  async opakovat() {
    const vypadek = [...this.zarizeni.values()].some((z) => z.ok === false && z.ovladac);
    if (!vypadek) return;
    // S vypnutým Řídit světla se na světla nesahá, jen se zjistí, jestli už odpovídají (kontrolka).
    if (this.mistni.ridit) await this.aplikovat();
    else await this.overit();
  }

  /** Dotaz na stav každého zařízení bez změny světla: kontrolka a Sezení → Před hrou. */
  async overit() {
    await Promise.all(
      [...this.zarizeni.values()].map(async (z) => {
        if (!z.ovladac) return;
        try {
          if (z.typ === 'hue') await z.ovladac.stav(z.id);
          else await z.ovladac.stav();
          z.ok = true;
          z.chyba = null;
        } catch (e) {
          z.ok = false;
          z.chyba = e.message;
          z.posledni = null;
        }
      }),
    );
    this.oznam();
    return this.verejny();
  }

  /** Změna scény, místa nebo vrstev: světla a plán blesků. */
  zmenaSceny() {
    // Střídání ilustrací mění scénu každých pár sekund: plán blesků se přepočítá jen při změně bouřky.
    const s = this.scena();
    const klic = JSON.stringify([s.pocasi?.includes('bourka'), s.intenzita, this.bleskyZapnute]);
    if (klic !== this.klicBlesku) {
      this.klicBlesku = klic;
      this.naplanovatBlesky();
    }
    if (this.mistni.ridit) this.aplikovat().catch(() => {});
    else this.oznam();
  }

  async nastavitRidit(ridit) {
    this.mistni.ridit = Boolean(ridit);
    await this.ulozitMistni();
    if (this.mistni.ridit) await this.aplikovat({ vynutit: true });
    else await this.normal(); // vypnutí vrátí výchozí stav a Hub pak světla nechá být (rozhodnutí 59)
    this.naplanovatBlesky();
    this.oznam();
    return this.verejny();
  }

  /** Světla normál: výchozí stav na všech zařízeních, bez ohledu na scénu. */
  async normal() {
    const cile = pojistky(Object.fromEntries(ROLE.map((r) => [r, normalizujRoli(this.mistni.vychozi[r]) ?? normalizujRoli(VYCHOZI_SVETLA[r])])));
    await this.aplikovat({ cile, vynutit: true, prechodMs: 1000 });
    for (const z of this.zarizeni.values()) z.posledni = null; // další scéna se pošle celá
    return this.verejny();
  }

  /** Aktuální stav rolí ze zařízení (první zařízení role). */
  async precistZarizeni() {
    const role = {};
    for (const r of ROLE) {
      const z = [...this.zarizeni.values()].find((x) => x.role === r && x.ovladac);
      if (!z) continue;
      try {
        role[r] = roleDoDat(z.typ === 'hue' ? await z.ovladac.stav(z.id) : await z.ovladac.stav());
      } catch (e) {
        throw chyba(`Světlo role ${r} neodpovídá: ${e.message}`, 503);
      }
    }
    if (!Object.keys(role).length) throw chyba('Žádné světlo není přiřazené k roli. Nastav je v Nastavení → Světla.', 409);
    return role;
  }

  async zachytitVychozi() {
    this.mistni.vychozi = { ...this.mistni.vychozi, ...(await this.precistZarizeni()) };
    await this.ulozitMistni();
    this.oznam();
    return this.verejny();
  }

  /** Test role: dvakrát bliknout, pak vrátit stav. */
  async testRole(role) {
    if (!ROLE.includes(role)) throw chyba('Neznámá role.');
    const zarizeni = [...this.zarizeni.values()].filter((z) => z.role === role);
    if (!zarizeni.length) throw chyba('K roli není přiřazené žádné světlo.', 409);
    const zpet = this.mistni.ridit ? this.cil()[role] : pojistky({ [role]: normalizujRoli(this.mistni.vychozi[role]) ?? normalizujRoli(VYCHOZI_SVETLA[role]) })[role];
    for (let i = 0; i < 2; i++) {
      await Promise.all(zarizeni.map((z) => this.poslat(z, { zap: true, jas: 100, rgb: [120, 255, 140] }, 0)));
      await new Promise((r) => setTimeout(r, 450));
      await Promise.all(zarizeni.map((z) => this.poslat(z, zpet, 0)));
      await new Promise((r) => setTimeout(r, 350));
    }
    for (const z of zarizeni) z.posledni = null;
    this.oznam();
    return { ok: zarizeni.every((z) => z.ok), zarizeni: zarizeni.map((z) => ({ klic: z.klic, ok: z.ok, chyba: z.chyba })) };
  }

  /* ---------- Blesky (rozhodnutí 61 a 64) ---------- */

  naplanovatBlesky() {
    clearTimeout(this.casovacBlesku);
    this.casovacBlesku = null;
    const s = this.scena();
    if (!s.pocasi?.includes('bourka') || !this.bleskyZapnute) return;
    const prumer = (ODSTUP_BLESKU_S[s.intenzita] ?? 20) * 1000;
    const za = prumer * (0.5 + this.nahodne()); // 0,5–1,5násobek průměru
    this.casovacBlesku = setTimeout(() => {
      this.blesk().catch(() => {});
      this.naplanovatBlesky();
    }, za);
    this.casovacBlesku.unref?.();
  }

  /** Smí teď bliknout? Nejvýš MAX_ZABLESKU_ZA_S za poslední sekundu. */
  smiZablesknout(ted = Date.now()) {
    this.zablesky = this.zablesky.filter((t) => ted - t < 1000);
    if (this.zablesky.length >= MAX_ZABLESKU_ZA_S) return false;
    this.zablesky.push(ted);
    return true;
  }

  /**
   * Jeden blesk podle vzdálenosti bouřky: obraz v OBS (událost), světla rolí (jen s Řídit světla).
   * @returns {{blesk: boolean, duvod?: string}}
   */
  async blesk({ vzdalenost } = {}) {
    if (!this.bleskyZapnute) return { blesk: false, duvod: 'Blesky jsou v Nastavení vypnuté.' };
    const s = this.scena();
    const v = BLESKY[vzdalenost ?? s.bourka] ?? BLESKY.blizko;
    if (!this.smiZablesknout()) return { blesk: false, duvod: 'Limit 3 záblesky za sekundu.' };
    const [od, do_] = v.hrom;
    this.emit('blesk', { vzdalenost: vzdalenost ?? s.bourka ?? 'blizko', jas: v.jas, hromZaMs: Math.round(od + this.nahodne() * (do_ - od)) });
    if (!this.mistni.ridit) return { blesk: true };
    const cile = this.cil();
    const posun = v.posunMs ?? 0;
    await Promise.all(
      v.role.map(async (role, i) => {
        await new Promise((r) => setTimeout(r, i * posun));
        const zarizeni = [...this.zarizeni.values()].filter((z) => z.role === role && z.ovladac);
        await Promise.all(zarizeni.map((z) => this.poslat(z, { zap: true, jas: v.jas, rgb: [235, 240, 255] }, 0)));
        await new Promise((r) => setTimeout(r, 90));
        await Promise.all(zarizeni.map((z) => this.poslat(z, cile[role], 120)));
      }),
    );
    return { blesk: true };
  }

  /** Zachytit světla do místa: hodnoty rolí pro uložení do hlavičky (zápis dělá Mista). */
  async zachytitProMisto() {
    return this.precistZarizeni();
  }

  zastavit() {
    clearTimeout(this.casovacBlesku);
    clearInterval(this.casovacOpakovani);
  }
}
