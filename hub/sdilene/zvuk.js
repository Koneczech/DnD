// Přehrávač zvuku pro výstupy Hubu (Blok 5): hudba, ambient a efekty u stolu (zvuk-u-stolu.html),
// hudba případně v OBS (hudba.html). Server říká, co má hrát; tady se to plynule prolne přes Web Audio.
//
// Smyčky hrají dva prvky <audio> střídavě: kousek před koncem se druhý spustí od začátku a oba
// se prolnou. Smyčka tak nemá šev ani u MP3 (kodér přidává na začátek a konec ticho) a dlouhé
// ambienty se nemusí celé dekódovat do paměti (v OBS by jinak zabraly stovky MB).
import { odebirat } from '/sdilene/zive.js';

const PROLNUTI_SMYCKY_S = 3;
const KRATKA_SMYCKA_S = 8;

/** Jedna smyčka (hudba nebo vrstva ambientu). */
class Smycka {
  constructor(ctx, cil, { soubor, url }, priChybe) {
    this.ctx = ctx;
    this.soubor = soubor;
    this.priChybe = priChybe;
    this.vystup = ctx.createGain();
    this.vystup.gain.value = 0;
    this.vystup.connect(cil);
    this.prvky = [0, 1].map(() => {
      const a = new Audio();
      a.preload = 'auto';
      a.src = url;
      const g = ctx.createGain();
      g.gain.value = 0;
      ctx.createMediaElementSource(a).connect(g).connect(this.vystup);
      a.addEventListener('error', () => this.priChybe?.(`Soubor ${soubor} se nepodařilo přehrát.`));
      return { a, g };
    });
    this.aktivni = 0;
    this.prechod = false;
    this.zastaveno = false;
    this.casovac = setInterval(() => this.hlidat(), 100);
  }

  get hraje() {
    return !this.zastaveno && this.prvky.some((p) => !p.a.paused);
  }

  async spustit() {
    const p = this.prvky[0];
    p.g.gain.setValueAtTime(1, this.ctx.currentTime);
    await p.a.play();
  }

  /** Kousek před koncem spustí druhý prvek od začátku a oba prolne. */
  hlidat() {
    if (this.zastaveno || this.prechod) return;
    const p = this.prvky[this.aktivni];
    const d = p.a.duration;
    if (p.a.ended) {
      // Časovač nestihl prolnutí (přetížený počítač): aspoň hned znovu od začátku.
      p.a.currentTime = 0;
      p.a.play().catch(() => {});
      return;
    }
    if (!Number.isFinite(d) || p.a.paused) return;
    if (d < KRATKA_SMYCKA_S) {
      p.a.loop = true; // krátký zvuk: prolnutí by bylo delší než on sám
      return;
    }
    const x = Math.min(PROLNUTI_SMYCKY_S, d / 4);
    if (d - p.a.currentTime > x) return;
    this.prechod = true;
    const q = this.prvky[1 - this.aktivni];
    q.a.currentTime = 0;
    q.a.play().catch(() => {});
    const t = this.ctx.currentTime;
    q.g.gain.cancelScheduledValues(t);
    q.g.gain.setValueAtTime(0, t);
    q.g.gain.linearRampToValueAtTime(1, t + x);
    p.g.gain.cancelScheduledValues(t);
    p.g.gain.setValueAtTime(1, t);
    p.g.gain.linearRampToValueAtTime(0, t + x);
    setTimeout(() => {
      p.a.pause();
      this.aktivni = 1 - this.aktivni;
      this.prechod = false;
    }, x * 1000 + 150);
  }

  hlasitost(v, ms) {
    const t = this.ctx.currentTime;
    const g = this.vystup.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(v, t + ms / 1000);
  }

  zastavit(ms) {
    this.zastaveno = true;
    this.hlasitost(0, ms);
    setTimeout(() => {
      clearInterval(this.casovac);
      for (const { a } of this.prvky) {
        a.pause();
        a.removeAttribute('src');
        a.load();
      }
      this.vystup.disconnect();
    }, ms + 100);
  }
}

/** Sada smyček, které mají hrát současně (ambient místa + počasí, nebo jedna hudba). */
export class Vrstvy {
  constructor(ctx, cil, priChybe) {
    this.ctx = ctx;
    this.cil = cil;
    this.priChybe = priChybe;
    this.smycky = new Map(); // soubor → Smycka
  }

