# Vrstvy scén (Blok 4)

Hub skládá světla scény po vrstvách: místo + denní doba → počasí → intenzita → režim → pojistky
(ZADANI.md, Blok 4). Světla místa jsou v hlavičce místa (`svetla.den`, `svetla.noc`), tady jsou
vrstvy, které platí pro všechna místa.

- `pocasi/<efekt>.yaml` — `dest`, `snih`, `mlha`, `bourka`. Víc efektů naráz se násobí.
- `rezim/souboj.yaml` — bojová světla; přepíše role, které uvádí.

Hodnota role je buď **úprava** (`jas_nasobek`, `teplota_posun` v kelvinech, záporný = chladnější),
nebo **nový stav** (`barva: [r, g, b]` a `jas` 0–100, `vypnuto: true`, u WiZ `wiz_scena` a `rychlost`).
`vsechny` upraví všechny role. Hlavní světlo má vždy podlahu jasu 15 a omezenou sytost, aby šly číst deníky.

Hub soubory sleduje: po uložení se světla změní hned.
