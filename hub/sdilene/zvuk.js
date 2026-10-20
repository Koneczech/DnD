// Přehrávač zvuku pro výstupy Hubu (Blok 5): hudba, ambient a efekty u stolu (zvuk-u-stolu.html),
// hudba případně v OBS (hudba.html). Server říká, co má hrát; tady se to plynule prolne přes Web Audio.
//
// Smyčky hrají dva prvky <audio> střídavě: kousek před koncem se druhý spustí od začátku a oba
// se prolnou. Smyčka tak nemá šev ani u MP3 (kodér přidává na začátek a konec ticho) a dlouhé
// ambienty se nemusí celé dekódovat do paměti (v OBS by jinak zabraly stovky MB).
import { odebirat } from '/sdilene/zive.js';

const PROLNUTI_SMYCKY_S = 3;
const KRATKA_SMYCKA_S = 8;
/** Playlist: další skladba naběhne tolik sekund před koncem předchozí (prolnutí skladeb). */
const PROLNUTI_SKLADEB_S = 4;
/** Kolik dekódovaných krátkých zvuků drží stránka v paměti (zvuky tahů, soundboard, hromy). */
const MAX_BUFFERU = 60;

/**
 * Vzdálenost zvuku (bod 85): 0 = u stolu, 1 = hodně daleko. Vzdálený zvuk je tišší a tupější
 * (dolní propust ubírá výšky), jako když se ozývá přes tábor nebo zpoza zdi.
 */
export class Vzdalenost {
  static parametry(v) {
    const x = Math.max(0, Math.min(1, Number(v) || 0));
    // 0 → 20 kHz (nic), 1 → 900 Hz; hlasitost 1 → 0,4.
    return { hz: 20000 * Math.pow(900 / 20000, x), zisk: 1 - 0.6 * x };
  }

  constructor(ctx, v = 0) {
    this.ctx = ctx;
    this.propust = ctx.createBiquadFilter();
    this.propust.type = 'lowpass';
    this.propust.Q.value = 0.5;
    this.zisk = ctx.createGain();
    this.vstup = this.propust;
    this.vystup = this.zisk;
    this.propust.connect(this.zisk);
    this.v = null;
    this.nastavit(v, 0);
  }

  nastavit(v, ms = 800) {
    const x = Math.max(0, Math.min(1, Number(v) || 0));
    if (x === this.v) return;
    this.v = x;
    const { hz, zisk } = Vzdalenost.parametry(x);
    const t = this.ctx.currentTime;
    for (const [param, cil, exp] of [[this.propust.frequency, hz, true], [this.zisk.gain, zisk, false]]) {
      param.cancelScheduledValues(t);
      if (!ms) {
        param.setValueAtTime(cil, t);
        continue;
      }
      param.setValueAtTime(param.value, t);
      if (exp) param.exponentialRampToValueAtTime(cil, t + ms / 1000);
      else param.linearRampToValueAtTime(cil, t + ms / 1000);
    }
  }
}

/** Jedna smyčka (hudba nebo vrstva ambientu). */
class Smycka {
  constructor(ctx, cil, { soubor, url, vzdalenost = 0 }, priChybe) {
    this.ctx = ctx;
    this.soubor = soubor;
    this.url = url;
    this.priChybe = priChybe;
    this.vystup = ctx.createGain();
    this.vystup.gain.value = 0;
    this.vzdalenost = new Vzdalenost(ctx, vzdalenost);
    this.vystup.connect(this.vzdalenost.vstup);
    this.vzdalenost.vystup.connect(cil);
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
    this.spustena = true;
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
    if (p.a.paused) {
      // Spuštěná smyčka se sama zastavila (prohlížeč přerušil přehrávání): po chvilce ji rozjeď znovu.
      if (this.spustena && performance.now() - (this.posledniOziveni ?? 0) > 2000) {
        this.posledniOziveni = performance.now();
        p.a.play().catch(() => {});
      }
      return;
    }
    if (!Number.isFinite(d)) return;
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
      this.vzdalenost.vystup.disconnect();
    }, ms + 100);
  }
}