  /** @param {Array<{soubor:string, url:string, hlasitost?:number}>} seznam */
  nastavit(seznam, prolnutiMs = 2000) {
    const chci = new Map(seznam.map((x) => [x.soubor, x]));
    for (const [soubor, s] of this.smycky) {
      if (chci.has(soubor)) continue;
      s.zastavit(prolnutiMs);
      this.smycky.delete(soubor);
    }
    for (const [soubor, x] of chci) {
      const cil = x.hlasitost ?? 1;
      const jiz = this.smycky.get(soubor);
      if (jiz) {
        jiz.hlasitost(cil, 600);
        continue;
      }
      const s = new Smycka(this.ctx, this.cil, x, this.priChybe);
      this.smycky.set(soubor, s);
      // Prolnutí začne až s prvním zvukem nové smyčky: stará mezitím dohrává, ticho nevznikne.
      s.spustit()
        .then(() => s.hlasitost(cil, prolnutiMs))
        .catch((e) => this.priChybe?.(e?.name === 'NotAllowedError' ? 'Prohlížeč zatím nepovolil zvuk. Klikni do stránky.' : `Soubor ${soubor} nehraje: ${e?.message ?? e}`));
    }
  }

  hraje() {
    return [...this.smycky.values()].filter((s) => s.hraje).map((s) => s.soubor);
  }
}

/**
 * Ucpané uši (málo HP, otevřený bod 73): dvě dolní propusti za sebou (strmý ořez výšek), mírně
 * zesílené basy a vyrovnání hlasitosti. Hudba nezní tišeji, ale tupě a „zpoza zdi“.
 * Bez tlumení je propust na 20 kHz a nic nemění.
 */
export class Tlumeni {
  static OTEVRENO_HZ = 20000;
  static NABEH_S = 1.2;
  static DOZNENI_S = 2;

  constructor(ctx) {
    this.ctx = ctx;
    this.vstup = ctx.createGain();
    this.propusti = [0, 1].map(() => {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = Tlumeni.OTEVRENO_HZ;
      f.Q.value = 0.7;
      return f;
    });
    this.basy = ctx.createBiquadFilter();
    this.basy.type = 'lowshelf';
    this.basy.frequency.value = 180;
    this.basy.gain.value = 0;
    this.vyrovnani = ctx.createGain();
    this.vystup = this.vyrovnani;
    this.vstup.connect(this.propusti[0]).connect(this.propusti[1]).connect(this.basy).connect(this.vyrovnani);
    this.aktivni = false;
  }

  /** Plynule zapne nebo vypne tlumení; `hz` = kde propust řeže (nižší = ucpanější). */
  nastavit(aktivni, hz = 500) {
    const cilHz = aktivni ? Math.max(100, hz) : Tlumeni.OTEVRENO_HZ;
    if (aktivni === this.aktivni && this.hz === cilHz) return;
    this.aktivni = aktivni;
    this.hz = cilHz;
    const t = this.ctx.currentTime;
    const d = aktivni ? Tlumeni.NABEH_S : Tlumeni.DOZNENI_S;
    const plynule = (param, cil, exp) => {
      param.cancelScheduledValues(t);
      param.setValueAtTime(param.value, t);
      if (exp) param.exponentialRampToValueAtTime(cil, t + d);
      else param.linearRampToValueAtTime(cil, t + d);
    };
    for (const f of this.propusti) plynule(f.frequency, cilHz, true);
    plynule(this.basy.gain, aktivni ? 5 : 0, false);
    // Ořez výšek ubere hlasitost; vyrovnání ji vrátí (čím nižší propust, tím víc).
    plynule(this.vyrovnani.gain, aktivni ? Math.min(1.6, 1 + 250 / cilHz) : 1, false);
  }
}

/**
 * Základ obou stránek: AudioContext, sběrnice s hlasitostí (Ticho), odemčení zvuku, hlášení
 * serveru a živé změny.
 */
export class Prehravac {
  /**
   * @param {object} volby
   * @param {'hudba'|'stul'} volby.stranka
   * @param {(stav: object) => void} volby.priZmene co hrát (událost zvuk)
   * @param {(efekt: object) => void} [volby.priEfektu]
   */
  constructor({ stranka, priZmene, priEfektu }) {
    this.stranka = stranka;
    this.ctx = new AudioContext({ latencyHint: 'playback' });
    this.chyba = null;
    this.vystup = null; // {nazev, ok, vybrany} u stolu
    this.buffery = new Map();
    this.priZmene = priZmene;
    this.priEfektu = priEfektu;
    this.ctx.addEventListener('statechange', () => this.hlasit());
  }

  sbernice() {
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.connect(this.ctx.destination);
    return g;
  }

