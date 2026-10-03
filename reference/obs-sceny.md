# Scény a zdroje v OBS

Revize kolekce scén z PC u stolu (3. 10. 2026). Popisuje, co v OBS je, co je potřeba změnit a jak má sestava vypadat až do Bloku 2. Je to **⚠ návrh**, dokud ho DM nepotvrdí (Otevřený bod 29 v `ZADANI.md`).

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
6. V kolekci nejsou žádné klávesové zkratky scén. Numpad tedy jde přes jiný program, nebo přes zkratky v profilu OBS (otázka níže).

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
| Cesta | Prezentace – cesta (`src/places/Cesta`, včetně `tabor.png`), Hub – medailon | Sloučí se Cesta a Ambient_cesta |
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

## Otevřené otázky

1. Jak dnes přepínáš scény numpadem? V kolekci zkratky nejsou.
2. Je Cesta (start.png s kalendářem) ještě potřeba, nebo ji nahradí nová Cesta s prezentací?
3. Má mít Lurkwood medailon kalendáře jako ostatní místa?
