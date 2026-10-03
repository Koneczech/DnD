#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Zapeče polozky.json do šablony a vyrobí samostatný generator.html.

Proč zapékat: generator.html se otevírá dvojklikem z disku (file://) a prohlížeče
tam blokují fetch() na sousední soubor. Zapečená data tenhle problém obcházejí.
Když se změní databáze, pusť tenhle skript znovu.
"""
import json, sys, pathlib

KOREN = pathlib.Path(__file__).parent
SABLONA = KOREN / 'generator_sablona.html'
DATA = KOREN / 'polozky.json'
VYSTUP = KOREN / 'generator.html'

def main():
    for f in (SABLONA, DATA):
        if not f.exists():
            sys.exit(f'chybí {f.name}')
    d = json.loads(DATA.read_text(encoding='utf-8'))
    pol = d['polozky']

    # jen to, co generátor potřebuje — soubor je jinak zbytečně velký
    stihle = [{k: p[k] for k in ('nazev_cs', 'nazev_en', 'cena_md', 'typy', 'lokality', 'bezne', 'kategorie')
               if k in p} | ({'kameny': p['kameny']} if 'kameny' in p else {})
              for p in pol]

    for p in stihle:
        assert p.get('nazev_cs') and p.get('typy') and p.get('lokality'), f'neúplná položka: {p}'
        assert isinstance(p['cena_md'], int) and p['cena_md'] > 0, f"cena: {p['nazev_cs']}"

    # </script> uvnitř JSONu by ukončil blok dřív, než má
    blob = json.dumps({'polozky': stihle}, ensure_ascii=False,
                      separators=(',', ':')).replace('</', '<\\/')

    html = SABLONA.read_text(encoding='utf-8')
    if '%%DATA%%' not in html:
        sys.exit('v šabloně chybí značka %%DATA%%')
    VYSTUP.write_text(html.replace('%%DATA%%', blob), encoding='utf-8')

    kb = VYSTUP.stat().st_size / 1024
    print(f'{VYSTUP.name}: {len(stihle)} položek, {kb:.0f} kB')

if __name__ == '__main__':
    main()
