// Světla podle HP (bod 72): během souboje Hub čte stav Player View z Improved Initiative
// (veřejný, stejný jako na TV). Když je na tahu postava hráče s 25 % HP a méně, ohlásí to světlům.
import https from 'node:https';
import { EventEmitter } from 'node:events';

export const PRAH_HP = 0.25;

/** „16/24“ nebo „3+5/24“ (dočasné HP se počítají jako polštář) → { hp, max }, jinak null. */
export function rozebratHp(text) {
  const m = String(text ?? '').trim().match(/^(-?\d+)(?:\+(\d+))?\/(\d+)$/);
  if (!m) return null;
  const max = Number(m[3]);
  if (!max) return null;
  return { hp: Number(m[1]) + Number(m[2] ?? 0), max };
}

/** Postava hráče na tahu s málo HP, nebo null. Netvory Player View ukazuje slovně, ty se nepočítají. */
export function kritickaPostava(stav, prah = PRAH_HP) {
  const s = stav?.encounterState ?? stav;
  const naTahu = (s?.Combatants ?? []).find((c) => c.Id === s?.ActiveCombatantId);
  if (!naTahu?.IsPlayerCharacter) return null;
  const hp = rozebratHp(naTahu.HPDisplay);
  if (!hp || hp.hp / hp.max > prah) return null;
  return { jmeno: naTahu.Name, hp: hp.hp, max: hp.max };
}

/** Kdo je na tahu: {id, jmeno, hrac, tagy}, nebo null. Tagy jsou jen ty, které Player View ukazuje hráčům. */
export function naTahu(stav) {
  const s = stav?.encounterState ?? stav;
  const c = (s?.Combatants ?? []).find((x) => x.Id === s?.ActiveCombatantId);
  if (!c) return null;
  const tagy = (Array.isArray(c.Tags) ? c.Tags : [])
    .map((t) => (typeof t === 'string' ? t : t?.Text))
    .filter((t) => typeof t === 'string' && t.trim())
    .map((t) => t.trim().slice(0, 60));
  return { id: String(c.Id), jmeno: String(c.Name ?? ''), hrac: c.IsPlayerCharacter === true, tagy };
}

/** ID setkání z odkazu na Player View (…/p/<id>). */
export function idSetkani(odkaz) {
  const m = String(odkaz ?? '').match(/\/p\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

/**
 * Události: 'zmena' ({jmeno, hp, max} nebo null) pro málo HP, 'tah' ({id, jmeno, hrac, tagy}) při změně
 * postavy na tahu (zvuky na tahu, bod 76), 'chyba' (text nebo null) pro záznam událostí.
 */
export class SledovaniHp extends EventEmitter {
  constructor({ odkaz, aktivni, hlidatHp = () => true, intervalMs = 1000, nacist }) {
    super();
    this.odkaz = odkaz; // () => odkaz na Player View
    this.aktivni = aktivni; // () => běží souboj
    this.hlidatHp = hlidatHp; // () => světla podle HP jsou zapnutá
    this.naTahu = null; // ID bytosti na tahu
    this.intervalMs = intervalMs;
    this.nacist = nacist ?? nacistPlayerView;
    this.stav = null;
    this.casovac = null;
    this.bezi = false;
    this.chyba = null;
  }

  spustit() {
    this.casovac = setInterval(() => this.krok().catch(() => {}), this.intervalMs);
    this.casovac.unref?.();
  }

  zastavit() {
    clearInterval(this.casovac);
  }

  /**
   * Konec souboje: zapomene, kdo byl na tahu, a ohlásí konec málo HP hned, bez čekání na další krok.
   * Pojistka pro případ, že by krok mimo souboj konec neohlásil (24. 10. 2026 zůstala lampa pulzovat).
   */
  vynulovat() {
    this.naTahu = null;
    if (!this.stav) return;
    this.stav = null;
    this.emit('zmena', null);
  }

  nastavitChybu(text) {
    if (text === this.chyba) return;
    this.chyba = text;
    this.emit('chyba', text);
  }

  /**
   * Jeden krok: přečte poslední stav a ohlásí změnu tahu a málo HP. Volá ho časovač i každý nový stav
   * Player View (iniciativa-cteni.js), takže změna tahu nečeká na další tik. Když krok zrovna běží,
   * proběhne po něm ještě jednou: nový stav se tak nikdy neztratí.
   */
  async krok() {
    if (this.bezi) {
      this.znovu = true;
      return;
    }
    this.bezi = true;
    try {
      const id = idSetkani(this.odkaz());
      const stav = this.aktivni() && id ? await this.nacist(id) : null;
      const kdo = stav ? naTahu(stav) : null;
      if ((kdo?.id ?? null) !== this.naTahu) {
        this.naTahu = kdo?.id ?? null;
        if (kdo) this.emit('tah', kdo);
      }
      const novy = stav && this.hlidatHp() ? kritickaPostava(stav) : null;
      const klic = (x) => (x ? `${x.jmeno}:${x.hp}/${x.max}` : '');
      if (klic(novy) !== klic(this.stav)) {
        this.stav = novy;
        this.emit('zmena', novy);
      }
      this.nastavitChybu(null);
    } catch (e) {
      // Chyba v kroku (třeba u posluchače) se dřív ztratila beze stopy; teď ji uvidí záznam událostí.
      this.nastavitChybu(`Sledování tahu: ${e?.message ?? e}`);
    } finally {
      this.bezi = false;
    }
    if (this.znovu) {
      this.znovu = false;
      await this.krok();
    }
  }
}

/** Stav Player View (veřejný, bez přihlášení). Čte ho i animace zásahu (iniciativa-cteni.js). */
export function nacistPlayerView(id) {
  return new Promise((ok, chyba) => {
    let hotovo = false;
    const konec = (fn, x) => {
      if (hotovo) return;
      hotovo = true;
      clearTimeout(pojistka);
      fn(x);
    };
    // Pojistka: spojení přerušené uprostřed odpovědi nemusí vyvolat ani 'end', ani 'error'.
    // Bez ní by čekání nikdy neskončilo a čtení Player View by se zastavilo do restartu Hubu.
    const pojistka = setTimeout(() => {
      r.destroy();
      konec(chyba, new Error('čas vypršel'));
    }, 6000);
    const r = https.get({ host: 'improvedinitiative.app', path: `/playerviews/${encodeURIComponent(id)}`, headers: { accept: 'application/json' } }, (odpoved) => {
      if (odpoved.statusCode !== 200) {
        odpoved.resume();
        return konec(chyba, new Error(`Player View odpověděl ${odpoved.statusCode}`));
      }
      const casti = [];
      odpoved.on('data', (c) => casti.push(c));
      odpoved.on('error', (e) => konec(chyba, e));
      odpoved.on('aborted', () => konec(chyba, new Error('spojení přerušeno')));
      odpoved.on('close', () => konec(chyba, new Error('spojení se zavřelo')));
      odpoved.on('end', () => {
        try {
          konec(ok, JSON.parse(Buffer.concat(casti).toString('utf8')));
        } catch (e) {
          konec(chyba, e);
        }
      });
    });
    r.setTimeout(5000, () => r.destroy(new Error('čas vypršel')));
    r.on('error', (e) => konec(chyba, e));
  });
}
