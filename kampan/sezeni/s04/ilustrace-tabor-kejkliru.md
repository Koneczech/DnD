# Tábor kejklířů: ilustrace do Hubu

Příprava sezení 4, 20. 11. 2026. ⚠ Rozmístění vozů a stánků je návrh: co bude na obrázku 1, bude na všech ostatních. Než začneš generovat, uprav `popis_obrazu` v kartě místa.

## Postup

1. Ulož kartu `tabor-kejkliru.md` do `kampan/mista/tabor-kejkliru/` v lokálním repu. Hub ji načte sám.
2. V Hubu: Ilustrační dílna → Tábor kejklířů. Dílna složí prompt z `popis_obrazu`. Hotové prompty jsou i níže, kdybys je chtěl vložit rovnou do ChatGPT.
3. **Nejdřív vygeneruj obrázek 1.** Ostatní generuj s ním jako předlohou (přilož ho do ChatGPT), aby tábor vypadal pořád stejně. Výjimkou jsou detaily a interiér (6–8).
4. Hotový obrázek nahraj přes dílnu. Uloží se jako skrytý.

## Přehled

Pořadí u stolu (DM 20. 11. 2026): nejdřív zebra na Long Road (7), pak převržený vůz (2), potom rozbalený tábor (1).


| # | Soubor | V dílně | Co je na obraze | Kdy to hráči vidí | Priorita |
|---|---|---|---|---|---|
| 1 | `celek-den.png` | celek, den | Rozbalený tábor: vozy v půlkruhu, stánky s hrami, zebra uvázaná, převržený vůz u cesty | Většina sezení, hry | **Nutné** |
| 2 | `celek-den-nehoda.png` | celek, den, stav *nehoda* (s předlohou 1) | Stejné místo hned po nehodě: chaos, rozházené věci, rozbitá klec, lidé běhají, stánky ještě nejsou | Silný začátek: hned po zebře | **Nutné** |
| 3 | `celek-noc-predstaveni.png` | celek, noc, stav *představení* (s předlohou 1) | Večerní představení: velký oheň, lucerny, pódium mezi vozy, diváci | Večer, Bubny proti dudám, pijácká soutěž | **Nutné** |
| 4 | `celek-noc.png` | celek, noc (s předlohou 1) | Pozdní noc po představení: dohasínající oheň, ticho, jedna postava u ohně | Jakub předává háčky od Malka | Doporučuju |
| 5 | `celek-den-mapa.png` | celek, den, stav *mapa* (s předlohou 1) | Půdorys shora bez postav a mřížky | Kdykoli se ztratí orientace | Doporučuju |
| 6 | `interier-den-vuz-kartarky.png` | interiér, den, stav *vůz kartářky* | Uvnitř Petřina vozu: svíčka, karty na stolku, závěsy | Tři karty | Doporučuju |
| 7 | `detail-den-zebra.png` | detail, den, stav *zebra* | Vyplašená zebra na Long Road | Silný začátek: první, co družina uvidí | **Nutné** |
| 8 | `detail-den-opice.png` | detail, den, stav *opice* | Malá opice na střeše vozu s ukradenou věcí | Honička za opicí | Volitelné |

Postavy kejklířů na obrazech nemají rozpoznatelné tváře. Portréty NPC jsou zvlášť (plátno 1080 × 1500, `reference/ilustrace-postav.md`).

## Prompty pro ChatGPT

Styl a technika jsou z `reference/styl-ilustraci.md`, stejně jako je skládá dílna. Rozlišení 1536 × 1024, ořez na 16 : 9 dělá dílna.

### 1. `celek-den.png`

