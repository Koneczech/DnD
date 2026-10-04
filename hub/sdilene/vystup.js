// Společné pro výstupy v OBS: odběr živých změn z Hubu a prolínání obrázků bez černého snímku.
import { odebirat } from './zive.js';

/**
 * První data z `url`, pak živé změny události `udalost` (WebSocket, jen tahle událost).
 * Při výpadku Hubu drží poslední stav a sám se znovu připojí; po znovupřipojení si stav načte celý.
 */
export function sledovat(udalost, url, priZmene) {
  const nacist = () => fetch(url).then((r) => r.json()).then(priZmene).catch(() => {});
  nacist();
  odebirat([udalost], (_, data) => priZmene(data), {
    priStavu: (pripojeno, poVypadku) => {
      if (pripojeno && poVypadku) nacist();
    },
  });
}

/** Načte a dekóduje obrázek předem, aby prolnutí nezačalo prázdnou plochou. */
export function predNacist(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => resolve(img));
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Dvě vrstvy nad sebou: nový obrázek se načte, pak se plynule prolne přes starý.
 * Starý zůstává pod ním celý čas prolnutí, takže nevznikne černý snímek.
 */
export class Prolinac {
  constructor(kontejner, { trvaniMs = 1000 } = {}) {
    this.trvaniMs = trvaniMs;
    this.vrstvy = [0, 1].map(() => {
      const v = document.createElement('div');
      v.className = 'vrstva';
      v.style.transition = `opacity ${trvaniMs}ms ease-in-out`;
      kontejner.append(v);
      return v;
    });
    this.horni = 0;
    this.priChybe = null;
    this.url = null;
    this.cislo = 0;
  }

  async ukazat(url) {
    if (url === this.url) return;
    const cislo = ++this.cislo;
    this.url = url;
    if (url) {
      const img = await predNacist(url);
      if (cislo !== this.cislo) return;
      if (!img) {
        // Obrázek se nenačetl: zapomeň adresu, ať další zpráva zkusí načtení znovu.
        this.url = null;
        if (this.priChybe) this.priChybe(url);
        return;
      }
    }
    const nova = this.vrstvy[1 - this.horni];
    const stara = this.vrstvy[this.horni];
    const prvni = this.vrstvy.every((v) => !v.style.backgroundImage || v.style.backgroundImage === 'none');
    nova.style.backgroundImage = url ? `url("${url}")` : 'none';
    nova.style.zIndex = '2';
    stara.style.zIndex = '1';
    if (prvni) {
      // Úplně první obrázek ukaž hned, bez přechodu: nic pod ním není, takže se nemá z čeho prolínat.
      nova.style.transition = 'none';
      nova.style.opacity = '1';
      void nova.offsetWidth;
      nova.style.transition = `opacity ${this.trvaniMs}ms ease-in-out`;
    } else {
      nova.style.opacity = '0';
      void nova.offsetWidth;
      nova.style.opacity = '1';
    }
    this.horni = 1 - this.horni;
    // Po prolnutí starou vrstvu schovej, ať při dalším přechodu nezůstane vidět pod průhlednou novou.
    setTimeout(() => {
      if (cislo === this.cislo) stara.style.opacity = '0';
    }, this.trvaniMs + 50);
  }
}
