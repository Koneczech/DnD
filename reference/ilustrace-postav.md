# Ilustrace postav a bytostí (karty Player View a animace zásahu)

Všechny portréty postav, NPC, bytostí a podob mají stejné plátno, aby velikost na kartách odpovídala skutečnosti.

| | Hodnota |
| --- | --- |
| Plátno | **1080 × 1500 px**, PNG s průhledným pozadím |
| Chodidla (spodní okraj postavy) | **y = 1375 px** (pod nimi zůstává místo pro pás se jménem) |
| Vodorovně | na střed |

## Výška postavy podle velikosti

| Velikost | Výška postavy | Příklad |
| --- | --- | --- |
| Tiny (drobná) | 400 px | |
| Small (malá) | 750 px | Leta, goblin |
| Medium (střední) | 1100 px | Tusker, Alba, bandité, Malk Orren |
| Large (velká) | 1300 px | Albiny podoby (vlk lítý, medvěd) |
| Huge, Gargantuan | 1340 px (víc se na plátno nevejde) | |

- Výška je od chodidel po temeno (u zvířete po nejvyšší bod).
- Postava, která by byla širší než 1040 px, se zmenší podle šířky.
- Uvnitř velikosti smí být postava nižší podle svého vzrůstu: trpaslík Koudur je střední, ale má 830 px.

Úprava hotového obrázku: oříznout na neprůhlednou část, zmenšit na výšku podle tabulky, vložit na průhledné plátno 1080 × 1500 tak, aby chodidla byla na y = 1375.

**Improved Initiative** bere ilustrace z GitHubu adresou. Když adresa obsahuje číslo commitu (`…/DnD/ccc9f23…/monsters/bandit.png`), ukazuje pořád starou verzi; po úpravě obrázku v ní nahraď číslo commitu slovem `main`. Prohlížeč a OBS si obrázek pamatují: po každé výměně přidej na konec adresy `?v=2` (příště `?v=3` …), jinak ukazují starou verzi.
