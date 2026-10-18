# Analýza DM Hubu (18. 10. 2026)

Zaměření: funkce, jestli fungují správně a jestli se Hub snadno ovládá. Bezpečnost a legislativa stranou.

Podklad: kód v `hub/` (13 100 řádků, 32 modulů serveru, 11 výstupů pro OBS), 188 automatických testů (všechny procházejí na Linuxu i Windows), `ZADANI.md`, záznam událostí z domácího PC a zkušenost ze sezení 1–2 a přípravy sezení 3.

## 1. Funkce: co funguje a co je křehké

| Oblast | Hodnocení | Proč |
| --- | --- | --- |
| Kalendář, obchody, místa, OBS | Spolehlivé | Používá se od sezení 1, testy, žádné hlášené chyby |
| Světla | Spolehlivé s výhradou | WiZ dostával zprávy rychleji, než je stíhal (opraveno spojováním). Pravidlo „co nic neřídí, svítí normálně“ platí |
| Souboj (Improved Initiative) | **Nejkřehčí část** | Závisí na cizí aplikaci: přihlášení vyprší, druhá záložka přepíše nastavení, Player View se umí „zaseknout“. Hub to dnes hlásí, ale neumí to opravit sám |
| Animace zásahů | Funguje, čeká na stůl | Zranění se pozná ze změny barvy HP, u nestvůr bez čísel je to odhad |
| Zvuk | Funguje, hodně nového najednou | Za 2 dny přibylo: soundboard, tahy, náhodné zvuky, dozvuk, sada, srovnání hlasitosti. Každé zvlášť má testy, dohromady u stolu nevyzkoušené |
| Zvuková sada | Funguje | Openverse z domácího PC často neodpovídá; výběr zvuku je automatický, takže občas mine (ambient bitvy byl vesmírná loď, harfa místo loutny) |
| Aktualizovat a restart | Funguje | První ostrá aktualizace 18. 10. prošla (commit „Úpravy z panelu“) |

**Chyby nalezené při analýze:**

- Otevřený bod 90 se ztratil při slučování větví (opraveno v tomto PR).
- Kontrolka Zvuk ukazuje „Výchozí zařízení“, i když Windows posílá zvuk do BT reproduktoru (PC nemá mikrofon, prohlížeč přesměrování nevidí). Mate.
- Po restartu se stránka Zvuk u stolu načte znovu a prohlížeč může chtít kliknutí, jinak je ticho. Neověřeno.

## 2. Ovládání: jak snadné to je

**Silné stránky**

- Každá chvíle u stolu má jedno hlavní tlačítko: Zahájit sezení, Souboj, Konec souboje, Ukončit sezení.
- Hub hlídá sám sebe (Před hrou, kontrolky, Záznam událostí) a chyby píše česky s návrhem, co udělat.
- Data jsou obyčejné soubory, které jdou číst i v Obsidianu a na GitHubu.

**Slabiny**

| Problém | Dopad | Návrh |
| --- | --- | --- |
| Příliš mnoho míst: 8 obrazovek, U stolu má 4 záložky, Nastavení 5 kategorií | Věci se hledají (Kontrola dat, restart, záznam) | Systém vpravo nahoře jako jediné místo pro údržbu (hotovo); Nastavení sloučit do 3 kategorií: Připojení (OBS, Hue/WiZ, II), Zvuk, Hub |
| Kontrola dat hlásí 21 varování, skoro vše chybějící zvuky | Opravdová chyba by zapadla | Skupiny: chyby nahoře, chybějící zvuky jedním řádkem s tlačítkem Doplnit, zbytek sbalený |
| Zvuk má desítky voleb (hladiny, vzdálenost, dozvuk, nahodilost …) | Těžko se nastavuje | Výchozí hodnoty stačí; pokročilé volby schovat pod „Více“ |
| Nastavení zvuku místa (den, noc, souboj × hudba, ambient, náhodné) | Dlouhý formulář | Šablony míst: „Tábor“, „Les“, „Město“, „Kobka“ nastaví zvuk najednou |
| Souboj stojí na Improved Initiative s mnoha podmínkami | Nejčastější zdroj problémů | Jeden průvodce „Připravit souboj“ v Před hrou: přihlášení, Encounter ID, portréty, Player View, vše zeleně |

## 3. Zjednodušení projektu

Nejjednodušší myšlenka: **Hub = jedno okno, jedno tlačítko pro každou chvíli u stolu, jeden soubor s přehledem.**

### Dokumenty (z 10 na 3 hlavní)

| Dnes | Návrh |
| --- | --- |
| `ZADANI.md` 761 řádků, 92 otevřených bodů, z toho ~80 „čeká na akceptaci“ | Zkrátit na pravidla a rozhodnutí. Přijaté body převést na jednořádková rozhodnutí, otevřené nechat jen skutečně otevřené (~10) |
| Stav funkcí rozptýlený v PR a bodech | `PREHLED.md`: co umí, co je rozdělané, co vynecháno (tento PR) |
| `reference/` 7 souborů, `zvuk.md` 235 řádků | Návody nechat, ale každý začne odstavcem „v kostce“ |

### GitHub

- **53 starých větví** po sloučených PR. Zapni v repu *Settings → General → Automatically delete head branches* a staré smaž na stránce *Branches* (stará data tím nezmizí, PR zůstanou).
- **Jeden PR na jednu věc a sloučit hned:** souběžné PR se pak nesrážejí (tak se ztratil bod 90).
- Aktualizace jen přes **Systém → Aktualizovat**, už ne PowerShell.

### Hub

1. Kontrola dat ve skupinách (viz výše).
2. Nastavení ve 3 kategoriích.
3. Průvodce „Připravit souboj“.
4. Šablony zvuku míst.
5. Pokročilé volby zvuku pod „Více“.

## 4. Doporučené pořadí

1. Sezení 3 odehrát a poznamenat, co se u stolu zadrhlo (F2 poznámka nebo Záznam událostí).
2. Úklid: ZADANI zkrátit, větve smazat, Kontrola dat ve skupinách.
3. Průvodce souboje a 3 kategorie Nastavení.
4. Blok 3 Kánon.
