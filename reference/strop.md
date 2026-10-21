# Obloha na strop (projektor)

Projektor svítí na strop oblohu, která se řídí scénou z Hubu. Není to obrazovka s obrázky, ale velké světlo s pohybem: mraky, hvězdy, mlha, sníh, bouřka s blesky. Hráči ho vnímají periferně, nemusí se na něj dívat (inspirace: IllumiRoom od Microsoft Research, divadelní efektové projektory).

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
6. **Hotovo** nebo znovu K.

Kalibrace se ukládá v Hubu (`hub/.stav/strop.json`, nastavení tohoto PC). Platí pro všechna okna stropu naráz, takže jde kalibrovat i **z druhého okna na monitoru**: otevři adresu stropu v běžném okně, dej K a táhni kolečka tam. Strop na projektoru se hýbe s tebou.

## Zkouška (klávesa Z)

Panel Zkouška oblohy přepíná den a noc, počasí, vzdálenost bouřky, intenzitu, souboj a málo HP **jen pro strop**, Hub, OBS ani světla se nezmění. S bouřkou ve zkoušce blýská obloha sama, **⚡ Blesk** (nebo klávesa **B**) blýskne hned. Zkouška platí pro všechna okna stropu v tomtéž prohlížeči, takže se dá ovládat z okna na monitoru. **Zpět podle Hubu** vrátí oblohu na scénu z Hubu.

Do rohu vypíše, co obloha právě ukazuje, adresa s `?ladeni`.

## Tipy k projektoru

- **Málo místa:** projektor polož na polici a před objektiv dej zrcadlo pod 45°, které paprsek otočí nahoru. Slabý dvojitý obraz z běžného zrcadla u měkké oblohy nevadí. Pak v kalibraci Převrátit.
- **Ostrost je skoro jedno:** obloha je záměrně měkká a kreslí se v polovičním rozlišení (`?kvalita=1` = plné, když máš ostrý projektor a výkonné PC).
- **Černá není černá:** projektor i v černé trochu svítí, v tmavé herně je vidět šedý obdélník. Pomůže širší okraj a nižší jas.
- **Bílý strop odráží hodně:** obloha nasvítí celou místnost. Ve dne je to výhoda (modré světlo shora), v noci uber jas.
