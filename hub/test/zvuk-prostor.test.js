// Zvuk prostoru (bod 85): náhodné zvuky, vzdálenost a dozvuk místa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Hub } from '../server/app.js';
import { slozitZvuk, normalizujZvukMista, normalizujNahodne, platnaVzdalenost } from '../server/zvuk.js';
import { sestavitKnihovnu, najitSkupinu } from '../server/zvuky-knihovna.js';
import { docasneRepo, dokud, FalesnyObs } from './pomoc.js';

const bezVerze = (u) => String(u).replace(/\?v=[^&]*$/, '');

const sc = (z = {}) => ({ varianta: 'den', pocasi: [], intenzita: 0, rezim: 'pruzkum', ...z });

test('náhodné zvuky: výchozí hodnoty, meze, duplicity a nejvýš 8', () => {
  const n = normalizujNahodne([
    { zvuk: 'tabor/hlasy' },
    { zvuk: 'tabor/kun', kazdych_s: 1, nahodilost: 2, hlasitost: -1, vzdalenost: 0.456 },
    { zvuk: 'tabor/hlasy', kazdych_s: 10 },
    { zvuk: '../ven' },
    'tabor/krkavec',
    { zvuk: 'x', kazdych_s: 9999 },
  ]);
  assert.deepEqual(n, [
    { zvuk: 'tabor/hlasy', kazdych_s: 30, nahodilost: 0.5, hlasitost: 0.8, vzdalenost: 0 },
    { zvuk: 'tabor/kun', kazdych_s: 3, nahodilost: 1, hlasitost: 0, vzdalenost: 0.46 },
    { zvuk: 'tabor/krkavec', kazdych_s: 30, nahodilost: 0.5, hlasitost: 0.8, vzdalenost: 0 },
    { zvuk: 'x', kazdych_s: 600, nahodilost: 0.5, hlasitost: 0.8, vzdalenost: 0 },
  ]);
  assert.equal(normalizujNahodne(Array.from({ length: 12 }, (_, i) => `z${i}`)).length, 8);
  assert.equal(normalizujNahodne('tabor/hlasy').length, 0);
  assert.equal(platnaVzdalenost(1.5), null);
  assert.equal(platnaVzdalenost('0.3'), 0.3);
});

test('zvuk místa: vzdálenost ambientu, náhodné zvuky a dozvuk', () => {
  const z = normalizujZvukMista({
    dozvuk: 'jeskyne',
    den: { ambient: 'tabor.mp3', vzdalenost: 0.4, nahodne: [{ zvuk: 'tabor/hlasy', kazdych_s: 20 }] },
    noc: { vzdalenost: 7 },
  });
  assert.equal(z.dozvuk, 'jeskyne');
  assert.equal(z.den.vzdalenost, 0.4);
  assert.equal(z.den.nahodne[0].kazdych_s, 20);
  assert.equal(z.noc, undefined, 'neplatná vzdálenost se zahodí');
  assert.equal(normalizujZvukMista({ dozvuk: 'zadny' }), null);
  assert.equal(normalizujZvukMista({ dozvuk: 'katedrala' }), null);
});

test('skládání: náhodné zvuky místa a počasí, v souboji místo ztichne, dozvuk z místa', () => {
  const misto = {
    zvuk: {
      dozvuk: 'kobka',
      den: { ambient: 'tabor.mp3', vzdalenost: 0.5, nahodne: [{ zvuk: 'tabor/hlasy', hlasitost: 1 }] },
    },
  };
  const vrstvy = {
    pocasi: { dest: { zvuk: { ambient: 'dest.mp3', hlasitost_podle_intenzity: true, nahodne: [{ zvuk: 'pocasi/okap', hlasitost: 1 }, { zvuk: 'tabor/hlasy' }] } } },
    rezim: { souboj: { zvuk: { hudba: 'souboj.mp3' } } },
  };
  const v = slozitZvuk({ misto, scena: sc({ pocasi: ['dest'], intenzita: 1 }), vrstvy });
  assert.deepEqual(v.ambient[0], { soubor: 'tabor.mp3', hlasitost: 1, zdroj: 'misto', vzdalenost: 0.5 });
  assert.deepEqual(v.nahodne.map((n) => [n.zvuk, n.hlasitost, n.zdroj]), [['tabor/hlasy', 1, 'misto'], ['pocasi/okap', 0.7, 'dest']]);
  assert.equal(v.dozvuk, 'kobka');
  const boj = slozitZvuk({ misto, scena: sc({ rezim: 'souboj' }), vrstvy });
  assert.equal(boj.nahodne[0].hlasitost, 0.35);
  assert.equal(slozitZvuk({ misto: null, scena: sc(), vrstvy }).dozvuk, 'zadny');
});

