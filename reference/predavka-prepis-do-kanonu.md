# Předávka: přepis sezení → kánon

Stav k 31. 10. 2026, větev `prepis-do-kanonu` (vychází z `main` 172ee84, do `main` nesloučeno, PR neotevřen). Relace běžela v Claude Code ve složce `Dokumenty\Claude\II` a její hlavní prací byl přepisový nástroj mimo toto repo.

## Cíl relace

Stavěli jsme cestu od nahrávky sezení ke kánonu v Hubu tak, aby přepis co nejlépe fungoval bez pálení AI tokenů a do kánonu se nedostalo nic, co DM neschválil. Vznikl přepisový nástroj se scénářem, verzemi a učením z oprav, na straně Hubu schvalování návrhů po operacích a měření kvality kánonu. Kánon má být před dalším přidáváním v pořádku, proto ta kontrola.

## Hotovo

### V této větvi (repo)

| Co | Kde | Stav |
| --- | --- | --- |
| **Návrh po sezení:** Hub načte `sNN.yaml`, DM schvaluje po operacích, Hub zapíše jen schválené. Nejdřív nasimuluje všechny, pak jeden zápis na kartu přes `zapisovac.upravit`, události přes `kalendar.pridat` | `hub/sdilene/navrh-sezeni.js`, `hub/server/navrh-sezeni.js`, `hub/server/app.js` (`/api/navrh-sezeni…`), `hub/panel/navrh-sezeni.html`, `.js`, odkaz v Kánonu; `nastavitSurove` a pole `dukaz` v `hub/sdilene/hlavicka.js` | Testy prochází, ostrý návrh tudy ještě neprošel |
| **Kvalita kánonu:** procento karet bez chyby, stránka Co opravit (`#kanon/kvalita`), rámeček na kartě, `npm run kvalita` | `hub/sdilene/kvalita-kanonu.js`, `hub/skripty/kvalita.js`, `Kanon.kvalita()` v `hub/server/kanon-modul.js`, `hub/panel/kanon-wiki.js`, `hub/panel/styly.css` | Vyzkoušeno v běžícím Hubu na zkušebním portu |
| **Oprava karty Malka Orrena:** Leta mu heslo řekla | `kampan/npc/malk-orren/malk-orren.md` | Hotovo |
| Testy | `hub/test/navrh-sezeni.test.js`, `hub/test/kvalita-kanonu.test.js` | Celá sada: 351 z 351 po spojení obou prací |
| Dokumentace | `PREHLED.md`, `ZADANI.md` (⚠ body 153 a 154) | Hotovo |

Kvalita kánonu dnes hlásí **60 %** (88 ze 145 karet bez chyby). Karet s chybou podle pravidla: poznámky z přípravy 22, anglické termíny 21, družina nevidí 17, prázdná karta 16, neúplné sezení 2. Doporučení: chybějící oddíly 74, zmínka bez odkazu 88 (odhad podle jmen, část hlášení bude planá), chybějící zdroj 5.

### Mimo repo: přepisový nástroj

