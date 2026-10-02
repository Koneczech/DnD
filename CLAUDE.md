# CLAUDE.md — pravidla pro práci v tomto repu

Repo `Koneczech/DnD` drží data kampaně D&D a aplikaci DM Hub. Zadání je v `ZADANI.md` a je to jediný master. Tento soubor říká, jak se v repu pracuje.

## Jazyk

- S DM komunikuj česky. Texty v panelu, výstupech, hláškách a dokumentaci jsou česky.
- Identifikátory v kódu mohou být česky bez diakritiky (`stav`, `zapsat`) nebo anglicky; v rámci jednoho modulu drž jednu volbu.
- Herní termíny podle českého PHB 2024 a `reference/prekladovy-klic-cz.md` (důkladný odpočinek, kostky obnovy, body výdrže).
- Nepiš česky „překladovým“ slovosledem.

## Rozhodování

- Co je v `ZADANI.md` mezi potvrzenými rozhodnutími, je hotové. Neotvírej to znovu.
- Co zadání neřeší a má vliv na **data, chování nebo UI**, rozhodni rozumně, v popisu PR to označ jako **⚠ návrh** a přidej do Otevřených bodů v `ZADANI.md`.
- Interní detaily kódu (názvy funkcí, struktura testů, pomocné moduly) rozhoduj sám.
- Nedoplňuj herní obsah (jména, události, vazby, statistiky), který DM nepotvrdil.

## Repo je veřejné

- `hub/.env` se nikdy necommituje. Tajné hodnoty (heslo OBS, PIN, API klíče) patří jen tam.
- Nikdy nepřidávej klíče, hesla ani tokeny do kódu, testů ani dokumentace. V testech používej zjevně falešné hodnoty generované za běhu.
- Pre-commit hook (`hub/hooks/pre-commit.js`) odmítne `.env` a řetězce podobné klíčům. Nevypínej ho (`--no-verify`).

## Zmrazené soubory

- `monsters/` je zmrazená: Improved Initiative z ní čte ilustrace přes URL. Nic nepřesouvej, nepřejmenovávej ani nepřidávej.
- Portréty `Alba.png`, `Koudur.png`, `Leta.png`, `Tusker.png` v kořeni a `Places/Mirabar/` zůstávají na místě, dokud je nepřesune blok uvedený v `ZADANI.md` (Migrace existujících dat).
- Přesun existujícího souboru = jeden commit, který zároveň opraví všechny odkazy.

## Cílová platforma

- Hub běží na **Windows 11**, OBS na stejném PC. Vývoj a CI probíhá i na Linuxu.
- Cesty skládej přes `node:path`, nikdy ručně přes `/` nebo `\`.
- Zápis souborů jen přes `hub/server/zapis.js` (atomický zápis s opakováním při zámku). Nikdy nezapisuj soubory dat napřímo přes `fs.writeFile`.
- Konce řádků jsou LF (`.gitattributes`). Shell skripty musí mít LF.
- Verze Node.js je v `.nvmrc`; `engines` v `hub/package.json` musí sedět.

## Testy

```sh
cd hub
npm ci
npm test            # všechny testy (node:test)
npm run check:node  # shoda .nvmrc a engines
```

Testy běží v GitHub Actions na `ubuntu-latest` i `windows-latest`. Test zámku souboru se na Windows zamyká přes PowerShell (bez sdílení), na Linuxu se přeskočí.

## Větve a PR

- Každý blok má vlastní větev (`blok-0`, `blok-1a` …). Do `main` se nic necommituje přímo.
- Slučuje se přes pull request. Popis PR obsahuje: co blok přinesl, jak ho ověřit doma, a seznam **⚠ návrhů**.
