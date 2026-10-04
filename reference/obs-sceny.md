# Scény a zdroje v OBS

## Kolekce DnD 2 (Blok 2)

Od Bloku 2 platí kolekce **DnD 2** (`Documents\DnD\OBS\DnD-2-sceny.json`, import přes *Kolekce scén → Importovat*):

| Scéna | Zdroje odspodu nahoru |
| --- | --- |
| Start | Obrázek – start (`repo/kampan/obs/start.png`), Hub – rekapitulace, Hub – odpočet |
| Místo | Hub – místo (`/vystupy/misto.html`, 1920 × 1080), Hub – medailon |
| Mapa | Obrázek – mapa (`repo/kampan/obs/mapa.png`), Hub – medailon |
| Obchod | Hub – obchod (`/vystupy/obchod.html`: obrázek obchodu + ceník) |
| Pauza | Obrázek – pauza (`repo/kampan/obs/pauza.png`), Text – pauza |
| Boj | Improved Initiative |
| TEST | do akceptace |

Scény Mirabar, Longsaddle, Lurkwood a Cesta nahradila scéna **Místo**: místo, ilustraci, den/noc, počasí a intenzitu přepínáš v Hubu na obrazovce Místa. V Hubu nastav scénu místa na *Místo* a scénu obchodu na *Obchod*.

### Role scén a obrazovka U stolu

Hub neví, jak se scény jmenují, dokud mu to neřekneš. Na obrazovce **U stolu** dole je tabulka **Role scén**:

| Role | Co dělá | Doporučená scéna |
| --- | --- | --- |
| Start | Pod dlaždicí se ukáže odpočet | Start |
| Místo | Pod dlaždicí místo, den/noc, počasí, intenzita, ilustrace; na ni přepne Ukázat v OBS | Místo |
| Obchod | Pod dlaždicí sortimenty; na ni přepne Ukázat v OBS | Obchod |
| Souboj | Na ni přepne tlačítko Souboj | Boj |
| Po doběhnutí odpočtu | Hub na ni přepne jednou, hned jak odpočet doběhne | Místo |

Dlaždice scén jsou přímo scény z OBS. Klik přepne OBS a pod dlaždicí se ukáže ovládání té role. Scény bez role (Mapa, Pauza, TEST) se jen přepnou.

Níže je původní revize z Bloku 1b.


Revize kolekce scén z PC u stolu (3. 10. 2026). Popisuje, co v OBS je, co je potřeba změnit a jak má sestava vypadat až do Bloku 2. DM odpověděl na otázky revize (níže); sestava je **⚠ návrh** k akceptaci Bloku 1b (Otevřený bod 29 v `ZADANI.md`).

## Co v OBS je dnes

Kolekce scén se jmenuje „Nepojmenované“. Má 11 scén.

| Scéna | Zdroje | Poznámka |
| --- | --- | --- |
| Start | `start.png`, malý orloj (starý soubor), velký orloj (starý soubor, skrytý), odpočet z Hubu | |
| Cesta | `start.png`, malý orloj (starý soubor), velký orloj (skrytý) | Kopie Startu bez odpočtu |
| Ambient_cesta | Prezentace „Obrázková prezentace 3“, malý orloj | **Prezentace je stejná jako v Longsaddle, takže tu běží obrázky Longsaddle** |
| Mirabar | Prezentace: složka `OBS/src/Mirabar` a k tomu 5 souborů z `src/places/mirabar` | Obrázky se v prezentaci nejspíš opakují |
| Longsaddle | Prezentace „Obrázková prezentace 3“ (`src/places/Longsaddle`), malý orloj | |
| Lurkwood | Prezentace (`src/places/Lurkwood`) | Bez kalendáře |
| Mapa | `map.png`, malý orloj | |
| Obchod | `src/obs/obchod/obchod.png`, ceník ze souboru `Apps/Shop/cenik.html` | Ceník zatím jde mimo Hub |
| Pause | `pause.png`, text „We'll be back soon...“ | Text je anglicky |
| Boj | Improved Initiative (carousel) | V pořádku |
| TEST | `test.html`, `rekapitulace.html` z Hubu | Jen na zkoušky |

Problémy:

