from playwright.sync_api import sync_playwright
import json, pathlib, re
url='file://'+str(pathlib.Path('generator.html').resolve())
vysl=[]
def ok(n,c,d=''): vysl.append((bool(c),n,d))
with sync_playwright() as pw:
    b=pw.chromium.launch(); pg=b.new_page(viewport={'width':1280,'height':900})
    chyby=[]; pg.on('console',lambda m: chyby.append(m.text) if m.type=='error' else None)
    pg.on('pageerror',lambda e: chyby.append(str(e)))
    pg.goto(url); pg.wait_for_timeout(300)
    ok('stránka bez JS chyb', not chyby, '; '.join(chyby[:2]))
    ok('naplněný výběr typů', pg.locator('#typ option').count()==16)

    # losování bez typu -> chyba
    pg.click('#losuj'); ok('losování bez typu hlásí chybu','Vyber' in pg.inner_text('#zprava'))

    pg.select_option('#typ','kovarna')
    pg.click('#lokalita button[data-v=premium]')
    pg.fill('#pocet','9'); pg.fill('#nazev','U Kovadliny'); pg.fill('#mesto','Mirabar')
    pg.click('#losuj'); pg.wait_for_timeout(150)
    n=pg.locator('#seznam li').count(); ok('vylosováno 9 řádků', n==9, f'je {n}')
    ok('hlavička se vyplnila','U Kovadliny' in pg.inner_text('#v-nazev'))
    ok('místo se vyplnilo','Mirabar' in pg.inner_text('#v-misto'))

    # reprodukovatelnost
    seed=pg.input_value('#seed'); prvni=pg.inner_text('#seznam')
    pg.click('#losuj'); pg.wait_for_timeout(100)
    ok('nový los dá jiný sortiment', pg.inner_text('#seznam')!=prvni)
    pg.fill('#seed',seed); pg.click('#znovu'); pg.wait_for_timeout(100)
    ok('stejný seed dá stejný sortiment', pg.inner_text('#seznam')==prvni)

    # české řazení
    serazeno=pg.evaluate('''() => {
        const j=[...document.querySelectorAll('.jmeno')].map(e=>e.textContent);
        const s=[...j].sort((a,b)=>a.localeCompare(b,'cs'));
        return JSON.stringify(j)===JSON.stringify(s);
    }''')
    ok('řazeno českou kolací', serazeno)
    ok('jádro označené mosazí', pg.locator('.tik:has-text("●")').count()>0)

    # editace ceny
    pg.locator('.cena input').first.fill('42 zl 5 st')
    pg.locator('.cena input').first.press('Enter'); pg.wait_for_timeout(120)
    ok('cena se přepsala', pg.locator('.cena input').first.input_value()=='42 zl 5 st',
       pg.locator('.cena input').first.input_value())
    pg.locator('.cena input').first.fill('nesmysl')
    pg.locator('.cena input').first.press('Enter'); pg.wait_for_timeout(120)
    ok('nesmyslná cena hlásí chybu','nerozumím' in pg.inner_text('#zprava'))

    # mnozstvi
    pg.locator('.mn').first.fill('3'); pg.locator('.mn').first.press('Enter'); pg.wait_for_timeout(120)
    ok('množství se uložilo', pg.locator('.mn').first.input_value()=='3')

    # smazani
    pred=pg.locator('#seznam li').count()
    pg.locator('.pryc').first.click(); pg.wait_for_timeout(100)
    ok('smazání ubere řádek', pg.locator('#seznam li').count()==pred-1)

    # rucni pridani + duplicita
    pg.fill('#hledej','Halapartna'); pg.click('#pridej'); pg.wait_for_timeout(100)
    ok('ruční přidání funguje','Halapartna' in pg.inner_text('#seznam'))
    pg.fill('#hledej','Halapartna'); pg.click('#pridej'); pg.wait_for_timeout(100)
    ok('duplicita odmítnuta','už v sortimentu' in pg.inner_text('#zprava'))
    pg.fill('#hledej','Neexistuje'); pg.click('#pridej'); pg.wait_for_timeout(100)
    ok('neznámá položka odmítnuta','nemám' in pg.inner_text('#zprava'))

    # tenky fond
    pg.select_option('#typ','pristavni'); pg.click('#lokalita button[data-v=premium]')
    pg.fill('#pocet','16'); pg.click('#losuj'); pg.wait_for_timeout(150)
    ok('tenký fond nespadne a upozorní','Fond má jen' in pg.inner_text('#zprava'),
       f"{pg.locator('#seznam li').count()} řádků")

    # export
    pg.select_option('#typ','kovarna'); pg.click('#losuj'); pg.wait_for_timeout(150)
    with pg.expect_download() as di: pg.click('#uloz')
    p=di.value.path(); d=json.loads(pathlib.Path(p).read_text(encoding='utf-8'))
    ok('export má verzi 1', d.get('verze')==1)
    ok('export má seed', isinstance(d['meta']['seed'],int))
    ok('export má položky s cenou v md', all(isinstance(x['cena_md'],int) for x in d['polozky']))
    pathlib.Path('vzorek_export.json').write_text(json.dumps(d,ensure_ascii=False,indent=1),encoding='utf-8')

    # slot ceniku
    pg.click('#zamoznost button[data-v="0.16"]')
    pg.click('#slot button[data-v="3"]')
    e,s=pg.evaluate('stav.exp'),pg.evaluate('stav.slot')
    ok('slot nepřepsal zámožnost', e==0.16 and s==3, f'exp={e} slot={s}')
    ok('slot 3 míří na cenik3.html', pg.evaluate('cilCeniku()')=='cenik3.html')
    pg.click('#slot button[data-v="1"]')
    ok('slot 1 míří na cenik.html', pg.evaluate('cilCeniku()')=='cenik.html')

    # bez pripojene slozky se pada zpatky na stahovani
    ok('beze složky hlásí stahování','stahuje' in pg.inner_text('#v-slozka'),pg.inner_text('#v-slozka'))
    ok('beze složky tlačítko ukládá json', pg.inner_text('#uloz')=='Uložit sortiment.json',
       pg.inner_text('#uloz'))

    pg.screenshot(path='generator.png',full_page=True)
    b.close()
for o,n,d in vysl: print(('  OK  ' if o else '  CHYBA ')+n+(f'  [{d}]' if d else ''))
print(f"\n{sum(1 for o,_,_ in vysl if o)}/{len(vysl)} prošlo")
