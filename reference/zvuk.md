# Zvuk u stolu (Blok 5)

Všechen zvuk hraje stránka `vystupy/zvuk-u-stolu.html` do BT reproduktoru u stolu (rozhodnutí 67):

| Co | Kudy | Kam |
| --- | --- | --- |
| **Hudba** scény, **ambient** místa a počasí, **hrom**, **efekty** | stránka `vystupy/zvuk-u-stolu.html` v okně prohlížeče | BT reproduktor u stolu |
| **Hudba** (jen když ji přepneš) | výstup `vystupy/hudba.html` jako zdroj *Browser* v OBS | TV přes monitorování zvuku v OBS |

Co hraje, určuje panel (místo, Den/Noc, počasí, souboj, Ticho). Stránky to jen plynule prolnou. Kde hraje hudba, přepneš v **Nastavení → Zvuk → Hudba hraje**.

**Ucpané uši při málo HP**: když je na tahu postava s 25 % HP a méně, hudba nezeslábne, ale zní tupě, jako přes ucpané uši (dolní propust, otevřený bod 73). V **Nastavení → Zvuk → Hudba a málo HP** zvolíš, jestli se tlumí jen hudba, nebo i ambient, a jak silně. **Vyzkoušet 12 s** pustí tlumení spolu s pulzem lampy.

## 1. Složka zvuku (jednou)

Zvukové soubory do veřejného repa nepatří (licence, rozhodnutí 63). `.gitignore` i pre-commit hook je odmítnou.

1. Vytvoř složku `Dokumenty\DnD\audio` (výchozí), nebo jinou a zadej ji v **Nastavení → Zvuk**.
2. Efekty pro tlačítka na U stolu (dveře, vlk, zvon …) dej do podsložky `efekty\`. Každý soubor tam je jedno tlačítko, popisek je jméno souboru.
3. Formáty: **mp3** nebo **ogg** (wav jde taky, jen je velký). m4a v OBS nemusí hrát. Na příponě v datech nezáleží: `dest.mp3` ve vrstvě najde i `dest.wav`.
4. Hub složku prohledá každých 30 s. Hned to udělá tlačítko **Načíst složku znovu**.

### Soubory, které čekají vrstvy v `kampan/sceny/`

| Soubor | Kde se hraje | Poznámka |
| --- | --- | --- |
| `dest.mp3` | ambient při dešti | sílí s intenzitou |
| `vitr-snih.mp3` | ambient při sněhu | sílí s intenzitou |
| `bourka.mp3` | ambient při bouřce | déšť a vítr, bez hromů |
| `hrom-1.mp3`, `hrom-2.mp3`, `hrom-3.mp3` | po každém blesku jeden náhodně | krátké (2–8 s); vzdálený Hub ztiší a utlumí |
| `souboj.mp3` | hudba v souboji | nahradí hudbu místa |
| `vitezstvi.mp3` | vítězná fanfára při Konci souboje | jednou, hudba uhne |
| `tahy/tusker.mp3`, `tahy/koudur.mp3`, `tahy/leta.mp3`, `tahy/alba.mp3`, `tahy/malk.mp3`, `tahy/nepritel.mp3` | zvuky na tah (`kampan/zvuky.yaml`) | krátké, do 2 s |

Jména můžeš změnit přímo v `kampan/sceny/…yaml`. Hudbu a ambient míst vybíráš v **Místa → místo → Zvuk**. Chybějící soubor ohlásí Kontrola dat a Sezení → Před hrou. Scéna pak hraje bez něj.

## 2. Hudba v OBS (jen když hudba hraje v OBS)

Výchozí je hudba z reproduktoru u stolu a tuhle část můžeš přeskočit. Zdroj `Hub – hudba` pak v OBS nic nepouští, klidně ho smaž.

Když OBS „nic nehraje“ ani se zkušebním zvukem, je to skoro vždy monitorování: se zaškrtnutým *Control audio via OBS* jde zvuk jen do mixu OBS (do streamu a nahrávky) a z reproduktorů ho uslyšíš, jen když má zdroj zapnuté monitorování (bod 4).

1. V OBS přidej zdroj **Browser** jménem `Hub – hudba` s adresou z **Nastavení → Výstupy pro OBS → Hudba** (`http://localhost:7420/vystupy/hudba.html`), velikost 100 × 100.
2. Zaškrtni **Control audio via OBS**. Nech vypnuté *Shutdown source when not visible* i *Refresh browser when scene becomes active*.
3. Zdroj přidej **do každé scény** přes *Add Existing* (stejný zdroj, ne kopie). OBS pouští zvuk jen ze zdrojů v aktivní scéně.
4. Zvuk na TV: **Nastavení → Zvuk → Pokročilé → Zařízení pro monitorování** = TV (HDMI). U zdroje `Hub – hudba` pak **Upřesnit vlastnosti zvuku → Monitorování zvuku** = *Pouze monitorovat (ztlumit výstup)*. Pokud streamuješ nebo nahráváš, zvol *Monitorovat a výstup*.
5. Zkouška: **Nastavení → Zvuk → Zkušební zvuk v OBS**. Z TV zazní tři stoupající tóny.

