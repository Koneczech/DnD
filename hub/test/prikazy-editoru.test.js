// Příkazy „/“ v editoru karty (⚠ bod 149).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRIKAZY, prikazyKarty, najitLomitko, filtrovatPrikazy, provestPrikaz } from '../sdilene/prikazy-editoru.js';

const prikaz = (id) => PRIKAZY.find((p) => p.id === id);
/** Napíše text s | jako kurzorem a provede příkaz; vrátí výsledek s | na novém místě kurzoru. */
function proved(sKurzorem, id, typ = 'npc') {
  const kurzor = sKurzorem.indexOf('|');
  const text = sKurzorem.replace('|', '');
  const l = najitLomitko(text, kurzor);
  assert.ok(l, `lomítko v „${sKurzorem}“`);
  const p = id.startsWith('oddil:') ? prikazyKarty(typ, text).find((x) => x.id === id) : prikaz(id);
  const r = provestPrikaz(text, l.od, kurzor, p, typ);
  return r.text.slice(0, r.kurzor) + '|' + r.text.slice(r.kurzor);
}

test('lomítko: na začátku řádku a po mezeře ano, uvnitř slova ne', () => {
  assert.deepEqual(najitLomitko('/nad', 4), { od: 0, dotaz: 'nad' });
  assert.deepEqual(najitLomitko('Text\n/', 6), { od: 5, dotaz: '' });
  assert.deepEqual(najitLomitko('Kovář /tuč', 10), { od: 6, dotaz: 'tuč' });
  assert.equal(najitLomitko('a/b', 3), null, 'adresa ani zlomek nabídku neotevře');
  assert.equal(najitLomitko('/nadpis s mezerou', 17), null, 'mezera nabídku zavře');
});

test('hledání: bez diakritiky, začátek názvu má přednost', () => {
  assert.equal(filtrovatPrikazy(PRIKAZY, 'nad')[0].id, 'nadpis');
  assert.equal(filtrovatPrikazy(PRIKAZY, 'tuc')[0].id, 'tucne');
  assert.equal(filtrovatPrikazy(PRIKAZY, 'tab')[0].id, 'tabulka');
  assert.equal(filtrovatPrikazy(PRIKAZY, 'zna')[0].id, 'druzina-vi', 'i podle klíče');
  assert.deepEqual(filtrovatPrikazy(PRIKAZY, 'xyz'), []);
  assert.equal(filtrovatPrikazy(PRIKAZY, '').length, PRIKAZY.length);
});

test('vložení: řádkové prvky, vnořené značky a kurzor', () => {
  assert.equal(proved('/nad|', 'nadpis'), '## |');
  assert.equal(proved('Úvod\n/|', 'odrazka'), 'Úvod\n- |');
  assert.equal(proved('Kovář /|', 'nadpis'), 'Kovář \n## |', 'uprostřed řádku na nový řádek');
  assert.equal(proved('  /|', 'citace'), '> |', 'mezery před lomítkem zmizí');
  assert.equal(proved('Je to /tuc| chlap', 'tucne'), 'Je to **|** chlap');
  assert.equal(proved('/|', 'druzina-vi'), '- | %%zná%%');
  assert.equal(proved('/|\nDalší', 'tabulka'), '| | |  |\n| --- | --- |\n|  |  |\nDalší');
  assert.equal(proved('/|konec', 'tabulka'), '| | |  |\n| --- | --- |\n|  |  |\nkonec', 'zbytek řádku se nepřilepí k tabulce');
});

test('odkaz otevře našeptávání karet', () => {
  const r = provestPrikaz('Viz /od', 4, 7, prikaz('odkaz'), 'npc');
  assert.equal(r.text, 'Viz [[');
  assert.equal(r.kurzor, 6);
  assert.equal(r.odkaz, true);
});

test('oddíly podle typu: jen chybějící, vloží se na své místo', () => {
  const telo = '# Dorn\n\nÚvod.\n\n## Příběh\n\nKovář.\n';
  const ids = prikazyKarty('npc', telo).filter((p) => p.oddil).map((p) => p.oddil);
  assert.deepEqual(ids, ['Co ví družina', 'Jak ho hrát', 'DM']);
  const vysledek = proved('# Dorn\n\nÚvod.\n\n## Příběh\n\nKovář. /|\n', 'oddil:Co ví družina');
  assert.ok(vysledek.indexOf('## Co ví družina') < vysledek.indexOf('## Příběh'), 'Co ví družina před Příběhem');
  assert.match(vysledek, /## Co ví družina\n\n\|/, 'kurzor pod nadpisem');
  assert.ok(!vysledek.includes('/'), 'lomítko zmizelo');
});
