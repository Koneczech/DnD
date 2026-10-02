// Spojení s OBS přes vestavěný WebSocket (OBS 28+). Scény se přepínají z panelu,
// numpad v OBS funguje dál paralelně.
import { EventEmitter } from 'node:events';
import OBSWebSocket from 'obs-websocket-js';

/** Nastavení Browser Source, která musí být vypnutá, aby výstup přežil výpadek Hubu. */
export const RIZIKOVA_NASTAVENI = Object.freeze({
  shutdown: 'Shutdown source when not visible',
  restart_when_active: 'Refresh browser when scene becomes active',
});

/**
 * Události: 'stav' (veřejný stav spojení a scén)
 */
export class Obs extends EventEmitter {
  constructor({ klient = new OBSWebSocket(), intervalPripojeniMs = 5000 } = {}) {
    super();
    this.klient = klient;
    this.intervalPripojeniMs = intervalPripojeniMs;
    this.url = null;
    this.heslo = null;
    this.pripojeno = false;
    this.chyba = null;
    this.sceny = [];
    this.aktualniScena = null;
    this.varovaniZdroju = [];
    this.casovac = null;
    this.ukonceno = false;

    this.klient.on('ConnectionClosed', (e) => {
      const bylo = this.pripojeno;
      this.pripojeno = false;
      if (e?.code === 4009) this.chyba = 'OBS odmítl heslo. Zkontroluj ho v Nastavení.';
      else if (bylo) this.chyba = 'Spojení s OBS se přerušilo.';
      this.oznam();
      this.naplanovat();
    });
    this.klient.on('CurrentProgramSceneChanged', ({ sceneName }) => {
      this.aktualniScena = sceneName;
      this.oznam();
    });
    this.klient.on('SceneListChanged', ({ scenes }) => {
      this.sceny = Obs.seradit(scenes);
      this.oznam();
    });
    this.klient.on('InputCreated', () => this.zkontrolovatZdroje().catch(() => {}));
    this.klient.on('InputSettingsChanged', () => this.zkontrolovatZdroje().catch(() => {}));
  }

  /** OBS vrací scény odspodu; panel je chce ve stejném pořadí jako seznam v OBS. */
  static seradit(scenes = []) {
    return [...scenes].sort((a, b) => b.sceneIndex - a.sceneIndex).map((s) => s.sceneName);
  }

  verejnyStav() {
    return {
      nastaveno: Boolean(this.url),
      pripojeno: this.pripojeno,
      chyba: this.chyba,
      sceny: this.sceny,
      aktualniScena: this.aktualniScena,
      varovaniZdroju: this.varovaniZdroju,
    };
  }

  oznam() {
    this.emit('stav', this.verejnyStav());
  }

  /** Nastaví adresu a heslo a (znovu) se připojí. */
  async nastavit(url, heslo) {
    this.url = url;
    this.heslo = heslo || undefined;
    clearTimeout(this.casovac);
    if (this.pripojeno) await this.klient.disconnect().catch(() => {});
    return this.pripojit();
  }

  async pripojit() {
    if (!this.url || this.ukonceno) return false;
    try {
      await this.klient.connect(this.url, this.heslo, { rpcVersion: 1 });
      this.pripojeno = true;
      this.chyba = null;
      const { scenes, currentProgramSceneName } = await this.klient.call('GetSceneList');
      this.sceny = Obs.seradit(scenes);
      this.aktualniScena = currentProgramSceneName;
      await this.zkontrolovatZdroje().catch(() => {});
      this.oznam();
      return true;
    } catch (e) {
      this.pripojeno = false;
      if (!this.chyba || !/heslo/.test(this.chyba)) {
        this.chyba = /authentic/i.test(String(e?.message))
          ? 'OBS odmítl heslo. Zkontroluj ho v Nastavení.'
          : 'OBS neodpovídá. Běží OBS a je v něm zapnutý WebSocket server?';
      }
      this.oznam();
      this.naplanovat();
      return false;
    }
  }

  naplanovat() {
    if (this.ukonceno || !this.url) return;
    clearTimeout(this.casovac);
    this.casovac = setTimeout(() => this.pripojit(), this.intervalPripojeniMs);
    this.casovac.unref?.();
  }

  async prepnoutScenu(nazev) {
    if (!this.pripojeno) throw Object.assign(new Error('OBS není připojené'), { status: 503 });
    if (!this.sceny.includes(nazev)) throw Object.assign(new Error(`Scéna „${nazev}“ v OBS neexistuje`), { status: 404 });
    await this.klient.call('SetCurrentProgramScene', { sceneName: nazev });
    this.aktualniScena = nazev;
    this.oznam();
  }

  /**
   * Ověří, že Browser Sources mají vypnuté Shutdown source when not visible
   * a Refresh browser when scene becomes active (Provoz a odolnost v ZADANI.md).
   */
  async zkontrolovatZdroje() {
    if (!this.pripojeno) return;
    const { inputs } = await this.klient.call('GetInputList', { inputKind: 'browser_source' });
    const varovani = [];
    for (const vstup of inputs) {
      const { inputSettings } = await this.klient.call('GetInputSettings', { inputName: vstup.inputName });
      const zapnuto = Object.keys(RIZIKOVA_NASTAVENI).filter((k) => inputSettings?.[k] === true);
      if (zapnuto.length) varovani.push({ zdroj: vstup.inputName, nastaveni: zapnuto.map((k) => RIZIKOVA_NASTAVENI[k]) });
    }
    this.varovaniZdroju = varovani;
    this.oznam();
  }

  async ukoncit() {
    this.ukonceno = true;
    clearTimeout(this.casovac);
    await this.klient.disconnect().catch(() => {});
  }
}
