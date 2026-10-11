// Player View z Improved Initiative: kontrola odkazu a dosazení do zdrojů Browser v OBS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Iniciativa, platnyOdkaz, jeZdrojIniciativy } from '../server/iniciativa.js';

test('platný odkaz na Player View', () => {
  assert.equal(platnyOdkaz(' https://improvedinitiative.app/p/abc123 '), 'https://improvedinitiative.app/p/abc123');
  assert.equal(platnyOdkaz('https://improvedinitiative.app/e/'), null, 'pohled DM není Player View');
  assert.equal(platnyOdkaz('http://improvedinitiative.app/p/abc'), null, 'jen https');
  assert.equal(platnyOdkaz('https://improvedinitiative.app.zly.cz/p/abc'), null, 'cizí doména');
  assert.equal(platnyOdkaz('nesmysl'), null);
  assert.equal(jeZdrojIniciativy('https://improvedinitiative.app/p/staré'), true);
  assert.equal(jeZdrojIniciativy('http://127.0.0.1:7420/vystupy/misto.html'), false);
});

test('nový odkaz se uloží a dosadí jen do zdrojů Improved Initiative', async () => {
  const slozka = await fs.mkdtemp(path.join(os.tmpdir(), 'hub-iniciativa-'));
  const zdroje = {
    'Hub – místo': { url: 'http://127.0.0.1:7420/vystupy/misto.html' },
    Iniciativa: { url: 'https://improvedinitiative.app/p/stare', css: '.carousel {}' },
  };
  const volani = [];
  const obs = {
    pripojeno: true,
    async nastavitUrlZdroju(vybrat, url) {
      const zmenene = [];
      for (const [jmeno, s] of Object.entries(zdroje)) {
        if (!vybrat(s.url)) continue;
        volani.push([jmeno, url]);
        s.url = url;
        zmenene.push(jmeno);
      }
      return zmenene;
    },
  };
  const i = new Iniciativa({ cesty: { lokalniStav: slozka }, obs });
  const r = await i.nastavit('https://improvedinitiative.app/p/nove');
  assert.deepEqual(r.zdroje, ['Iniciativa']);
  assert.equal(r.chyba, null);
  assert.equal(zdroje.Iniciativa.url, 'https://improvedinitiative.app/p/nove');
  assert.equal(zdroje.Iniciativa.css, '.carousel {}', 'CSS carouselu zůstává');
  assert.equal(zdroje['Hub – místo'].url, 'http://127.0.0.1:7420/vystupy/misto.html');

  const znovu = new Iniciativa({ cesty: { lokalniStav: slozka }, obs });
  await znovu.nacist();
  assert.equal(znovu.odkaz, 'https://improvedinitiative.app/p/nove', 'odkaz přežije restart');

  await assert.rejects(i.nastavit('https://improvedinitiative.app/e/'), /Player View/);
  await fs.rm(slozka, { recursive: true, force: true });
});

test('bez OBS se odkaz uloží a ohlásí, že se dosadí později', async () => {
  const slozka = await fs.mkdtemp(path.join(os.tmpdir(), 'hub-iniciativa-'));
  const i = new Iniciativa({ cesty: { lokalniStav: slozka }, obs: { pripojeno: false } });
  const r = await i.nastavit('https://improvedinitiative.app/p/x1');
  assert.equal(r.odkaz, 'https://improvedinitiative.app/p/x1');
  assert.match(r.chyba, /až se připojí/);
  await fs.rm(slozka, { recursive: true, force: true });
});
