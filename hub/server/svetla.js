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
/*
 * Málo HP (bod 72): nastavení v Nastavení → Světla, uložené v hub/.stav/svetla.json.
 * Lampa: režim „barvy“ (fáze A a B mají vlastní barvu, jas a délku) nebo „intenzita“ (barva A,
 * mění se jen jas). Čisté barvy bez bílé, ať lampa nejde do růžova; místo žluté teplá oranžová,
 * žlutá je na WiZ zelenkavá. Pozadí jednou barvou s náběhem.
 */
export const VYCHOZI_HP = Object.freeze({
  rezim: 'barvy',
  prechod_s: 1.5, // jak dlouho se lampa přelévá z jedné fáze do druhé (nejvýš délka fáze)
  a: { rgb: [255, 0, 0], jas: 100, s: 3 },
  b: { rgb: [255, 110, 0], jas: 70, s: 1 },
  pozadi: { rgb: [255, 0, 0], jas: 100, nabeh_s: 3 },
  // Hlavní světlo v herně (bod 82): zčervená se stejným náběhem jako pozadí. Plná barva
  // na přání DM (výjimka ze stropu sytosti, rozhodnutí 64), jas nejméně podlaha jasu kvůli deníkům.
  hlavni: { zap: true, rgb: [255, 0, 0], jas: 60 },
});
/** Nejkratší fáze: 0,5 s = nejvýš 2 změny za sekundu, pod hranicí 3 záblesků (rozhodnutí 64). */
export const HP_NEJKRATSI_S = 0.5;
const ROLE_PRI_HP_ZAKLAD = ['lampa', 'pozadi'];