1. Kalendář se na pěti místech čte ze starého `Apps/Calendar/kalendar.html` přes `file://`. Ten se od Bloku 1b dál nevyvíjí a nevidí data v repu.
2. Ceník čte starý `Apps/Shop/cenik.html`, takže Ukázat v OBS z Hubu se v něm neprojeví.
3. Zdroje mají obecná jména (Prohlížeč 2–6, Obrázek 2 a 3), takže není poznat, co je co.
4. Ambient_cesta omylem sdílí prezentaci s Longsaddle.
5. Scény Start a Cesta jsou skoro totožné.
6. V kolekci nejsou žádné klávesové zkratky scén. Numpad DM zatím nepoužíval; scény se přepínají v Hubu (Scény OBS, Souboj, Ukázat v OBS) a nouzově klikem přímo v OBS.

## Cílová sestava do Bloku 2

Zásady:

- **Jeden zdroj, víckrát použitý.** Zdroj z Hubu se vytvoří jednou a do dalších scén se vloží přes *Přidat → Existující*. Změna adresy pak platí všude.
- **Jména podle obsahu**, ne podle typu.
- Výstupy Hubu jdou vždy přes `http://127.0.0.1:7420/vystupy/…`. U každého Browser Source nech vypnuté *Shutdown source when not visible* i *Refresh browser when scene becomes active*.

Sdílené zdroje z Hubu:

| Jméno zdroje | Adresa | Velikost zdroje |
| --- | --- | --- |
| Hub – medailon | `/vystupy/kalendar-maly.html` | 1000 × 270 |
| Hub – orloj | `/vystupy/kalendar-velky.html` | 1080 × 1080 |
| Hub – rekapitulace | `/vystupy/rekapitulace.html` | 1920 × 1080 |
| Hub – odpočet | `/vystupy/odpocet.html` | podle současného |
| Hub – ceník | `/vystupy/cenik.html` | 640 × 1080, pozice 1280, 0 |

Scény (v tomto pořadí):

| Scéna | Zdroje odspodu nahoru | Změna proti dnešku |
| --- | --- | --- |
| Start | Obrázek – start, Hub – rekapitulace, Hub – odpočet | Rekapitulace místo dvou starých orlojů |
| Mirabar | Prezentace – Mirabar, Hub – medailon | Prezentace jen z jedné složky, přidat medailon |
| Longsaddle | Prezentace – Longsaddle, Hub – medailon | Medailon z Hubu |
| Lurkwood | Prezentace – Lurkwood, Hub – medailon | Přidat medailon |
| Cesta | Prezentace – cesta (`src/places/Cesta`, včetně `tabor.png`), Hub – medailon | Nahradí starou Cestu i Ambient_cesta |
| Mapa | Obrázek – mapa, Hub – medailon | Medailon z Hubu |
| Obchod | Obrázek – obchod, Hub – ceník | Ceník z Hubu |
| Pauza | Obrázek – pauza, Text – pauza („Za chvíli pokračujeme…“) | Přejmenovat, text česky |
| Boj | Improved Initiative | Beze změny |

Kolekci přejmenuj na **DnD** (Kolekce scén → Přejmenovat). Scénu TEST smaž po akceptaci Bloku 1b.

V Hubu potom nastav:

- **Nastavení:** Souboj → *Boj*.
- **Odpočet:** scéna po odpočtu, podle toho, kde první sezení začíná (např. *Cesta*).
- **Obchody:** scéna obchodu → *Obchod*.

**Co přinese Blok 2:** scény míst (Mirabar, Longsaddle, Lurkwood, Cesta) se slijí do jedné scény *Místo* s jedním výstupem z Hubu. Panel v ní bude přepínat místo, den a noc, stav a počasí. Počet scén tak klesne na zhruba šest.

## Obrázek obchodu (do Bloku 2)

Postup vychází z `Apps/Shop/PREDANI.md` (rozhodnutí 7 a 8). Obrázek interiéru nesmí obsahovat text a pravá třetina má zůstat klidná, protože přes ni leží ceník.

