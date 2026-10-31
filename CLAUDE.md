# CLAUDE.md — pravidla pro práci v tomto repu

Repo `Koneczech/DnD` drží data kampaně D&D a aplikaci DM Hub. Zadání je v `ZADANI.md` a je to jediný master. Stav funkcí (co umí, co je rozdělané, co vynecháno) je v `PREHLED.md`: po každé změně funkcí ho aktualizuj. Stav všech částí kampaně a kdo na čem dělá je v `ROZCESTNIK.md`. Tento soubor říká, jak se v repu pracuje.

## Souběžné relace a rozcestník

Nad repem pracuje víc relací Clauda najednou (Hub, Přepis, projekt Příběh) a navzájem se nevidí. Proto:

- Na začátku relace si přečti `ROZCESTNIK.md`. Na konci uprav tabulky, kterých se práce týká, a připiš řádek do Deníku.
- Dělej jen na součásti, kterou tvoje relace vlastní (tabulka Součásti v rozcestníku). Potřebu změny v cizí součásti zapiš do Předávek a nedělej ji sám.
- Rozdělanou práci vždy pushni do větve na GitHubu. Nezakládej lokální pracovní kopie (`git worktree`) ani větve, které na GitHub nepůjdou.
- Rozhraní mezi přepisovým nástrojem a Hubem je `reference/prepis-kanon.md`. Mění se jen přes PR se souhlasem DM.
- Přepisy, scénáře a podklady ze sezení do repa nepatří. V kartách jsou jen krátké citace v poli `dukaz`.

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
- Kánon převáděj podle `reference/kanon-prevod.md` a `reference/kanon-mapa.yaml`: text karet nepřepisuj, opravuj jen rozpory, které DM potvrdil, a po každé skupině pusť `npm run kanon -- <skupina>`.
- Co do kánonu patří a co ne, říká rozhodnutí 82: Co ví družina drží jen to, co o věci platí teď a bude potřeba při další hře; události patří do hráčského kánonu, hody do zápisu sezení, mechanika do listu postavy. Do karet nepiš pracovní poznámky (své, z chatu ani z převodu); původ drží Git, `dukaz` a `zdroj`.
- Sezení se do kánonu zapisuje podle `reference/prepis-kanon.md`: jen operacemi, které DM schválil. Neplatný text se nemaže, ale přesune do oddílu Neplatné s číslem rozhodnutí R (rozhodnutí 77). Zápis nesmí přidat novou chybu Kvality kánonu (rozhodnutí 79).

## Repo je veřejné

- `hub/.env` se nikdy necommituje. Tajné hodnoty (heslo OBS, PIN, API klíče) patří jen tam.
- Nikdy nepřidávej klíče, hesla ani tokeny do kódu, testů ani dokumentace. V testech používej zjevně falešné hodnoty generované za běhu.
- Pre-commit hook (`hub/hooks/pre-commit.js`) odmítne `.env` a řetězce podobné klíčům. Nevypínej ho (`--no-verify`).

## Zmrazené soubory

- `monsters/` je zmrazená: Improved Initiative z ní čte ilustrace přes URL. Nic nepřesouvej, nepřejmenovávej ani nepřidávej.
- Portréty `Alba.png`, `Koudur.png`, `Leta.png`, `Tusker.png` v kořeni zůstávají na místě, dokud je nepřesune blok uvedený v `ZADANI.md` (Migrace existujících dat).
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
