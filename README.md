# DnD — kampaň na Mečovém pobřeží a DM Hub

Repo drží data kampaně D&D 5e (2024), ilustrace a **DM Hub**, lokální ovládací panel DM pro sezení u stolu a OBS.

| Co | Kde |
| --- | --- |
| Zadání DM Hubu (master) | [`ZADANI.md`](ZADANI.md) |
| Pravidla pro práci Claude Code | [`CLAUDE.md`](CLAUDE.md) |
| Kód Hubu | [`hub/`](hub/) |
| Data kampaně (stav, entity, sezení) | [`kampan/`](kampan/) |
| Překladový klíč a prompty | [`reference/`](reference/) |
| Ilustrace nestvůr pro Improved Initiative | [`monsters/`](monsters/) — zmrazeno, IIO z ní čte přes URL |
| Portréty postav | `Alba.png`, `Koudur.png`, `Leta.png`, `Tusker.png` v kořeni — přesunou se ve verzi 2 |

## Spuštění DM Hubu (Windows 11)

Jednou na novém PC:

1. Zkontroluj, že klon repa **neleží v OneDrive** (Dokumenty a Plocha bývají synchronizované). Pokud ano, přesuň ho jinam, třeba do `C:\DnD`.
2. Nainstaluj Node.js ve verzi z [`.nvmrc`](.nvmrc) a Git s přihlášením k GitHubu (Git Credential Manager nebo GitHub Desktop).
3. V OBS (28 nebo novější) zapni **Tools → WebSocket Server Settings → Enable WebSocket server** a nastav heslo.
4. Vytvoř zástupce na ploše:
   ```powershell
   powershell -ExecutionPolicy Bypass -File hub\nastroje\vytvorit-zastupce.ps1
   ```

Pak už jen dvojklik na **DM Hub** na ploše. Poprvé se doinstalují závislosti, otevře se panel a v Nastavení vyplníš heslo k OBS.

Okno „DM Hub“ na liště nech běžet minimalizované; jeho zavřením Hub skončí. Když server spadne, spouštěč ho do pár sekund spustí znovu a výstupy v OBS mezitím drží poslední stav.

## Vývoj

```sh
cd hub
npm ci
npm test
```

Testy běží v GitHub Actions na Ubuntu i Windows. Každý blok zadání má vlastní větev a slučuje se přes pull request.