```
A wide establishing view of a small travelling troupe of jugglers and performers camped on a grassy verge beside the muddy Long Road in early autumn: six weathered wooden wagons with faded painted panels drawn into a loose half circle, one wagon lying on its side at the roadside with a broken wheel, patched canvas awnings, a small striped tent, a rope strung between two wagons above a heap of hay, a wooden strongman bell tower with a mallet, a round straw target hanging on a wagon side, a small folding table with three upturned cups, a campfire ring in the middle, a zebra tethered to a wagon, an empty animal cage with a broken door, low rolling hills, sparse pines and dry autumn grass, in daylight under an overcast sky.

A few performers move about the camp, seen from a distance, faces not in focus.

Painterly hand-painted fantasy illustration of the northern Sword Coast in the Forgotten Realms, matte, no photographic rendering. Dark, muted, restrained palette: slate grey, weathered stone, dry brown earth, muted pine green, with warm amber accents only from fire and lanterns. No saturated colours. Soft diffuse light, gentle vignette, subtle canvas and paper grain.

Composition: horizontal, aspect ratio 16:9. Keep all important elements within the middle 84% of the image height, because the top and bottom strips will be cropped. Image size 1536x1024 pixels.
Absolutely no text, no letters, no numerals, no signage, no runes, no watermark anywhere in the image.
```

### 2. `celek-den-nehoda.png` (přilož obrázek 1)

```
Use the attached image as the exact reference. Keep the same composition, camera angle, buildings, terrain and objects. Change only what is described below: show the scene in daylight under an overcast sky.

State of the place: right after an accident. The camp is not set up yet: no stalls, no target, no bell tower, no hay rope. The wagon lies freshly overturned at the roadside, its load spilled across the road: crates, juggling clubs, costumes, a broken barrel. The animal cage has burst open and is empty, the zebra is gone. A few performers run around in confusion, one points down the road. Dust still hangs in the air.

Painterly hand-painted fantasy illustration of the northern Sword Coast in the Forgotten Realms, matte, no photographic rendering. Dark, muted, restrained palette: slate grey, weathered stone, dry brown earth, muted pine green, with warm amber accents only from fire and lanterns. No saturated colours. Soft diffuse light, gentle vignette, subtle canvas and paper grain.

Composition: horizontal, aspect ratio 16:9. Keep all important elements within the middle 84% of the image height, because the top and bottom strips will be cropped. Image size 1536x1024 pixels.
Absolutely no text, no letters, no numerals, no signage, no runes, no watermark anywhere in the image.
```

### 3. `celek-noc-predstaveni.png` (přilož obrázek 1)

```
Use the attached image as the exact reference. Keep the same composition, camera angle, buildings, terrain and objects. Change only what is described below: show the scene at night, lit only by cold moonlight and a few warm lanterns or fires.

State of the place: an evening performance. A large bright campfire burns in the middle, strings of lanterns hang between the wagons, a simple wooden stage of planks stands in front of the striped tent. A small crowd of travellers and farmers sits and stands around the fire, silhouettes only. A drummer plays on the stage, sparks rise into the dark sky.

Painterly hand-painted fantasy illustration of the northern Sword Coast in the Forgotten Realms, matte, no photographic rendering. Dark, muted, restrained palette: slate grey, weathered stone, dry brown earth, muted pine green, with warm amber accents only from fire and lanterns. No saturated colours. Soft diffuse light, gentle vignette, subtle canvas and paper grain.

Composition: horizontal, aspect ratio 16:9. Keep all important elements within the middle 84% of the image height, because the top and bottom strips will be cropped. Image size 1536x1024 pixels.
Absolutely no text, no letters, no numerals, no signage, no runes, no watermark anywhere in the image.
```

### 4. `celek-noc.png` (přilož obrázek 1)

```
Use the attached image as the exact reference. Keep the same composition, camera angle, buildings, terrain and objects. Change only what is described below: show the scene at night, lit only by cold moonlight and a few warm lanterns or fires.

State of the place: late at night after the show. The campfire has burned down to glowing embers, most lanterns are out, the camp is quiet and asleep. A single cloaked figure sits alone by the embers, seen from behind.

Painterly hand-painted fantasy illustration of the northern Sword Coast in the Forgotten Realms, matte, no photographic rendering. Dark, muted, restrained palette: slate grey, weathered stone, dry brown earth, muted pine green, with warm amber accents only from fire and lanterns. No saturated colours. Soft diffuse light, gentle vignette, subtle canvas and paper grain.

Composition: horizontal, aspect ratio 16:9. Keep all important elements within the middle 84% of the image height, because the top and bottom strips will be cropped. Image size 1536x1024 pixels.
Absolutely no text, no letters, no numerals, no signage, no runes, no watermark anywhere in the image.
```

### 5. `celek-den-mapa.png` (přilož obrázek 1)

