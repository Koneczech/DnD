# DM Hub v kostce

Stav k 18. 10. 2026. Tenhle soubor odpovídá na tři otázky: **co Hub umí, co je rozdělané a co jsme vědomě vynechali.** Podrobná pravidla a rozhodnutí jsou v `ZADANI.md`, návody v `reference/`.

## Hub jednou větou

Jedno okno, ze kterého DM u stolu řídí všechno, co hráči vidí a slyší: obraz v OBS, světla, zvuk a souboj. Data kampaně leží v tomhle repu.

## Jak se Hub používá

| Kdy | Co uděláš | Kde |
| --- | --- | --- |
| Před hrou | Zástupce **DM Hub** na ploše → otevře se panel a stránka Zvuk u stolu | plocha |
| Před hrou | Projdi **Sezení → Před hrou**, zelené = připraveno | Sezení |
| Začátek | **Zahájit sezení** → odpočet → scéna Start → světla se pomalu rozsvítí | Sezení |
| Během hry | Místo, počasí, den/noc, obchod, soundboard | U stolu |
| Souboj | **Souboj** nahoře → Improved Initiative, zvuky tahů, animace zásahů, málo HP | U stolu → Souboj |
| Konec | **Ukončit sezení** → kontrolní seznam → uložení na GitHub | Sezení |
| Nová verze | Slouč PR na GitHubu → **Systém → Aktualizovat** → Hub se restartuje sám | Systém (vpravo nahoře) |
| Něco nejde | **Systém → Záznam událostí → Stáhnout** a pošli Claudovi | Systém |

## Co Hub umí

✓ hotové a vyzkoušené u stolu · ◐ hotové, čeká na vyzkoušení u stolu · ✗ chybí

| Oblast | Funkce | Stav |
| --- | --- | --- |
| **Sezení** | Zahájit a Ukončit sezení, odpočet, poznámky (F2), Před hrou | ✓ |
| | Start hry: světla se z normálu pomalu přepnou na výchozí | ◐ |
| **Kalendář** | Harptos, Další den (s odpočinkem i bez), události, malý a velký kalendář v OBS | ✓ |
| **Obchody** | Sortimenty, aktivní obchod, ceník v OBS | ✓ |
| **Místa a scény** | Ilustrace míst, den/noc, stavy (poplach, hoří, po boji), odkrývání stop, počasí s intenzitou | ✓ |
| | Ilustrační dílna (prompt, ořez, nová ilustrace jako skrytá) | ✓ |
| **OBS** | Přepínání scén podle rolí, výstupy jako zdroje Browser, živý náhled | ✓ |
| **Světla** | Hue a WiZ po rolích (hlavní, pozadí, lampa), světla místa, blesky při bouřce | ✓ |
| | Málo HP: lampa i hlavní světlo pulzují červeně | ◐ |
| **Souboj** | Improved Initiative v záložce (Epic účet přes Hub), Player View hlídaný Hubem | ✓ |
| | Animace zásahu (velký zásah, rozpad poražených, šedé karty) | ◐ |
| | Zvuky na tah podle postavy a podoby Alby | ◐ |
| **Zvuk** | Hudba, ambient a efekty do BT reproduktoru, Ticho, ucpané uši při málo HP | ✓ |
| | Soundboard s variantami, smyčky, klávesy 1–9 | ◐ |
| | Náhodné zvuky, vzdálenost, dozvuk, vlastní zvuk místa v souboji | ◐ |
| | Zvuková sada: Freesound, Openverse, balíčky Kenney, Vyměnit a ↻ | ◐ |
| | Srovnání hlasitosti a přeskočení ticha na začátku | ◐ |
| **Údržba** | Aktualizovat jedním tlačítkem, restart sám, Kontrola dat, Záznam událostí | ◐ |
| **Kánon** (Blok 3) | Postavy, NPC, frakce a deník v repu, hledání, karty v panelu | ✗ |
| **Verze 2** | Editor entit, příprava Lazy DM, generátor obchodů, portréty, export do IIO | ✗ |

## Co je rozdělané (v tomto pořadí)

1. **Vyzkoušet u stolu** všechno označené ◐ (sezení 3, tábor lupičů). Co projde, se v `ZADANI.md` uzavře.
2. **Zjednodušit Kontrolu dat:** chybějící zvuky v jednom řádku s tlačítkem Doplnit, chyby nahoře.
3. **Zvuk u stolu po restartu:** ověřit, jestli prohlížeč chce kliknutí; když ano, otevírat ho v samostatném okně.
4. **Blok 3 Kánon:** převod z Notionu po skupinách.
5. **Verze 2.**

## Vědomě vynecháno

Vlastní combat tracker, sledování zdrojů postav (BV, kouzla, Zuřivost), mixážní pult, zvuky v repu, pohled pro hráče na mobilech, editace mimo domov. Důvody jsou v `ZADANI.md` → Mimo rozsah.

## Známá omezení

- **PC nemá mikrofon:** reproduktor pro Zvuk u stolu se nastavuje ve Windows (Směšovač hlasitosti), kontrolka v Hubu pak ukazuje „Výchozí zařízení“.
- **Openverse** z domácího PC často neodpovídá (ochrana proti robotům). Sadu tahá hlavně Freesound a Kenney.
- **Improved Initiative:** druhá otevřená záložka editoru umí přepsat nastavení Player View; přihlášení (connect.sid) platí asi 4 týdny.
- **Animace zásahů** poznají zranění podle barvy HP v Player View, u nestvůr bez čísel je to odhad.

## Kde co je

| Co | Kde |
| --- | --- |
| Pravidla práce pro Clauda | `CLAUDE.md` |
| Zadání, rozhodnutí, otevřené body | `ZADANI.md` |
| Návody (zvuk, OBS, ilustrace) | `reference/` |
| Data kampaně | `kampan/` |
| Kód Hubu a testy | `hub/` |
| Zvuky (mimo repo) | `Dokumenty\DnD\audio` |
| Záznam událostí (mimo repo) | `hub\.stav\zaznam\` |
