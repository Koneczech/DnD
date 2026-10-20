---
schema: 1
id: longsaddle
typ: misto
nazev: Longsaddle
ikona: 🛤️
aliases: []
vazby: ["[[leta]]", "[[thiril-ambersedge]]", "[[malk-orren]]", "[[ordwin-sohla]]", "[[co-longsaddle-vyda]]"]
tags: []
zdroj: https://app.notion.com/p/3c49ed22673681af9ef7d5d6a2958cc8
verejne: true
# Anglický popis vzhledu místa pro prompty dílny (doplní DM). Dílna ho vloží do promptu.
popis_obrazu: ""
ilustrace:
  - soubor: celek.png
    ucel: scena
    skryta: false
    puvod: src/places/Longsaddle/1.png
  - soubor: ulice.png
    ucel: scena
    skryta: false
    puvod: src/places/Longsaddle/2.png
svetla:
  noc:
    hlavni: { barva: [ 47, 128, 255 ], jas: 65 }
    pozadi: { barva: [ 129, 255, 0 ], jas: 100 }
    lampa: { barva: [ 31, 35, 255 ], jas: 21 }
# Zvuk (DM 19. 10. 2026, ⚠ návrh): klidná vesnice na Long Road. Přes den ruch, koně a kovář, občas
# pes nebo povoz; tu a tam zapraskání kouzla od Harpellů. V noci cvrčci, psi a sova. Hudba je playlist
# ze Spotify (DM 20. 10. 2026) se zálohou ze složky, když Spotify nejede.
zvuk:
  den:
    hudba: { spotify: spotify:playlist:2UAnG9qnMbmlPCmaJpApa2, zaloha: hudba/longsaddle/ }
    ambient: longsaddle-den.mp3
    nahodne:
      - { zvuk: nahodne/tabor/kun, kazdych_s: 70, nahodilost: 0.8, hlasitost: 0.6, vzdalenost: 0.6 }
      - { zvuk: nahodne/tabor/kovadlina, kazdych_s: 55, nahodilost: 0.6, hlasitost: 0.5, vzdalenost: 0.8 }
      - { zvuk: nahodne/mesto/pes, kazdych_s: 90, nahodilost: 0.9, hlasitost: 0.5, vzdalenost: 0.8 }
      - { zvuk: nahodne/mesto/povoz, kazdych_s: 120, nahodilost: 0.8, hlasitost: 0.6, vzdalenost: 0.4 }
      - { zvuk: nahodne/longsaddle/kouzlo, kazdych_s: 240, nahodilost: 0.9, hlasitost: 0.4, vzdalenost: 0.8 }
  noc:
    hudba: { spotify: spotify:playlist:2UAnG9qnMbmlPCmaJpApa2, zaloha: hudba/longsaddle/ }
    ambient: longsaddle-noc.mp3
    nahodne:
      - { zvuk: nahodne/mesto/pes, kazdych_s: 120, nahodilost: 0.9, hlasitost: 0.4, vzdalenost: 0.9 }
      - { zvuk: nahodne/noc/sova, kazdych_s: 90, nahodilost: 0.8, hlasitost: 0.5, vzdalenost: 0.7 }
      - { zvuk: nahodne/longsaddle/kouzlo, kazdych_s: 300, nahodilost: 0.9, hlasitost: 0.4, vzdalenost: 0.8 }
---
# Longsaddle

Osada na Long Road severně od Mirabaru *(Neplatí: jižně od Mirabaru, R8.)*, **sedm dní pěšky**. Známá díky Harpellům — což je důvod, proč „kontakt, který ví víc" zní zrovna tady uvěřitelně.

Cíl, který [[thiril-ambersedge|Thiril]] [[leta|Letě]] vymyslel jako past na čas. Má se tam sejít s kontaktem, který jí údajně vysvětlí podmínky výměny za Thirilovu svobodu.

[[malk-orren|Kontakt]] je **[[ordwin-sohla|Ordwinův]] člověk** — existuje, ale vydá jen tolik, kolik mu Ordwin dovolil. Kolik to je, zůstává otevřené (viz [[co-longsaddle-vyda|registr rozhodnutí]]). *(Rozhodnuto, kontaktem byl Malk Orren, R1, R15.)*
