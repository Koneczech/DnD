// Motor Harptos v Hubu musí dávat stejné výsledky jako původní kalendar.html (kritérium Bloku 1b).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { Harptos, MESICE, normalizujUdalost, aktivniLhuty, udalostiDne, indexZacatku, seradit } from '../sdilene/harptos.js';
import { HUB_DIR } from '../server/cesty.js';

const d = (den, mesic, rok = 1491) => ({ rok, mesic, den });
const s = (svatek, rok = 1491) => ({ rok, svatek });

test('délka roku: 365 dní, v přestupném 366 se Shieldmeet po Midsummer', () => {
  assert.equal(Harptos.dny(1491).length, 365);
  assert.equal(Harptos.dny(1492).length, 366);
  assert.equal(Harptos.normalizuj(s('Shieldmeet', 1491)), null);
  assert.deepEqual(Harptos.normalizuj(s('Shieldmeet', 1492)), s('Shieldmeet', 1492));
  assert.deepEqual(Harptos.posun(s('Midsummer', 1492), 1), s('Shieldmeet', 1492));
  assert.deepEqual(Harptos.posun(s('Midsummer', 1491), 1), d(1, 'Eleasis'));
  assert.equal(Harptos.popisSvatku(s('Shieldmeet', 1492)), 'po svátku Midsummer');
});

test('svátky stojí mezi měsíci', () => {
  assert.deepEqual(Harptos.posun(d(30, 'Hammer'), 1), s('Midwinter'));
  assert.deepEqual(Harptos.posun(s('Midwinter'), 1), d(1, 'Alturiak'));
  assert.deepEqual(Harptos.posun(d(30, 'Eleint'), 1), s('Highharvestide'));
  assert.deepEqual(Harptos.posun(s('Highharvestide'), 1), d(1, 'Marpenoth'));
  assert.equal(Harptos.popisSvatku(s('Highharvestide')), 'po měsíci Eleint');
});

test('přelom roku tam i zpět', () => {
  assert.deepEqual(Harptos.posun(d(30, 'Nightal'), 1), d(1, 'Hammer', 1492));
  assert.deepEqual(Harptos.posun(d(1, 'Hammer', 1492), -1), d(30, 'Nightal'));
  assert.equal(Harptos.rozdil(d(30, 'Nightal'), d(1, 'Hammer', 1492)), 1);
  assert.equal(Harptos.rozdil(d(1, 'Hammer', 1492), d(1, 'Hammer', 1493)), 366);
});

test('formát a rozsah data', () => {
  assert.equal(Harptos.format(d(19, 'Eleint')), '19. Eleint 1491 DR');
  assert.equal(Harptos.format(s('Highharvestide')), 'Highharvestide 1491 DR');
  assert.equal(Harptos.formatRozsah(d(14, 'Eleint'), d(18, 'Eleint')), '14.–18. Eleint 1491 DR');
  assert.equal(Harptos.formatRozsah(d(28, 'Eleint'), d(3, 'Marpenoth')), '28. Eleint – 3. Marpenoth 1491 DR');
});

test('převod textového data ze stav.md', () => {
  assert.deepEqual(Harptos.zTextu('19. Eleint 1491'), d(19, 'Eleint'));
  assert.deepEqual(Harptos.zTextu('19. eleint 1491 DR'), d(19, 'Eleint'));
  assert.deepEqual(Harptos.zTextu('Highharvestide 1491 DR'), s('Highharvestide'));
  assert.equal(Harptos.zTextu(''), null);
  assert.equal(Harptos.zTextu('32. Eleint 1491'), null);
  assert.equal(Harptos.zTextu('Shieldmeet 1491'), null);
});