/**
 * Playlist hudby: skladby ze složky (`hudba/souboj/`) v náhodném pořadí, každá jednou, než se
 * začne znovu (a nová runda nezačne skladbou, která právě dohrála). Kousek před koncem skladby
 * naběhne další a obě se prolnou, takže hudba nikdy neztichne. Hraje jako Smycka (dva prvky <audio>),
 * každá skladba má vlastní zesílení ze srovnání hlasitosti.
 */
export class Playlist {
  constructor(ctx, cil, { soubor, skladby }, priChybe) {
    this.ctx = ctx;
    this.soubor = soubor;
    this.priChybe = priChybe;
    this.skladby = skladby;
    this.url = Playlist.klic(skladby);
    this.vystup = ctx.createGain();
    this.vystup.gain.value = 0;
    // Stejné rozhraní jako Smycka: vzdálenost se u hudby nepoužívá, ale Vrstvy ji nastavují.
    this.vzdalenost = new Vzdalenost(ctx, 0);
    this.vystup.connect(this.vzdalenost.vstup);
    this.vzdalenost.vystup.connect(cil);
    this.prvky = [0, 1].map(() => {
      const a = new Audio();
      a.preload = 'auto';
      const g = ctx.createGain();
      g.gain.value = 0;
      ctx.createMediaElementSource(a).connect(g).connect(this.vystup);
      a.addEventListener('error', () => {
        if (this.zastaveno || !a.getAttribute('src')) return;
        this.priChybe?.(`Skladba ${a.dataset.soubor ?? ''} se nepodařilo přehrát.`);
        // Rozbitá skladba nesmí zastavit hudbu: rovnou další.
        if (a === this.prvky[this.aktivni].a) this.dalsi(0.5);
      });
      return { a, g, zisk: 1 };
    });
    this.aktivni = 0;
    this.poradi = [];
    this.posledni = null;
    this.prechod = false;
    this.zastaveno = false;
    this.casovac = setInterval(() => this.hlidat(), 200);
  }

  /** Skladba, která právě hraje (po prolnutí ta nová). */
  get skladba() {
    const p = this.prvky[this.prechod ? 1 - this.aktivni : this.aktivni];
    return p.a.dataset.soubor ?? null;
  }

  /** Otisk seznamu skladeb (změna = nová skladba ve složce). */
  static klic(skladby) {
    return skladby.map((x) => x.url).join('|');
  }

  get hraje() {
    return !this.zastaveno && this.prvky.some((p) => !p.a.paused);
  }

