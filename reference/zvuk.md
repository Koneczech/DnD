# Zvuk u stolu a hudba na TV (Blok 5)

Hub pouští dvě věci:

| Co | Kudy | Kam |
| --- | --- | --- |
| **Hudba** scény | výstup `vystupy/hudba.html` jako zdroj *Browser* v OBS | TV (přes monitorování zvuku v OBS) |
| **Ambient** místa a počasí, **hrom**, **efekty** | stránka `vystupy/zvuk-u-stolu.html` v okně prohlížeče | BT reproduktor u stolu |

Co hraje, určuje panel (místo, Den/Noc, počasí, souboj, Ticho). Stránky to jen plynule prolnou.

## 1. Složka zvuku (jednou)

Zvukové soubory do veřejného repa nepatří (licence, rozhodnutí 63). `.gitignore` i pre-commit hook je odmítnou.

1. Vytvoř složku `Dokumenty\DnD\audio` (výchozí), nebo jinou a zadej ji v **Nastavení → Zvuk**.
2. Efekty pro tlačítka na U stolu (dveře, vlk, zvon …) dej do podsložky `efekty\`. Každý soubor tam je jedno tlačítko, popisek je jméno souboru.
3. Formáty: **mp3** nebo **ogg** (wav jde taky, jen je velký). m4a v OBS nemusí hrát.
4. Hub složku prohledá každých 30 s. Hned to udělá tlačítko **Načíst složku znovu**.

### Soubory, které čekají vrstvy v `kampan/sceny/`

| Soubor | Kde se hraje | Poznámka |
| --- | --- | --- |
| `dest.mp3` | ambient při dešti | sílí s intenzitou |
| `vitr-snih.mp3` | ambient při sněhu | sílí s intenzitou |
| `bourka.mp3` | ambient při bouřce | déšť a vítr, bez hromů |
| `hrom-1.mp3`, `hrom-2.mp3`, `hrom-3.mp3` | po každém blesku jeden náhodně | krátké (2–8 s); vzdálený Hub ztiší a utlumí |
| `souboj.mp3` | hudba v souboji | nahradí hudbu místa |

Jména můžeš změnit přímo v `kampan/sceny/…yaml`. Hudbu a ambient míst vybíráš v **Místa → místo → Zvuk**. Chybějící soubor ohlásí Kontrola dat a Sezení → Před hrou. Scéna pak hraje bez něj.

## 2. Hudba v OBS (jednou)

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

Když se reproduktor odpojí (vybije se, je mimo dosah), stránka hraje dál na výchozí zařízení, kontrolka **Zvuk** v liště zežloutne a Sezení to napíše. Po připojení se zvuk vrátí sám. Hudba v OBS i světla běží dál.

## 4. Příprava souborů

- **Smyčky**: Hub dlouhé soubory (8 s a víc) na konci prolne se začátkem (3 s), takže šev neslyšíš ani u MP3. Nejlépe znějí smyčky, které nemají na konci vyznění do ticha. U krátkých souborů do 8 s smyčka jen začne znovu.
- **Hlasitost**: srovnej soubory na podobnou hlasitost (Audacity: *Efekty → Hlasitost a komprese → Normalizace hlasitosti*, cíl −16 LUFS pro hudbu, −20 LUFS pro ambient). Jemně pak dolaďuješ posuvníky Hudba a Ambient na U stolu.
- **Hrom**: krátké soubory bez ticha na začátku, jinak přijde pozdě po blesku.
- **Délka**: ambient 2–10 minut stačí. Dlouhé soubory Hub nenačítá celé do paměti.

## 5. Zdroje (licence ověř u každého souboru)

| Zdroj | Na co | Licence |
| --- | --- | --- |
| Tabletop Audio | ambienty pro RPG (les, hospoda, bouře, město) | volně pro soukromé hraní, podmínky na webu |
| Freesound.org | hrom, déšť, dveře, zvířata | CC0 nebo CC BY, u každého souboru zvlášť |
| Incompetech (Kevin MacLeod) | hudba | CC BY |
| YouTube Audio Library | hudba a efekty | podle položky |

Soubory zůstávají jen doma, takže stačí licence pro soukromé hraní.