test('souboj místa: vlastní hudba, ambient a náhodné zvuky nahradí zvuk místa; co chybí, platí jako dřív', () => {
  const vrstvy = { pocasi: {}, rezim: { souboj: { zvuk: { hudba: 'souboj.mp3' } } } };
  const misto = {
    zvuk: normalizujZvukMista({
      den: { hudba: 'tabor.mp3', ambient: 'tabor-ohen.mp3', nahodne: [{ zvuk: 'tabor/kun' }] },
      souboj: { ambient: 'tabor-boj.mp3', nahodne: [{ zvuk: 'boj/rinceni', hlasitost: 0.9 }] },
    }),
  };
  const boj = slozitZvuk({ misto, scena: sc({ rezim: 'souboj' }), vrstvy });
  assert.equal(boj.hudba, 'souboj.mp3', 'bez vlastní hudby hraje hudba souboje');
  assert.deepEqual(boj.ambient.map((a) => [a.soubor, a.hlasitost]), [['tabor-boj.mp3', 1]]);
  assert.deepEqual(boj.nahodne.map((n) => [n.zvuk, n.hlasitost]), [['boj/rinceni', 0.9]]);
  const vlastniHudba = slozitZvuk({ misto: { zvuk: { ...misto.zvuk, souboj: { hudba: 'tabor-bitva.mp3' } } }, scena: sc({ rezim: 'souboj' }), vrstvy });
  assert.equal(vlastniHudba.hudba, 'tabor-bitva.mp3');
  assert.deepEqual(vlastniHudba.ambient.map((a) => [a.soubor, a.hlasitost]), [['tabor-ohen.mp3', 0.35]], 'bez vlastního ambientu ztlumený ambient místa');
  assert.equal(vlastniHudba.nahodne[0].hlasitost, 0.28);
  const mimoBoj = slozitZvuk({ misto, scena: sc(), vrstvy });
  assert.equal(mimoBoj.ambient[0].soubor, 'tabor-ohen.mp3', 'mimo souboj se zvuk souboje nepoužije');
});

test('knihovna: složka nahodne/ je vlastní druh a krátké ID ji najde', () => {
  const k = sestavitKnihovnu(['nahodne/tabor/hlasy-1.mp3', 'nahodne/tabor/hlasy-2.mp3', 'jednorazove/boj/mec.mp3']);
  assert.deepEqual(k.nahodne.map((s) => [s.id, s.kategorie, s.soubory.length]), [['nahodne/tabor/hlasy', 'tabor', 2]]);
  assert.equal(najitSkupinu(k, 'tabor/hlasy').druh, 'nahodne');
  assert.equal(k.jednorazove.length, 1);
});

const MISTO = `---
typ: misto
nazev: Tábor
verejne: true
ilustrace: []
zvuk:
  den: { ambient: tabor.mp3 } # komentář, který musí přežít
---
Tělo.
`;

async function spustitHub() {
  const repo = await docasneRepo();
  const audio = await fs.mkdtemp(path.join(os.tmpdir(), 'dmhub-prostor-'));
  const slozka = path.join(repo.c.kampan, 'mista', 'tabor');
  await fs.mkdir(slozka, { recursive: true });
  await fs.writeFile(path.join(slozka, 'tabor.md'), MISTO);
  for (const f of ['tabor.mp3', 'nahodne/tabor/hlasy-1.mp3', 'nahodne/tabor/hlasy-2.mp3', 'jednorazove/zvirata/kun.mp3']) {
    await fs.mkdir(path.dirname(path.join(audio, ...f.split('/'))), { recursive: true });
    await fs.writeFile(path.join(audio, ...f.split('/')), Buffer.from(`zvuk ${f} `.repeat(50)));
  }
  await fs.writeFile(repo.c.env, `OBS_URL="ws://127.0.0.1:4455"\nOBS_HESLO="spravne"\nZVUK_SLOZKA=${JSON.stringify(audio)}\n`);
  const hub = new Hub({ cesty: repo.c, obsKlient: new FalesnyObs({ heslo: 'spravne' }), gitSit: false, port: 0 });
  await hub.spustit();
  const efekty = [];
  hub.zvuk.on('efekt', (e) => efekty.push(e));
  const volat = async (cesta, { metoda = 'GET', telo } = {}) => {
    const r = await fetch(hub.adresa + cesta, { method: metoda, headers: telo ? { 'Content-Type': 'application/json' } : {}, body: telo ? JSON.stringify(telo) : undefined });
    return { status: r.status, data: await r.json() };
  };
  return {
    hub, repo, volat, efekty,
    soubor: path.join(slozka, 'tabor.md'),
    zastavit: async () => {
      await hub.zastavit();
      await repo.smazat();
      await fs.rm(audio, { recursive: true, force: true });
    },
  };
}