  /** Další skladba v náhodném pořadí, každá jednou za kolo. */
  vybrat() {
    if (!this.poradi.length) {
      this.poradi = this.skladby.map((_, i) => i);
      for (let i = this.poradi.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.poradi[i], this.poradi[j]] = [this.poradi[j], this.poradi[i]];
      }
      // Nové kolo nezačne skladbou, která právě dohrála.
      if (this.poradi.length > 1 && this.skladby[this.poradi[0]]?.url === this.posledni) this.poradi.push(this.poradi.shift());
    }
    const x = this.skladby[this.poradi.shift()] ?? this.skladby[0];
    this.posledni = x.url;
    return x;
  }

  nacist(p, x) {
    p.a.src = x.url;
    p.a.dataset.soubor = x.soubor;
    p.zisk = x.zisk ?? 1;
    p.a.currentTime = 0;
  }

  async spustit() {
    const p = this.prvky[0];
    this.nacist(p, this.vybrat());
    p.g.gain.setValueAtTime(p.zisk, this.ctx.currentTime);
    await p.a.play();
    this.spustena = true;
  }

  /** Seznam skladeb se změnil (nová skladba ve složce): hraje dál, novinka přijde v dalším kole. */
  aktualizovat(skladby) {
    this.skladby = skladby;
    this.url = Playlist.klic(skladby);
    this.poradi = this.poradi.filter((i) => i < skladby.length);
  }

  /** Prolne na další skladbu za `s` sekund. */
  dalsi(s = PROLNUTI_SKLADEB_S) {
    if (this.zastaveno || this.prechod) return;
    this.prechod = true;
    const p = this.prvky[this.aktivni];
    const q = this.prvky[1 - this.aktivni];
    this.nacist(q, this.vybrat());
    q.a.play().catch(() => {});
    const t = this.ctx.currentTime;
    q.g.gain.cancelScheduledValues(t);
    q.g.gain.setValueAtTime(0, t);
    q.g.gain.linearRampToValueAtTime(q.zisk, t + s);
    p.g.gain.cancelScheduledValues(t);
    p.g.gain.setValueAtTime(p.g.gain.value, t);
    p.g.gain.linearRampToValueAtTime(0, t + s);
    setTimeout(() => {
      p.a.pause();
      this.aktivni = 1 - this.aktivni;
      this.prechod = false;
    }, s * 1000 + 150);
  }

  hlidat() {
    if (this.zastaveno || this.prechod) return;
    const p = this.prvky[this.aktivni];
    if (p.a.ended) return this.dalsi(0.3);
    if (p.a.paused) {
      if (this.spustena && performance.now() - (this.posledniOziveni ?? 0) > 2000) {
        this.posledniOziveni = performance.now();
        p.a.play().catch(() => {});
      }
      return;
    }
    const d = p.a.duration;
    if (!Number.isFinite(d)) return;
    const x = Math.min(PROLNUTI_SKLADEB_S, d / 4);
    if (d - p.a.currentTime <= x) this.dalsi(x);
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
      this.vzdalenost.vystup.disconnect();
    }, ms + 100);
  }
}

/**
 * Virtuální kabel se Spotify (DM 20. 10. 2026): aplikace Spotify hraje do kabelu VB-CABLE a stránka
 * ho otevře jako vstup. Jedno otevření pro celou stránku; prohlížeč se poprvé zeptá na „mikrofon“.
 * Zpracování řeči (ozvěna, šum, zesílení) je vypnuté, jinak by hudbu zkreslilo.
 */
const kabely = new Map(); // jméno → Promise<{ stream, nazev }>
export function otevritKabel(jmeno) {
  const klic = String(jmeno || 'CABLE Output').toLowerCase();
  if (!kabely.has(klic)) {
    const p = (async () => {
      const najit = async () => (await navigator.mediaDevices.enumerateDevices()).find((d) => d.kind === 'audioinput' && d.label.toLowerCase().includes(klic));
      let vstup = await najit();
      if (!vstup) {
        // Bez povolení prohlížeč jména vstupů neukáže: jednou se zeptat, pak hledat znovu.
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        for (const t of s.getTracks()) t.stop();
        vstup = await najit();
      }
      if (!vstup) throw new Error(`Virtuální kabel „${jmeno}“ tu není. Nainstaluj VB-CABLE (reference/zvuk.md) a obnov stránku.`);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: vstup.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 },
      });
      return { stream, nazev: vstup.label };
    })();
    // Selhání se nepamatuje: další pokus (třeba po instalaci kabelu) to zkusí znovu.
    p.catch(() => kabely.delete(klic));
    kabely.set(klic, p);
  }
  return kabely.get(klic);
}

/**
 * Hudba ze Spotify přes kabel. Stejné rozhraní jako Smycka, takže jde přes sběrnici hudby (ucpané uši,
 * uhnutí, Ticho). Hlasitost pustí až ve chvíli, kdy Hub ohlásí, že Spotify přepnulo na správný playlist
 * (`hraje`); při změně playlistu hudbu nejdřív ztlumí. Stará hudba tak nedohraje přes novou scénu.
 */
