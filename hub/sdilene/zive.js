// Živé změny z Hubu přes WebSocket (panel i výstupy v OBS).
//
// Proč ne SSE: OBS pouští všechny Browser Sources v jednom prohlížeči a ten drží na jeden
// server nejvýš 6 běžných spojení. Trvalá spojení SSE je vyčerpala a nové obrázky se pak
// nenačetly (audit K1). WebSocket se do tohoto limitu nepočítá.

// Chyby stránky (panel, výstupy v OBS) jdou do záznamu Hubu (bod 84): v OBS konzoli nikdo nevidí.
if (!globalThis.__dmhubChyby) {
  globalThis.__dmhubChyby = true;
  let pocet = 0;
  const nahlasit = (zprava) => {
    if (++pocet > 20) return; // zacyklená chyba nesmí zahltit záznam
    fetch('/api/zaznam', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zdroj: location.pathname.split('/').pop() || 'panel', zprava: String(zprava).slice(0, 400) }),
    }).catch(() => {});
  };
  addEventListener('error', (e) => nahlasit(`${e.message} (${(e.filename ?? '').split('/').pop()}:${e.lineno ?? ''})`));
  addEventListener('unhandledrejection', (e) => nahlasit(`Neošetřená chyba: ${e.reason?.message ?? e.reason}`));
}

/**
 * Odebírá události z Hubu. Při výpadku drží poslední stav a za 1 s se připojí znovu.
 * @param {string[]|null} udalosti jména událostí, null = všechny (panel)
 * @param {(udalost: string, data: unknown) => void} priZprave
 * @param {{priStavu?: (pripojeno: boolean, poVypadku: boolean) => void}} [volby]
 */
export function odebirat(udalosti, priZprave, { priStavu } = {}) {
  const dotaz = udalosti?.length ? `?udalosti=${udalosti.map(encodeURIComponent).join(',')}` : '';
  const adresa = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/zive${dotaz}`;
  let poVypadku = false;
  let casovac = null;
  let verze = null;

  function pripojit() {
    casovac = null;
    let spojeni;
    try {
      spojeni = new WebSocket(adresa);
    } catch {
      znovu();
      return;
    }
    spojeni.addEventListener('open', () => {
      priStavu?.(true, poVypadku);
    });
    spojeni.addEventListener('message', (e) => {
      let zprava;
      try {
        zprava = JSON.parse(e.data);
      } catch {
        return;
      }
      if (!zprava || typeof zprava.u !== 'string') return;
      if (zprava.u === 'verze') {
        // Hub po restartu běží s jiným kódem panelu a výstupů: načti stránku znovu, ať neběží stará verze.
        if (verze && zprava.d !== verze) location.reload();
        verze = zprava.d;
        return;
      }
      priZprave(zprava.u, zprava.d);
    });
    spojeni.addEventListener('close', () => {
      poVypadku = true;
      priStavu?.(false, true);
      znovu();
    });
  }

  function znovu() {
    if (!casovac) casovac = setTimeout(pripojit, 1000);
  }

  pripojit();
}