test('Místa → Zvuk: náhodné zvuky, vzdálenost a dozvuk se uloží do hlavičky a stránka dostane soubory', async () => {
  const t = await spustitHub();
  try {
    let r = await t.volat('/api/mista/tabor/zvuk/den', {
      metoda: 'PUT',
      telo: { vzdalenost: 0.3, nahodne: [{ zvuk: 'nahodne/tabor/hlasy', kazdych_s: 25, nahodilost: 0.7, hlasitost: 0.8, vzdalenost: 0.6 }, { zvuk: 'zvirata/kun', kazdych_s: 60 }] },
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    r = await t.volat('/api/mista/tabor/zvuk-dozvuk', { metoda: 'PUT', telo: { dozvuk: 'jeskyne' } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    let text = await fs.readFile(t.soubor, 'utf8');
    assert.match(text, /# komentář, který musí přežít/);
    assert.match(text, /\n {6}- \{ zvuk: nahodne\/tabor\/hlasy, kazdych_s: 25, nahodilost: 0\.7, hlasitost: 0\.8, vzdalenost: 0\.6 \}/);
    assert.match(text, /dozvuk: jeskyne/);
    assert.match(text, /Tělo\./);

    await t.volat('/api/scena/zobrazit', { metoda: 'POST', telo: { misto: 'tabor' } });
    await dokud(async () => (await t.volat('/api/zvuk?pro=stranka')).data.nahodne?.length === 2);
    const s = (await t.volat('/api/zvuk?pro=stranka')).data;
    assert.equal(s.dozvuk, 'jeskyne');
    assert.equal(s.ambient[0].vzdalenost, 0.3);
    assert.deepEqual(s.nahodne[0].soubory.map((f) => bezVerze(f.url)), ['/audio/nahodne/tabor/hlasy-1.mp3', '/audio/nahodne/tabor/hlasy-2.mp3']);
    assert.deepEqual(s.nahodne[1].soubory.map((f) => f.soubor), ['jednorazove/zvirata/kun.mp3']);

    // Chybějící náhodný zvuk: stránka ho vynechá, panel a Kontrola dat ho ukážou.
    await t.volat('/api/mista/tabor/zvuk/den', { metoda: 'PUT', telo: { nahodne: [{ zvuk: 'tabor/krkavec' }] } });
    await dokud(async () => (await t.volat('/api/zvuk')).data.chybiTed.includes('tabor/krkavec'));
    assert.deepEqual((await t.volat('/api/zvuk?pro=stranka')).data.nahodne, []);
    await dokud(async () => (await t.hub.data.zkontrolovat()).problemy.some((p) => p.zprava === 'Náhodný zvuk „tabor/krkavec“ není ve složce zvuku'));

    // Soundboard zní v prostoru místa, zvuk na tah ne.
    await t.volat('/api/zvuk/efekt', { metoda: 'POST', telo: { zvuk: 'zvirata/kun' } });
    assert.equal(t.efekty.at(-1).prostor, true);

    // Zvuk místa v souboji se ukládá stejně jako den a noc.
    r = await t.volat('/api/mista/tabor/zvuk/souboj', { metoda: 'PUT', telo: { ambient: 'tabor.mp3', nahodne: [{ zvuk: 'zvirata/kun' }] } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(t.hub.mista.get('tabor').zvuk.souboj.ambient, 'tabor.mp3');
    await t.volat('/api/mista/tabor/zvuk/souboj', { metoda: 'PUT', telo: { ambient: null, nahodne: [] } });
    assert.equal(t.hub.mista.get('tabor').zvuk.souboj, undefined);

    // Smazání: prázdný seznam, vzdálenost 0, bez dozvuku; jednořádkový zápis se vrátí.
    await t.volat('/api/mista/tabor/zvuk/den', { metoda: 'PUT', telo: { nahodne: [], vzdalenost: 0 } });
    await t.volat('/api/mista/tabor/zvuk-dozvuk', { metoda: 'PUT', telo: { dozvuk: 'zadny' } });
    text = await fs.readFile(t.soubor, 'utf8');
    assert.match(text, /den: \{ ambient: tabor\.mp3 \}/);
    assert.doesNotMatch(text, /nahodne|dozvuk|vzdalenost/);

    assert.equal((await t.volat('/api/mista/tabor/zvuk-dozvuk', { metoda: 'PUT', telo: { dozvuk: 'katedrala' } })).status, 400);
    assert.equal((await t.volat('/api/mista/tabor/zvuk/den', { metoda: 'PUT', telo: { vzdalenost: 2 } })).status, 400);
    assert.equal((await t.volat('/api/mista/tabor/zvuk/den', { metoda: 'PUT', telo: { nahodne: [{ zvuk: '../ven' }] } })).status, 400);
  } finally {
    await t.zastavit();
  }
});

test('vyměněný soubor má novou adresu, stránka ho načte bez F5', async () => {
  const t = await spustitHub();
  try {
    await t.volat('/api/scena/zobrazit', { metoda: 'POST', telo: { misto: 'tabor' } });
    const pred = (await t.volat('/api/zvuk?pro=stranka')).data.ambient[0].url;
    assert.match(pred, /^\/audio\/tabor\.mp3\?v=/);
    await new Promise((r) => setTimeout(r, 20));
    const soubor = path.join(t.hub.zvuk.slozka, 'tabor.mp3');
    await fs.writeFile(soubor, Buffer.from('jiny ohen '.repeat(80)));
    await t.volat('/api/zvuk/prohledat', { metoda: 'POST', telo: {} });
    const po = (await t.volat('/api/zvuk?pro=stranka')).data.ambient[0].url;
    assert.notEqual(po, pred);
    assert.equal((await fetch(t.hub.adresa + po)).status, 200, 'adresa s ?v= funguje');
  } finally {
    await t.zastavit();
  }
});