export class SpotifyVstup {
  constructor(ctx, cil, x, priChybe) {
    this.ctx = ctx;
    this.soubor = x.soubor;
    this.url = 'spotify';
    this.priChybe = priChybe;
    this.kabel = x.kabel;
    this.uri = x.uri;
    this.pripraveno = Boolean(x.hraje);
    this.prolnutiMs = 2000;
    this.chtena = 0;
    this.vystup = ctx.createGain();
    this.vystup.gain.value = 0;
    this.vzdalenost = new Vzdalenost(ctx, 0);
    this.vystup.connect(this.vzdalenost.vstup);
    this.vzdalenost.vystup.connect(cil);
    // Měřič: je v kabelu signál? (Spotify hraje jinam než do kabelu = ticho.)
    this.analyzator = ctx.createAnalyser();
    this.analyzator.fftSize = 2048;
    this.zdroj = null;
    this.zastaveno = false;
  }

  get hraje() {
    return !this.zastaveno && Boolean(this.zdroj) && this.pripraveno;
  }

  async spustit() {
    const { stream } = await otevritKabel(this.kabel);
    if (this.zastaveno) return;
    this.zdroj = this.ctx.createMediaStreamSource(stream);
    this.zdroj.connect(this.vystup);
    this.zdroj.connect(this.analyzator);
  }

  /** Úroveň signálu v kabelu (RMS 0–1). */
  uroven() {
    const d = new Float32Array(this.analyzator.fftSize);
    this.analyzator.getFloatTimeDomainData(d);
    let suma = 0;
    for (const x of d) suma += x * x;
    return Math.sqrt(suma / d.length);
  }

  rampa(v, ms) {
    const t = this.ctx.currentTime;
    const g = this.vystup.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(v, t + ms / 1000);
  }

  /** Hlasitost od Hubu (posuvník Hudba, srovnání): platí, až Spotify hraje správný playlist. */
  hlasitost(v, ms) {
    this.chtena = v;
    this.rampa(this.pripraveno ? v : 0, ms);
  }

  /** Nový stav od Hubu: jiný playlist = ztlumit; Hub ohlásil, že hraje = zesílit. */
  aktualizovat(x, prolnutiMs) {
    this.prolnutiMs = prolnutiMs;
    if (x.uri !== this.uri) {
      this.uri = x.uri;
      this.pripraveno = false;
      this.rampa(0, prolnutiMs);
    }
    if (x.hraje && !this.pripraveno) {
      this.pripraveno = true;
      this.rampa(this.chtena, prolnutiMs);
    } else if (!x.hraje && this.pripraveno) {
      this.pripraveno = false;
      this.rampa(0, prolnutiMs);
    }
  }

