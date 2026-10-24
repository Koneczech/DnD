# DM Hub v kostce

Stav k 24. 10. 2026. Tenhle soubor odpovídá na tři otázky: **co Hub umí, co je rozdělané a co jsme vědomě vynechali.** Podrobná pravidla a rozhodnutí jsou v `ZADANI.md`, návody v `reference/`.

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
| Kdo je kdo | **Hledat v kánonu** nahoře (Ctrl+K) nebo **Kánon**: wiki, karta, mapa, Pohled družiny | Kánon |
| Družina se něco dozví | Karta v Kánonu → **Co ví družina** → oko 👁 u odrážky, nebo napiš novou a Enter. Hotový odstavec z textu karty odkryješ okem 👁 vedle něj | Kánon |
| Něco nejde | **Systém → Záznam událostí → Stáhnout** a pošli Claudovi | Systém |
| Projektor | Edge s adresou Stropu na displeji projektoru, F11; K kalibrace, Z zkouška | Nastavení → Výstupy pro OBS, `reference/strop.md` |
| Mimo domov | Codespace na GitHubu → panel se štítkem **Zkouška**, nic se neukládá | `reference/zkouska-v-cloudu.md` |
| Mimo domov | Kánon v prohlížeči, i z práce; pohled DM po zadání hesla, úpravy karet přímo na stránce (token GitHubu) | [koneczech.github.io/DnD](https://koneczech.github.io/DnD/) |

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
| | Hierarchie míst (Leží v): strom v Místech, U stolu i dílně, popis nadřazeného místa v promptu | ◐ |
| **OBS** | Přepínání scén podle rolí, výstupy jako zdroje Browser, živý náhled | ✓ |
| **Světla** | Hue a WiZ po rolích (hlavní, pozadí, lampa), světla místa, blesky při bouřce | ✓ |
| | Málo HP: lampa i hlavní světlo pulzují červeně; Konec souboje pulz i ucpané uši vždy ukončí | ◐ |
| **Strop** | Obloha z projektoru na strop podle scény: den a noc, počasí, bouřka s blesky podle vzdálenosti, intenzita, souboj, málo HP | ◐ |
| | Kalibrace (K): čtyři rohy, měkký okraj, jas, převrácení pro zrcadlo; zkouška bez zásahu do Hubu (Z) | ◐ |
| | Volný tvar, který se pomalu přelévá (členitost), masky míst, kam nesvítit | ◐ |
| | Motiv podle místa: nebe, les, tábor, jeskyně, interiér (Místa → Zvuk → Prostor, jinak podle dozvuku) | ◐ |
| | Ptáci: hejno, klín a netopýři přeletí sami nebo z U stolu → Strop | ◐ |
| **Souboj** | Improved Initiative v záložce (Epic účet přes Hub), Player View hlídaný Hubem | ✓ |
| | Animace zásahu (velký zásah, rozpad poražených, šedé karty) | ◐ |
| | Zvuky na tah podle postavy a podoby Alby, živě bez zpoždění (spojení jako Player View) | ◐ |
| **Zvuk** | Hudba, ambient a efekty do BT reproduktoru, Ticho, ucpané uši při málo HP | ✓ |
| | Soundboard s variantami, smyčky, klávesy 1–9 | ◐ |
| | Náhodné zvuky, vzdálenost, dozvuk, vlastní zvuk místa v souboji | ◐ |
| | Playlisty hudby (složka = playlist), hudba scény Start, konec souboje bubnem v dozvuku | ◐ |
| | Hudba ze Spotify přes virtuální kabel (s efekty Hubu a zálohou ze složky) | ◐ |
| | Hudba v liště na každé obrazovce: pauza, další skladba, co hraje, hlasitosti | ◐ |
| | Zvuk míst Longsaddle, Tábor lupičů (den i noc) a Jeskyně u tábora | ◐ |
| | Zvuková sada: Freesound, Openverse, balíčky Kenney, hudba, Vyměnit a ↻ | ◐ |
| | Srovnání hlasitosti a přeskočení ticha na začátku | ◐ |
| **Údržba** | Aktualizovat jedním tlačítkem, restart sám, Kontrola dat, Záznam událostí | ◐ |
| | Tlačítko ukáže „Uložit na GitHub“ jen u změn v `kampan/`; jiné soubory (nastavení Obsidianu) zmíní v popisu | ◐ |
| | Zkouška v cloudu (GitHub Codespaces): panel v prohlížeči mimo domov, bez světel, OBS a zvuku, na GitHub se nic neukládá | ◐ |
| **Kánon** (Blok 3) | Příprava převodu: audit zdrojů, mapa převodu, šablony, report `npm run kanon` | ◐ |
| | Vztahy s popisem a postojem: formát, šablony, Kontrola dat | ◐ |
| | Převedené karty: postavy (4), padouši a frakce (6), NPC (23), místa (16), předměty (6), registr rozhodnutí (39), zápis sezení 1 | ◐ |
| | Karty mimo Notion (8), hráčský kánon sezení 1 | ◐ |
| | Zápis a hráčský kánon sezení 2, nové karty ze sezení 2 (Jorun, Artur, Marwen, Gerd, dřevorubci, brod, Malkova zásilka), události v Kalendáři | ◐ |
| | Wiki kánonu: přehled, kategorie, stránka karty, Pohled družiny, hledání v liště | ◐ |
| | Co ví družina po odrážkách (oko 👁 u každé), rychlé přidání u stolu | ◐ |
| | Odkrývání odstavců a odrážek z celého textu karty (oko 👁 u bloku, i z příběhu postavy) | ◐ |
| | List postavy jako character sheet z dat (`list.yaml` u každé postavy): vlastnosti, bojové hodnoty, záchrany, dovednosti, smysly, obrana, zdatnosti a záložky Actions, Spells, Inventory, Features & Traits; odvozené hodnoty počítá Hub podle pravidel 2024, rozpory s původním listem ukáže jen DM s ⚠ (u Koudura záchrana na Charismu); list vidí i družina, poznámky DM v něm nejsou; v Hubu, na webu i na telefonu | ◐ |
| | Plný editor karty (text, pole, portrét, našeptávání odkazů), nová karta ze šablony | ◐ |
| | Živý náhled v editoru karty (jako Obsidian): nadpisy, tučné, odkazy, odrážky a oko 👁 rovnou v textu, značky jen na řádku s kurzorem; text se ukládá beze změny formátu; Enter pokračuje v seznamu | ◐ |
| | Příkazy „/“ v editoru: nabídka prvků (nadpis, odrážka, odrážka pro družinu, citace, odkaz, tučně, kurzíva, skrytá poznámka, tabulka, oddělovač, chybějící oddíly typu), v Hubu i na webu | ◐ |
| | Typové stránky: boční panel podle typu (role, osud, kde ho najít, patří k, sídlo, u koho je), Kdo tu je, Členové a Má u sebe, vztahy po skupinách, DM oddíly dole s odkazem, editor nabídne chybějící oddíly | ◐ |
| | Události z Kalendáře ve wiki: navázané karty, co se rozhodlo, události v kartě | ◐ |
| | Mapa (záložka): vazby a vztahy, malé úpravy, nástěnky; Otevřít v Obsidianu, F2 s odkazem | ◐ |
| | Mapa: výběr víc uzlů (Shift), přesun skupiny, Ctrl+Z, kruh a mřížka, fokus, hromadně Ve hře a Družina zná, paměť rozložení | ◐ |
| | Místa v místech: čára Leží v na mapě, cesta Mirabar › v kartě, Místa uvnitř, výběr Leží v | ◐ |
| | Mapa: podmísta sbalená do nadřazeného místa (odznak +N, Rozbalit místa), čára přes podmísta | ◐ |
| | Časová osa: pořadí událostí v dni (Kalendář ↑ ↓), na mapě pás událostí s hráčským kánonem, Předtím / Potom v kartě a události, Co se tu stalo u místa | ◐ |
| | Mapa: Rozložit podle (Síť, Čas, Čas a místa, Kdy a kde, Kdo a kdy, Blízkost, Spojenci a nepřátelé, Co družina ví, Zapomenutá vlákna, Mosty) | ◐ |
| | Přiřazení existujících míst (kam co patří), nová místa High Forest, Triboar, Cragy, Long Road | ✓ |
| | Čtecí verze kánonu na GitHub Pages: wiki, mapa, Pohled družiny, hledání; obnoví se po každém pushi | ◐ |
| | Úpravy na webu (pohled DM): editor karty z Hubu, Ve hře, Družina zná, přezdívky, oko a nové odrážky Co ví družina, oko u odstavců textu; ukládá se commitem přes GitHub API s osobním tokenem; stránka si novou verzi načte sama | ◐ |
| | Na webu chybí: nová karta, vazby a vztahy, Leží v, portrét, události, nástěnky (dál jen v Hubu) | ✗ |
| | Soubor na GitHubu: odkaz na soubor karty v editoru GitHubu (záloha) | ◐ |
| | Heslo na pohled DM ve čtecí verzi (pohled družiny otevřený, Zamknout DM) | ◐ |
| | Hráčská stránka na GitHub Pages (pohled družiny) | ✗ |
| **Verze 2** | Příprava Lazy DM, generátor obchodů, dílna portrétů, export do IIO | ✗ |

## Co je rozdělané (v tomto pořadí)

1. **Vyzkoušet u stolu** všechno označené ◐ (sezení 3, tábor lupičů). Návrhy v `ZADANI.md` DM potvrdil 19. 10.; co u stolu nefunguje, se opraví.
2. **Zjednodušit Kontrolu dat:** chybějící zvuky v jednom řádku s tlačítkem Doplnit, chyby nahoře.
3. **Zvuk u stolu po restartu:** ověřit, jestli prohlížeč chce kliknutí; když ano, otevírat ho v samostatném okně. Při zkoušce 24. 10. se stránka po Restartu z panelu nepřipojila vůbec (záznam: „Zvuk u stolu: neotevřená“), hrát začala až po ručním otevření.
4. **Zvuk před sezením 3:** stáhnout sadu (Nastavení → Zvuk → Doplnit chybějící zvuky), vyměnit zvuky, které vyšly špatně, a poslechnout playlisty. **Spotify:** nainstalovat VB-CABLE, poslat Spotify do kabelu, založit aplikaci na developer.spotify.com a přihlásit Hub (`reference/zvuk.md`, Hudba ze Spotify).
5. **Blok 3 Kánon:** rozpory R1–R16 jsou rozhodnuté (19. 10.). DM zazálohuje Notion, pak převod po skupinách podle `reference/kanon-prevod.md` (včetně návrhů vztahů). Kánon je wiki s editorem (◐): vyzkoušet, doplnit u karet Družina zná a odrážky Co ví družina, navázat události. Typové stránky: Claude navrhne hodnoty nových polí (role, osud, kde, patří k, druh, sídlo, u koho je) z textu karet, DM potvrdí. Zápis sezení 2 je z přepisu nahrávky hotový (◐): projít a doplnit, co přepis nezachytil.
6. **Verze 2.**

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
| Návody (zvuk, OBS, ilustrace, strop, zkouška v cloudu) | `reference/` |
| Prostředí pro zkoušku v cloudu (Codespaces) | `.devcontainer/` |
| Čtecí verze kánonu (GitHub Pages) | `hub/stranky/`, `hub/server/stranky.js`, `.github/workflows/stranky.yml`; úpravy na webu `hub/sdilene/upravy-webu.js` |
| Editor karty: živý náhled | `hub/panel/kanon-zivy-nahled.js`, CodeMirror 6 v `hub/panel/vendor/codemirror.js` (obnoví `npm run vendor:editor`) |
| Text karty kánonu (server i web) | `hub/sdilene/karta-kanonu.js`, `hub/sdilene/hlavicka.js`, `hub/sdilene/frontmatter.js` |
| Data kampaně | `kampan/` |
| List postavy (character sheet) | data `kampan/postavy/<id>/list.yaml`, popis polí `sablony/list-postavy.yaml`; výpočty `hub/sdilene/list-postavy-data.js`, vzhled `hub/panel/kanon-list.js` |
| Šablony pro nové soubory (Obsidian) | `sablony/` |
| Nástěnky mapy kánonu (uložená rozložení) | `kampan/nastenky/` |
| Kánon: audit, mapa a návod na převod | `reference/kanon-audit.md`, `reference/kanon-mapa.yaml`, `reference/kanon-prevod.md` |
| Kód Hubu a testy | `hub/` |
| Zvuky (mimo repo) | `Dokumenty\DnD\audio` |
| Záznam událostí (mimo repo) | `hub\.stav\zaznam\` |
