# Audit kánonu (19. 10. 2026)

Soupis všeho, co o kampani „Limba: Rok kamenné borovice“ víme, a kde to leží. Podklad pro Blok 3: co se převádí, co se vynechá, co si odporuje a co chybí. Kartu po kartě to rozepisuje `reference/kanon-mapa.yaml`, postup převodu `reference/kanon-prevod.md`.

Všechno se jen četlo. V Notionu, v projektu v Claude ani v `kampan/` se nic nezměnilo.

## Shrnutí

- **Kánon je ve čtyřech zdrojích:** Notion, projekt D&D v Claude, dotazník (xlsx) a chaty s Claudem. Notion je největší a nejúplnější.
- **Převede se 94 souborů:**

  | Skupina | Souborů |
  | --- | --- |
  | Postavy | 4 |
  | Padouši a frakce | 5 |
  | NPC | 23 |
  | Místa | 16 (z toho jedno sloučení do existujícího Longsaddle) |
  | Předměty | 6 |
  | Rozhodnutí | 39 |
  | Zápis sezení 1 | 1 |

- **Nepřevede se 12 stránek Notionu:** vzorové karty šablony, prázdné stránky šablony a anglické nástroje Sly Flourish. Každá má v mapě důvod.
- **11 položek kánonu žije mimo Notion**, hlavně v chatech z přípravy sezení 2 a 3: Malk Orren, lidé z Longsaddle, váček se semeny a další. Soubory vzniknou, až DM potvrdí jejich text.
- **16 rozporů a zastaralých míst.** Většina je drobná. Převod ale zdrží čtyři:
  - kde je Thirilův prsten (R3),
  - kdo je kontakt v Longsaddle (R1),
  - Torva: typ a smrt (R2),
  - kterým směrem šel Bifron (R11).
- **Dvě díry:**
  - Zápis sezení 2 neexistuje nikde.
  - Databáze „Hraci kanon“ v Notionu je prázdná, takže hráčský kánon zatím nemá co převést.

## Zdroje

### Notion: Lazy RPG Campaign Template (1)