  zastavit(ms) {
    this.zastaveno = true;
    this.rampa(0, ms);
    setTimeout(() => {
      // Kabel zůstává otevřený pro další scénu se Spotify; odpojí se jen tahle cesta.
      this.zdroj?.disconnect();
      this.vystup.disconnect();
      this.vzdalenost.vystup.disconnect();
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
      // Srovnání hlasitosti (bod 86): `zisk` dorovná soubor na výchozí hladinu svého druhu.
      // U playlistu má zisk každá skladba zvlášť.
      const cil = (x.hlasitost ?? 1) * (x.playlist ? 1 : x.zisk ?? 1);
      let jiz = this.smycky.get(soubor);
      if (jiz && x.spotify && jiz instanceof SpotifyVstup) {
        // Spotify: stejný kabel, jiný playlist nebo potvrzení, že hraje (ztlumit / zesílit).
        jiz.aktualizovat(x, prolnutiMs);
      } else if (jiz && x.playlist && jiz instanceof Playlist) {
        // Playlist hraje dál; nová nebo vyměněná skladba ve složce přijde na řadu sama.
        if (jiz.url !== Playlist.klic(x.skladby)) jiz.aktualizovat(x.skladby);
      } else if (jiz && (Boolean(x.playlist) !== jiz instanceof Playlist || Boolean(x.spotify) !== jiz instanceof SpotifyVstup || (x.url && jiz.url !== x.url))) {
        // Soubor se vyměnil (jiný otisk v adrese): stará smyčka doběhne, nová naběhne.
        jiz.zastavit(prolnutiMs);
        this.smycky.delete(soubor);
        jiz = null;
      }
      if (jiz) {
        // Hlasitost jen při skutečné změně: jinak by každé nové hlášení Hubu (měření, soubory)
        // zkrátilo právě běžící pomalé prolnutí (konec souboje).
        if (jiz.cil !== cil) {
          jiz.cil = cil;
          jiz.hlasitost(cil, 600);
        }
        jiz.vzdalenost.nastavit(x.vzdalenost ?? 0);
        continue;
      }
      const s = x.spotify ? new SpotifyVstup(this.ctx, this.cil, x, this.priChybe) : x.playlist ? new Playlist(this.ctx, this.cil, x, this.priChybe) : new Smycka(this.ctx, this.cil, x, this.priChybe);
      if (x.spotify) s.prolnutiMs = prolnutiMs;
      s.cil = cil;
      this.smycky.set(soubor, s);
      // Prolnutí začne až s prvním zvukem nové smyčky: stará mezitím dohrává, ticho nevznikne.
      // AbortError („play() interrupted by pause()“): přehrávání přerušil prohlížeč (přepnutí výstupu,
      // načítání), ne soubor. Smyčka, která pořád má hrát, to zkusí znovu, jinak by zůstala potichu.
      const zkusit = (pokus) =>
        s.spustit()
          .then(() => s.hlasitost(cil, prolnutiMs))
          .catch((e) => {
            if (s.zastaveno) return;
            if (e?.name === 'AbortError' && pokus < 5) {
              setTimeout(() => !s.zastaveno && zkusit(pokus + 1), 300 * (pokus + 1));
              return;
            }
            this.priChybe?.(x.spotify ? `Spotify: ${e?.name === 'NotAllowedError' ? 'prohlížeč nepovolil vstup z kabelu (ikona zámku vedle adresy → Mikrofon → Povolit).' : e?.message ?? e}` : e?.name === 'NotAllowedError' ? 'Prohlížeč zatím nepovolil zvuk. Klikni do stránky.' : `Soubor ${soubor} nehraje: ${e?.message ?? e}`);
          });
      zkusit(0);
    }
  }

  hraje() {
    return [...this.smycky.values()].filter((s) => s.hraje).map((s) => s.soubor);
  }

  /** Playlist, který hraje (ten, co právě nedobíhá), nebo null. */
  playlist() {
    return [...this.smycky.values()].find((s) => s instanceof Playlist && !s.zastaveno) ?? null;
  }
}

/**
 * Náhodné zvuky prostředí (bod 85): krátké zvuky, které se samy občas ozvou pod ambientem
 * (hlasy v táboře, kůň, kovadlina, krkavec). Každý má průměrný odstup `kazdych_s` a `nahodilost`
 * (0 = přesně pravidelně, 1 = kdykoli mezi 0 a dvojnásobkem). Varianta se nikdy neopakuje dvakrát
 * za sebou, výška a hlasitost se trochu mění a zvuk přijde náhodně zleva nebo zprava.
 */
export class NahodneZvuky {
  /**
   * @param {Prehravac} prehravac
   * @param {AudioNode} cil sběrnice (s dozvukem místa)
   */
  constructor(prehravac, cil) {
    this.p = prehravac;
    this.cil = cil;
    this.zvuky = new Map(); // zvuk → {x, casovac, posledni, klic}
  }

  static odstupMs({ kazdych_s, nahodilost }, nahodne = Math.random) {
    const r = Math.max(0, Math.min(1, nahodilost ?? 0.5));
    return Math.max(1500, kazdych_s * 1000 * (1 + r * (nahodne() * 2 - 1)));
  }

