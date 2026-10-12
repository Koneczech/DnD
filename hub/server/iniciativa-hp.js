// Světla podle HP (otevřený bod 72): během souboje Hub čte stav Player View z Improved Initiative
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

/** ID setkání z odkazu na Player View (…/p/<id>). */
export function idSetkani(odkaz) {
  const m = String(odkaz ?? '').match(/\/p\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

/** Události: 'zmena' ({jmeno, hp, max} nebo null). */
export class SledovaniHp extends EventEmitter {
  constructor({ odkaz, aktivni, intervalMs = 1500, nacist }) {
    super();
    this.odkaz = odkaz; // () => odkaz na Player View
    this.aktivni = aktivni; // () => běží souboj a světla podle HP jsou zapnutá
    this.intervalMs = intervalMs;
    this.nacist = nacist ?? nacistPlayerView;
    this.stav = null;
    this.casovac = null;
    this.bezi = false;
  }

  spustit() {
    this.casovac = setInterval(() => this.krok().catch(() => {}), this.intervalMs);
    this.casovac.unref?.();
  }

  zastavit() {
    clearInterval(this.casovac);
  }

  async krok() {
    if (this.bezi) return;
    this.bezi = true;
    try {
      const id = idSetkani(this.odkaz());
      const novy = this.aktivni() && id ? kritickaPostava(await this.nacist(id)) : null;
      const klic = (x) => (x ? `${x.jmeno}:${x.hp}/${x.max}` : '');
      if (klic(novy) !== klic(this.stav)) {
        this.stav = novy;
        this.emit('zmena', novy);
      }
    } finally {
      this.bezi = false;
    }
  }
}

/** Stav Player View (veřejný, bez přihlášení). Čte ho i animace zásahu (iniciativa-cteni.js). */
export function nacistPlayerView(id) {
  return new Promise((ok, chyba) => {
    const r = https.get({ host: 'improvedinitiative.app', path: `/playerviews/${encodeURIComponent(id)}`, headers: { accept: 'application/json' } }, (odpoved) => {
      if (odpoved.statusCode !== 200) {
        odpoved.resume();
        return chyba(new Error(`Player View odpověděl ${odpoved.statusCode}`));
      }
      const casti = [];
      odpoved.on('data', (c) => casti.push(c));
      odpoved.on('end', () => {
        try {
          ok(JSON.parse(Buffer.concat(casti).toString('utf8')));
        } catch (e) {
          chyba(e);
        }
      });
    });
    r.setTimeout(5000, () => r.destroy(new Error('čas vypršel')));
    r.on('error', chyba);
  });
}