test('vícedenní události, lhůty a dnešní události', () => {
  const ud = [
    normalizujUdalost({ id: 'a', datum: d(14, 'Eleint'), konec: d(18, 'Eleint'), text: 'Cesta', verejna: true }),
    normalizujUdalost({ id: 'b', datum: d(18, 'Eleint'), text: 'Longsaddle', verejna: true }),
    normalizujUdalost({ id: 'c', datum: d(18, 'Eleint'), text: 'Tajné', verejna: false }),
    normalizujUdalost({ id: 'd', datum: s('Highharvestide'), text: 'Highharvestide', odpocet: 20 }),
  ];
  assert.equal(ud[3].lhuta, 20, 'starší pole odpocet se převede na lhuta');
  assert.equal('odpocet' in ud[3], false);
  const dnes = udalostiDne(d(18, 'Eleint'), ud);
  assert.deepEqual(dnes.map((x) => [x.u.id, x.den, x.celkem]), [['b', 1, 1], ['a', 5, 5]]);
  assert.equal(udalostiDne(d(18, 'Eleint'), ud, { jenVerejne: false }).length, 3);
  assert.deepEqual(aktivniLhuty(d(19, 'Eleint'), ud).map((x) => x.zbyva), [12]);
  assert.deepEqual(aktivniLhuty(d(1, 'Eleint'), ud), [], '30 dní před svátkem je mimo lhůtu 20');
  assert.equal(normalizujUdalost({ datum: d(31, 'Eleint'), text: 'x' }), null);
  assert.equal(normalizujUdalost({ datum: d(18, 'Eleint'), konec: d(17, 'Eleint'), text: 'x' }).konec, undefined);
  assert.deepEqual(seradit([ud[3], ud[1], ud[0]]).map((u) => u.id), ['a', 'b', 'd']);
  assert.equal(indexZacatku(d(12, 'Eleint'), d(19, 'Eleint')), Harptos.index(d(12, 'Eleint')));
  assert.equal(indexZacatku(d(12, 'Eleint', 1490), d(19, 'Eleint')), 0);
  assert.equal(indexZacatku(d(20, 'Eleint'), d(19, 'Eleint')), null);
});

// Původní motor z Apps/Calendar/kalendar.html, spuštěný beze změny ve vlastním kontextu.
function puvodniMotor() {
  const html = fs.readFileSync(path.join(HUB_DIR, '..', 'Apps', 'Calendar', 'kalendar.html'), 'utf8');
  const blok = html.slice(html.indexOf('/* HARPTOS-START */'), html.indexOf('/* HARPTOS-END */'));
  const kontext = {};
  vm.runInNewContext(`${blok}\nthis.Harptos = Harptos; this.udalostiDne = udalostiDne; this.aktivniOdpocty = aktivniOdpocty; this.normalizujData = normalizujData;`, kontext);
  return kontext;
}

test('stejné výsledky jako původní kalendar.html (každý den let 1490–1493)', () => {
  const P = puvodniMotor();
  for (let rok = 1490; rok <= 1493; rok++) {
    assert.equal(Harptos.dny(rok).length, P.Harptos.dny(rok).length);
    for (const den of Harptos.dny(rok)) {
      const c = Harptos.cisty(den);
      assert.equal(Harptos.absolutni(c), P.Harptos.absolutni(c));
      assert.deepEqual(Harptos.posun(c, 1), JSON.parse(JSON.stringify(P.Harptos.posun(c, 1))));
      assert.deepEqual(Harptos.posun(c, -40), JSON.parse(JSON.stringify(P.Harptos.posun(c, -40))));
      assert.equal(Harptos.format(c), P.Harptos.format(c).replace(/ /g, ' '));
    }
  }
  // Události a lhůty na skutečných datech kampaně
  const js = fs.readFileSync(path.join(HUB_DIR, '..', 'Apps', 'Calendar', 'kalendar-data.js'), 'utf8');
  const data = JSON.parse(js.slice(js.indexOf('{'), js.lastIndexOf('}') + 1));
  const stara = P.normalizujData(data);
  const nove = data.udalosti.map(normalizujUdalost);
  for (let i = 0; i < 40; i++) {
    const den = Harptos.posun(data.zacatek, i);
    const staraData = { ...stara, dnes: den };
    assert.deepEqual(udalostiDne(den, nove).map((x) => [x.u.id, x.den, x.celkem]), JSON.parse(JSON.stringify(P.udalostiDne(staraData).map((x) => [x.u.id, x.den, x.celkem]))));
    assert.deepEqual(aktivniLhuty(den, nove).map((x) => [x.u.id, x.zbyva]), JSON.parse(JSON.stringify(P.aktivniOdpocty(staraData).map((x) => [x.u.id, x.zbyva]))));
  }
  assert.ok(MESICE.includes('Eleint'));
});