  /** @param {Array<{zvuk:string, soubory:Array<{soubor:string,url:string}>, kazdych_s:number, nahodilost:number, hlasitost:number, vzdalenost:number}>} seznam */
  nastavit(seznam = []) {
    const chci = new Map(seznam.map((x) => [x.zvuk, x]));
    for (const [zvuk, z] of this.zvuky) {
      if (chci.has(zvuk)) continue;
      clearTimeout(z.casovac);
      this.zvuky.delete(zvuk);
    }
    for (const [zvuk, x] of chci) {
      const klic = JSON.stringify([x.kazdych_s, x.nahodilost, x.soubory.map((f) => f.url)]);
      const jiz = this.zvuky.get(zvuk);
      if (jiz) {
        jiz.x = x; // hlasitost a vzdálenost platí od dalšího zaznění
        if (jiz.klic === klic) continue;
        clearTimeout(jiz.casovac);
      }
      const z = { x, klic, casovac: null, posledni: jiz?.posledni ?? null };
      this.zvuky.set(zvuk, z);
      // První zaznění ne hned po přepnutí scény: někde mezi třetinou a celým odstupem.
      this.naplanovat(z, Math.max(1500, x.kazdych_s * 1000 * (0.33 + Math.random() * 0.67)));
    }
  }

  naplanovat(z, ms) {
    z.casovac = setTimeout(() => {
      if (this.zvuky.get(z.x.zvuk) !== z) return;
      this.zahrat(z);
      this.naplanovat(z, NahodneZvuky.odstupMs(z.x));
    }, ms);
  }

  zahrat(z) {
    if (!this.p.odemceno) return;
    const { soubory, hlasitost, vzdalenost } = z.x;
    const moznosti = soubory.length > 1 ? soubory.filter((f) => f.url !== z.posledni) : soubory;
    const f = moznosti[Math.floor(Math.random() * moznosti.length)];
    if (!f) return;
    z.posledni = f.url;
    // Vzdálený zvuk je v prostoru víc „rozlitý“, blízký může přijít víc ze strany.
    const pan = (Math.random() * 2 - 1) * (0.7 - 0.3 * (vzdalenost ?? 0));
    this.p.efekt({ url: f.url, hlasitost, obmena: true, vzdalenost, pan, zisk: f.zisk ?? 1, zacatek: f.zacatek ?? 0 }, this.cil).catch((e) => this.p.zaznamenatChybu(`Náhodný zvuk ${f.soubor} nehraje: ${e.message ?? e}`));
  }

  zastavit() {
    this.nastavit([]);
  }
}

/**
 * Dozvuk místa (bod 85): ozvěna prostoru spočítaná přímo v prohlížeči (konvoluce s uměle
 * vytvořenou odezvou místnosti, bez souborů). Přímý zvuk zůstává, přidá se jen „ocas“ prostoru.
 */
export class Dozvuk {
  /** délka dozvuku (s), jak rychle doznívá, podíl dozvuku, tmavost (0 = jasný, 1 = tmavý) a předzpoždění (s) */
  static PROSTORY = Object.freeze({
    zadny: null,
    mistnost: { delka: 0.7, pokles: 3.5, mokry: 0.18, tmavost: 0.3, pred: 0.008 },
    kobka: { delka: 1.3, pokles: 2.8, mokry: 0.26, tmavost: 0.45, pred: 0.012 },
    sal: { delka: 2.4, pokles: 2.4, mokry: 0.3, tmavost: 0.35, pred: 0.025 },
    jeskyne: { delka: 3.8, pokles: 2, mokry: 0.38, tmavost: 0.65, pred: 0.035 },
  });

  static odezvy = new Map();