## 3. Zvuk u stolu do BT reproduktoru (jednou)

1. BT reproduktor spáruj s PC. Lepší je reproduktor na síťovém napájení, bateriové se po čase uspí.
2. Spouštěč otevře stránku **Zvuk u stolu** sám (vypíná se v Nastavení → Zvuk), jinak ji otevři v **Nastavení → Zvuk → Otevřít Zvuk u stolu**.
3. Klikni na **Zapnout zvuk u stolu**. Prohlížeč pustí zvuk až po kliknutí, po každém otevření stránky jednou.
4. **Vybrat reproduktor**: prohlížeč se zeptá na mikrofon. Hub ho nepoužívá, bez povolení by ale prohlížeč neukázal jména reproduktorů. Vyber BT reproduktor. Volba se pamatuje.
   - Jiná cesta: ve Windows **Nastavení → Systém → Zvuk → Směšovač hlasitosti** nastav výstup prohlížeče na BT reproduktor. Tahle volba platí pro celý prohlížeč, takže se hodí, když panel běží v jiném prohlížeči než Zvuk u stolu.
5. **Zkušební zvuk** zahraje tři tóny z vybraného reproduktoru, i když je zapnuté Ticho.
6. Okno nech otevřené celou hru (klidně minimalizované).

Když se reproduktor odpojí (vybije se, je mimo dosah), stránka hraje dál na výchozí zařízení, kontrolka **Zvuk** v liště zežloutne a Sezení to napíše. Po připojení se zvuk vrátí sám. Světla běží dál.

## 4. Soundboard a zvuky na tahu

Soundboard je na **U stolu** ve sloupci Ve hře teď pod posuvníky. Hraje do stejného reproduktoru jako zbytek zvuku.

### Složky

| Složka ve složce zvuku | Co to je | Jak se chová |
| --- | --- | --- |
| `jednorazove\<kategorie>\` | jednorázové zvuky (šplouchnutí, výkřik, vytí) | klik = jedno přehrání, hudba na chvíli uhne |
| `smycky\<kategorie>\` | delší smyčky (poplašný zvon, oheň, řeka) | klik zapne, další klik vypne; náběh a doběh 1,5 s |
| `tahy\` | zvuky na tah v souboji | hraje je Hub sám |
| `efekty\` | původní ruční efekty | jako jednorázové, kategorie „efekty“ |

Podsložka = kategorie v Knihovně (`jednorazove\boj\`, `jednorazove\zvirata\` …). **Varianty**: `mec-1.mp3`, `mec-2.mp3`, `mec-3.mp3` jsou jedno tlačítko „Mec“. Hub zahraje náhodnou variantu (nikdy dvakrát stejnou za sebou) a pokaždé trochu jinou výškou a hlasitostí.

### Připnutí k místu a klávesy

1. **Knihovna…** v kartě Soundboard ukáže všechny zvuky s hledáním.
2. **☆** připne zvuk k místu, které je ve scéně. Připnuté zvuky jsou pak na U stolu přímo pod rukou, pořadí = klávesy **1–9**.
3. Klávesa **0** (nebo **Zastavit smyčky**) vypne všechny zapnuté smyčky. Ticho ztlumí všechno jako dřív.
4. Klávesy nefungují při psaní do pole a v otevřeném dialogu.
5. Soundboard funguje i z iPadu přes domácí síť. Zvuk hraje dál PC u stolu.

### Popisky a smyčky s koncem: `kampan/zvuky.yaml`

Bez zápisu je popisek jméno souboru (bez háčků a čárek). Hezčí popisek a automatický konec smyčky:

```yaml
zvuky:
  smycky/poplasny-zvon: { nazev: Poplašný zvon, limit_s: 20 }
  jednorazove/boj/vykrik: { nazev: Výkřik }
