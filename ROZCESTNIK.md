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
| **Návrh po sezení** | Schválení operací z přepisu, rozpory, vyřazení do oddílu Neplatné, zápis do kánonu | toto repo, `hub/` (PR #106 sloučené 31. 10.) | relace **Hub** | ◐ dostavěno podle smlouvy (schéma 2, brána, `vyradit`, `smazat`, Neplatné, rozpory, `kampan/rozpory.yaml`, ⚠ bod 157), ostrý návrh tudy ještě neprošel |
| **Kvalita kánonu** | Měření chyb v kartách, stránka Co opravit | toto repo, `hub/` | relace **Hub** | ◐ 61 % karet bez chyby (89 ze 145); sezení čekající na zápis už chybu nehlásí (⚠ bod 158) |
| **Přepisový nástroj** | Nahrávka → přepis → scénář → podklad a kontrola důkazů | soukromé repo `Koneczech/DnD-prepis` (rozhodnutí 81), lokálně `Dokumenty\DnD\OBS\prepis\prepis-tool` | relace **Přepis** (Claude Code) | ✓ přepis, scénář a kontrola důkazů podle `prepis-kanon.md` § 7; ◐ opravy od Clauda u bloků zatím nejsou |
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
| `karta-sezeni` | Karta sezení ve wiki podle návrhu, který DM potvrdil 31. 10. (⚠ bod 158): údaje sezení, hráčský kánon, události, U stolu, Kdo a kde, stav zápisu; Kvalita kánonu u nezapsaných sezení; družina vidí sezení podle kánonu | DM: projít PR #107 a sloučit, pak vyzkoušet na kartách Sezení 2 a 3 |

## Předávky (fronta)

Co jedna část potřebuje od jiné. Hotové položky se mažou, záznam zůstane v Deníku.

| Od | Pro | Co | Stav |
| --- | --- | --- | --- |
| DM | Hub | Po schválení scénáře s03: finální `s03.yaml` podle `prepis-kanon.md` § 3a ve schématu 2 (`schema: 2`, `stav: finalni`, `scenar_verze`). Zkušební průchod předběžného návrhu: 73 ze 74 operací Hub přijme, `o62` mění pole `harptos_konec`, které karta sezení nemá. Při schválení všeho by zápis přidal 4 chyby Kvality kánonu (rozhodnutí 79): Ordwinův dopis, Thirilův prsten a Kapitán lupičů jsou skryté, i když je zmiňuje hráčský kánon (přidat `pole verejne` a odkrytou odrážku), Mrtvá dívka z tábora lupičů má popis jen 73 znaků (nejméně 200). Pole `rozhodnuti_r` v hlavičce Hub nečte, číslo R patří do `r` u rozporu | čeká |
| DM | – | Dokončit kontrolu scénáře sezení 3 (poslech), pak ho schválit | čeká |
| Kánon | Příběh | 8× dořešit (`kampan/kanon/*` s `doresit: true`), 10 otevřených rozhodnutí; po zápisu sezení 3 i jeho otevřené nitky | čeká |
| Hub | Hub | Úklid kánonu po skupinách podle Kvality kánonu (rozhodnutí 79), souběžně s ostatní prací | čeká |

## Doporučené pořadí

1. DM: dokončit poslech scénáře sezení 3 a schválit ho.
2. Relace Hub: finální `s03.yaml` podle `reference/prepis-kanon.md` § 3a (předávka výše).
3. DM: sezení 3 do kánonu přes Návrh po sezení. Je to první ostrá zkouška celé cesty.
4. Projekt Příběh: příprava sezení 4 do repa, s dořešit body a nitkami ze sezení 3.

## Otevřené

- Mikrofony na sezení 4 (3 stopy: hráči, DM, zvuk z OBS). Varianty jsou v předávce `prepis-do-kanonu`, nic není vybrané.
- Cloudový přepis (Soniox, ElevenLabs) jen se souhlasem hráčů.
- Odložené rozpory jsou v `kampan/rozpory.yaml` se `stav: otevrene`; Kontrola dat je hlásí jako varování.
- Lokální pracovní kopie `repo-navrh` a `repo-kvalita` a jejich větve smaže dvojklik na `uklid-pracovnich-kopii.cmd` v `Dokumenty\DnD\repo` (obsah je na GitHubu, skript se po sobě smaže); pak tenhle bod smazat.

## Deník

Jeden řádek na relaci: datum, relace, co se udělalo, kde to je.

- 31. 10. 2026 · Uspořádání (Claude) · audit D&D projektů, rozcestník, smlouva `reference/prepis-kanon.md`, pravidla souběžných relací v `CLAUDE.md`, rozhodnutí DM 77–81, oprava konce sezení 3 · větev `usporadani`
- 31. 10. 2026 · Přepis (Claude Code) · kontrola důkazů podle § 7, schéma 2, odpovědi na § 8, nástroj v soukromém repu · `Koneczech/DnD-prepis`, větev `prepis-odpovedi`, PR #105
- 31. 10. 2026 · Přepis (Claude Code) · Návrh po sezení a Kvalita kánonu přesunuté z lokálních kopií do větve, předávka · větev `prepis-do-kanonu`
- 31. 10. 2026 · Uspořádání (Claude) · PR #102 a #103 sloučené; datum sezení 1; seznam větví k smazání ověřený · větev `s01-datum`
- 31. 10. 2026 · Hub (Claude) · Návrh po sezení dostavěný podle smlouvy: schéma 2 a brána předběžný/finální, `vyradit` (i celé karty), `smazat`, oddíl Neplatné, tlačítka rozporů, registr `kampan/rozpory.yaml` od R17, pojistka Kvality kánonu, filtr Vyřazené; ⚠ bod 157; zkušební průchod předběžného `s03.yaml` · větev `prepis-do-kanonu`, PR #106
- 31. 10. 2026 · Uspořádání (Claude) · `main` (#105) sloučený do `prepis-do-kanonu`, konflikt v rozcestníku vyřešený; předávka Přepis → Hub (tvar `problemy`, `dm`, `blok` v ▶) je v PR #106 hotová · větev `prepis-do-kanonu`
- 31. 10. 2026 · Hub (Claude) · karta sezení podle potvrzeného návrhu (plátno „Karta sezení — návrh“), ⚠ bod 158 · větev `karta-sezeni`, PR #107
- 31. 10. 2026 · Uspořádání (Claude) · návrh `sNN.yaml` píše relace Hub, postup pro DM v `prepis-kanon.md` § 3a · větev `navrh-pise-hub`