Pracovní kopie šablony Sly Flourish ([odkaz](https://app.notion.com/p/3c39ed2267368185bdc2f02d0b397d7c)). Druhá stránka „Lazy RPG Campaign Template“ bez „(1)“ je nedotčený originál se vzorovými daty, kampaň v ní není. Hledání jmen kampaně (Bifron, Mirabar) nic mimo kopii (1) nenašlo.

| Část | Položek | Převod | Poznámka |
| --- | --- | --- | --- |
| Campaign Database | 56 karet | 52 karet do `npc/`, `padouchove/`, `frakce/`, `mista/`, `predmety/`, `rozhodnuti/` | 4 karty „[SMAZAT – vzorová karta]“ se vynechají |
| Characters | 4 karty | `postavy/` | Sloučí se s projektem v Claude a dotazníkem |
| Registr rozhodnutí (databáze „DM rozhodnuti“) | 37 řádků | `rozhodnuti/` | Jen vlastnosti, stránky jsou prázdné. Stav: 16 rozhodnuto, 15 otevřené, 6 zavrženo |
| Hraci kanon | **0 řádků** | — | Databáze existuje, ale nikdo do ní nezapisoval |
| Sezení 1 — Mirabar → Lurkwood | 1 stránka | `sezeni/s01/` | Zápis podle Lazy DM, 2. 9. 2026 |
| Session Zero Notes, Old Session Notes, Session Notes Template Example, Characters → Party Info | 4 stránky | — | Nevyplněné stránky šablony |
| Single-Page Lazy DM Prep Template | 1 stránka | — | Anglická šablona; nahrazuje ji česká `sablony/priprava-lazy-dm.md` |
| Forge of Foes, Dice Roller | 2 | — | Nástroje, do panelu jen jako odkazy |

**Jak jsou karty napsané:**

- Každá karta má emoji ikonu. Obrázky nemá žádná, jen titulní strany šablony.
- Vlastnosti jsou jen Name, Tags (Location, NPC, Villain, Item, Current) a relace Postavy.
- Odkazy mezi kartami jsou **jen tučný text**, ne zmínky. Vazby `[[id]]` proto nejde vzít z Notionu. Odvodil jsem je z textu a jsou v mapě.
- Relaci Postavy má jen 5 karet (karty pilotu s tagem Current). Pro vazby skoro nic nedává.
- Tagy občas neodpovídají obsahu:
  - Krkavčí prapor a Rod Redgrave mají tag NPC, ale jsou to frakce;
  - kruh (buňka) má tag Villain a je to frakce;
  - „Rok a kalendář“ a „Stopa do Yartaru“ mají jen tag Current a nejsou to entity, ale rozhodnutí o kampani.
- Tajemství DM jsou na kartách pod nadpisy „DM“ a „Co X neví“. Repo je veřejné, takže po převodu je přečte každý, kdo repo najde. ZADANI s tím počítá (Mimo rozsah: skrývání obsahu repa před hráči), jen to připomínám.

### Projekt D&D v Claude

| Dokument | Obsah | Převod |
| --- | --- | --- |
| `postavy/*.md` (4) | Listy postav z D&D Beyond (21. 8. 2026): vlastnosti, dovednosti, OT, BV, výbava, kouzla | Oddíl „List postavy“ v `postavy/<id>/<id>.md` |
| `claude/dm-hub-*.md` (3) | Dokumentace Hubu a podklad k sezení 3 | Nejsou kánon. Fakta o sezení 3 (Malk bojuje s družinou) jsou i v chatech |
| `prekladovy-klic-cz.md`, `prompty.md` | Už jsou v `reference/` (Blok 0) | — |
| `SRD_CC_v5.2.1.pdf`, `vycisti.py` | Pravidla a skript na přepisy | Nejsou kánon |

Po převodu podle ZADANI soubory postav v projektu zůstat nemají: Claude bude číst repo.

### Dotazník k postavě (xlsx)

4 odpovědi z 18.–21. 8. 2026, 43 otázek. Adriana odpovídala slovensky. Podle ZADANI jde **celý** do těla souboru postavy a xlsx do `archiv/`.

Dotazník obsahuje i věci, které na kartách v Notionu nejsou, a nijak jim neodporuje:

- **Leta:**
  - strach z vody a vzpomínka na pád do kádě,
  - tetování šipky, čtyři náušnice, různobarevné oči, 93 cm,
  - Deep Speech ji naučil slepý podivín ve sklepě pod knihovnou.
- **Koudur:**
  - strach ze samoty a z bodavého hmyzu,
  - tetování loutny, 115 cm, oblíbený bard Calin.
- **Tusker:** strach z potvor s víc než dvěma očima.
- **Alba:** nejraději se mění ve zlovlka.

Kde DM příběh později rozvinul jinak, platí karta v Notionu. Například Leta v dotazníku chce otce osvobodit, kdežto podle karty ji Thiril poslal z města pryč. Dotazník se přesto převede beze změn jako záznam toho, co hráč napsal.

### Chaty s Claudem (kánon, který se do Notionu nedostal)

| Chat | Co v něm DM potvrdil |
| --- | --- |
| Komplikovaná cesta k dopisu v Longsaddle (11. 9.) | Příprava sezení 2. **Malk Orren:** kurýr i Ordwinův kontakt v jedné osobě, statblok SRD Spy (CR 1) s rysy Nezapamatovatelný a Nebojuje za cizí. Lidé v Longsaddle: Ilma Dunwarová (hostinská U Zlomeného sedla), Gerd, Marwen, Ondrik, Roswyn. Tábor: 6 lupičů, Tough pozná Letu, prsten na ruce kapitána, ohořelé dopisy, odpočet 4 dílky. „Žádné heslo neexistuje.“ |
| Zlepšení bandity tábora (14. 9.) | Sezení 2 skončilo těsně před táborem. Do tábora přišli s Malkem a sezení 3 začíná iniciativou, protože je hlídka zaslechla |
| Návrh bojového sezení (12. 10.) | Příchod k táboru pozdě odpoledne. Sezení 4 ve štole: tři skupiny (Alba sama, Koudur sám, Tusker a Leta spolu), Malk zůstane venku |
| Odbočky a selhání v pilotní session (27. 8.) | Znak Krkavčího praporu zná Tusker z mirabarské stráže, Alba ne. Bifron jí o minulosti kruhu nevyprávěl |
| Shrnutí prvního sezení (2. 9.) | Zápis sezení 1 (je v Notionu) a hráčské shrnutí do skupinového chatu (jen v chatu) |
| První session shrnutí (29. 8.) | Datum „12. Eleint 1489 DR“ je staré, platí 1491 (karta Rok a kalendář) |

Stejná fakta o sezeních 2–4 drží paměť projektu v Claude. V mapě mají akci **doplnit**: soubor vznikne, až DM text potvrdí.

### Repo

- **`kampan/mista/`:** 5 míst z Bloku 2 (Cesta, Longsaddle, Lurkwood, Mirabar, Tábor lupičů), všechna se zástupným textem „Popis místa doplní DM“.
  - Longsaddle má kartu i v Notionu, sloučí se.
  - Mirabar kartu v Notionu nemá, jen jeho podniky a domy.
- **`kampan/postavy/alba/`:** podoby zlovlk a medvěd (rozhodnutí 74).
- **Ilustrace postav:**
  - v kořeni repa portréty `Alba.png`, `Koudur.png`, `Leta.png`, `Tusker.png`;
  - v `monsters/` Torva, Malk Orren, Hlídač kruhu, Nováček kruhu, Bandit, Bandit Captain, Tough.
  - Převedené karty na ně odkážou cestou od kořene (`/monsters/torva.png`), nic se nepřesouvá.
- **`kampan/sezeni/`:** jen `priprava.md`. Sezení 1 a 2 se odehrála, souborů zatím není.

## Rozpory a zastaralá místa

Každý rozpor rozhodne DM před převodem příslušné skupiny. Převod text nepřepisuje, opraví jen to, co tady DM potvrdí.

| # | Kde | Co si odporuje | Návrh |
| --- | --- | --- | --- |
| R1 | Kontakt v Longsaddle (karta), Longsaddle, 2 otevřená rozhodnutí | Notion: kontakt bez jména, Leta ho najde podle hesla „úplně poslední zakázka z Mirabaru“. Příprava sezení 2: kontaktem je **Malk Orren** a „žádné heslo neexistuje“ | Kartu sloučit do nové karty Malka Orrena (alias „Kontakt v Longsaddle“), obě otevřená rozhodnutí zavřít jako rozhodnutá |
| R2 | Torva | Notion: tag Villain, „když prohraje, nepadne mrtvá“. ZADANI: `npc/torva`. Sezení 1: Torva je mrtvá | Typ `npc`. Na začátek karty: „V sezení 1 zemřela.“ |
| R3 | Thirilův prsten, Ordwinův dopis, Thiril, Ordwin | Prsten má v Notionu tři polohy: „Ordwin ho vykoupil a drží ho“, „v obálce s dopisem jako vzorek“ (2. 9.) a „kapitán lupičů ho nosí na malíčku“ (12. 10.). Příprava sezení 2 a místo Tábor lupičů: na ruce kapitána | Platí nejnovější: prsten má kapitán. Staré věty označit jako přípravu před sezením 2 |
| R4 | Nováček kruhu (17 let), zápis sezení 1 | Zápis jmenuje **Tavise**, ukecaného nováčka, kterého zabila Leta. Karta popisuje sedmnáctiletého kluka, který „mluví víc, než by měl“. Jeden nováček navíc utekl | Rozhodnout, jestli je Tavis ten kluk. Když ano, Tavis je alias karty |
| R5 | Koudur (kap. 7), U Kamenné mísy × Norra, Hedwiga | Pozvánka „přišla před dvěma, třemi dny“ × „předává se na scéně v den pilotu 12. Eleintu“ (doplněno 26. 8.) | Platí novější. U Koudura a U Kamenné mísy připsat poznámku |
| R6 | Ordwinův dopis | Poznámka DM: jméno, „které jí za čtrnáct let neřekl“. Leta je u Thirila od 7 do 25 let, tedy 18 let | Opravit na osmnáct |
| R7 | U Roztaveného groše × Leta | Hospoda: sázky se „účastnila spolu s Ordwinem“. Leta: Ordwin se o sázce teprve dozvěděl | Rozhodnout, jestli byl Ordwin u sázky |
| R8 | Longsaddle | „Osada na Long Road **severně** od Mirabaru“. Longsaddle leží jižně, cesta kampaně vede Mirabar → Longsaddle → Triboar | Opravit na „jižně“ |
| R9 | Jazyky postav | Tusker: Notion Common, **Orc**, Dwarvish × list postavy Common, **Common Sign Language**, Dwarvish. Alba a Leta mají v listu navíc **Elvish** | Platí list postavy (mechanika). Vlastnost Languages z Notionu nepřevádět |
| R10 | Ordwinův dopis | „Otevřené: jméno na obálce“ × příprava sezení 2: adresát je označený Letiným symbolem, ne jménem | Zavřít podle přípravy sezení 2 |
| R11 | Stopa do Yartaru × Alba, rozhodnutí „Jak se Alba připojí“, Bifron | Bifronova další zastávka po Lurkwoodu: „Moonwood, na východ“ × „Neverwinterský hvozd, na západ“. Plán sázení je Lurkwood → Moonwood → Neverwinter | Rozhodnout, kam Bifron šel |
| R12 | Corvain × Alba | Corvain dal směr „mezi Mirabarem a Lurkwoodem“ × Alba: „mezi Glimmerwoodem a Lurkwoodem“ | Drobnost, sjednotit |
| R13 | Tábor kruhu v Lurkwoodu × `mista/lurkwood` | Notion má tábor jako samostatné místo. Jeho ilustrace (tabor-zoldaku, tabor-vuz, tabor-zajatci) leží v Lurkwoodu | Samostatné místo s vazbou `[[lurkwood]]`, ilustrace nechat v Lurkwoodu |
| R14 | Bifron (karta a rozhodnutí) | První řádek „Lidský... ne, Aasimařin otec.“ je nedopsaný. V rozhodnutí je překlep „obykčejná“ | Opravit při převodu |
| R15 | Registr rozhodnutí | Otevřené otázky, které sezení 1 a příprava sezení 2 už zodpověděly: druhý zajatec v táboře, cesta do Lurkwoodu, jak se Leta dozví o Thirilově smrti, jméno kontaktu, co Longsaddle vydá | DM je zavře, nebo nechá otevřené s poznámkou |
| R16 | Karty postav a NPC: oddíly „Dnes“, „Současný stav“, „Teď“ | Popisují stav **před** sezením 1 (Leta „ještě není na cestě“, Ordwin „drží prsten i dopis“) | Nadpis převést jako „Výchozí stav (před sezením 1)“ a text nechat |

## Co chybí

1. **Zápis sezení 2.** Je jen příprava (chat a čtyřstránkové PDF). Bez zápisu nebude v repu, co se v Longsaddle stalo a co hráči ví. Potřebuje poznámky DM, nebo přepis z WhisperX.
2. **Hráčský kánon.** Notion „Hraci kanon“ je prázdný. Hráčské shrnutí sezení 1 je jen v chatu. Návrh: od sezení 3 zapisovat do `kanon/` podle šablony `sablony/kanon.md`; zpětně jen sezení 1 a 2, pokud DM chce.
3. **Karty, které chybí, i když se o nich mluví jako o kánonu:**
   - Malk Orren,
   - Hlídač kruhu (statblok a ilustrace existují),
   - Tavis,
   - kapitán lupičů,
   - lidé z Longsaddle a hostinec U Zlomeného sedla,
   - převis nad Long Road (zápis s1 říká „vhodné založit kartu“),
   - **váček s podivnými semeny**, klíčový předmět, který nese Tusker.

   V mapě jsou jako **doplnit**.
4. **Jména bez karty**, o kterých karty mluví, ale nic dalšího se o nich neví:
   - frakce a rody: Rada jiskřivých kamenů, rody Stonewhen, Ambersedge a Ironvale;
   - města a kraje: Triboar, Yartar, Kheldell, Glimmerwood, Moonwood, Cragy, High Forest;
   - Ordwinovo vetešnictví u Přístavní brány;
   - slepý podivín z dotazníku.

   Nezakládat, dokud je DM nepotřebuje (pravidlo „nedoplňuj herní obsah“). Hledání je najde v textu.
5. **Obrázky karet.** Notion žádné nemá. Portréty postav a NPC jsou v repu a karty na ně odkážou.

## Co z toho plyne pro Hub

- **Místa bez ilustrací:** převod přidá 15 nových míst bez ilustrací. Dlaždice U stolu → Místo proto ukazují jen místa se scénou pro OBS. Ostatní zůstanou v modulu Místa, kde jim dílna může ilustraci přidat.
- **Stav rozhodnutí:** záznam rozhodnutí má pole `stav` (otevrene, rozhodnuto, zavrzeno) a Kontrola dat ho hlídá.
- **Report převodu:** `npm run kanon` ukáže u každé skupiny počet ve zdroji a v repu, co chybí, soubory bez `zdroj` a hlášení z Kontroly dat. To jsou akceptační kritéria Bloku 3.
