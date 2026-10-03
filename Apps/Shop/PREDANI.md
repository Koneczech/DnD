# Sortiment obchodů na TV — předání do Claude Code

Přečti si celý dokument, než začneš cokoli psát. Navazuješ na hotovou práci, ne na prázdný projekt.

## Jak spolu pracujeme

- **Jedna otázka po druhé**, čekej na odpověď. Neptej se na dvě věci naráz.
- **Označuj své předpoklady.** Netiš do výstupu nic, na čem jsme se nedohodli — auditovat, co sis domyslel, stojí víc času než se zeptat.
- Když si nejsi jistý, řekni to. Nestav další hypotézu na chybné diagnóze.
- **Kód testuj, než ho odevzdáš.** Pro HTML používej Playwright, ne jen statickou kontrolu.
- **Pravidla a ceny vždycky ověřuj ve zdroji**, ne z paměti.

## Kontext

Matěj vede D&D 5e (pravidla 2024, SRD 5.2.1) na severním Mečovém pobřeží — Mirabar,
Longsaddle, Triboar, Yartar. Hraje se offline, na stěně visí TV řízená z OBS.
Mluvíme a píšeme česky.

**Zásadní omezení:** u stolu chce dělat co nejmíň rozhodnutí a kliknutí. Všechno se
připravuje předem. Generátor je nástroj pro přípravu, ne pro běh hry.

`SRD_CC_v5_2_1.pdf` **není PDF** — je to čistý text s příponou `.pdf`. Dá se v něm
grepovat přímo.

## Co je hotové

| Soubor | Co dělá |
|---|---|
| `kampan/obchody/polozky.json` (od Bloku 1b) | Databáze, 260 položek, česky i anglicky, otagovaná typem obchodu a lokalitou |
| `hub/nastroje/generator_sablona.html` (od Bloku 1b) | Šablona generátoru se značkou `%%DATA%%` |
| `postav_generator.py` | Zapeče `polozky.json` do šablony → `generator.html` |
| `cenik_sablona.html` | Šablona ceníku pro OBS se značkou `%%SORTIMENT%%` |
| `postav_cenik.py` | Záložní CLI cesta: zapeče `sortiment.json` do šablony → `cenik.html` |
| `nacti_sortiment.py` | Čtečka a validátor formátu `sortiment.json` |
| `test_gen.py` | 26 testů generátoru v Playwrightu |
| `extrakce.py`, `tagy.py` | Jednorázová stavba databáze ze SRD. Znovu je pouštět netřeba. |

**Zapékání dat do HTML je záměr, ne lenost.** Prohlížeče i OBS blokují `fetch()` mezi
soubory na `file://`. Kdyby HTML četlo JSON zvenčí, zůstalo by prázdné.

**Generátor si zapéká ceník sám.** Přes File System Access API dostane handle na složku
projektu (přežívá restart prohlížeče v IndexedDB), přečte si `cenik_sablona.html` a zapíše
`sortiment.json` i hotový `cenik.html`. `postav_cenik.py` tím přestal být součástí postupu
a zůstává jen jako záloha. Ověřeno: na `file://` je `isSecureContext` true a API funguje;
povolení k zápisu si Chrome vyžádá jedním potvrzením po každém spuštění, ne po každém
uložení. Když složka není připojená nebo zápis selže, generátor spadne zpátky na stahování.

**Sloty ceníku.** Přepínač 1/2/3 v generátoru řídí, kam se ceník zapíše: slot 1 do
`cenik.html` (aby staré nastavení OBS dál platilo), sloty 2 a 3 do `cenik2.html` a
`cenik3.html`. Tři obchody za večer se tak dají připravit dopředu, každý na svůj zdroj
v OBS. Pozor na generický handler `.segment` v šabloně — přidání dalšího přepínače bez
větve v něm tiše přepíše `stav.exp` (zámožnost); hlídá to test.

## Rozhodnutí, která se neotvírají

1. **Databáze stojí na SRD 5.2.1**, ne na cizím katalogu. Katalog posloužil jen jako
   zdroj tagů (typ obchodu, lokalita, příznak stálého zboží).
2. **Vlastní položky se píšou vlastní**, ne opisují z cizího katalogu. Každá má v datech
   uvedenou kotvu — konkrétní položku ze SRD, od které je cena odvozená.
3. **Typy obchodů jsou katalogové** (10) plus **stáje a povozník**. Témata čtyři.
4. **Osa lokality zůstává `rural / urban / premium`.** Profil města byl zamítnut.
   Ví se, že ta osa filtruje slabě: rural 155 / urban 203 / premium 224 položek.
5. **Měna zl / st / md.** V datech vždy celé číslo měďáků (`cena_md`), překlad je věcí
   zobrazení.