```

### Zvuky na tahu

Během souboje Hub každou sekundu čte Player View z Improved Initiative. Když se změní, kdo je na tahu, zahraje krátký zvuk podle `kampan/zvuky.yaml`:

```yaml
tahy:
  postavy:
    Tusker: tahy/tusker
    Alba:
      vychozi: tahy/alba
      podle_tagu:
        Vlk: zvirata/vlk-vyti      # Divoká podoba
  tagy:
    Unconscious: tahy/srdce        # kdokoli na tahu s tímto tagem
  nepratele: tahy/nepritel         # jeden společný zvuk pro ostatní bytosti
```

- Jméno se hledá podle začátku: `Alba` najde i „Alba Nox“.
- **Albiny podoby**: když se Alba promění, přidej jí v Improved Initiative tag s názvem podoby (třeba „Vlk“). Tag musí být viditelný pro hráče: skryté tagy Player View neposílá.
- Pořadí: tag postavy → tag pro kohokoli → výchozí zvuk postavy → společný zvuk nepřátel. Postava hráče bez zápisu zůstane potichu.
- Vypínač **Zvuky tahů** je v záložce Souboj. **Jen postavy hráčů** (bez zvuku nepřátel) je v Nastavení → Zvuk.
- Chybějící zvuky z mapy ohlásí Kontrola dat.

### Vítězná fanfára

**Konec souboje** zahraje `vitezstvi.mp3` (`zvuk.konec` v `kampan/sceny/rezim/souboj.yaml`). Při útěku nebo prohře použij v záložce Souboj **Konec bez fanfáry**.

### Náhodné zvuky, vzdálenost a dozvuk místa

Nastavuje se v **Místa → místo → Zvuk** (otevřený bod 85):

| Co | Kde | Jak zní |
| --- | --- | --- |
| **Náhodné zvuky** | u dne, noci a souboje, nejvýš 8 | krátké zvuky, které se samy občas ozvou pod ambientem: kůň, kovadlina, krkavec; v boji řinčení a výkřiky |
| **Vzdálenost ambientu** | u dne, noci a souboje | posuvník od „u stolu“ po „hodně daleko“: ambient je tišší a tupější |
| **Dozvuk** | jednou pro celé místo | Bez dozvuku (venku), Místnost, Kobka, Velký sál, Jeskyně |

Náhodný zvuk má tyto volby:

- **Každých (s)**: průměrný odstup, 3 s až 10 min.
- **Nahodilost**: „pravidelně“ hraje přesně po odstupu, „hodně“ kdykoli mezi nulou a dvojnásobkem.
- **Hlasitost** a **Vzdálenost**: vzdálený zvuk je tišší a bez výšek, jako zpoza tábora.

Další pravidla:

- Varianty `kun-1.mp3`, `kun-2.mp3` … se střídají (nikdy dvakrát stejná). Každé zaznění má trochu jinou výšku a přijde náhodně zleva nebo zprava.
- Soubory dej do `nahodne\<kategorie>\` (třeba `nahodne\tabor\kun-1.mp3`). Vybrat jde i jednorázový zvuk soundboardu.
- Náhodné zvuky hrají s hlasitostí Ambient a v souboji se ztlumí jako ambient místa. Ticho je vypne a ucpané uši s volbou „vše“ je utlumí.
- **Dozvuk** platí pro náhodné zvuky a pro soundboard (tlačítka i smyčky). Ambient a hudba zůstávají, jak jsou nahrané, protože nahrávky z jeskyně svou ozvěnu už mají. Zvuky na tah, fanfára a hrom jdou bez dozvuku.
- Počasí může mít náhodné zvuky taky. Zapisují se ručně do `kampan/sceny/pocasi/*.yaml` (viz README tamtéž).
- Chybějící náhodný zvuk ohlásí Kontrola dat. Stránka Zvuk u stolu ukáže, které náhodné zvuky hrají a jaký je dozvuk.

**Souboj místa**: třetí řádek vedle Den a Noc. Co u něj nastavíš, v souboji nahradí zvuk místa:

- **Hudba** nahradí hudbu souboje z `kampan/sceny/rezim/souboj.yaml`.
- **Ambient** a **Náhodné zvuky** nahradí ambient a náhodné zvuky místa a hrají naplno.
- Co nenastavíš, platí jako dřív: hudba souboje a ztlumený ambient a náhodné zvuky místa.

Třeba tábor: mimo boj oheň, koně a kovadlina; v boji ambient bitvy, řinčení zbraní a výkřiky.

V hlavičce místa vypadá zápis takto:

```yaml
zvuk:
  dozvuk: jeskyne
  den:
    ambient: tabor-ohen.mp3
    vzdalenost: 0.2
    nahodne:
      - { zvuk: nahodne/tabor/kun, kazdych_s: 60, nahodilost: 0.7, hlasitost: 0.8, vzdalenost: 0.7 }
  souboj:
    ambient: tabor-bitva.mp3
    nahodne:
      - { zvuk: nahodne/boj/rinceni, kazdych_s: 8, nahodilost: 0.8, hlasitost: 0.7, vzdalenost: 0.4 }
```

## 5. Zvuková sada z Freesoundu a srovnání hlasitosti

Soubory nemusíš stahovat, stříhat ani srovnávat ručně (otevřený bod 86).

### Zvuková sada

Hub hledá zvuky ve dvou zdrojích (otevřené body 86 a 87):

| Zdroj | Co v něm je | Klíč |
| --- | --- | --- |
| **Freesound** | největší knihovna zvukových efektů, hledá se jako první | ano, zdarma (`freesound.org/apiv2/apply`) |
| **Openverse** | vyhledávač nad volně licencovanými zvuky: Freesound, Wikimedia Commons, Jamendo, ccMixter a další | ne |

Třetí zdroj jsou **balíčky Kenney** (kenney.nl, CC0): položka sady s `balik: kenney/<balíček>` a `soubory: [jména]` vezme jmenované soubory z balíčku. ZIP se stáhne jednou do `baliky\kenney_<balíček>.zip` ve složce zvuku a dál se pracuje lokálně (balíček tam jde dát i ručně). Ve složce už jsou RPG Audio, Impact Sounds, Music Jingles a Voiceover Pack: Fighter.

Bez klíče Freesound tedy sada funguje taky: Openverse najde i CC0 zvuky z Freesoundu, jen s menším výběrem. Pixabay ani Mixkit veřejné API na zvuky nemají, ty jdou jen ručně.

1. (Nepovinně) Na [freesound.org](https://freesound.org) si založ účet a na `freesound.org/apiv2/apply` vytvoř klíč. Vlož ho v **Nastavení → Zvuk → Zvuková sada**. Zůstane jen v `hub/.env`.
2. Klikni na **Doplnit chybějící zvuky**. Hub projde `kampan/zvuky-sada.yaml`, pro každou položku najde zvuky se zadanou délkou a povolenou licencí, stáhne je a pojmenuje podle sady (`nahodne\tabor\kun-1.mp3` …). Soubor z Wikimedia Commons může mít příponu `.ogg` nebo `.wav`; data i Hub ho najdou stejně.
3. V tabulce si každý soubor poslechneš (▶, v popisku je autor, licence a zdroj). **↻** u souboru vymění jen tuhle variantu, **Vyměnit vše** celou položku. Hub stáhne další zvuk v pořadí a ten starý už znovu nenabídne.

- **Licence**: vždy CC0 a public domain. Položka může dovolit i CC BY (`licence: [cc0, by]`), třeba kvůli hudbě z Jamenda. Na soukromé hraní stačí, autory máš v `zdroje.json`.
- Autory, názvy, odkazy a zdroj Hub zapíše do `zdroje.json` ve složce zvuku.
- Tvoje vlastní soubory se stejným jménem Hub nepřepíše; přepíše je jen tlačítkem Vyměnit.
- Když jeden zdroj nejde (špatný klíč, limit), Hub hledá dál v dalším a chybu napíše pod tlačítko.
- Co do sady patří, upravíš v `kampan/zvuky-sada.yaml` (`hledat` anglicky, `delka: [od, do]`, `variant`, `licence`).
- `hledat` může být i seznam náhradních dotazů (`hledat: [lute strum, harp strum]`). Když nic nenajde, Hub dotaz o 3 a víc slovech zkusí zkrátit.
- Zvuk z balíčku nemá „další v pořadí“: vymění se přepsáním jména v `soubory`. Jména souborů najdeš v ZIPu ve složce `baliky`.

### Srovnání hlasitosti

Stránka Zvuk u stolu každý soubor jednou změří (hlasitost v LUFS, špička, ticho na začátku). Hub pak při přehrávání každému souboru přidá zesílení nebo zeslabení na hladinu jeho druhu. Soubory se nemění.

| Druh | Výchozí hladina |
| --- | --- |
| Hudba | −18 LUFS |
| Ambient (déšť, bouřka, oheň) | −24 LUFS |
| Náhodné zvuky | −24 LUFS (k tomu hlasitost a vzdálenost u místa) |
| Soundboard, zvuky na tah, fanfára | −18 LUFS |
| Hrom | −16 LUFS |

- Zesílení je nejvýš +12 dB a nikdy nepřekročí špičku souboru. Zeslabení je nejvýš −20 dB.
- U krátkých zvuků Hub přeskočí ticho na začátku. Hrom tak přijde hned po blesku.
- Zvuk na tah delší než 2,5 s se plynule ztlumí.
- Hladiny a vypínač jsou v **Nastavení → Zvuk → Srovnání hlasitosti**. Posuvníky Hudba, Ambient a Efekty pak dolaďují už srovnané zvuky.
- Měření běží na pozadí, když je otevřená stránka Zvuk u stolu (asi 1–3 s na soubor). Změněný soubor Hub změří znovu sám.

## 6. Příprava souborů

- **Smyčky**: Hub dlouhé soubory (8 s a víc) na konci prolne se začátkem (3 s), takže šev neslyšíš ani u MP3. Nejlépe znějí smyčky, které nemají na konci vyznění do ticha. U krátkých souborů do 8 s smyčka jen začne znovu.
- **Hlasitost**: srovnej soubory na podobnou hlasitost (Audacity: *Efekty → Hlasitost a komprese → Normalizace hlasitosti*, cíl −16 LUFS pro hudbu, −20 LUFS pro ambient). Jemně pak dolaďuješ posuvníky Hudba a Ambient na U stolu.
- **Hrom**: krátké soubory bez ticha na začátku, jinak přijde pozdě po blesku.
- **Náhodné zvuky**: krátké (1–6 s), bez ticha na začátku a na konci, ideálně 2–5 variant od jednoho zvuku.
- **Délka**: ambient 2–10 minut stačí. Dlouhé soubory Hub nenačítá celé do paměti.

## 7. Zdroje (licence ověř u každého souboru)

| Zdroj | Na co | Licence |
| --- | --- | --- |
| Tabletop Audio | ambienty pro RPG (les, hospoda, bouře, město) | volně pro soukromé hraní, podmínky na webu |
| Freesound.org | hrom, déšť, dveře, zvířata | CC0 nebo CC BY, u každého souboru zvlášť |
| Incompetech (Kevin MacLeod) | hudba | CC BY |
| YouTube Audio Library | hudba a efekty | podle položky |

Soubory zůstávají jen doma, takže stačí licence pro soukromé hraní.
