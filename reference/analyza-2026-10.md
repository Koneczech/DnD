# Multispektrální analýza DM Hubu

18. 10. 2026, stav `main` po PR #53. Zaměření: funkce, jestli fungují, jak snadno se Hub ovládá. Bezpečnost a legislativa stranou.

**Jak se měřilo:**

- **Zadání:** každé akceptační kritérium z `ZADANI.md` jsem porovnal s kódem, testy a daty.
- **Živý průchod:** Hub běžel v oddělené kopii repa s falešným OBS a skutečnými zvukovými soubory. Prohlížeč (Playwright) prošel 15 obrazovek, 10 hlavních průchodů a všech 11 výstupů pro OBS. Zaznamenával chyby, časy a počet ovládacích prvků.
- **Kód:** velikost modulů, testy, API, které panel nepoužívá.
- **Data:** Kontrola dat nad skutečnými daty kampaně.
- **Provoz:** záznam událostí z domácího PC (18. 10.).

## Shrnutí v deseti bodech

| # | Zjištění | Úhel | Váha |
| --- | --- | --- | --- |
| 1 | **Všechno, co se v průchodu zkoušelo, funguje.** 0 chyb JavaScriptu, 0 chybných požadavků, 11 z 11 výstupů pro OBS se načte bez chyby | Funkce | ✅ |
| 2 | **Hub je rychlý:** panel se načte za 0,4 s, souboj se zapne za 75 ms, místo v OBS za 0,5 s. Všechny časové limity zadání (500 ms až 1 s) splňuje s rezervou | Výkon | ✅ |
| 3 | **Nastavení → Zvuk má 129 ovládacích prvků** na jedné stránce. Zbytek Hubu jich má 2 až 36 na obrazovku | Ovládání | 🔴 |
| 4 | **Souboj je nejkřehčí místo:** záleží na Improved Initiative (přihlášení, druhá záložka, Player View). Hub chyby hlásí, ale neopraví | Spolehlivost | 🟠 |
| 5 | **Zadání je přerostlé:** 761 řádků a 92 otevřených bodů, z toho 43 jen „čeká na akceptaci“. Přehled o stavu se ztrácí | Dokumentace | 🟠 |
| 6 | **Zvuk:** 6 nových funkcí za 2 dny, žádná zatím nevyzkoušená u stolu | Funkce | 🟠 |
| 7 | **Kontrola dat nad daty kampaně je čistá (0 chyb).** Všechna varování jsou chybějící zvukové soubory, ne chyby dat | Data | ✅ |
| 8 | **Blok 3 Kánon nezačal:** složky `kanon`, `npc`, `postavy` … jsou prázdné nebo mají jen README. Kánon žije pořád v Notionu | Rozsah | 🟡 |
| 9 | **Proces:** při souběžných PR se ztratil otevřený bod 90 a na GitHubu je 53 starých větví | Proces | 🟡 |
| 10 | **Kód drží pohromadě,** ale panel je jeden soubor o 3 587 řádcích. Další funkce do něj budou čím dál dražší | Udržovatelnost | 🟡 |

## 1. Zadání proti skutečnosti (akceptační kritéria)

| Blok | Splněno | Nesplněno nebo neověřeno |
| --- | --- | --- |
| **0 Základ** | Spouštěč, zápis bez Uložit, Obsidian, OBS, výpadek serveru, Kontrola dat, CI Linux a Windows, zámky souborů | — |
| **1a Řízení sezení** | Zahájit a Ukončit, odpočet, scény jedním klikem, F2 | Generální zkouška 30 minut bez ruční akce v OBS: neprokázaná, ale dvě sezení proběhla |
| **1b Kalendář a obchody** | Harptos, Další den, ceník v OBS | **Po dvou sezeních měly `kalendar.html`, `kalendar-data.js` a `cenik.html` jít do `archiv/nastroje/`.** Složka je prázdná a staré nástroje jsou pořád v lokálním klonu |
| **2 Scény a dílna** | Odkrývání, prolínání, dílna, pilotní místo, Mirabar (fight.png je teď `ulicka-noc.png`) | Déšť 10 min bez vynechaných snímků v OBS: neověřeno |
| **4 Světla** | Všechna kritéria, testy proti falešnému Hue a WiZ | — |
| **5 Zvuk** | Prolínání, ambient a počasí, hrom, souboj, Ticho, výpadek reproduktoru, zvuky mimo Git | — |
| **3 Kánon** | — | Nezačato |

