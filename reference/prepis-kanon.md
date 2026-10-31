# Ze sezení do kánonu

Smlouva mezi přepisovým nástrojem a DM Hubem. Stav k 31. 10. 2026.

Nahrazuje tři dokumenty, které vznikly mimo Git ve složce nástroje: `SPOLUPRACE-prepis-hub.md`, `NAVRH-kanon-po-sezeni.md` (relace Hub, 28. 10.) a § 7 z `NAVRH-zjednoduseni.md` (relace Přepis). Ty už neplatí. Platí tento soubor a mění se jen přes PR se souhlasem DM.

Rozhodnutí DM: 77–81 v `ZADANI.md` (31. 10. 2026). Nepotvrzená podoba Návrhu po sezení je bod 155.

## 1. Tři pravidla

1. **Kánon se po sezení mění jen operacemi.** Každá operace má důkaz (místo v nahrávce nebo rozhodnutí DM), schvaluje ji DM a zapisuje ji Hub přes `zapis.js` jedním zápisem. Všechno jde vrátit přes Git.
2. **Nic se nemaže, neplatné se přesune.** Starý text se přesune do oddílu **Neplatné** na konci karty, s důvodem a číslem rozhodnutí R (rozhodnutí 77). Smazat jde jen chybu zápisu: věc, která u stolu nikdy nezazněla.
3. **Každé rozhodnutí DM o rozporu má číslo R a jedno místo:** `kampan/rozpory.yaml`. Číslování navazuje na R1–R16 v `reference/kanon-mapa.yaml`.

**Soukromí:** přepis, scénář a podklad zůstávají mimo toto veřejné repo. Do repa jdou jen karty, zápisy a krátké citace v poli `dukaz` (pár slov, ne celé repliky).

## 2. Kdo co vlastní

| Část | Vlastník | Kde |
| --- | --- | --- |
| Přepis, scénář, verze, učení ze slovníku, schválení scénáře | relace **Přepis** | přepisový nástroj (`127.0.0.1:8765`) |
| Podklad a kontrola důkazů | relace **Přepis** | nástroj |
| Opravy scénáře od Clauda (`opravy-sNN.json`) | Claude píše, nástroj je ukáže u bloků | nástroj |
| Návrh změn `sNN.yaml` | Claude (v relaci Hub nebo v samostatném chatu podle zadání DM) | `hub/.stav/navrhy/` |
| **Návrh po sezení**: schválení, rozpory, `vyradit`, Neplatné, registr R, zápis | relace **Hub** | `hub/` |
| Rozhodnutí | **DM** | – |

Relace Přepis nepíše kód do `hub/` a relace Hub nepíše do nástroje. Potřebu zapíší do Předávek v `ROZCESTNIK.md`.

## 3. Tok jednoho sezení

| # | Krok | Kdo | Výstup | Stav sezení v nástroji |
| --- | --- | --- | --- | --- |
| 1 | Přepis a scénář | nástroj | `scenar.json` | Zpracováno |
| 2 | Kontrola proti kánonu, jen nezkontrolované bloky | Claude | `opravy-sNN.json`, nálezy rozporů | Ke kontrole |
| 3 | Poslech a opravy scénáře | DM v nástroji | opravený scénář, pravidla slovníku | Kontrola |
| 4 | Schválení scénáře | DM | zmrazená verze | Schváleno |
| 5 | Podklad a návrh změn | nástroj, Claude | `podklad.md`, `hub/.stav/navrhy/sNN.yaml` (`stav: finalni`) | V kánonu (rozepsáno) |
| 6 | Návrh po sezení v Hubu: operace a rozpory | DM | rozhodnutí R | V kánonu (rozepsáno) |
| 7 | Zapsat schválené, Kontrola dat, uložit | Hub (uloží `kampan/` na GitHub sám) | commit, `sNN.zapsano.json` | Ověřeno |

**Brána mezi kroky 4 a 5:** finální návrh vzniká jen ze schváleného scénáře. Návrh z neschváleného scénáře má `stav: predbezny` a Hub ho zobrazí, ale nedovolí ho zapsat.

