# Obloha na strop (projektor)

Projektor svítí na strop oblohu (nebo les, tábor, jeskyni, interiér), která se řídí scénou z Hubu. Není to obrazovka s obrázky, ale velké světlo s pohybem: mraky, hvězdy, mlha, sníh, bouřka s blesky. Hráči ho vnímají periferně, nemusí se na něj dívat (inspirace: IllumiRoom od Microsoft Research, divadelní efektové projektory).

Výstup je `vystupy/strop.html`. Adresu najdeš v Nastavení → Výstupy pro OBS → Strop.

## Co obloha ukazuje

| Ve scéně | Na stropě |
| --- | --- |
| Den | Modré nebe s mraky, zenit uprostřed sytější |
| Noc | Tmavé nebe, hvězdy a měsíc |
| Déšť | Husté šedé mraky, rychlejší |
| Sníh | Mraky a snášející se vločky |
| Mlha | Šedý závoj, mraky skoro stojí |
| Bouřka | Těžké tmavé mraky, které se valí. Měsíc za nimi zmizí |
| Blesk (sám při bouřce, nebo tlačítko Blesk v Hubu) | **Daleko:** slabá záře u kraje stropu. **Blízko:** jasná skvrna v mracích, dva pulzy. **Nad námi:** celý strop, tři pulzy a klikatice blesku |
| Intenzita 1–3 | Tmavší, mraky rychlejší |
| Souboj | Rudý nádech, neklidnější pohyb |
| Málo HP | Kraje tepou do červena v rytmu lampy |

Změny se prolínají: počasí asi 3 s, den a noc asi 4 s. Blesky drží limit 3 záblesky za sekundu jako světla a obraz (rozhodnutí 64). Blesky přicházejí z Hubu, takže je vypne i vypínač Blesky v Nastavení. Strop blýská i bez zapnutého Řídit světla, stejně jako obraz v OBS.

## Ptáci

Přes strop občas přeletí ptáci. Letí pod mraky, v lese se schovávají za listím a drží se tvaru i masek.

| Kdo | Jak letí | Kdy sami |
| --- | --- | --- |
| Hejno | 35–70 špačků, drží se pohromadě a vlní se | Ve dne venku za pěkného počasí; jedno hejno uletí taky na začátku bouřky |
| Klín | 9–17 hus ve tvaru V, pomalu mávají a občas plachtí | Ve dne venku za pěkného počasí |
| Netopýři | Pár netopýrů, cik cak; nad táborem je zespodu chytá záře ohně | V noci v táboře a v lese, v jeskyni kdykoli |

Sami přiletí asi jednou za 1–4 minuty, v souboji ne. Vypnout to jde v kalibraci (Ptáci přeletí sami). Hned je pošleš z Hubu: **U stolu → Strop → Hejno / Klín / Netopýři**, nebo na stropě klávesou **P** (vybere podle doby a motivu) a ve zkoušce tlačítky Přelet.

## Motiv podle místa

Co je na stropě, určuje místo ve scéně. Nastavuje se v **Místa → Zvuk → Prostor → Strop**:

| Motiv | Na stropě | Počasí a blesky |
| --- | --- | --- |
| Nebe | Obloha, jak je popsaná výše | Všechno |
| Les | Pohled vzhůru korunami: hustě u krajů, uprostřed průhled na nebe, listí se kývá ve větru | Nebe v průhledu, vítr podle počasí |
| Tábor | Nebe a teplá záře ohně od kraje, jiskry stoupají | Všechno |
| Jeskyně | Skála s puklinami, odlesky vody, světlo pochodně u kraje | Žádné, blesk jen slabě prosvitne vchodem |
| Interiér | Trámy, uprostřed mihotavé světlo svícnu | Žádné, blesk jen slabě prosvitne okny |

Bez volby (**Podle dozvuku**) vybere motiv dozvuk místa: jeskyně a kobka → Jeskyně, místnost a sál → Interiér, jinak Nebe. Většina míst tak nepotřebuje nic nastavovat. V hlavičce místa je to pole `strop: les`.

## Spuštění

**Okno prohlížeče (doporučené):**

