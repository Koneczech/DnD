# Převod kánonu do repa (Blok 3)

Návod, jak kánon z Notionu, projektu v Claude a dotazníku převést do `kampan/`. Co kde je a co si odporuje, říká `reference/kanon-audit.md`. Každou položku s id, typem a cílem obsahuje `reference/kanon-mapa.yaml`.

**Kdy:** převod jen přidává soubory, Hub u stolu neohrozí. Může běžet před sezením 3 i po něm.

## Jednou před převodem

1. **Rozpory R1–R16 jsou rozhodnuté** (DM 19. 10. 2026, `reference/kanon-audit.md`). Rozhodnutí jsou v mapě v `rozhodnute_rozpory`; text karet se opraví jen podle nich.
2. **Záloha Notionu.** Postup:
   1. Otevři stránku „Lazy RPG Campaign Template (1)“.
   2. Klikni na `•••` vpravo nahoře a zvol **Export**.
   3. Nastav formát **Markdown & CSV** a zapni **Include subpages** a **Create folders for subpages**.
   4. Export. Notion pošle odkaz na ZIP e-mailem nebo ho rovnou stáhne.

   ZIP ulož **mimo repo**, třeba do `Dokumenty\DnD\zalohy\notion-2026-10-xx.zip`. Repo je veřejné a export obsahuje i šablonu, obrázky a texty Sly Flourish, které do veřejného repa nepatří. ZADANI předpokládalo `archiv/notion-<datum>/` v repu, proto je to bod 95.
3. **Sloučit PR s přípravou** (šablony, mapa, report) přes Systém → Aktualizovat.

## Pořadí skupin

Po každé skupině běží `npm run kanon -- <skupina>` a DM skupinu potvrdí. Teprve potom se převádí další.

| # | Skupina | Souborů | Co DM u skupiny kontroluje |
| --- | --- | --- | --- |
| 1 | `postavy` | 4 | Sloučení tří zdrojů, jazyky (R9), oddíl Výchozí stav (R16) |
| 2 | `padousi-frakce` | 6 | Bifron, Grimsdal, Torva (R2), Krkavčí prapor, kruh, Rod Redgrave |
| 3 | `npc` | 22 | Malk Orren z karty Kontakt v Longsaddle (R1), Nováček a Tavis (R4) |
| 4 | `mista` | 16 | Longsaddle se sloučí do existujícího souboru (R8), Tábor kruhu (R13) |
| 5 | `predmety` | 6 | Thirilův prsten a Ordwinův dopis (R3, R6, R10) |
| 6 | `rozhodnuti` | 39 | Zastaralé otevřené otázky (R15) |
| 7 | `sezeni` | 1 | Zápis sezení 1 |
| 8 | doplnit | 10 | Váček se semeny, Hlídač kruhu, Tavis, lidé z Longsaddle … Text předloží Claude a soubor vznikne po potvrzení |
| 9 | hráčský kánon | — | Záznamy `kanon/` pro sezení 1 a 2 (DM 19. 10.). Navrhne je Claude ze zápisů, zápis sezení 2 vznikne z přepisu nahrávky |

Report je hotový, když platí všechno z tohoto seznamu:

- souborů v repu je tolik, kolik položek k převodu;
- každý rozdíl je vysvětlený (vynecháno, doplnit);
- každý soubor má `zdroj`;
- Kontrola dat nehlásí chybějící vazbu ani duplicitní `id`.

To jsou akceptační kritéria Bloku 3.

## Pravidla převodu

### Text

