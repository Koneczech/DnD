// Zkušební režim: Hub v GitHub Codespaces, ovládaný z prohlížeče mimo domov.
//
// Zapíná ho proměnná DMHUB_ZKOUSKA=1 (nastavuje ji .devcontainer/devcontainer.json).
// V tomhle režimu Hub:
//  - pustí panel i přes adresu, kterou Codespaces přidělí přesměrovanému portu
//    (<codespace>-<port>.app.github.dev); jiný cizí Host dál odmítne (ochrana proti DNS rebinding),
//  - nic neukládá na GitHub: Aktualizovat jen stahuje novinky, Uložit a Sloučit odmítne,
//  - nespouští průchod k Improved Initiative (běží na vedlejším portu, který Codespaces nepřesměruje).
// Přístup k přesměrovanému portu hlídá GitHub: port je soukromý, otevře ho jen přihlášený majitel Codespace.

/**
 * @param {object} [env] proměnné prostředí
 * @param {number} [port] port, na kterém Hub poslouchá
 * @returns {{ zapnuto: boolean, hosty: Set<string> }}
 */
export function zkusebniRezim(env = process.env, port) {
  const zapnuto = env.DMHUB_ZKOUSKA === '1';
  const hosty = new Set();
  if (zapnuto && port) {
    const jmeno = env.CODESPACE_NAME;
    const domena = env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
    if (jmeno && domena) hosty.add(`${jmeno}-${port}.${domena}`.toLowerCase());
    // Ruční doplnění (jiné cloudové prostředí): seznam oddělený čárkami.
    for (const h of String(env.DMHUB_ZKOUSKA_HOSTY || '').split(',')) {
      if (h.trim()) hosty.add(h.trim().toLowerCase());
    }
  }
  return { zapnuto, hosty };
}

export const HLASKA_BEZ_ULOZENI =
  'Zkušební režim: na GitHub se odsud nic neukládá. Změny zůstanou jen v tomhle Codespace a domácí Hub je neuvidí.';
