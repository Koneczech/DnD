// Průchod k Improved Initiative: relace DM jde jen na improvedinitiative.app, nikdy do prohlížeče.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { PruchodIniciativy, povolitPozadavek, hlavickyNaCil, hlavickyZpet, CIL } from '../server/iniciativa-pruchod.js';
import { hodnotaRelace } from '../server/nastaveni.js';

const falesnaRelace = () => `s%3A${crypto.randomBytes(12).toString('hex')}.${crypto.randomBytes(8).toString('hex')}`;

test('hodnota relace: sama, s předponou i se zbytkem cookie', () => {
  const r = falesnaRelace();
  assert.equal(hodnotaRelace(r), r);
  assert.equal(hodnotaRelace(` connect.sid=${r}; Path=/ `), r);
  assert.equal(hodnotaRelace('krátké'), null);
  assert.equal(hodnotaRelace('a b c d e f g h i j k l m n o p'), null);
});

test('povolené jsou jen požadavky z tohoto počítače a bez akcí, které poškodí účet', () => {
  const zaklad = { adresa: '127.0.0.1', host: '127.0.0.1:7421', metoda: 'GET', cesta: '/e/' };
  assert.equal(povolitPozadavek(zaklad, 7421), null);
  assert.equal(povolitPozadavek({ ...zaklad, host: 'localhost:7421', origin: 'http://localhost:7421' }, 7421), null);
  assert.match(povolitPozadavek({ ...zaklad, adresa: '192.168.0.50' }, 7421), /tohoto počítače/);
  assert.match(povolitPozadavek({ ...zaklad, host: 'zly.example:7421' }, 7421), /Neznámá adresa/);
  assert.match(povolitPozadavek({ ...zaklad, origin: 'https://zly.example' }, 7421), /cizí stránky/);
  assert.match(povolitPozadavek({ ...zaklad, cesta: '/logout' }, 7421), /Odhlášení/);
  assert.match(povolitPozadavek({ ...zaklad, metoda: 'DELETE', cesta: '/my' }, 7421), /Smazání účtu/);
});

test('hlavičky: ven jen relace DM, zpět žádná cookie ani zákaz vložení', () => {
  const r = falesnaRelace();
  const ven = hlavickyNaCil({ host: '127.0.0.1:7421', cookie: 'cizi=1', origin: 'http://127.0.0.1:7421', referer: 'http://127.0.0.1:7421/e/' }, r, 7421);
  assert.equal(ven.host, CIL);
  assert.equal(ven.cookie, `connect.sid=${r}`);
  assert.equal(ven.origin, `https://${CIL}`);
  assert.equal(ven.referer, `https://${CIL}/e/`);
  const nova = falesnaRelace();
  const zpet = hlavickyZpet({ 'set-cookie': [`connect.sid=${nova}; Path=/; HttpOnly`], 'x-frame-options': 'DENY', location: `https://${CIL}/e/` }, '127.0.0.1:7421');
  assert.equal(zpet.novaRelace, nova);
  assert.equal(zpet.hlavicky['set-cookie'], undefined);
  assert.equal(zpet.hlavicky['x-frame-options'], undefined);
  assert.equal(zpet.hlavicky.location, 'http://127.0.0.1:7421/e/');
});

test('průchod přidá relaci, odstraní cookie z odpovědi a nahlásí obnovenou relaci', async () => {
  const relace = falesnaRelace();
  const obnovena = falesnaRelace();
  const prijate = [];
  const cil = http.createServer((req, res) => {
    prijate.push({ cesta: req.url, cookie: req.headers.cookie, host: req.headers.host });
    res.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': `connect.sid=${obnovena}; Path=/` });
    res.end(req.url === '/my' ? '{}' : 'ok');
  });
  await new Promise((r) => cil.listen(0, '127.0.0.1', r));
  const portCile = cil.address().port;
  // Místo improvedinitiative.app falešný server na tomto počítači.
  const request = (volby, cb) => http.request({ ...volby, host: '127.0.0.1', port: portCile }, cb);
  const pruchod = new PruchodIniciativy({ port: 0, relace: () => relace, request });
  await pruchod.spustit();
  pruchod.port = pruchod.server.address().port;
  const nove = [];
  pruchod.on('relace', (x) => nove.push(x));

  const odpoved = await fetch(`http://127.0.0.1:${pruchod.port}/e/`);
  assert.equal(odpoved.status, 200);
  assert.equal(await odpoved.text(), 'ok');
  assert.equal(odpoved.headers.get('set-cookie'), null, 'prohlížeč relaci nedostane');
  assert.equal(prijate[0].cookie, `connect.sid=${relace}`);
  assert.equal(prijate[0].host, CIL);
  assert.deepEqual(nove, [obnovena]);

  const smazat = await fetch(`http://127.0.0.1:${pruchod.port}/my`, { method: 'DELETE' });
  assert.equal(smazat.status, 403);
  assert.equal(prijate.length, 1, 'smazání účtu na server vůbec nedojde');

  assert.equal(await pruchod.overit(), true);
  await pruchod.zastavit();
  await new Promise((r) => cil.close(r));
});
