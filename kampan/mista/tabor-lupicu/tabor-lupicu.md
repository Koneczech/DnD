---
schema: 1
id: tabor-lupicu
typ: misto
nazev: Tábor lupičů
verejne: true
lezi_v: "[[longsaddle]]"
# Anglický popis vzhledu místa pro prompty dílny (doplní DM). Dílna ho vloží do promptu.
popis_obrazu: ""
ilustrace:
  - soubor: celek-den.png
    ucel: scena
    varianta: den
    skryta: true
    puvod: Golden Hour Bandit Camp in the Pines.png
  - soubor: celek-noc.png
    ucel: scena
    varianta: noc
    skryta: false
    puvod: Moonlit Medieval Forest Camp.png
  - soubor: poplach.png
    ucel: scena
    stav: poplach
    skryta: true
    puvod: Bandit Camp Alarm at Golden Hour.png
  - soubor: hori.png
    ucel: scena
    stav: hoří
    skryta: true
    puvod: Burning Wilderness Camp at Sunset.png
  - soubor: opusteny.png
    ucel: scena
    stav: po boji
    skryta: false
    puvod: Abandoned Camp Beneath Stormy Dusk.png
  - soubor: mapa-shora.png
    ucel: scena
    stav: mapa
    skryta: false
    puvod: Autumn Woodland Camp with Horses and Treehouse.png
  - soubor: spalene-dopisy.png
    ucel: scena
    skryta: true
    puvod: Scorched Letters by the Campfire.png
  - soubor: prsten-kapitana.png
    ucel: scena
    skryta: true
    puvod: Weathered Warrior’s Ring at Sunset.png
svetla:
  noc:
    hlavni: { barva: [ 47, 128, 255 ], jas: 65 }
    pozadi: { barva: [ 129, 255, 0 ], jas: 100 }
    lampa: { barva: [ 31, 35, 255 ], jas: 21 }
zvuk:
  den:
    hudba:
      spotify: spotify:playlist:3XhR52j3ROEfcD2TfBFmps
      zaloha: hudba/divocina/
    ambient: tabor-ohen.mp3
    nahodne:
      - { zvuk: nahodne/tabor/kun, kazdych_s: 60, nahodilost: 0.8, hlasitost: 0.8, vzdalenost: 0.7 }
      - { zvuk: nahodne/tabor/kovadlina, kazdych_s: 45, nahodilost: 0.75, hlasitost: 0.8, vzdalenost: 0.7 }
      - { zvuk: nahodne/tabor/krkavec, kazdych_s: 90, nahodilost: 0.9, hlasitost: 0.7, vzdalenost: 0.5 }
      - { zvuk: nahodne/tabor/drevo, kazdych_s: 40, nahodilost: 0.6, hlasitost: 0.8, vzdalenost: 0.3 }
  # Noc (DM 19. 10. 2026, ⚠ návrh): oheň dál, tábor spí; koně, sova a vlci v dálce.
  noc:
    hudba: { spotify: spotify:playlist:3XhR52j3ROEfcD2TfBFmps, zaloha: hudba/divocina/ }
    ambient: tabor-ohen.mp3
    nahodne:
      - { zvuk: nahodne/tabor/kun, kazdych_s: 90, nahodilost: 0.8, hlasitost: 0.6, vzdalenost: 0.6 }
      - { zvuk: nahodne/noc/sova, kazdych_s: 75, nahodilost: 0.8, hlasitost: 0.6, vzdalenost: 0.6 }
      - { zvuk: nahodne/noc/vlk, kazdych_s: 180, nahodilost: 0.9, hlasitost: 0.5, vzdalenost: 0.9 }
  souboj:
    ambient: tabor-bitva.mp3
    nahodne:
      - { zvuk: nahodne/boj/rinceni, kazdych_s: 6, nahodilost: 0.8, hlasitost: 0.7, vzdalenost: 0.4 }
      - { zvuk: nahodne/boj/sip, kazdych_s: 12, nahodilost: 0.9, hlasitost: 0.7, vzdalenost: 0.3 }
      - { zvuk: nahodne/boj/pokrik, kazdych_s: 15, nahodilost: 0.9, hlasitost: 0.6, vzdalenost: 0.6 }
strop: tabor
---
# Tábor lupičů

Pilotní místo Bloku 2 (rozhodnutí 37): tábor lupičů kousek od Longsaddle. Popis místa doplní DM.

Ilustrace: celek ve dne a v noci, stavy poplach, hoří, po boji a mapa shora; skryté stopy spálené dopisy a prsten na ruce kapitána (sezení 2).