Leží v `Dokumenty\DnD\OBS\prepis\prepis-tool` a **není v Gitu**, takže nemá žádnou zálohu ani historii. Běží na 127.0.0.1:8765, spouští se dvojklikem. Přepisy ve `vystup\` do veřejného repa nepatří, proto tu z nástroje není nic než popis.

| Co | Soubory |
| --- | --- |
| Přepis, zarovnání, mluvčí, otisky hlasů, potlačení prosaknutí mezi stopami | `pipeline.py`, `hlasy.py` |
| Scénář jako dokument, průběžný poslech, značky ✓ kontroly, oprava mluvčích podle hlasu | `sezeni.py`, `static/sezeni.js` |
| Verze, schválení, porovnání a učení z úprav | `verze.py`, `static/uceni.js` |
| Podklad a kontrola důkazů, čtení kánonu z repa | `podklad.py`, `hubkanon.py` |

Sezení 3: z 1 466 replik je ✓ u 317 (22 %), u 39 replik je mluvčí opravený podle hlasu.

## Rozdělané

- **Paralelní práce.** Relace Hub 28. 10. založila `SPOLUPRACE-prepis-hub.md` a `NAVRH-kanon-po-sezeni.md` (oba ve složce nástroje) a napsala `hub/.stav/navrhy/s03.yaml` (74 operací, předběžný, mimo Git). Píše v nich, že Návrh po sezení v Hubu není postavený. Tato větev byla tehdy jen lokální, takže o ní nevěděla. Obě práce je potřeba sjednotit (viz Otevřené otázky).
- **`s03.yaml` proti kódu této větve:** soubor se načte, ale 4 operace `vyradit` Hub neumí. Oddíl Neplatné a registr rozhodnutí R také ne. Zda Hub zachová nová pole u rozporů (`druh`, `navrh_reseni`), jsem nezkoušel.
- **Kontrola důkazů:** body 1–8 ze `SPOLUPRACE-prepis-hub.md` § 4 nejsou udělané a otázky § 5 pro relaci Přepis nemají odpověď.
- **Scénář sezení 3** není zkontrolovaný ani schválený, takže návrh z něj je jen předběžný.
- **Úklid kánonu (krok 2 a dál)** nezačal: skončilo se změřením a opravou Malka.
- **Starší lokální větve** `blok-navrh-po-sezeni` a `blok-kvalita-kanonu` jsou touto větví nahrazené, stejně jako pracovní složky `repo-navrh` a `repo-kvalita`. Nic z nich není potřeba, ale nesmazal jsem je.

## Rozhodnutí

Jen to, co DM potvrdil v této relaci:

- Podklad připraví nástroj, návrh napíše Claude, potvrzuje DM („Podklad claude, já potvrdím.“). Hub smí kvůli tomu dostat úpravy („je to možné“, „zařídíš to?“).
- Přepis zůstává mimo repo („Ideálně asi mimo repo“).
- Do kánonu se přidává po částech: „odrážku, odstavec, část...“.
- Nástroj má fungovat co nejlépe bez pálení AI tokenů.
- Zlatý standard je sezení z 24. 10. 2026, které DM projde.
- Od dalšího sezení 3 stopy: mikrofon pro hráče, mikrofon pro DM a zvuky z OBS.
- U Alby je primární slovenský přepis.
- Nepotřebné modely a prostředí smazat (hotovo, přes Koš).
- Vícevstupová zvuková karta ne („Strašně drahé“).
- Aby se do kánonu mohlo přidávat, musí být kánon na 100 %.
- Rozpor s heslem: platí, že ho Leta řekla, pokud to tak bylo („Jestli Leta heslo řekla, je to v pořádku.“). Přepis to potvrdil.
- Začít krokem 1, tedy kontrolou kánonu v Hubu („Jinak ano, začni.“).
- Smart App Control zatím neřešit. Prostředí nástroje neměnit (torch, pandas, FFmpeg), klíče a tokeny jen v proměnných prostředí.

## Návrhy bez potvrzení

- Přesná pravidla Kvality kánonu: co je chyba a co doporučení, hranice 200 znaků popisu a 24 hodin sezení. DM odsouhlasil začátek práce, ne jednotlivé prahy. Všechno je ⚠ bod 154.
- Celý návrh Návrhu po sezení je ⚠ bod 153. Pravidlo „kánon se jen doplňuje, existující text se nepřepisuje“ jsem navrhl já a DM odpověděl jen „ok“ k postupu. Relace Hub má od DM novější a jiné pravidlo (viz Otevřené otázky).
- Pořadí dalších kroků: úklid poznámek a termínů po skupinách, doplnění sezení 3, prázdné karty a Co ví družina, nakonec vzhled.
- Vzhled webu pro družinu: rámeček s portrétem a údaji, skloňování („o Koudur Hardbeard“), události na kartě i podle `kdo` v záznamu kánonu, deník po sezeních, náhledy karet, obrázky kolem 300 kB.
- Mikrofony: nejdřív zdarma mobily hráčů, pak drátové klopové mikrofony přes 4 USB zvukovky a napájený hub (asi 2,5–3,5 tis. Kč), případně 2 sady DJI Mic Mini 2 (asi 4–5 tis. Kč). Nic nebylo vybráno.
- Cloudové přepisy (Soniox, ElevenLabs) vyzkoušet na zlatém standardu. Vyžaduje souhlas hráčů a klíče.
- V nástroji: zarovnání stop z mobilů, návod pro hráče, poslech s přeskakováním DM.
- V Hubu nepřidávat pohled „Přepis“.

## Otevřené otázky

1. **Která verze Návrhu po sezení platí?** Doporučuju vyjít z kódu v této větvi a doplnit do něj `vyradit`, oddíl Neplatné a registr R podle `NAVRH-kanon-po-sezeni.md`. Rozhodne DM.
2. **Jen přidávat, nebo i vyřazovat?** Tato relace stavěla kánon jen na přidávání. Podle `NAVRH-kanon-po-sezeni.md` DM 28. 10. rozhodl, že neplatný text se přesune do oddílu Neplatné. To je novější, ale zapsala to jiná relace, proto to tady neuvádím jako potvrzené. DM by to měl potvrdit.
3. **Co bude dřív:** dostavět Hub, nebo sezení 3 zapsat ručně? `SPOLUPRACE-prepis-hub.md` tu otázku nechává na DM.
4. **Musí být kánon na 100 % ještě před zápisem sezení 3?** Sezení 3 je samo jedna ze dvou chyb pravidla Neúplné sezení, takže se to bez zápisu nesplní.
5. **Schéma návrhu:** `SPOLUPRACE-prepis-hub.md` mluví o schématu 2, `s03.yaml` má v hlavičce `schema: 1`. Přechod ještě nikdo nepotvrdil.
6. **Sezení 3 v datech:** konec je 28. 10., čtyři dny po začátku. Je to omyl? Sezení 1 nemá datum.
7. **Přepisový nástroj nemá Git.** Kam ho dát, aby se přepisy nedostaly do veřejného repa?
8. **Mikrofony** na sezení 4.

## Vazby

| Část | Vliv |
| --- | --- |
| `kampan/` | Nově se mění jen `npc/malk-orren/malk-orren.md`. Návrh po sezení bude po sloučení zapisovat do karet, `kanon/`, `sezeni/` a `kalendar/udalosti.yaml`. Kvalita kánonu jen čte, ale určuje, co se bude uklízet (asi 57 karet s chybou) |
| `ZADANI.md` | ⚠ body 153 a 154. Oba čekají na akceptaci. Sloučení s jinou větví může narazit na konec tabulky bodů |
| `PREHLED.md` | Řádky o Návrhu po sezení a Kvalitě kánonu, umístění souborů |
| Kánon (Hub) | Odkaz na Návrh po sezení v hlavičce Kánonu, Kvalita kánonu na přehledu a na kartách, pole `dukaz` v hlavičce karty, `hlavicka` v načtené entitě |
| Čtecí verze webu | Pohled DM dostane Kvalitu kánonu se seznamem karet, pohled družiny ne. Návrh po sezení na webu není |
| Příprava sezení | Sezení 3 nemá shrnutí ani záznamy hráčského kánonu, takže příprava sezení 4 se o ně zatím nemůže opřít. Od sezení 4 se počítá se 3 stopami v OBS (`pipeline.py` je umí) |
| `hub/.stav/navrhy/` | Mimo Git, společné místo nástroje a Hubu: `sNN.yaml`, `.dukazy.json`, `.rozhodnuti.json`, `.zapsano.json` |
