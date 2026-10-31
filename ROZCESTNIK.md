# Rozcestník

Jedno místo, kde je vidět stav všech částí kampaně a kdo na čem dělá. Stav k 31. 10. 2026.

**Pravidla pro každou relaci Clauda (Claude Code i Claude projekty):**

1. Na začátku si přečti tento soubor.
2. Dělej jen na součásti, kterou vlastníš (tabulka Součásti). Když potřebuješ změnu v cizí součásti, zapiš ji do **Předávek** a nedělej ji sám.
3. Rozdělanou práci vždy pushni do větve na GitHubu. Nic nesmí zůstat jen v lokální pracovní kopii.
4. Na konci uprav tabulky, kterých se práce týká, a připiš řádek do **Deníku**.

Podrobnosti mají svá místa a tady se neopakují: funkce Hubu jsou v `PREHLED.md`, rozhodnutí v `ZADANI.md` a cesta přepisu do kánonu v `reference/prepis-kanon.md`.

## Součásti a vlastníci

| Součást | Co to je | Kde žije | Kdo ji staví | Stav |
| --- | --- | --- | --- | --- |
| **DM Hub** | Panel u stolu: OBS, světla, zvuk, souboj, kalendář, modul Kánon (wiki, mapa, editor, web) | toto repo, `hub/` | relace **Hub** (Claude Code ve `Dokumenty\DnD\repo`) | viz `PREHLED.md`; mnoho funkcí ◐ čeká na vyzkoušení u stolu |
| **Návrh po sezení** | Schválení operací z přepisu, rozpory, vyřazení do oddílu Neplatné, zápis do kánonu | toto repo, `hub/`, rozpracováno ve větvi `prepis-do-kanonu` | relace **Hub** | ◐ kód a testy hotové, chybí `vyradit`, Neplatné a `kampan/rozpory.yaml` (rozhodnutí 77, bod 155) |
| **Kvalita kánonu** | Měření chyb v kartách, stránka Co opravit | větev `prepis-do-kanonu` | relace **Hub** | ◐ 60 % karet bez chyby (88 ze 145) |
| **Přepisový nástroj** | Nahrávka → přepis → scénář → podklad a kontrola důkazů | `Dokumenty\DnD\OBS\prepis\prepis-tool`, přesune se do soukromého repa `Koneczech/DnD-prepis` (rozhodnutí 81) | relace **Přepis** (Claude Code) | ✓ přepis, scénář a kontrola důkazů podle `prepis-kanon.md` § 7; ◐ opravy od Clauda u bloků zatím nejsou; soukromé repo čeká na založení |
| **Obsah kánonu** | Co ve světě platí: karty, hráčský kánon, zápisy sezení, rozhodnutí | toto repo, `kampan/` | **DM** schvaluje; zapisuje Hub (Návrh po sezení) nebo relace Hub na pokyn DM | ◐ sezení 3 chybí, 8× dořešit, 10 otevřených rozhodnutí |
| **Příprava příběhu** | Oblouky, příprava sezení podle Lazy DM | Claude projekt **Příběh**; výstup do `kampan/sezeni/sNN/priprava-sNN.md` | projekt **Příběh** | ◐ koncept sezení 4 (štola) jen mimo repo |

Notion je archiv jen pro čtení. Kánon v něm nežije (rozhodnutí 1).

## Koloběh sezení

Příprava → hra u stolu → přepis a scénář → návrh a schválení → kánon. Postup je v `reference/prepis-kanon.md`.

| Sezení | Hráno | Příprava v repu | Přepis a scénář | Kánon | Dořešit |
| --- | --- | --- | --- | --- | --- |
| s01 | 29. 8. 2026 (podle nahrávek) | ✗ (Notion) | ✓ | ✓ zápis a hráčský kánon | 3 |
| s02 | 11. 9. 2026 | ✗ (Notion) | ✓ | ✓ PR #101 | 5 |
| s03 | 24. 10. 2026 | ✗ | ◐ scénář zkontrolovaný z 22 % (317 z 1 466 replik), předběžný `s03.yaml` (74 operací) | ✗ jen poznámky ze stolu | – |
| s04 | – | ◐ koncept mimo repo | – | – | – |