  /** Umělá odezva prostoru: stereo šum, který exponenciálně doznívá; tmavé prostory ztratí výšky. */
  static odezva(ctx, nazev) {
    const klic = `${nazev}@${ctx.sampleRate}`;
    if (Dozvuk.odezvy.has(klic)) return Dozvuk.odezvy.get(klic);
    const p = Dozvuk.PROSTORY[nazev];
    const delka = Math.ceil(p.delka * ctx.sampleRate);
    const pred = Math.floor(p.pred * ctx.sampleRate);
    const buffer = ctx.createBuffer(2, delka, ctx.sampleRate);
    for (let k = 0; k < 2; k++) {
      const d = buffer.getChannelData(k);
      let hladky = 0;
      for (let i = pred; i < delka; i++) {
        const t = (i - pred) / (delka - pred);
        const sum = Math.random() * 2 - 1;
        // Jednopólová dolní propust: čím dál v čase, tím tmavší (vzduch a kámen pohltí výšky).
        const a = Math.min(0.97, p.tmavost * (0.5 + t));
        hladky = a * hladky + (1 - a) * sum;
        d[i] = hladky * Math.pow(1 - t, p.pokles);
      }
    }
    Dozvuk.odezvy.set(klic, buffer);
    return buffer;
  }

  constructor(ctx) {
    this.ctx = ctx;
    this.vstup = ctx.createGain();
    this.vystup = ctx.createGain();
    this.konvoluce = ctx.createConvolver();
    this.mokry = ctx.createGain();
    this.mokry.gain.value = 0;
    this.vstup.connect(this.vystup); // přímý zvuk
    this.vstup.connect(this.konvoluce).connect(this.mokry).connect(this.vystup);
    this.prostor = 'zadny';
    this.casovac = null;
  }

  /**
   * Prostor hned, bez prolnutí: pro jednorázový zvuk, který má zaznít rovnou v dozvuku (úder konce
   * souboje). `sila` násobí podíl dozvuku (dramatický úder chce víc ozvěny než soundboard).
   */
  nastavitHned(nazev, sila = 1) {
    const p = Dozvuk.PROSTORY[nazev];
    this.prostor = p ? nazev : 'zadny';
    clearTimeout(this.casovac);
    const t = this.ctx.currentTime;
    this.mokry.gain.cancelScheduledValues(t);
    if (!p) {
      this.mokry.gain.setValueAtTime(0, t);
      return;
    }
    this.konvoluce.buffer = Dozvuk.odezva(this.ctx, nazev);
    this.mokry.gain.setValueAtTime(Math.min(0.7, p.mokry * sila), t);
  }

  /** Plynule přepne prostor: dozvuk starého doběhne, nový naběhne. */
  nastavit(nazev) {
    const prostor = Dozvuk.PROSTORY[nazev] !== undefined ? nazev : 'zadny';
    if (prostor === this.prostor) return;
    this.prostor = prostor;
    const t = this.ctx.currentTime;
    const g = this.mokry.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + 0.6);
    clearTimeout(this.casovac);
    const p = Dozvuk.PROSTORY[prostor];
    if (!p) return;
    this.casovac = setTimeout(() => {
      this.konvoluce.buffer = Dozvuk.odezva(this.ctx, prostor);
      const t2 = this.ctx.currentTime;
      g.cancelScheduledValues(t2);
      g.setValueAtTime(0, t2);
      g.linearRampToValueAtTime(p.mokry, t2 + 1.2);
    }, 650);
  }
}

