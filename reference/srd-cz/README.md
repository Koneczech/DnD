# Pravidla česky ze SRD 5.2.1

Český překlad částí SRD 5.2.1 (pravidla D&D 2024), které potřebuje hra. Začali jsme u Alby, protože si kouzla po každém důkladném odpočinku vybírá z celého seznamu druida (rozhodnutí „Alba sesílá jen připravená kouzla“).

| Soubor | Obsah |
| --- | --- |
| `kouzla-druid.yaml` | 51 kouzel: všechna kouzla druida do 2. úrovně a Světlo (ásimarské dědictví Alby). Pole `na_listu`, `vzdy` a `zdroj_listu` podle `kampan/postavy/alba/list.yaml` |
| `zvirata-divoka-podoba.yaml` | 56 zvířat s nebezpečností do 1 bez rychlosti letu, tedy podoby, které může Alba (Kruh Měsíce, 3. úroveň) mít v Divoké podobě. `albina` označuje její oblíbené podoby (zlovlk = vlk lítý, medvěd = medvěd hnědý) |

## Jak je to přeložené

- Termíny podle `reference/prekladovy-klic-cz.md` (český PHB 2024). Vzdálenosti ve stopách jako jinde v repu.
- Složky kouzel česky: V (verbální), P (pohybová), S (surovinová).
- Kostky jako `1k8`, zranění v 2. pádu („2k8 ohnivého zranění“).
- **Vlastní názvy (⚠ ověřit v PHB):** kouzla Dlouhý krok (Longstrider), Očisti jídlo a pití (Purify Food and Drink); zvířata, která v klíči chybí (pole `vlastni_nazev: true`).
- Trnový bič (Thorn Whip) Alba má, ale v SRD 5.2.1 není, takže tu chybí. Popis je v české Příručce hráče.
- Rozpor v názvu: klíč má Goodberry = **Dobrůvky**, rozhodnutí `goodberry-pred-odpocinkem` píše **dobrobobule**. Rozhodne DM.

## Zdroj a licence

Data jsou z Open5e (`open5e/open5e-api`, dokument `srd-2024`). Text je český překlad.

This work includes material from the System Reference Document 5.2.1 („SRD 5.2.1“) by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.

Texty z placených knih (PHB, DMG, dobrodružství) sem nepatří: repo je veřejné.