1. Projektor připoj k PC jako další displej (Windows: Win+P → Rozšířit).
2. V Edgi otevři adresu stropu a okno přetáhni na displej projektoru.
3. Klikni do okna a dej **F11** (celá obrazovka). Kurzor nad oblohou zmizí.

**Přes OBS:** zdroj Browser `Hub – strop` (1920 × 1080) ve vlastní scéně Strop, pravým klikem na scénu **Projektor na celou obrazovku (scéna)** → displej projektoru. Kalibrovat pak jde z druhého okna stropu v prohlížeči (viz níže), protože do projektoru OBS se klikat nedá.

## Kalibrace (klávesa K)

1. Na stropě se ukáže mřížka a čtyři kolečka 1–4.
2. Přetáhni kolečka tam, kde má obloha končit. Mřížka má na stropě vypadat pravoúhle (projektor svítí šikmo, takže obraz je lichoběžník a kolečka ho vyrovnají). Jemně: klikni na kolečko a posouvej šipkami, se Shiftem víc.
3. **Okraj:** jak široký je přechod do tmy. Ostrá hrana obdélníku kazí iluzi nejvíc, výchozích 12 % je dobrý start.
4. **Jas:** projektor svítí celou místnost, výchozích 75 %. Když přebíjí světla Hue nebo bledne čtení deníků, ubírej.
5. **Převrátit ↔ / ↕:** projektor přes zrcadlo pod 45° dává zrcadlově obrácený obraz.
6. **Tvar:** **Volný, mění se** (výchozí) udělá z obdélníku nepravidelnou plochu s cárovitým okrajem, která se pomalu přelévá; v bouřce a v souboji rychleji. **Členitost** říká, jak moc: 0 % je skoro ovál, 100 % roztrhané cáry. **Obdélník** drží plochu podle rohů jen s měkkým okrajem. Při kalibraci je tvar vidět jako světlejší plocha v mřížce.
7. **Masky:** **+ Nová maska**, pak klikáním obtáhni místo, kam projektor nemá svítit (svítidlo, skříň, kus stěny), a **Enter** (nebo Uzavřít masku). Esc kreslení zruší. Body hotové masky jdou táhnout, pravý klik bod smaže, **× Maska N** smaže celou. Nejvýš 8 masek. Maska drží na místě na stropě, i když pak posuneš rohy.
8. **Hotovo** nebo znovu K. Panel kalibrace jde přesunout na druhou stranu, když zakrývá roh.

Kalibrace se ukládá v Hubu (`hub/.stav/strop.json`, nastavení tohoto PC). Platí pro všechna okna stropu naráz, takže jde kalibrovat i **z druhého okna na monitoru**: otevři adresu stropu v běžném okně, dej K a táhni kolečka tam. Strop na projektoru se hýbe s tebou.

## Zkouška (klávesa Z)

Panel Zkouška oblohy přepíná motiv, den a noc, počasí, vzdálenost bouřky, intenzitu, souboj a málo HP **jen pro strop**, Hub, OBS ani světla se nezmění. S bouřkou ve zkoušce blýská obloha sama, **⚡ Blesk** (nebo klávesa **B**) blýskne hned. Zkouška platí pro všechna okna stropu v tomtéž prohlížeči, takže se dá ovládat z okna na monitoru. **Zpět podle Hubu** vrátí oblohu na scénu z Hubu.

Do rohu vypíše, co obloha právě ukazuje, adresa s `?ladeni`.

## Tipy k projektoru

- **Málo místa:** projektor polož na polici a před objektiv dej zrcadlo pod 45°, které paprsek otočí nahoru. Slabý dvojitý obraz z běžného zrcadla u měkké oblohy nevadí. Pak v kalibraci Převrátit.
- **Ostrost je skoro jedno:** obloha je záměrně měkká a kreslí se v polovičním rozlišení (`?kvalita=1` = plné, když máš ostrý projektor a výkonné PC).
- **Černá není černá:** projektor i v černé trochu svítí, v tmavé herně je vidět šedý obdélník. Volný tvar a masky ho nezmizí (svítí celý čip projektoru), pomůže nižší jas a tmavší motiv.
- **Bílý strop odráží hodně:** obloha nasvítí celou místnost. Ve dne je to výhoda (modré světlo shora), v noci uber jas.