/**
 * Ucpané uši (málo HP, bod 73): dvě dolní propusti za sebou (strmý ořez výšek), mírně
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
  constructor({ stranka, priZmene, priEfektu, priPovelu }) {
    this.stranka = stranka;
    this.ctx = new AudioContext({ latencyHint: 'playback' });
    this.chyba = null;
    this.vystup = null; // {nazev, ok, vybrany} u stolu
    this.kabel = null; // {ok, nazev, ticho, chyba} virtuální kabel se Spotify (jen u stolu)
    this.buffery = new Map();
    this.priZmene = priZmene;
    this.priEfektu = priEfektu;
    this.priPovelu = priPovelu; // ovládání hudby z lišty panelu (další skladba)
    this.skladba = null; // skladba playlistu, která právě hraje (hlásí se Hubu)
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
  async efekt({ url, hlasitost = 1, filtr = null, obmena = false, vzdalenost = 0, pan = 0, zisk = 1, zacatek = 0, maxS = null }, cil) {
    let buffer = this.buffery.get(url);
    if (!buffer) {
      const data = await (await fetch(url)).arrayBuffer();
      buffer = await this.ctx.decodeAudioData(data);
      if (this.buffery.size > MAX_BUFFERU) this.buffery.delete(this.buffery.keys().next().value);
      this.buffery.set(url, buffer);
    }
    const zdroj = this.ctx.createBufferSource();
    zdroj.buffer = buffer;
    const g = this.ctx.createGain();
    const h = hlasitost * zisk;
    g.gain.value = obmena ? h * (0.85 + Math.random() * 0.15) : h;
    if (obmena) zdroj.playbackRate.value = 0.95 + Math.random() * 0.1;
    let uzel = zdroj;
    if (filtr === 'daleko') {
      // Vzdálený hrom duní: dolní propust uřízne praskání.
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 700;
      uzel = uzel.connect(f);
    }
    if (vzdalenost > 0) {
      // Náhodný zvuk z dálky (bod 85): tišší a tupější.
      const { hz, zisk } = Vzdalenost.parametry(vzdalenost);
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = hz;
      f.Q.value = 0.5;
      uzel = uzel.connect(f);
      g.gain.value *= zisk;
    }
    if (pan && this.ctx.createStereoPanner) {
      const s = this.ctx.createStereoPanner();
      s.pan.value = Math.max(-1, Math.min(1, pan));
      uzel = uzel.connect(s);
    }
    uzel.connect(g).connect(cil);
    // Ticho na začátku souboru se přeskočí (změřené, bod 86); dlouhý zvuk se po maxS ztlumí.
    const od = Math.min(Math.max(0, zacatek), Math.max(0, buffer.duration - 0.05));
    zdroj.start(0, od);
    let delka = (buffer.duration - od) / zdroj.playbackRate.value;
    if (maxS && delka > maxS) {
      const t = this.ctx.currentTime;
      g.gain.setValueAtTime(g.gain.value, t + maxS - 0.3);
      g.gain.linearRampToValueAtTime(0, t + maxS);
      zdroj.stop(t + maxS + 0.05);
      delka = maxS;
    }
    return delka;
  }

  /**
   * Načte a dekóduje zvuky předem (zvuky tahů během souboje): první přehrání pak nečeká na síť
   * ani dekódování. Načítá postupně, ať nezdrží hraní.
   */
  async predNacist(urls = []) {
    for (const url of urls) {
      if (this.buffery.has(url)) continue;
      try {
        const data = await (await fetch(url)).arrayBuffer();
        if (!this.buffery.has(url)) this.buffery.set(url, await this.ctx.decodeAudioData(data));
      } catch {
        /* chybu ohlásí až skutečné přehrání */
      }
    }
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
      body: JSON.stringify({ stranka: this.stranka, odemceno: this.odemceno, hraje: this.hraje(), chyba: this.chyba, vystup: this.vystup, ...(this.kabel ? { kabel: this.kabel } : {}), ...(this.skladba ? { skladba: this.skladba } : {}) }),
    }).catch(() => {});
  }

  spustit() {
    const nacist = () =>
      fetch('/api/zvuk?pro=stranka')
        .then((r) => r.json())
        .then((s) => this.priZmene(s))
        .catch(() => {});
    nacist();
    odebirat(['zvuk', 'zvuk-efekt', 'zvuk-povel'], (udalost, data) => {
      if (udalost === 'zvuk') this.priZmene(data);
      else if (udalost === 'zvuk-povel') this.priPovelu?.(data);
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