6. **Vážení losu:** `váha = cena_md^(-e) × (stálé zboží ? 6 : 1)`, kde `e` je 0,40 / 0,28 / 0,16
   podle přepínače Zámožnost. Ověřeno na 300 losech: levné stálice ~50 %, plátovka ~1 %.
7. **Obrázek interiéru nesmí obsahovat text.** Cenovky se nekreslí, ceník se pokládá
   jako panel navrch. Generátory obrázků neumí čitelnou češtinu a přes deset předmětů
   nezvládnou.
8. **Lokace vlevo, panel vpravo.** Prompt objednává obrázek s klidnou pravou třetinou.
9. **Ceník je jen panel**, žádné pevné plátno. Velikost si určuje Browser Source v OBS,
   umísťování je práce OBS. Písmo se dopočítá k výšce zdroje, dolní mez 22 px.
10. **Ikony u položek se nepřidávají.**
11. **České názvy se řídí překladovým klíčem**, ne vlastním citem. Klíč je
    `../prekladovy-klic-cz.md` — Příručka hráče 2024, český překlad Lethrendis a spol.,
    d20.cz. Co klíč pokrývá (zbraně, zbroje, nářadí, vybavení, životní styl, zvířata),
    má jeho znění doslova. Co nepokrývá (munice, ohniska, hudební nástroje, šperky,
    doprava, jídlo a pití, vlastní položky), zůstává v projektovém stylu. Závorkové
    doplňky jako `(10 stop)` nebo `(den)` jsou naše, klíč je neřeší, a zachovávají se.
12. **Slovosled se obrací tam, kde vzniká skupina** — `Meč, dlouhý`, ne `Dlouhý meč`.
    Slovník je z klíče, pořadí je naše: ceník se řadí abecedně, takže tři meče mají být
    pod sebou, ne rozházené přes celý panel. Týká se to kyje, sekyry, kladiva, hole,
    šipky, kuše, luku, meče a lucerny. **Není to chyba proti klíči, nepřepisuj to zpátky.**
    Položky bez skupiny (Řemdih, Kropáč, Kůsa, Dřevec…) zůstávají tak, jak je má klíč.

## Rozdělaná práce: hospoda

**Data jsou hotová, generátor ještě ne.**

**Hospoda není obyčejný typ obchodu.** Náhodný los napříč stupni by vyrobil nesmysl —
aristokratický nocleh, mizerné jídlo a chudý pokoj v jednom podniku.

Místo toho: **přepínač Zámožnost u hospody vybere třídu podniku.** Ta určí napevno
jeden řádek noclehu a jeden řádek stravy. Nápoje a drobné jídlo se dolosují normálně,
s vahou posunutou podle třídy — v honosném hostinci víno, v chudém pivo a řepná polévka.

**Co v datech je:** 31 položek s tagem `hospoda` — 5 kanonických nápojů a jídel do losu,
6 stupňů noclehu a 6 stupňů stravy pro pevný výběr (`kategorie` Nocleh/Strava,
`podkategorie` nese třídu), 12 vlastních položek s kotvou a 2 znovupoužité ze stájí
(`Krmivo (den)`, `Ustájení (den)`). Losovací fond hospody má 19 položek.

**Co zbývá:** přidat `hospoda` do `TYPY` v obou šablonách a napsat mapování
třípolohového přepínače (chudý / běžný / bohatý) na šest tříd. Mapování není nikde
dohodnuté — pravděpodobně přes kombinaci se **Lokalitou**, aby vesnická hospoda
nenabízela aristokratický pokoj. Zeptej se, neřeš to za něj.

**Pozor na kolizi slov:** přepínač Zámožnosti používá „chudý" a „bohatý", což jsou
zároveň názvy dvou tříd noclehu a stravy. Při psaní mapování to plete; v UI to bude
chtít rozlišit.

### Vyřešená otázka: ceny jídla

SRD 5.2.1 **uvádí všech šest stupňů**, ne tři, jak se dřív myslelo. Tabulka
`Food, Drink, and Lodging` je rozdělená přes zlom stránky 102, takže se snadno přehlédne.
Ověřeno přímo v PDF: Comfortable 2 SP, Wealthy 3 SP, Aristocratic 6 SP. Nejsou to hodnoty
z edice 2014 (3 st / 5 st / 2 zl) — ty by byly špatně.

## Další věci na horizontu

- Chrámový sortiment: typ obchodu existuje s 27 položkami ze SRD, ale vlastní zboží
  (kadidlo, kadidelnice, milodarná schránka) Matěj zamítl. Nejlevnější typ na obohacení,
  kdyby si to rozmyslel.