```
Use the attached image as the exact reference. Keep the same layout of wagons, tent, stalls, campfire, road and terrain. Change only what is described below: show the scene in daylight under an overcast sky.

State of the place: a top-down map view seen straight from above, like a hand-painted battle map. No people, no animals, no grid. Every wagon, the tent, the stalls, the hay heap, the campfire ring and the road keep their positions from the reference.

Painterly hand-painted fantasy illustration of the northern Sword Coast in the Forgotten Realms, matte, no photographic rendering. Dark, muted, restrained palette: slate grey, weathered stone, dry brown earth, muted pine green, with warm amber accents only from fire and lanterns. No saturated colours. Soft diffuse light, gentle vignette, subtle canvas and paper grain.

Composition: horizontal, aspect ratio 16:9. Keep all important elements within the middle 84% of the image height, because the top and bottom strips will be cropped. Image size 1536x1024 pixels.
Absolutely no text, no letters, no numerals, no signage, no runes, no watermark anywhere in the image.
```

### 6. `interier-den-vuz-kartarky.png`

```
An interior view inside a fortune teller's wagon in a small travelling troupe of jugglers camped beside the Long Road: a cramped wooden interior with a curved roof, heavy faded curtains, bundles of dried herbs hanging from the ceiling, a small round table with a single burning candle and three face-down cards laid in a row, a worn cushion on each side, a small window with grey daylight, in daylight under an overcast sky.

No people in the image.

Painterly hand-painted fantasy illustration of the northern Sword Coast in the Forgotten Realms, matte, no photographic rendering. Dark, muted, restrained palette: slate grey, weathered stone, dry brown earth, muted pine green, with warm amber accents only from fire and lanterns. No saturated colours. Soft diffuse light, gentle vignette, subtle canvas and paper grain.

Composition: horizontal, aspect ratio 16:9. Keep all important elements within the middle 84% of the image height, because the top and bottom strips will be cropped. Image size 1536x1024 pixels.
Absolutely no text, no letters, no numerals, no signage, no runes, no watermark anywhere in the image.
```

Karty jsou rubem nahoru schválně: na lících by ChatGPT kreslil znaky a nápisy.

### 7. `detail-den-zebra.png`

```
A close-up detail view on the muddy Long Road in early autumn: a frightened zebra with a broken harness strap trailing behind it gallops straight toward the viewer, ears pinned back, mud flying from its hooves, low rolling hills and sparse pines behind, in daylight under an overcast sky.

Painterly hand-painted fantasy illustration of the northern Sword Coast in the Forgotten Realms, matte, no photographic rendering. Dark, muted, restrained palette: slate grey, weathered stone, dry brown earth, muted pine green, with warm amber accents only from fire and lanterns. No saturated colours. Soft diffuse light, gentle vignette, subtle canvas and paper grain.

Composition: horizontal, aspect ratio 16:9. Keep all important elements within the middle 84% of the image height, because the top and bottom strips will be cropped. Image size 1536x1024 pixels.
Absolutely no text, no letters, no numerals, no signage, no runes, no watermark anywhere in the image.
```

### 8. `detail-den-opice.png`

```
A close-up detail view within a small travelling troupe of jugglers camped beside the Long Road: a small mischievous monkey wearing a tiny faded red waistcoat crouches on the curved roof of a weathered wooden wagon, clutching a stolen object (a leather pouch) to its chest and grinning, wagon canvas and sparse pines behind, in daylight under an overcast sky.

Painterly hand-painted fantasy illustration of the northern Sword Coast in the Forgotten Realms, matte, no photographic rendering. Dark, muted, restrained palette: slate grey, weathered stone, dry brown earth, muted pine green, with warm amber accents only from fire and lanterns. No saturated colours. Soft diffuse light, gentle vignette, subtle canvas and paper grain.

Composition: horizontal, aspect ratio 16:9. Keep all important elements within the middle 84% of the image height, because the top and bottom strips will be cropped. Image size 1536x1024 pixels.
Absolutely no text, no letters, no numerals, no signage, no runes, no watermark anywhere in the image.
```

⚠ Červená vestička opice je můj návrh. U obrázku 8 si v předmětu vyber, co opice ukradne. Kožený váček je jen zástupný.