## 4. Společné soubory

Všechny leží mimo Git v `hub/.stav/navrhy/`, kromě `opravy-sNN.json`, které jsou v nástroji.

| Soubor | Píše | Čte | Tvar |
| --- | --- | --- | --- |
| `sNN.yaml` | Claude | nástroj (kontrola), Hub | schéma 2, § 5 |
| `sNN.dukazy.json` | nástroj | Hub | `{ sezeni, cas, operace: { <id>: { ok, problemy: [ { text, zavaznost: chyba / upozorneni } ] } } }`; Hub přijme i problémy jako prosté texty (dnešní tvar, berou se jako upozornění) |
| `sNN.rozhodnuti.json` | Hub | Hub | rozpracované schválení (co DM schválil, upravil, zamítl) |
| `sNN.zapsano.json` | Hub | nástroj (podle `mtime` pozná „v kánonu“) | `{ sezeni, cas, navrh_hash, zapsane: [id], zamitnute: [id], upravene: [id], rozpory: [R…], commit }`; `zapsane` je souhrn všech zápisů, `commit` je `null`, když se uložení na GitHub nepovedlo |
| `revize-<datum>.yaml` | Claude | Hub | stejné schéma, revize kánonu mimo sezení (jen `vyradit`, `doplnit`, `pole`, `smazat`) |
| `vystup/_kanon/sNN/opravy-sNN.json` | Claude | nástroj | `{ blok, id, cas, mluvci, najdi, oprava, skupina, duvod, jistota }`; skupina K (kánon), J (jména), M (mluvčí, `oprava` začíná `[Mluvčí]`), P (k poslechu), X (mimo hru); jistota `vysoka` / `stredni` / `poslechnout` |

## 5. Schéma návrhu (verze 2)

Hlavička:

```yaml
schema: 2
sezeni: s03
stav: predbezny            # predbezny | finalni
scenar_verze: 47
```

Každá operace má `id` (`o1`, `o2` …), `op`, `dukaz` a `jistota` (`jista` / `nutno_potvrdit`).

**Důkaz** je seznam míst:

```yaml
dukaz:
  - { cas: "d2 0:11:39", blok: "46cf14239e", citat: "pár slov" }   # z nahrávky
  - { dm: 2026-10-28, citat: "rozhodnutí DM mimo nahrávku" }      # nehledá se v přepisu
```

`blok` je id bloku scénáře. Citace tak přežije opravy přepisu: když se text bloku změní, Hub citaci přečte znovu a zvýrazní, že se důkaz změnil.

| Operace | Co dělá | Pojistka |
| --- | --- | --- |
| `nova_karta` | Nová entita ze šablony Hubu | id se nesmí shodovat s existujícím |
| `doplnit` | Přidá odrážku nebo odstavec do oddílu karty | existující text se nemění |
| `pole` | Změní pole hlavičky, i `verejne` (karta pro družinu) | nese `puvodni`; když se mezitím změnila, operace se zastaví; odkazové pole se porovná podle id (`[[x]]` = `x`) |
| `vazba` | Přidá vazbu nebo vztah | cíl musí existovat nebo vzniknout v tomtéž návrhu |
| `kanon` | Nový záznam hráčského kánonu `sNN-…` | číslování a id podle Hubu |
| `udalost` | Událost v kalendáři | datum Harptosu musí sedět |
| `sezeni` | Doplní `sNN.md` (Shrnutí, Tajemství a stopy, Poklady, Otevřené nitky) | slévá se s existujícím souborem, Poznámky ze stolu zůstanou |
| `rozpor` | Přepis říká X, karta Y | nikdy se nevyřeší sám, § 6 |
| `vyradit` | Vyjme text z karty: `karta_id`, `oddil`, `najdi` (přesný text, v oddílu právě jednou), volitelně `nahradit`, `duvod`, `r`. Celou kartu vyřadí `cela_karta: true` bez `najdi` | starý text jde do oddílu Neplatné |
| `smazat` | Smaže chybu zápisu: `karta_id`, `oddil`, `najdi` (jen text v kartě, celou kartu ne) | Hub se zeptá ještě jednou |