1. V generátoru vylosuj sortiment a klikni na *Zkopírovat prompt pro obrázek*.
2. Vlož prompt do ChatGPT (1536 × 1024).
3. V Affinity Photo ořízni na 1536 × 864 a zvětši na 1920 × 1080 (stejně jako u ilustrací míst).
4. Ulož jako `src/obs/obchod/<id obchodu>.png`, kde id je jméno souboru sortimentu v `kampan/obchody/sortimenty/`.
5. Před sezením zkopíruj obrázek obchodu, který čekáš, přes `src/obs/obchod/obchod.png`. Scéna Obchod ukazuje vždy tento soubor; OBS ho po přepsání sám načte znovu.

Od Bloku 2 bude obrázek patřit k sortimentu a Ukázat v OBS vymění obrázek i ceník najednou, takže krok 5 odpadne.

## Odpovědi DM (3. 10. 2026)

1. Numpad zatím nepoužívá. Zkratky se nenastavují, scény přepíná Hub.
2. Stará Cesta (start.png s kalendářem) bude nahrazená novou Cestou s prezentací.
3. Lurkwood dostane medailon kalendáře jako ostatní místa.

## Postup přestavby

Počítej s 20–30 minutami. Hub musí běžet. Před začátkem si kolekci zálohuj: *Kolekce scén → Exportovat*.

1. **Kolekce:** *Kolekce scén → Přejmenovat* na `DnD`.
2. **Hub – medailon:** ve scéně Mapa otevři vlastnosti zdroje *Prohlížeč 5*, vypni *Local file*, vlož adresu `http://127.0.0.1:7420/vystupy/kalendar-maly.html` a velikost 1000 × 270. Zdroj přejmenuj na `Hub – medailon`. Protože je sdílený, změní se tím i v Longsaddle a Ambient_cesta.
3. **Lurkwood:** *Přidat → Prohlížeč → Přidat existující → Hub – medailon*, umísti ho stejně jako v Mapě.
4. **Mirabar:** v prezentaci nech jen složku `src/places/mirabar` (smaž položku `OBS/src/Mirabar`, nebo naopak, podle toho, kde jsou aktuální obrázky). Přidej existující `Hub – medailon`.
5. **Cesta:**
   - Smaž scény *Cesta* a *Ambient_cesta*.
   - Vytvoř novou scénu *Cesta* a přidej do ní *Obrázková prezentace* se složkou `src/places/Cesta` (pojmenuj ji `Prezentace – cesta`).
   - Přidej existující `Hub – medailon`.
6. **Longsaddle:** prezentaci přejmenuj na `Prezentace – Longsaddle`, ostatní prezentace obdobně.
7. **Start:**
   - Smaž *Prohlížeč 3* a *Prohlížeč 4* (staré orloje).
   - Přidej *Prohlížeč* `Hub – rekapitulace` s adresou `http://127.0.0.1:7420/vystupy/rekapitulace.html` a velikostí 1920 × 1080. Umísti ho pod odpočet (v seznamu zdrojů níž).
   - *Prohlížeč 6* přejmenuj na `Hub – odpočet`, *Start_img* na `Obrázek – start`.
   - Pokud se orloj s odpočtem překrývá, posuň odpočet dolů.
8. **Obchod:**
   - *Prohlížeč 2* přejmenuj na `Hub – ceník`, vypni *Local file* a vlož adresu `http://127.0.0.1:7420/vystupy/cenik.html`. Velikost 640 × 1080 a pozice 1280, 0 zůstávají.
   - *Obrázek 3* přejmenuj na `Obrázek – obchod`.
9. **Pauza:** scénu přejmenuj na *Pauza*, text změň na „Za chvíli pokračujeme…“ a obrázek přejmenuj na `Obrázek – pauza`.
10. **Mapa:** *Obrázek* přejmenuj na `Obrázek – mapa`.
11. **Pořadí scén:** Start, Mirabar, Longsaddle, Lurkwood, Cesta, Mapa, Obchod, Pauza, Boj, TEST.
12. **Hub:**
    - Nastavení → Souboj: *Boj*.
    - Odpočet → scéna po odpočtu: první scéna sezení.
    - Obchody → scéna obchodu: *Obchod*.
13. **Kontrola:** v Hubu klikni na + 1 den. Medailon se musí změnit ve všech místech a v Mapě, rekapitulace ve Startu se rozjede znovu. Ve Scénách OBS v Hubu by mělo být 10 scén.

Scénu TEST smaž po akceptaci Bloku 1b.
