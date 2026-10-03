// Další den (Blok 1b): posune datum, ukáže dnešní události a připomínky podle odpočinku,
// zapíše „Nový den: <datum>“ do sezení. Nic nesleduje (rozhodnutí 11).
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { Harptos, udalostiDne, aktivniLhuty } from '../sdilene/harptos.js';

export const KDY = Object.freeze(['dukladny', 'bez', 'vzdy']);

export async function nacistPripominky(soubor) {
  try {
    const d = YAML.parse(await fs.readFile(soubor, 'utf8'));
    const seznam = Array.isArray(d?.pripominky) ? d.pripominky : [];
    return {
      pripominky: seznam
        .filter((p) => p && KDY.includes(p.kdy) && p.text)
        .map((p) => ({ kdy: p.kdy, kdo: String(p.kdo ?? ''), text: String(p.text) })),
      chyba: null,
    };
  } catch (e) {
    return { pripominky: [], chyba: e.code === 'ENOENT' ? 'Soubor kampan/pripominky.yaml chybí.' : `pripominky.yaml nejde přečíst: ${e.message.split('\n')[0]}` };
  }
}

/** Připomínky pro danou odpověď na otázku po důkladném odpočinku. */
export function vybratPripominky(pripominky, dukladny) {
  return pripominky.filter((p) => p.kdy === 'vzdy' || p.kdy === (dukladny ? 'dukladny' : 'bez'));
}

/** Co se dnes děje: svátek, události (i skryté, panel je jen pro DM) a lhůty. */
export function prehledDne(dnes, udalosti) {
  return {
    dnes,
    dnesText: Harptos.format(dnes),
    svatek: dnes.svatek ?? null,
    udalosti: udalostiDne(dnes, udalosti, { jenVerejne: false }).map((x) => ({
      id: x.u.id,
      text: x.u.text,
      verejna: x.u.verejna,
      den: x.den,
      celkem: x.celkem,
    })),
    lhuty: aktivniLhuty(dnes, udalosti).map((x) => ({ id: x.u.id, text: x.u.text, zbyva: x.zbyva })),
  };
}

export class DalsiDen {
  constructor({ cesty, kalendar, sezeni }) {
    this.soubor = path.join(cesty.kampan, 'pripominky.yaml');
    this.kalendar = kalendar;
    this.sezeni = sezeni;
  }

  /** Náhled před potvrzením: na jaké datum se posune a co ten den čeká (krok 1). */
  nahled() {
    const dnes = this.kalendar.dnes();
    const zitra = dnes ? Harptos.posun(dnes, 1) : null;
    return { dnes, zitra, den: zitra ? prehledDne(zitra, this.kalendar.udalosti) : null };
  }

  async provest({ dukladny }) {
    const { dnes, vysledek } = await this.kalendar.posunout(1);
    const { pripominky, chyba } = await nacistPripominky(this.soubor);
    const text = `Nový den: ${Harptos.format(dnes)}${dukladny ? ' (po důkladném odpočinku)' : ' (bez důkladného odpočinku)'}`;
    const poznamka = await this.sezeni.poznamka(text);
    return {
      ...prehledDne(dnes, this.kalendar.udalosti),
      dukladny: Boolean(dukladny),
      pripominky: vybratPripominky(pripominky, Boolean(dukladny)),
      chybaPripominek: chyba,
      poznamka: poznamka.soubor,
      vysledek,
    };
  }
}
