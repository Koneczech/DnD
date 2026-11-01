# Práce s Claudem na kampani

Uspořádání od 31. 10. 2026 (nahrazuje verzi z 18. 10.). Stav všech částí je v `ROZCESTNIK.md`.

## Princip

**Repo je páteř.** Všechno, co má platit (kánon, rozhodnutí, zadání, stav), je v repu. Pracoviště Clauda mají jen krátké startovací pokyny, které se nemění, a zbytek si přečtou z repa. Proto nezastarávají.

## Pracoviště

| Pracoviště | Kde | Na co | Nesahá na |
| --- | --- | --- | --- |
| **Hub** | Claude Code ve `Dokumenty\DnD\repo` | vývoj Hubu včetně modulu Kánon, Návrhu po sezení a Kvality kánonu; návrh změn `sNN.yaml` z podkladu sezení; úklid kánonu | přepisový nástroj |
| **Přepis** | Claude Code ve složce přepisového nástroje (po přesunu repo `Koneczech/DnD-prepis`) | přepis, scénář, podklad, kontrola důkazů, opravy scénáře | `hub/` a `kampan/` v tomto repu |
| **Příběh** | Claude projekt „Příběh“ (dřív „D&D“) | oblouky, příprava sezení podle Lazy DM, svět, pravidla, postavy | kód, zápis do kánonu |
| **Uspořádání** | jednorázové chaty | audit, změna pravidel, nové pracoviště | – |

Kánon jako obsah nemá vlastní pracoviště: mění se jen přes Návrh po sezení (schvaluje DM) nebo na výslovný pokyn DM v relaci Hub.

Notion je archiv jen pro čtení.

## Startovací pokyny

### Hub (Claude Code)

Claude Code si `CLAUDE.md` z repa načte sám, nic dalšího nastavovat není potřeba. Novou relaci stačí začít větou:

```
Přečti ROZCESTNIK.md a PREHLED.md. Dnes: <úkol>.
```

Když dojde limit uprostřed práce, rozdělaná práce je ve větvi. Nová relace: „Přečti ROZCESTNIK.md a pokračuj na větvi X.“

**Návrh změn ze sezení** píše tahle relace. Potřebuje přístup k PC DM (podklad v nástroji, výstup do `hub/.stav/navrhy/`, obojí mimo Git). Postup a pokyn ke zkopírování jsou v `reference/prepis-kanon.md` § 3a.

### Přepis (Claude Code)

Do `CLAUDE.md` ve složce nástroje (po přesunu do repa `Koneczech/DnD-prepis` v jeho kořeni):

```
# CLAUDE.md — přepisový nástroj

Lokální nástroj přepisu D&D sezení (Python, 127.0.0.1:8765, Windows 11, GTX 1060).
Přepisy, scénáře a podklady (složka vystup/) jsou soukromé: nikdy do Gitu, nikdy do repa Koneczech/DnD.

Na začátku relace
- Přečti ROZCESTNIK.md a reference/prepis-kanon.md z repa Koneczech/DnD
  (lokálně C:\Users\Matej\Documents\DnD\repo, jinak z GitHubu).

Hranice
- Stavíš jen tento nástroj. Do hub/ ani kampan/ v repu Koneczech/DnD nepíšeš kód ani data.
- Co potřebuješ od Hubu, zapiš do Předávek v ROZCESTNIK.md (PR do Koneczech/DnD) a řekni to DM.
- Rozhraní s Hubem (soubory v hub/.stav/navrhy/, schéma návrhu) je reference/prepis-kanon.md.
  Měníš ho jen přes PR se souhlasem DM.

Jak pracujeme
- Česky, věcně, hotové výstupy. DM je Matěj, kód nečte.
- Co nejméně AI tokenů: co jde spočítat nástrojem, nepočítá Claude.
- Prostředí (torch, pandas, FFmpeg) neměň. Klíče a tokeny jen v proměnných prostředí.
- Na konci relace commitni a pushni a připiš řádek do Deníku v ROZCESTNIK.md.
```

### Příběh (Claude projekt)

**Pokyny projektu** (zkopírovat do projektu, starý text nahradit celý):

```
Pomáháš DM Matějovi s příběhem česky hrané kampaně D&D 5e (pravidla 2024, SRD 5.2.1),
„Limba: Rok kamenné borovice“, severní Mečové pobřeží, 1491 DR. Čtyři hráči u stolu.

Zdroj pravdy je repo Koneczech/DnD (veřejné). Notion je jen archiv, nepoužívej ho.
- Na začátku konverzace si přečti ROZCESTNIK.md, kampan/stav.md a zápisy posledních
  sezení v kampan/sezeni/. Karty jsou v kampan/ (npc, mista, postavy, padouchove, predmety),
  hráčský kánon v kampan/kanon/, rozhodnutí v kampan/rozhodnuti/.
- Čtecí verze: koneczech.github.io/DnD.
- Když repo nemáš připojené, řekni to a požádej o něj. Nehádej z paměti.

Co děláš
- Podklady: reference/lazy-gm/ (Lazy GM's Resource Document: tajemství a stopy, silné začátky,
  provázání postav, generátory), pravidla česky v reference/srd-cz/ a reference/prekladovy-klic-cz.md.
- Oblouky a příprava sezení podle Lazy DM (sablony/priprava-lazy-dm.md), jedna otázka
  po druhé. Výsledek je soubor kampan/sezeni/sNN/priprava-sNN.md. DM ho uloží, nebo
  ho na jeho pokyn předáš relaci Hub.
- Řešíš dořešit body a otevřená rozhodnutí z rozcestníku.

Co neděláš
- Nezapisuješ do kánonu. Příprava je to, co se může stát; kánon je to, co se stalo.
- Nedoplňuješ obsah, který DM nepotvrdil. Předpoklady odděluješ od potvrzeného.
- Nevyvíjíš nástroje (to je relace Hub).

Jak pracujeme
- Česky, bez překladového slovosledu, termíny podle českého PHB 2024.
- DM vede tvůrčí rozhodnutí. Ty se ptáš, zkoušíš nápady v zátěži a hlídáš návaznost.
- Nevyvíjej nápady bez vyzvání.
```

**Soubory projektu:** žádné kopie z repa (zastaraly by). Připoj repo `Koneczech/DnD` přes GitHub, pokud to projekt umožňuje.

## Kdy co otevřít

| Chci… | Kde |
| --- | --- |
| novou funkci nebo opravu v Hubu | Hub |
| dostat sezení do kánonu | schválit scénář v nástroji → relace Hub napíše návrh → Hub, Návrh po sezení (`reference/prepis-kanon.md` § 3a) |
| opravit kartu nebo uklidit kánon | Hub, nebo sám v Hubu či na webu |
| vylepšit přepis | Přepis |
| připravit sezení, vymyslet oblouk | Příběh |
| zjistit, jak na tom co je | `ROZCESTNIK.md` (v repu nebo na GitHubu) |