/** Ověří a doplní nastavení málo HP; chybu ohlásí srozumitelně. */
export function normalizujHp(z, puvodni = VYCHOZI_HP) {
  const v = structuredClone({ ...VYCHOZI_HP, ...puvodni });
  if (!z || typeof z !== 'object') return v;
  const barva = (x, kde) => {
    if (x === undefined) return undefined;
    if (!Array.isArray(x) || x.length !== 3 || x.some((c) => !Number.isInteger(c) || c < 0 || c > 255)) throw chyba(`${kde}: barva je [r, g, b] 0–255.`);
    return x;
  };
  const cislo = (x, od, do_, kde) => {
    if (x === undefined) return undefined;
    const n = Number(x);
    if (!Number.isFinite(n) || n < od || n > do_) throw chyba(`${kde} musí být ${od}–${do_}.`);
    return n;
  };
  if (z.rezim !== undefined) {
    if (!['barvy', 'intenzita'].includes(z.rezim)) throw chyba('Režim lampy je barvy, nebo intenzita.');
    v.rezim = z.rezim;
  }
  v.prechod_s = cislo(z.prechod_s, 0, 30, 'Přechod lampy (s)') ?? v.prechod_s ?? VYCHOZI_HP.prechod_s;
  for (const f of ['a', 'b']) {
    if (!z[f]) continue;
    v[f] = {
      rgb: barva(z[f].rgb, `Lampa ${f.toUpperCase()}`) ?? v[f].rgb,
      jas: cislo(z[f].jas, 1, 100, `Jas lampy ${f.toUpperCase()}`) ?? v[f].jas,
      s: cislo(z[f].s, HP_NEJKRATSI_S, 30, `Délka fáze ${f.toUpperCase()} (s)`) ?? v[f].s,
    };
  }
  if (z.hlavni) {
    if (z.hlavni.zap !== undefined && typeof z.hlavni.zap !== 'boolean') throw chyba('Hlavní světlo při málo HP je zapnuté, nebo vypnuté.');
    v.hlavni = {
      zap: z.hlavni.zap ?? v.hlavni.zap,
      rgb: barva(z.hlavni.rgb, 'Hlavní světlo') ?? v.hlavni.rgb,
      jas: cislo(z.hlavni.jas, PODLAHA_JASU, 100, 'Jas hlavního světla') ?? v.hlavni.jas,
    };
  }
  if (z.pozadi) {
    v.pozadi = {
      rgb: barva(z.pozadi.rgb, 'Pozadí') ?? v.pozadi.rgb,
      jas: cislo(z.pozadi.jas, 1, 100, 'Jas pozadí') ?? v.pozadi.jas,
      nabeh_s: cislo(z.pozadi.nabeh_s, 0, 30, 'Náběh pozadí (s)') ?? v.pozadi.nabeh_s,
    };
  }
  return v;
}
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
    this.mistni = { ridit: false, vychozi: { ...VYCHOZI_SVETLA }, hp: normalizujHp(), nabehStartu: true };
    this.nabeh = null; // odpočet na scéně Start: světla se přelévají do výchozího stavu (bod 77)
    this.vrstvy = { pocasi: {}, rezim: {} };
    this.chybyVrstev = [];
    this.zarizeni = new Map(); // klic → { klic, role, typ, ovladac, id, ok, chyba, posledni }
    this.zablesky = [];
    this.casovacBlesku = null;
    this.casovacOpakovani = null;
    this.fronta = Promise.resolve();
    this.kritickeHp = null; // postava na tahu s málo HP: lampa pulzuje (bod 72)
    this.casovacPulzu = null;
  }

  async nacist() {
    try {
      const d = JSON.parse(await fs.readFile(this.soubor, 'utf8'));
      let hp = normalizujHp();
      try {
        hp = normalizujHp(d.hp);
      } catch {
        /* poškozené nastavení málo HP: výchozí */
      }
      this.mistni = { ridit: d.ridit === true, vychozi: { ...VYCHOZI_SVETLA, ...(d.vychozi ?? {}) }, hp, nabehStartu: d.nabehStartu !== false };
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

  get hpSvetlaZapnute() {
    return this.nastaveni().HP_SVETLA !== '0';
  }

  verejny() {
    const n = this.nastaveni();
    return {
      ridit: this.mistni.ridit,
      blesky: this.bleskyZapnute,
      hpSvetla: this.hpSvetlaZapnute,
      kritickeHp: this.pulzBezi ? this.kritickeHp : null,
      hpNastaveni: this.mistni.hp,
      nabehStartu: this.mistni.nabehStartu,
      nabehBezi: Boolean(this.nabeh),
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
          // Lampa a pozadí při málo HP scénu neposlouchají, dokud tah postavy neskončí.
          if (this.pulzBezi && this.rolePriHp().includes(z.role) && !vynutit) return;
          // Během odpočtu světla plynou do výchozího stavu; scéna je převezme až po něm.
          if (this.nabeh && !vynutit) return;
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

  /** Role, které při málo HP poslouchají pulz, ne scénu (hlavní světlo jen se zapnutou volbou). */
  rolePriHp() {
    return this.mistni.hp?.hlavni?.zap ? [...ROLE_PRI_HP_ZAKLAD, 'hlavni'] : ROLE_PRI_HP_ZAKLAD;
  }

  /** Výchozí stav rolí (s pojistkami hlavního světla). */
  cileVychozi() {
    return pojistky(Object.fromEntries(ROLE.map((r) => [r, normalizujRoli(this.mistni.vychozi[r]) ?? normalizujRoli(VYCHOZI_SVETLA[r])])));
  }

  /**
   * Odpočet do začátku hry (bod 77): podle stavu odpočtu spustí, pozastaví, nebo ukončí přelévání
   * světel do výchozího stavu. Volá app.js při každé změně odpočtu.
   */
  odpocet(s) {
    const klic = `${s?.stav}|${s?.konec ?? ''}`;
    if (klic === this.klicOdpoctu) return;
    this.klicOdpoctu = klic;
    if (s?.stav === 'bezi' && s.konec) this.spustitNabeh(Date.parse(s.konec)).catch(() => {});
    else if (s?.stav === 'pauza') this.zastavitNabeh(); // světla zůstanou, kde jsou; po pokračování se přelévají dál
    else this.zastavitNabeh({ obnovit: true });
  }

  /**
   * Start hry: světla se od toho, jak právě svítí, pomalu přelijí do výchozího stavu a doběhnou s odpočtem.
   * Jen s Řídit světla a zapnutým přepínačem. Hue dostává kroky s přechodem (plynule), WiZ kroky po
   * 0,5–3 s podle délky odpočtu; po konci převezme světla scéna (přechod 3 s).
   */
  async spustitNabeh(konecMs) {
    this.zastavitNabeh();
    if (!this.mistni.ridit || !this.mistni.nabehStartu) return false;
    const zacatek = Date.now();
    if (!Number.isFinite(konecMs) || konecMs - zacatek < 3000) return false;
    const cile = this.cileVychozi();
    const zarizeni = [...this.zarizeni.values()].filter((z) => z.ovladac && cile[z.role]);
    const token = {};
    this.nabeh = { token, konecMs };
    // Odkud: to, jak světla svítí teď (zařízení, které neodpoví, jde rovnou do cíle s přechodem).
    const od = new Map();
    await Promise.all(zarizeni.map(async (z) => {
      try {
        od.set(z.klic, z.typ === 'hue' ? await z.ovladac.stav(z.id) : await z.ovladac.stav());
      } catch {
        /* bez výchozího bodu */
      }
    }));
    if (this.nabeh?.token !== token) return false;
    const krokMs = Math.round(Math.min(3000, Math.max(500, (konecMs - zacatek) / 200)));
    const smes = (a, b, t) => Math.round(a + (b - a) * t);
    const krok = () => {
      if (this.nabeh?.token !== token) return;
      const t = Math.min(1, (Date.now() - zacatek) / (konecMs - zacatek));
      for (const z of zarizeni) {
        if (this.pulzBezi && this.rolePriHp().includes(z.role)) continue;
        const cil = cile[z.role];
        const o = od.get(z.klic);
        let mezi = cil;
        if (t < 1 && o && !o.scena && !cil.scena) {
          const oJas = o.zap ? o.jas : 0;
          const oRgb = o.zap && o.rgb ? o.rgb : cil.rgb;
          const jas = smes(oJas, cil.zap ? cil.jas : 0, t);
          mezi = { zap: jas > 0, jas, rgb: oRgb.map((c, i) => smes(c, cil.rgb[i], t)) };
        }
        if (t >= 1) z.posledni = JSON.stringify(cil);
        this.poslatKrok(z, mezi, z.typ === 'hue' ? krokMs : 0, () => this.nabeh?.token === token || t >= 1);
      }
      if (t >= 1) {
        this.nabeh = null;
        this.oznam();
        // Po odpočtu převezme světla scéna (místo, počasí); bez vlastních světel zůstane výchozí stav.
        for (const z of this.zarizeni.values()) z.posledni = null;
        setTimeout(() => this.aplikovat({ prechodMs: 3000 }).catch(() => {}), krokMs + 200).unref?.();
        return;
      }
      this.casovacNabehu = setTimeout(krok, krokMs);
      this.casovacNabehu.unref?.();
    };
    krok();
    this.oznam();
    return true;
  }

  /** Ukončí přelévání při odpočtu; `obnovit` = světla hned převezme scéna (zrušený odpočet). */
  zastavitNabeh({ obnovit = false } = {}) {
    if (!this.nabeh) return;
    clearTimeout(this.casovacNabehu);
    this.nabeh = null;
    for (const z of this.zarizeni.values()) {
      z.krokCeka = null;
      z.posledni = null;
    }
    if (obnovit && this.mistni.ridit) this.aplikovat({ prechodMs: 2000 }).catch(() => {});
    this.oznam();
  }

  /** Krok přelévání: na zařízení nejvýš jeden příkaz na cestě, čeká jen ten nejnovější (jako poslatPulz). */
  poslatKrok(z, cil, ms, platne) {
    if (z.krokNaCeste) {
      z.krokCeka = { cil, ms, platne };
      return;
    }
    z.krokNaCeste = true;
    this.poslat(z, cil, ms)
      .catch(() => {})
      .finally(() => {
        z.krokNaCeste = false;
        const dalsi = z.krokCeka;
        z.krokCeka = null;
        if (dalsi && dalsi.platne()) this.poslatKrok(z, dalsi.cil, dalsi.ms, dalsi.platne);
      });
  }

  async nastavitNabehStartu(zap) {
    this.mistni.nabehStartu = zap === true;
    await this.ulozitMistni();
    if (!this.mistni.nabehStartu) this.zastavitNabeh({ obnovit: true });
    this.oznam();
    return this.verejny();
  }

  /** Světla normál: výchozí stav na všech zařízeních, bez ohledu na scénu. */
  async normal() {
    this.zastavitNabeh();
    const cile = this.cileVychozi();
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
    if (!this.mistni.ridit || this.nabeh) return { blesk: true };
    const posun = v.posunMs ?? 0;
    // Lampa a pozadí při málo HP pulzují; blesk je nepřeruší.
    const role = v.role.filter((r) => !(this.pulzBezi && this.rolePriHp().includes(r)));
    await Promise.all(
      role.map(async (r, i) => {
        await new Promise((ok) => setTimeout(ok, i * posun));
        const zarizeni = [...this.zarizeni.values()].filter((z) => z.role === r && z.ovladac);
        await Promise.all(zarizeni.map((z) => this.poslat(z, { zap: true, jas: v.jas, rgb: [235, 240, 255] }, 0)));
        await new Promise((ok) => setTimeout(ok, 90));
        // Návrat na to, co má role svítit teď (scéna, bez vlastních světel výchozí stav).
        await Promise.all(zarizeni.map((z) => this.poslat(z, this.cil()[r], 120)));
      }),
    );
    // Hue doručuje rychle po sobě jdoucí příkazy přes Zigbee bez záruky pořadí: záblesk může dorazit
    // až po návratu a světlo zůstane bílé. Proto za 0,8 s ještě jednou pošle správný stav.
    const pojistka = setTimeout(() => {
      if (!this.mistni.ridit || this.nabeh) return;
      const cile = this.cil();
      for (const z of this.zarizeni.values()) {
        if (!role.includes(z.role) || !z.ovladac) continue;
        if (this.pulzBezi && this.rolePriHp().includes(z.role)) continue;
        this.poslat(z, cile[z.role], 300).then(() => {
          if (z.ok) z.posledni = JSON.stringify(cile[z.role]);
        }).catch(() => {});
      }
    }, 800);
    pojistka.unref?.();
    return { blesk: true };
  }

  /* ---------- Světla podle HP (bod 72) ---------- */

  /**
   * Postava hráče na tahu s málo HP (nebo null): lampa střídá fázi A a B (barvy, nebo jen jas)
   * podle Nastavení → Světla → Málo HP, pozadí se rozsvítí jednou barvou s náběhem. Po konci tahu se
   * obě role vrátí ke scéně se stejným náběhem. Jen s Řídit světla a zapnutým vypínačem;
   * `vynutit` = zkouška z Nastavení (i bez souboje a bez Řídit světla).
   */
  nastavitKritickeHp(kriticke, { vynutit = false } = {}) {
    this.kritickeHp = kriticke ?? null;
    // Obraz v OBS a zvuk (ucpané uši) se řídí stejným stavem, i při zkoušce a bez Řídit světla.
    this.emit('kriticke-hp', this.kritickeHp);
    const pulzovat = Boolean(this.kritickeHp) && (vynutit || (this.mistni.ridit && this.hpSvetlaZapnute));
    const zarizeniRole = (role) => [...this.zarizeni.values()].filter((z) => z.role === role && z.ovladac);
    const n = this.mistni.hp;
    if (pulzovat && !this.pulzBezi) {
      this.pulzBezi = true;
      const nabeh = Math.round(n.pozadi.nabeh_s * 1000);
      Promise.all(zarizeniRole('pozadi').map((z) => this.poslat(z, { zap: true, jas: n.pozadi.jas, rgb: n.pozadi.rgb }, nabeh))).catch(() => {});
      if (n.hlavni?.zap) {
        const cil = { zap: true, jas: Math.max(PODLAHA_JASU, n.hlavni.jas), rgb: n.hlavni.rgb };
        Promise.all(zarizeniRole('hlavni').map((z) => this.poslat(z, cil, nabeh))).catch(() => {});
      }
      let faze = 'a';
      let predchozi = null;
      const krok = () => {
        if (!this.pulzBezi) return;
        const f = n[faze];
        const cil = { zap: true, jas: f.jas, rgb: n.rezim === 'intenzita' ? n.a.rgb : f.rgb };
        const ms = Math.round(f.s * 1000);
        // Na začátku fáze se lampa plynule přelije do její barvy (Přechod, nejvýš celá fáze), pak barvu drží.
        const prechod = predchozi ? Math.min(ms, Math.round(n.prechod_s * 1000)) : 0;
        for (const z of zarizeniRole('lampa')) this.prelit(z, predchozi, cil, prechod);
        predchozi = cil;
        faze = faze === 'a' ? 'b' : 'a';
        this.casovacPulzu = setTimeout(krok, ms);
        this.casovacPulzu.unref?.();
      };
      krok();
    } else if (!pulzovat && this.pulzBezi) {
      this.pulzBezi = false;
      clearTimeout(this.casovacPulzu);
      this.casovacPulzu = null;
      for (const z of this.zarizeni.values()) {
        clearInterval(z.prelivani);
        z.pulzCeka = null; // čekající krok pulzu už nepošle; návrat ke scéně jde po tom, co je na cestě
      }
      for (const z of this.zarizeni.values()) if (this.rolePriHp().includes(z.role)) z.posledni = null;
      if (this.mistni.ridit) this.aplikovat({ prechodMs: Math.round(n.pozadi.nabeh_s * 1000) }).catch(() => {});
      else this.normal().catch(() => {}); // po zkoušce bez Řídit světla zpět na výchozí stav
    }
    this.oznam();
  }

  /**
   * Příkaz pulzu na WiZ: nejvýš jeden na cestě, další čeká jen ten poslední. WiZ čeká na odpověď
   * lampy (často déle než krok 150 ms); bez toho by se příkazy hromadily ve frontě a lampa by
   * pulzovala ještě dlouho po konci tahu.
   */
  poslatPulz(z, cil) {
    if (z.pulzNaCeste) {
      z.pulzCeka = cil;
      return;
    }
    z.pulzNaCeste = true;
    this.poslat(z, cil, 0)
      .catch(() => {})
      .finally(() => {
        z.pulzNaCeste = false;
        const dalsi = z.pulzCeka;
        z.pulzCeka = null;
        if (dalsi && this.pulzBezi) this.poslatPulz(z, dalsi);
      });
  }

  /**
   * Plynulý přechod lampy: Hue dostane jeden příkaz s přechodem, WiZ přechod neumí,
   * proto ho Hub prolne sám po krocích 150 ms (plynulá změna, ne záblesk).
   */
  prelit(z, od, cil, ms) {
    clearInterval(z.prelivani);
    if (z.typ === 'hue') {
      this.poslat(z, cil, ms).catch(() => {});
      return;
    }
    if (!od || ms < 300) {
      this.poslatPulz(z, cil);
      return;
    }
    const zacatek = Date.now();
    const smes = (a, b, t) => Math.round(a + (b - a) * t);
    z.prelivani = setInterval(() => {
      if (!this.pulzBezi) return clearInterval(z.prelivani);
      const t = Math.min(1, (Date.now() - zacatek) / ms);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; // pomalý začátek i konec
      this.poslatPulz(z, { zap: true, jas: smes(od.jas, cil.jas, e), rgb: od.rgb.map((c, i) => smes(c, cil.rgb[i], e)) });
      if (t >= 1) clearInterval(z.prelivani);
    }, 150);
    z.prelivani.unref?.();
  }

  /** Uloží nastavení málo HP (Nastavení → Světla). Běžící pulz se rozjede s novými hodnotami. */
  async nastavitHp(z) {
    this.mistni.hp = normalizujHp(z, this.mistni.hp);
    await this.ulozitMistni();
    if (this.pulzBezi) {
      const k = this.kritickeHp;
      const vynutit = this.zkouskaHp;
      this.pulzBezi = false;
      clearTimeout(this.casovacPulzu);
      // Krok ze starého nastavení (třeba barva B před přepnutím na Jen intenzita) už nepošle.
      for (const z of this.zarizeni.values()) {
        clearInterval(z.prelivani);
        z.pulzCeka = null;
      }
      this.nastavitKritickeHp(k, { vynutit });
    }
    this.oznam();
    return this.verejny();
  }

  /** Zkouška z Nastavení: pulz na 12 s i bez souboje. */
  zkusitHp() {
    this.zkouskaHp = true;
    this.nastavitKritickeHp({ jmeno: 'Zkouška', hp: 1, max: 4 }, { vynutit: true });
    clearTimeout(this.casovacZkouskyHp);
    this.casovacZkouskyHp = setTimeout(() => {
      this.zkouskaHp = false;
      this.nastavitKritickeHp(null);
    }, 12000);
    this.casovacZkouskyHp.unref?.();
    return this.verejny();
  }

  /** Zachytit světla do místa: hodnoty rolí pro uložení do hlavičky (zápis dělá Mista). */
  async zachytitProMisto() {
    return this.precistZarizeni();
  }

  zastavit() {
    this.pulzBezi = false;
    clearTimeout(this.casovacPulzu);
    clearTimeout(this.casovacZkouskyHp);
    clearTimeout(this.casovacBlesku);
    clearInterval(this.casovacOpakovani);
    clearTimeout(this.casovacNabehu);
    this.nabeh = null;
  }
}