- **Text se nepřepisuje.** Převádí se tak, jak je v Notionu. Opraví se jen to, co DM potvrdil u rozporů.
- Nadpis karty je `# Název`. Nadpisy uvnitř karty zůstanou o úroveň níž (`##`, `###`).
- Tabulky z Notionu se převedou na markdown tabulky. Citace `>` a odrážky zůstanou.
- **Odkazy:** první zmínka o jiné entitě v každém oddílu se změní na `[[id|Jméno]]`. Například „**Ordwinem Sohlou**“ se změní na `**[[ordwin-sohla|Ordwinem Sohlou]]**`. Další zmínky ve stejném oddílu zůstanou textem. Id bere z mapy.
- Oddíly „Dnes“, „Současný stav“ a „Teď“, které popisují stav před sezením 1, dostanou nadpis **Výchozí stav (před sezením 1)** (R16). Text pod nimi zůstane.
- Oddíly jen pro DM mají nadpis začínající `DM`: „Co Leta neví (DM)“ se změní na **DM — co Leta neví**, „DM sekce — co Tusker neví“ na **DM — co Tusker neví**. Hub podle toho pozná, co do pohledu družiny nikdy nepatří (bod 99).
- Oddíl **Co ví družina** se při převodu nezakládá. Napíše ho DM, až bude chtít entitu ukázat v pohledu družiny.

### Hlavička (všechny typy)

| Pole | Odkud |
| --- | --- |
| `schema` | vždy `1` |
| `id` | z mapy |
| `typ` | z mapy (`postava`, `npc`, `padouch`, `frakce`, `misto`, `predmet`, `rozhodnuti`, `sezeni`) |
| `nazev` | název z mapy: bez dovětků v závorce, ty jdou do `aliases` |
| `verejne` | `false`; existující místa z Bloku 2 si nechají `true` |
| `ikona` | emoji karty z Notionu (⚠ návrh, pro budoucí karty v panelu) |
| `aliases` | z mapy |
| `vazby` | z mapy jako `["[[id]]", …]` |
| `vztahy` | návrh Claude z textu karty, jen kde karta vztah říká (viz níže) |
| `tags` | tag Notionu Current → `aktualni`; Villain, NPC, Location a Item se nepřevádí, ty už vyjadřuje typ |
| `ilustrace` | z mapy (`/monsters/torva.png`, `/Tusker.png`) s `ucel: portret` |
| `zdroj` | odkaz na kartu `https://app.notion.com/p/<id>` |

### Vztahy (rozhodnutí 70)

Formát je v `ZADANI.md` → Datový model → Vztahy. Při převodu platí:

- Vztah se zapíše jen tam, kde ho karta říká. Popis se vezme z karty („adoptivní otec“, „dluží mu“, „bývalá snoubenka“), nevymýšlí se.
- `postoj` se uvede jen u výslovného postoje v textu (miluje, nenávidí, nevěří). Jinak se pole vynechá a čára zůstane šedá.
- Vztah se zapíše na kartu, *od které* vede: „Leta nevěří Ordwinovi“ patří do `leta.md`. Opačný směr se zapíše jen tehdy, když ho říká i druhá karta.
- Všechny vztahy začínají bez `verejne` (družina je nezná). Družina zná nastaví DM v Hubu.
- Cíl každého vztahu je i ve `vazby`.
- V PR je u skupiny tabulka navržených vztahů (kdo, komu, popis, postoj, věta z karty), aby je DM prošel najednou.

### Postava (`postavy/<id>/<id>.md`)

Hlavička navíc obsahuje `hrac`, `druh` a `povolani`. Tělo má tyto oddíly v tomto pořadí:

1. První řádek karty z Notionu jako citace: druh, povolání, věk, BV.
2. **Příběh:** kapitoly z Notionu (bez úvodní věty „Životopis sestaven v rozhovoru s DM“).
3. **Výchozí stav (před sezením 1)**.
4. **DM — co postava neví**.
5. **List postavy:** celý soubor `postavy/<jméno>.md` z projektu v Claude, s datem 21. 8. 2026.
6. **Dotazník:** všechny odpovědi hráče, otázka jako `###`, odpověď beze změn (Adriana slovensky).

Vlastnosti z Notionu (Background, Languages, Trained Skills) se nepřevádí. Mechaniku drží list postavy (R9).

### Rozhodnutí (`rozhodnuti/<id>.md`)