Nad rámec původního zadání přibylo (body 68–92): Improved Initiative v Hubu, animace zásahů, málo HP (světla a ucpané uši), soundboard, zvuky tahů, náhodné zvuky, dozvuk, zvuková sada, srovnání hlasitosti, Záznam událostí, Aktualizovat. **Tedy skoro druhý Hub navíc.** Proto se ztrácí přehled.

## 2. Živý průchod (jako u stolu)

| Průchod | Výsledek | Kliknutí | Čas |
| --- | --- | --- | --- |
| Zahájit sezení | ✅ sezení 3 běží, připravený odpočet | 2 | 1,5 s |
| Odpočet | ✅ předvolba + Spustit | 2 | — |
| Poznámka F2 | ✅ uloženo | F2 + text + Ctrl+Enter | 0,6 s |
| Místo do OBS (Tábor lupičů) | ✅ | 3 (záložka, místo, Ukázat) | 0,5 s |
| Počasí bouřka a blesk | ✅ | 2 | — |
| Souboj zapnout a vypnout | ✅ hudba přepnuta, po konci zpět | 1 + 1 | 75 ms |
| Ticho a zpět | ✅ | 1 + 1 | — |
| Další den | ✅ dialog se správnou otázkou na odpočinek | 1 | — |
| Soundboard | ✅ knihovna, přehrání | 2 | — |
| Ukončit sezení | ✅ kontrolní seznam, uložení | 2 | — |
| Zvuk u stolu | ✅ hraje ambient místa i bouřku, měří hlasitost (3 soubory za 4 s) | — | — |

Klíčové chvíle u stolu jsou na 1–3 kliknutí. To je dobrý výsledek, zachovat.

## 3. Ovládání a složitost

| Obrazovka | Ovládacích prvků | Hodnocení |
| --- | --- | --- |
| Sezení | 6 | ✅ jednoduché |
| Místa, Obchody, Kontrola dat | 1–5 | ✅ |
| Kalendář | 24 | 🟡 hodně, ale přehledné |
| Dílna | 10 | ✅ |
| U stolu (každá ze 4 záložek) | 30–36 | 🟠 je to „kokpit“ při hře: hodně najednou |
| Nastavení → Světla | 29 | 🟡 |
| **Nastavení → Zvuk** | **129** | 🔴 sada zvuků (32 řádků s tlačítky), hladiny, složka |
| Nastavení → OBS, Výstupy, Hub | 8–9 | ✅ |

