# Šablony

Šablony pro nové soubory kampaně. V Obsidianu je zapni v Nastavení → Šablony (Templates) a jako složku šablon nastav `sablony`. `{{title}}` se nahradí názvem poznámky, `{{date:…}}` dnešním datem.

| Šablona | Kam patří soubor | Tvar |
| --- | --- | --- |
| `postava.md` | `kampan/postavy/<id>/<id>.md` | entita |
| `list-postavy.yaml` | `kampan/postavy/<id>/list.yaml` (list postavy jako data, popis polí uvnitř) | data |
| `npc.md` | `kampan/npc/<id>/<id>.md` | entita |
| `padouch.md` | `kampan/padouchove/<id>/<id>.md` | entita |
| `frakce.md` | `kampan/frakce/<id>/<id>.md` | entita |
| `misto.md` | `kampan/mista/<id>/<id>.md` | entita |
| `predmet.md` | `kampan/predmety/<id>/<id>.md` | entita |
| `bytost.md` | `kampan/bytosti/<id>/<id>.md` | entita |
| `rozhodnuti.md` | `kampan/rozhodnuti/<id>.md` | záznam |
| `kanon.md` | `kampan/kanon/<id>.md` | záznam |
| `sezeni.md` | `kampan/sezeni/sNN/sNN.md` (Hub ho zakládá sám) | entita |
| `priprava-lazy-dm.md` | `kampan/sezeni/sNN/priprava-sNN.md` | příprava (verze 2) |

Pravidla: `id` je slug (malá písmena bez diakritiky, pomlčky) a je stejné jako jméno souboru. Odkazy na jiné soubory se píšou `[[id]]` nebo `[[id|Jméno]]`. Podrobně `ZADANI.md` → Datový model a `reference/kanon-prevod.md`.
