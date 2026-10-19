# Práce s Claudem na DM Hubu

Doporučené uspořádání (18. 10. 2026):

| Kde | Na co | Proč |
| --- | --- | --- |
| **Claude projekt „DM Hub“** s připojeným repem `Koneczech/DnD` | vývoj Hubu: nové funkce, opravy, analýzy | Claude vidí kód, spouští testy, otevírá PR; z telefonu i z PC |
| **Claude projekt „D&D“** (stávající) | svět, pravidla, příprava sezení, postavy | Hub tam nepatří, jinak se kontext míchá |

Claude Code v terminálu není potřeba: relace v Claude s připojeným repem (jako tahle) umí totéž a jde na ni navázat odkudkoli.

## Nastavení projektu „DM Hub“

1. V Claude: **Projekty → Nový projekt → „DM Hub“**.
2. **Pokyny projektu**: zkopíruj blok níže.
3. **Soubory projektu**: nahraj `PREHLED.md`, `CLAUDE.md` a `ZADANI.md` z repa. Repo je ale vždy přednější: Claude si je v každé relaci přečte znovu.
4. Novou práci začínej v projektu „DM Hub“ s připojeným repem `Koneczech/DnD` a propojením na tento počítač (kvůli záznamu událostí a složce zvuku).

### Pokyny projektu (zkopírovat)

```
Pracuješ na DM Hubu: lokální panel pro DM D&D kampaně (Node.js 24, Windows 11, OBS, Hue/WiZ,
Improved Initiative). Repo Koneczech/DnD je jediný zdroj pravdy.

Na začátku každé relace si přečti CLAUDE.md, PREHLED.md a v ZADANI.md otevřené body.

Jak pracujeme
- Komunikuj česky, věcně, s hotovými výstupy. DM je Matěj, ovládá Hub, kód nečte.
- Jedna věc = jedna větev = jeden PR. Testy (cd hub && npm test) musí projít. PR po sloučení
  DM stáhne tlačítkem Systém → Aktualizovat.
- Co nového rozhodneš sám (data, chování, UI), označ ⚠ návrh v PR a zapiš do ZADANI.md.
- Po každé změně funkcí aktualizuj PREHLED.md (stav ✓ ◐ ✗).
- Při chybě u stolu nejdřív přečti záznam událostí: hub/.stav/zaznam/hub-RRRR-MM-DD.log
  (přes propojení s počítačem), teprve pak hádej.
- Před úpravou dat kampaně v kampan/ ověř, že DM nemá rozdělané změny (jinak konflikt):
  požádej ho o Systém → Aktualizovat.
- Nové funkce drž jednoduché: výchozí hodnoty musí stačit, pokročilé volby schovat.

Prostředí DM
- Hub běží přes zástupce DM Hub (spouštěč restartuje), panel na http://localhost:7420.
- Zvuk: složka C:\Users\Matej\Documents\DnD\audio, BT reproduktor ULT FIELD 3 přes Směšovač
  hlasitosti Windows (PC nemá mikrofon).
- Repo: C:\Users\Matej\Documents\DnD\repo. Tajné hodnoty jen v hub/.env, nikdy je nechtěj.
```

## Když dojde limit uprostřed práce

Rozdělaná práce žije ve větvi na GitHubu. Nová relace stačí napsat: „Pokračuj na větvi X“ nebo „Projdi otevřené PR a PREHLED.md“.