## Rozdělané větve

| Větev | Co v ní je | Další krok |
| --- | --- | --- |
| `prepis-do-kanonu` | Návrh po sezení, Kvalita kánonu, oprava karty Malka; předávka `reference/predavka-prepis-do-kanonu.md` | relace Hub doplní vyřazování a otevře PR |

## Předávky (fronta)

Co jedna část potřebuje od jiné. Hotové položky se mažou, záznam zůstane v Deníku.

| Od | Pro | Co | Stav |
| --- | --- | --- | --- |
| DM | Hub | Dostavět Návrh po sezení z větve `prepis-do-kanonu`: `vyradit`, `smazat`, oddíl Neplatné, `kampan/rozpory.yaml` (R17+), tlačítka rozporů, schéma 2 | čeká |
| Přepis | Hub | `navrh-sezeni.js` čte `problemy` v `sNN.dukazy.json` jako text, teď jsou to objekty `{ text, zavaznost }` (ukázalo by se `[object Object]`). Ukázat i upozornění u operací s `ok: true`, pole `dm` a do ▶ přidat `blok` (`prepis-kanon.md`, Odpovědi relace Přepis) | čeká |
| DM | Přepis | Založit prázdné soukromé repo `Koneczech/DnD-prepis`. Nástroj je lokálně v Gitu a ověřený, `vystup/` v `.gitignore`, chybí jen push | čeká na DM |
| DM | – | Dokončit kontrolu scénáře sezení 3 (poslech), pak ho schválit | čeká |
| Kánon | Příběh | 8× dořešit (`kampan/kanon/*` s `doresit: true`), 10 otevřených rozhodnutí; po zápisu sezení 3 i jeho otevřené nitky | čeká |
| Hub | Hub | Úklid kánonu po skupinách podle Kvality kánonu (rozhodnutí 79), souběžně s ostatní prací | čeká |

## Doporučené pořadí

1. Relace Hub: dostavět Návrh po sezení (větev `prepis-do-kanonu`), otevřít PR, DM sloučí.
2. DM: dokončit poslech scénáře sezení 3. Relace Přepis mezitím upraví kontrolu důkazů.
3. Sezení 3 do kánonu přes Návrh po sezení. Je to první ostrá zkouška celé cesty.
4. Projekt Příběh: příprava sezení 4 do repa, s dořešit body a nitkami ze sezení 3.

## Otevřené

- Mikrofony na sezení 4 (3 stopy: hráči, DM, zvuk z OBS). Varianty jsou v předávce `prepis-do-kanonu`, nic není vybrané.
- Cloudový přepis (Soniox, ElevenLabs) jen se souhlasem hráčů.
- Úklid GitHubu: 100 sloučených větví (všechny kromě `main` a `prepis-do-kanonu`, ověřeno 31. 10.) smaže DM, a lokální pracovní kopie `repo-navrh` a `repo-kvalita` (nahrazené větví `prepis-do-kanonu`) smaže relace Hub.

## Deník

Jeden řádek na relaci: datum, relace, co se udělalo, kde to je.

- 31. 10. 2026 · Uspořádání (Claude) · audit D&D projektů, rozcestník, smlouva `reference/prepis-kanon.md`, pravidla souběžných relací v `CLAUDE.md`, rozhodnutí DM 77–81, oprava konce sezení 3 · větev `usporadani`
- 31. 10. 2026 · Přepis (Claude Code) · kontrola důkazů podle § 7, schéma 2, odpovědi na § 8, nástroj v lokálním Gitu · `dukazy.py` v nástroji, větev `prepis-odpovedi`
- 31. 10. 2026 · Přepis (Claude Code) · Návrh po sezení a Kvalita kánonu přesunuté z lokálních kopií do větve, předávka · větev `prepis-do-kanonu`
- 31. 10. 2026 · Uspořádání (Claude) · PR #102 a #103 sloučené; datum sezení 1; seznam větví k smazání ověřený · větev `s01-datum`