Operace, které vznikly rozhodnutím rozporu, nesou `z_rozporu: oN`. Hub je pustí jen u Platí stůl a Jinak; u Platí karta a Odložit je zamítne sám.

Rozpor nese `karta_id`, `karta_tvrzeni`, `prepis_tvrzeni`, `otazka`, `druh` (§ 6) a volitelně `r` (číslo, když ho DM přidělil už mimo Hub) a `rozhodnuti` (co DM řekl mimo Hub nebo co navrhuje Claude; Hub ho jen ukáže). Bez `r` přidělí Hub další volné číslo při zápisu. V textu navazujících operací (`text`, `nahradit`, `obsah` …) může stát zástupce `R?`, Hub ho nahradí přiděleným číslem: `*(R?)*` → `*(R21)*`. ⚠ bod 157

Citace v poli `dukaz` mají nejvýš 12 slov; delší Hub do karty a registru zkrátí.

**Pravidlo pro Clauda:** vývoj děje není rozpor. Když NPC v jednom sezení slíbí a v dalším nesplní, platí obojí v jiném čase, takže je to `doplnit` s předponou „Sezení N:“.

## 6. Rozpory

| Druh (`druh`) | Kdy | Výchozí řešení | Co se zapíše |
| --- | --- | --- | --- |
| `stul_vs_karta` | U stolu zaznělo jinak, než říká karta, a hráči to slyšeli | platí stůl | `vyradit` + `doplnit`, nový text se značkou *(R…)* |
| `prereknuti` | DM se přeřekl | platí karta | řádek do zápisu sezení, karta se nemění, bez R |
| `pamet_hracu` | Hráči si pamatují jinak | platí karta | řádek do zápisu sezení, bez R |
| `priprava_vs_hra` | Příprava DM počítala s něčím jiným, než se odehrálo | platí stůl | příprava se označí jako neplatná, jen v oddílech DM |
| `novy_fakt` | U stolu vznikla věc, která mění minulost | rozhodne DM, bez výchozí volby | když platí: doplnit historii, označit starý text, případně událost |

Výchozí řešení je jen předvolba (DM 28. 10. 2026: „většinou ano“). Hub nic nerozhodne sám. Karta rozporu má tlačítka **Platí stůl**, **Platí karta**, **Jinak** (vlastní znění) a **Odložit**. Odložený rozpor zůstane v registru jako otevřený, ukáže se v Kontrole dat a v rozcestníku.

Lež nebo omyl postavy ve světě není rozpor. Do Co ví družina zůstane, co družina slyšela, do oddílu DM se doplní, jak to je.

**Registr** `kampan/rozpory.yaml`:

```yaml
- id: R17
  kdy: 2026-10-28
  sezeni: s03
  druh: stul_vs_karta
  karta: vezeni-pod-radnici
  karta_tvrzeni: "…"
  prepis_tvrzeni: "…"
  dukaz: [{ cas: "d2 0:11:39", blok: "…", citat: "pár slov" }]
  stav: rozhodnuto          # otevrene | rozhodnuto
  rozhodnuti: "Platí stůl."
```

**Oddíl Neplatné** na konci karty:

```markdown
## Neplatné

- **R17** (28. 10. 2026, sezení 3, z oddílu Poslední rozhovor): „starý text“ — důvod.
```

Oddíl Neplatné se jako oddíly DM nikdy neukáže v pohledu družiny ani na webu pro hráče. Celá vyřazená karta dostane v hlavičce `platnost: vyrazeno` a `vyrazeno: R17` a zmizí z pohledu družiny, mapy a hledání (filtr Zobrazit vyřazené ji vrátí). Starší poznámky „*(Neplatí: …, R3.)*“ z převodu Notionu zůstávají.

## 7. Kontrola důkazů (nástroj)

Na předběžném `s03.yaml` hlásila kontrola 33 ze 74 operací, ale žádné hlášení nebylo skutečnou chybou. Úpravy:

