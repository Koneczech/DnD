# Zkouška Hubu v cloudu (GitHub Codespaces)

Hub jde vyzkoušet mimo domov jen v prohlížeči, bez instalace. GitHub ho spustí ve svém virtuálním počítači (Codespace) a panel otevřeš přes adresu, kterou GitHub přidělí. Nahoře v panelu svítí štítek **Zkouška**.

## Spuštění

1. Na [github.com/Koneczech/DnD](https://github.com/Koneczech/DnD) zelené tlačítko **Code** → záložka **Codespaces** → **Create codespace on main**. Příště už jen otevřeš existující Codespace na [github.com/codespaces](https://github.com/codespaces).
2. Otevře se editor v prohlížeči. Poprvé se pár minut instaluje, pak v terminálu dole naběhne „DM Hub běží“.
3. Panel se otevře v nové záložce. Když ne (prohlížeč zablokoval vyskakovací okno): dole záložka **Ports** → řádek **DM Hub (7420)** → ikona zeměkoule (Open in Browser).

Editor můžeš nechat být. Soubory v něm needituj, panel stačí.

## Co jde a co ne

| Funguje | Nefunguje |
| --- | --- |
| Sezení, Kalendář, Další den, Obchody, Místa, ilustrační dílna | Světla Hue a WiZ |
| Kánon: wiki, editor, mapa, Pohled družiny, hledání | OBS a přepínání scén |
| Výstupy v prohlížeči, např. `/vystupy/misto.html` nebo `/vystupy/uder.html?zkouska` | Zvuk (zvukové soubory jsou jen doma) |
| Improved Initiative v záložce Souboj (bez přihlášení k Epicu) | Uložení na GitHub |

Kontrolky Světla, OBS a Zvuk budou červené. To je v pořádku. Nastavení vyplňovat nemusíš.

## Data

- Změny, které uděláš (datum, poznámky, karty kánonu), zůstanou **jen v tomhle Codespace**. Na GitHub se nikdy neodešlou a domácí Hub je neuvidí.
- **Aktualizovat** jen stáhne novinky z GitHubu (novou verzi Hubu i data z domova). Tvoje zkušební změny při tom zůstanou.
- Začít načisto: na [github.com/codespaces](https://github.com/codespaces) u Codespace **…** → **Delete** a založ nový.

## Kolik to stojí

Osobní účet GitHub má měsíčně zdarma 120 core hodin, na nejmenším stroji (2 jádra) asi 60 hodin běhu. Codespace se po 30 minutách nečinnosti zastaví sám; zastavený čas nespotřebovává. Ručně ho zastavíš na [github.com/codespaces](https://github.com/codespaces) → **…** → **Stop codespace**.

## Bezpečnost

Port DM Hub nech **soukromý** (Private, výchozí stav). Otevře ho jen přihlášený majitel Codespace. Veřejný port (Public) by otevřel panel komukoli s odkazem.

## Když to nejde

- Panel hlásí „Přístup jen z tohoto počítače“: pošli Claudovi adresu panelu z prohlížeče (adresu, ne obsah stránky).
- Stránka se nenačte vůbec: pracovní síť nejspíš blokuje adresy `github.dev` a `app.github.dev`.
