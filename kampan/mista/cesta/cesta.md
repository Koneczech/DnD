---
schema: 1
id: cesta
typ: misto
nazev: Cesta
verejne: true
# Anglický popis vzhledu místa pro prompty dílny (doplní DM). Dílna ho vloží do promptu.
popis_obrazu: ""
ilustrace:
  - soubor: celek.png
    ucel: scena
    skryta: false
    puvod: src/places/Cesta/cesta.png
  - soubor: brod.png
    ucel: scena
    skryta: false
    puvod: src/places/Cesta/brod.png
  - soubor: tabor-noc.png
    ucel: scena
    varianta: noc
    skryta: false
    puvod: src/places/Cesta/tabor.png
  - soubor: kolaz.png
    ucel: scena
    skryta: false
    puvod: src/places/Cesta/4.png
svetla:
  noc:
    hlavni: { barva: [ 47, 128, 255 ], jas: 65 }
    pozadi: { barva: [ 129, 255, 0 ], jas: 100 }
    lampa: { barva: [ 31, 35, 255 ], jas: 21 }
strop: nebe
---
# Cesta

Popis místa doplní DM.