1. Správné jméno proti zkomolenému přepisu: porovnávat i se schválenými opravami a slovníkem.
2. Jméno karty, které u stolu nezaznělo doslova: přijmout jména z `karta_id` a `vazby`, jako upozornění.
3. Číslovky slovy (osm = 8).
4. Metatext: číslování odrážek, „Sezení 3:“, „1. úrovně“, data a časy důkazů.
5. Herní termíny česky i anglicky podle `prekladovy-klic-cz.md`.
6. Operaci `sezeni` porovnávat s celým sezením, ne s okolím 90 s.
7. Důkaz typu `dm` přeskočit, jen ho ukázat.
8. U `vyradit` kontrolovat i `nahradit`.

## 8. Otevřené otázky pro relaci Přepis

1. Opravy od Clauda u bloků: využít sekci Návrhy oprav, nebo nový panel v editoru scénáře? Seznam má id bloků, ne čísla replik.
2. Souhlasí body 1–8 z § 7? Body 1 a 5 potřebují slovník a jména z kánonu (`hubkanon.jmena_kanonu` existuje).
3. Přechod `schema-navrhu.md` na schéma 2 je potvrzený (rozhodnutí 80). Kdy?
4. Sedí tvar `sNN.zapsano.json`?
5. Jakou URL má Hub otevřít, aby nástroj skočil na blok nebo čas (▶ Poslechnout)? Například `http://127.0.0.1:8765/#scenar/2026-10-24/blok/<id>`.

Odpovědi zapiš do tohoto souboru přes PR (oddíl níže) nebo do Předávek v `ROZCESTNIK.md`.

## Odpovědi relace Přepis

31. 10. 2026. Kontrola důkazů a schéma 2 jsou v nástroji hotové.

1. **Opravy od Clauda u bloků:** nový panel přímo v editoru scénáře, ne sekce Návrhy oprav. Ta pracuje s číslovanými replikami jedné nahrávky a je schovaná v Pokročilých. Opravy mají id bloků, takže patří k bloku, s tlačítkem ▶ a volbami Schválit, Upravit, Zamítnout. Zatím není postavené.
2. **Body 1–8 z § 7:** souhlasí, jsou hotové (`dukazy.py`, 19 testů). Upřesnění:
   - Chyba je jen citace, která nezazněla, neplatný důkaz, číslo, které v sezení nezaznělo, a jméno, které kánon nezná a v sezení nezaznělo.
   - Jméno z kánonu je vždy jen upozornění, i když operace kartu neuvádí.
   - Číslo nebo jméno ze smíšeného důkazu (nahrávka i `dm`) je jen upozornění.
   - `opravy-sNN.json` nemá stav schválení. Schválené opravy už jsou ve scénáři, takže se ze souboru berou skupiny J a K bez jistoty `poslechnout`.
3. **Schéma 2:** hotové. Příští podklad vygeneruje `schema-navrhu.md` ve verzi 2 a `scenar-s-casy.txt` s id bloků (`[d2 0:11:39 #id]`). Kontrola přijme i soubor s hlavičkou `schema: 1`, takže prošel i dnešní `s03.yaml`, který má tuto hlavičku, ale nová pole už používá.
4. **`sNN.zapsano.json`:** tvar sedí. Nástroj z něj čte jen `mtime`, víc zatím nepotřebuje.
5. **URL pro ▶ Poslechnout:** `http://127.0.0.1:8765/?cislo=s03&blok=<id>&cas=d2 0:11:39`, hodnoty zakódované přes `encodeURIComponent`. Blok má přednost, čas je záloha, když blok zmizel. Nástroj otevře scénář, skočí na repliku a pustí ji.

**`sNN.dukazy.json`:** `problemy` mají tvar z § 4. Navíc přibylo volitelné pole `dm` s důkazy typu `dm` (`[{ dm, citat }]`), aby je Hub mohl ukázat.

**Výsledek na `s03.yaml`:** místo 33 hlášených operací ze 74 je 53 čistých, 20 s upozorněním a 1 s chybou. Ta jedna (`o63`) hlásí tři jména: dvě v přepisu opravdu nejsou, jedno je planý poplach u kouzla, které se v klíči nespárovalo. DM to posoudí při schvalování.
