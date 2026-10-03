#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Načte a ověří sortiment.json — sdílený formát mezi generator.html a cenik.html."""
import json, sys

LOKALITY = {'rural', 'urban', 'premium'}

def zl(md):
    """Měďáky -> čitelný zápis. 1 zl = 100 md, 1 st = 10 md."""
    z, zb = divmod(md, 100)
    s, m = divmod(zb, 10)
    return ' '.join(x for x in (f'{z} zl' if z else '', f'{s} st' if s else '',
                                f'{m} md' if m else '') if x) or '0 md'

def nacti(cesta, typy_obchodu=None):
    with open(cesta, encoding='utf-8') as f:
        d = json.load(f)
    chyby = []
    if d.get('verze') != 1:
        chyby.append(f"neznámá verze formátu: {d.get('verze')!r}")
    o = d.get('obchod') or {}
    for k in ('nazev', 'typ', 'lokalita'):
        if not o.get(k):
            chyby.append(f'obchod.{k} chybí')
    if o.get('lokalita') and o['lokalita'] not in LOKALITY:
        chyby.append(f"obchod.lokalita {o['lokalita']!r} není z {sorted(LOKALITY)}")
    if typy_obchodu and o.get('typ') not in typy_obchodu:
        chyby.append(f"obchod.typ {o.get('typ')!r} není známý typ")
    pol = d.get('polozky')
    if not isinstance(pol, list) or not pol:
        chyby.append('polozky chybí nebo jsou prázdné')
        pol = []
    videno = set()
    for i, p in enumerate(pol):
        kde = f'polozky[{i}]'
        if not p.get('nazev'):
            chyby.append(f'{kde}.nazev chybí'); continue
        if p['nazev'] in videno:
            chyby.append(f"{kde}: {p['nazev']!r} je v sortimentu dvakrát")
        videno.add(p['nazev'])
        c = p.get('cena_md')
        if not isinstance(c, int) or isinstance(c, bool) or c <= 0:
            chyby.append(f"{kde}.cena_md musí být kladné celé číslo, je {c!r}")
        m = p.get('mnozstvi')
        if m is not None and (not isinstance(m, int) or isinstance(m, bool) or m <= 0):
            chyby.append(f"{kde}.mnozstvi musí být kladné celé číslo nebo null, je {m!r}")
    return d, chyby

def vypis(d):
    o = d['obchod']
    print(f"{o['nazev']}  ({o.get('mesto', '?')} — {o['typ']}/{o['lokalita']})")
    if o.get('podtitul'):
        print(f"  {o['podtitul']}")
    print()
    for p in d['polozky']:
        mn = f"  ×{p['mnozstvi']}" if p.get('mnozstvi') else ''
        jd = ' ·' if p.get('jadro') else '  '
        print(f"{jd} {p['nazev']:<32}{zl(p['cena_md']):>10}{mn}")
    print(f"\n  {len(d['polozky'])} položek, seed {d.get('meta', {}).get('seed', '—')}")

if __name__ == '__main__':
    cesta = sys.argv[1] if len(sys.argv) > 1 else 'sortiment.json'
    d, chyby = nacti(cesta)
    if chyby:
        print('CHYBY:'); [print('  -', c) for c in chyby]; sys.exit(1)
    vypis(d)