  /** Sběrnice s ucpanýma ušima: hlasitost → tlumení → uhnutí → výstup. */
  sberniceSTlumenim() {
    const g = this.ctx.createGain();
    g.gain.value = 0;
    const tlumeni = new Tlumeni(this.ctx);
    const uhyb = this.ctx.createGain();
    g.connect(tlumeni.vstup);
    tlumeni.vystup.connect(uhyb).connect(this.ctx.destination);
    return { g, tlumeni, uhyb };
  }

  /**
   * Hudba krátce uhne jednorázovému zvuku (soundboard, fanfára): −6 dB za 80 ms, drží po dobu zvuku
   * (nejvýš 1,5 s) a za 0,6 s se vrátí. Výkřik tak prořízne i bojovou hudbu.
   */
  uhnout(uhyb, delkaS = 1) {
    if (!uhyb) return;
    const t = this.ctx.currentTime;
    const drzet = Math.min(1.5, Math.max(0.3, delkaS));
    uhyb.gain.cancelScheduledValues(t);
    uhyb.gain.setValueAtTime(uhyb.gain.value, t);
    uhyb.gain.linearRampToValueAtTime(0.5, t + 0.08);
    uhyb.gain.setValueAtTime(0.5, t + 0.08 + drzet);
    uhyb.gain.linearRampToValueAtTime(1, t + 0.68 + drzet);
  }

  /** Plynulá změna hlasitosti sběrnice (Ticho do 1 s). */
  nastavHlasitost(g, v, ms = 400) {
    const t = this.ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(v, t + ms / 1000);
  }

  get odemceno() {
    return this.ctx.state === 'running';
  }

  async odemknout() {
    await this.ctx.resume();
    this.hlasit();
  }

  zaznamenatChybu(text) {
    this.chyba = text;
    this.hlasit();
  }

  /**
   * Jednorázový zvuk přes ostatní (hrom, ruční efekt, soundboard). Krátké soubory se dekódují a drží
   * v paměti. `obmena`: drobně jiná výška (±5 %) a hlasitost, aby opakovaný zvuk nezněl jako stroj.
   * @returns {Promise<number>} délka zvuku v sekundách
   */
  async efekt({ url, hlasitost = 1, filtr = null, obmena = false }, cil) {
    let buffer = this.buffery.get(url);
    if (!buffer) {
      const data = await (await fetch(url)).arrayBuffer();
      buffer = await this.ctx.decodeAudioData(data);
      if (this.buffery.size > 30) this.buffery.delete(this.buffery.keys().next().value);
      this.buffery.set(url, buffer);
    }
    const zdroj = this.ctx.createBufferSource();
    zdroj.buffer = buffer;
    const g = this.ctx.createGain();
    g.gain.value = obmena ? hlasitost * (0.85 + Math.random() * 0.15) : hlasitost;
    if (obmena) zdroj.playbackRate.value = 0.95 + Math.random() * 0.1;
    let uzel = zdroj;
    if (filtr === 'daleko') {
      // Vzdálený hrom duní: dolní propust uřízne praskání.
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 700;
      uzel = uzel.connect(f);
    }
    uzel.connect(g).connect(cil);
    zdroj.start();
    return buffer.duration / zdroj.playbackRate.value;
  }

  /** Zkušební tón bez souboru: tři stoupající tóny. */
  test(cil) {
    const t0 = this.ctx.currentTime + 0.05;
    [523.25, 659.25, 783.99].forEach((f, i) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.frequency.value = f;
      const t = t0 + i * 0.28;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.35, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
      o.connect(g).connect(cil);
      o.start(t);
      o.stop(t + 0.3);
    });
  }

  hraje() {
    return [];
  }

  hlasit() {
    fetch('/api/zvuk/hlaseni', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stranka: this.stranka, odemceno: this.odemceno, hraje: this.hraje(), chyba: this.chyba, vystup: this.vystup }),
    }).catch(() => {});
  }

  spustit() {
    const nacist = () =>
      fetch('/api/zvuk?pro=stranka')
        .then((r) => r.json())
        .then((s) => this.priZmene(s))
        .catch(() => {});
    nacist();
    odebirat(['zvuk', 'zvuk-efekt'], (udalost, data) => {
      if (udalost === 'zvuk') this.priZmene(data);
      else if (data?.cil === this.stranka) this.priEfektu?.(data);
    }, {
      priStavu: (pripojeno, poVypadku) => {
        if (pripojeno && poVypadku) nacist();
      },
    });
    setInterval(() => this.hlasit(), 5000);
    this.hlasit();
  }
}