| Notion | Repo |
| --- | --- |
| Otazka | `nazev` |
| Stav: Otevrene, Rozhodnuto, Zavrzeno | `stav: otevrene`, `rozhodnuto`, `zavrzeno` |
| Oblast: Leta, Koudur, Tusker, Alba, Kampan | `oblast: leta`, `koudur`, `tusker`, `alba`, `kampan` |
| Zaznamenano | `zaznamenano: 2026-08-22` |
| Kontext | oddíl `## Kontext` |
| Dopad | oddíl `## Dopad` |

Karty „Rok a kalendář kampaně“ a „Stopa do Yartaru“ z Campaign Database se převedou jako rozhodnutí se `stav: rozhodnuto` a celým textem karty pod `## Kontext`.

### Sezení (`sezeni/s01/s01.md`)

Hlavička se řídí otevřeným bodem 14: `cislo: 1`, `datum_realne` (doplní DM), `pritomni` (všichni čtyři) a `verejne: false`. Oddíly šablony Lazy DM se přejmenují česky:

| Notion | Repo |
| --- | --- |
| Characters | Postavy |
| Strong Start | Silný začátek |
| Scenes | Scény |
| Secret and Clues | Tajemství a stopy (zaškrtávátka zůstanou) |
| Fantastic Locations | Fantastická místa |
| NPCs | NPC |
| Monsters | Nestvůry |
| Treasure | Poklady |
| Session Notes | Poznámky ze sezení |

### Po poslední skupině

- Notion přepnout jen pro čtení. Smazat ho je samostatné rozhodnutí po verzi 2.
- Dotazník `Dotazník k postavě — odpovědi.xlsx` → `archiv/dotaznik-postav.xlsx`.
- V projektu v Claude smazat `postavy/*.md`. Claude pak čte postavy z repa (`reference/claude-projekt.md`).

## Jak zadat převod Claudovi

V Claude Code (nebo v projektu „DM Hub“) stačí napsat:

> Převeď skupinu `npc` podle `reference/kanon-prevod.md` a `reference/kanon-mapa.yaml`. Rozpory R1, R2 a R4 platí podle návrhu.

Claude postupuje takto:

1. Načte karty z Notionu.
2. Zapíše soubory na větev `blok-3-<skupina>`.
3. Pustí `npm run kanon -- <skupina>` a testy.
4. Pošle PR s reportem.

DM PR projde a sloučí. Pak přijde další skupina.

## Příklad: Ordwin Sohla

Karta v Notionu → `kampan/npc/ordwin-sohla/ordwin-sohla.md`:

```markdown
---
schema: 1
id: ordwin-sohla
typ: npc
nazev: Ordwin Sohla
verejne: false
ikona: 🪙
aliases: [Ordwin]
vazby: ["[[thiril-ambersedge]]", "[[leta]]", "[[halvar-grimsdal]]", "[[malk-orren]]", "[[thiriluv-prsten]]", "[[ordwinuv-dopis]]", "[[u-roztaveneho-grose]]"]
tags: [aktualni]
zdroj: https://app.notion.com/p/3c49ed226736818f9adedfbd4d8588d5
---
# Ordwin Sohla

Člověk, překupník a vetešník. **Vetešnictví u Přístavní brány** — přední místnost plná harampádí, zadní místnost, kam se chodí jinými dveřmi. Kupuje všechno, prodá cokoli.

Jediný kontakt do podsvětí, se kterým [[thiril-ambersedge|Thiril]] [[leta|Letu]] seznámil. Leta si to celý život vykládá jako nedůvěru; ve skutečnosti to byla ochrana.

## Letin postoj

Nevěří mu. Počítá s tím, že ji hodí přes palubu, jakmile bude odměna za její hlavu vyšší než jejich kšefty.

## DM — co Leta neví

- Ordwin se dozvěděl o sázce s [[halvar-grimsdal|Grimsdalovým]] prstenem a **šel s tím za Thirilem** — …
- …
```