**Nalezitelnost:** Kontrola dat a restart byly schované (opraveno v #52: Systém vpravo nahoře). Zbývá:

- Zahájit sezení je jen na obrazovce Sezení, v liště je jen stav.
- Odpočet se spouští ve dvou krocích (předvolba a pak Spustit).
- Zvuk místa je v Místech, zvuk scény v U stolu a zvuk Hubu v Nastavení: tři místa pro jednu věc.

**Jazyk:** všechny texty česky, žádné zbylé anglické hlášky, žádné prázdné tlačítko bez popisku. Názvy měsíců Harptosu jsou anglicky záměrně (kánon Forgotten Realms).

## 4. Spolehlivost u stolu: co když něco vypadne

| Výpadek | Co se stane | Hodnocení |
| --- | --- | --- |
| Server Hubu spadne | Spouštěč ho do 5 s spustí, výstupy v OBS drží poslední obraz | ✅ |
| OBS se odpojí | Kontrolka, Hub se připojí znovu | ✅ |
| Hue nebo WiZ neodpovídá | Ostatní světla jedou, po návratu dostane aktuální stav | ✅ |
| BT reproduktor se odpojí | Hraje výchozí zařízení, kontrolka. Na PC bez mikrofonu kontrolka vždy ukazuje „výchozí“ | 🟡 |
| Improved Initiative: odhlášení, druhá záložka, zaseknutý Player View | Hlášení a návod, ruční oprava | 🟠 |
| Freesound nebo Openverse nejdou | Sada stáhne, co jde, zbytek napíše | ✅ |
| Restart po aktualizaci | Panel i OBS se načtou samy. Zvuk u stolu možná chce kliknutí | 🟡 neověřeno |

## 5. Kód a udržovatelnost

- **Kód:** 13 100 řádků v `hub/`, 32 modulů serveru, 188 testů (všechny zelené na Linuxu i Windows).
- **Moduly bez vlastního testu:** jen `index.js` (start), `obs.js` (ověřuje se přes falešné OBS) a `sse.js`.
- **Největší soubory:**
  - `panel/app.js` (3 587 řádků): všechny obrazovky v jednom souboru.
  - `server/app.js` (1 312): všechny adresy API v jednom souboru.
  - `server/zvuk.js` (1 014).
- **API, které panel už nepoužívá:** `/api/git/stahnout` a `/api/git/sloucit` (nahradilo je Aktualizovat), `/api/obs/souboj`. Kandidáti na smazání.
- **TODO nebo FIXME v kódu:** 0.

## 6. Data kampaně

- **Kontrola dat:** 0 chyb a 0 varování v datech. Varování o zvucích závisí na složce zvuku.
- **Místa:** 5 míst s 27 ilustracemi, 3 obchody, kalendář, 6 vrstev scén.
- **Kánon:** postavy, NPC, frakce, padouši, předměty, kánon a rozhodnutí jsou prázdné. Zdrojem je pořád Notion a projekt v Claude. Kompletní je jen Alba (podoby).

## 7. Dokumentace a proces

| Co | Stav | Problém |
| --- | --- | --- |
| `ZADANI.md` | 761 řádků, 92 otevřených bodů | Bod „čeká na akceptaci“ se nikdy neuzavře, takže se seznam jen prodlužuje |
| `PREHLED.md` | nový (#54) | Musí se udržovat (zapsáno v `CLAUDE.md`) |
| `reference/` | 7 souborů, `zvuk.md` 235 řádků | Návody rostou s každou funkcí |
| PR | 54 PR za 16 dní, souběžně až 3 | Při souběhu se ztratil bod 90 |
| Větve | 53 na GitHubu | Nikdo je nemaže |
| Aktualizace | od #52 Systém → Aktualizovat | První ostrá proběhla 18. 10. |

## 8. Doporučení podle priority

**Hned (před sezením 3):**

1. Odehrát sezení 3 a všechno se značkou ◐ v `PREHLED.md` potvrdit nebo vrátit k opravě.
2. Zvuk u stolu po restartu: ověřit, jestli nechce kliknutí.

**Úklid (jeden PR):**

3. Zkrátit `ZADANI.md`: přijaté body převést na jednořádková rozhodnutí a nechat jen skutečně otevřené. Body „Akceptace Bloku …“ uzavřít naráz, protože bloky jsou v provozu.
4. Smazat staré větve a zapnout jejich automatické mazání. Jeden PR naráz.
5. Přesunout `kalendar.html`, `kalendar-data.js` a `cenik.html` z lokálního klonu do `archiv/nastroje/`. Podmínka „dvě sezení“ je splněná.
6. Smazat nepoužívané API (`git/stahnout`, `git/sloucit`, `obs/souboj`).

**Jednodušší ovládání:**

7. **Nastavení → Zvuk rozdělit:** sada zvuků na vlastní kartu sbalenou do souhrnu „Chybí 3 · Doplnit“. Tabulku ukázat až na kliknutí.
8. **Kontrola dat ve skupinách:** chyby nahoře, chybějící zvuky jedním řádkem.
9. **Průvodce „Připravit souboj“** v Před hrou: přihlášení, Encounter ID, portréty a Player View na jednom místě.
10. **Odpočet jedním kliknutím:** předvolba rovnou spustí.

**Až bude čas:**

11. Rozdělit `panel/app.js` po obrazovkách (kvůli dalším funkcím, ne kvůli chybám).
12. Blok 3 Kánon.
