#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Zapeče sortiment.json do cenik.html pro OBS Browser Source (1920×1080, průhledné pozadí).

Použití:
    python postav_cenik.py                  # vezme sortiment.json vedle skriptu
    python postav_cenik.py kovarna.json      # nebo konkrétní soubor

V OBS ukazuje Browser Source pořád na cenik.html. Před sezením se přestaví tímhle
skriptem — přepínání obchodů se tak děje výměnou souboru, ne klikáním za běhu.
"""
import json, sys, pathlib
from nacti_sortiment import nacti

KOREN = pathlib.Path(__file__).parent
SABLONA = KOREN / 'cenik_sablona.html'
VYSTUP = KOREN / 'cenik.html'

def main():
    zdroj = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else KOREN / 'sortiment.json'
    if not zdroj.exists():
        sys.exit(f'chybí {zdroj}')
    if not SABLONA.exists():
        sys.exit(f'chybí {SABLONA.name}')

    d, chyby = nacti(zdroj)
    if chyby:
        print('sortiment.json má chyby:', file=sys.stderr)
        for c in chyby:
            print('  -', c, file=sys.stderr)
        sys.exit(1)

    n = len(d['polozky'])
    if n > 16:
        print(f'varování: {n} položek se do panelu nemusí vejít čitelně (doporučeno do 16)',
              file=sys.stderr)

    blob = json.dumps(d, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
    html = SABLONA.read_text(encoding='utf-8')
    if '%%SORTIMENT%%' not in html:
        sys.exit('v šabloně chybí značka %%SORTIMENT%%')
    VYSTUP.write_text(html.replace('%%SORTIMENT%%', blob), encoding='utf-8')

    print(f"{VYSTUP.name}: {d['obchod']['nazev']}, {n} položek")

if __name__ == '__main__':
    main()
