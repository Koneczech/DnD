// Playlisty hudby, hudba scény Start, konec souboje s bubnem a živé zvuky tahů (DM 19. 10. 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Hub } from '../server/app.js';
import { platnaHudba, jePlaylist, normalizujKonec, slozitZvuk, KONEC_PROLNUTI_MS, PROLNUTI_MS } from '../server/zvuk.js';
import { rozebratZpravu, ZivyPlayerView } from '../server/iniciativa-zive.js';
import { CteniPlayerView } from '../server/iniciativa-cteni.js';
import { SledovaniHp } from '../server/iniciativa-hp.js';
import { Openverse, normalizujSadu } from '../server/zvuky-sada.js';
import { docasneRepo, FalesnyObs, dokud } from './pomoc.js';

test('hudba z dat: soubor, složka jako playlist, seznam; nic mimo složku zvuku', () => {
  assert.equal(platnaHudba('souboj.mp3'), 'souboj.mp3');
  assert.equal(platnaHudba('hudba/souboj/'), 'hudba/souboj/');
  assert.equal(platnaHudba('hudba\\souboj\\'), 'hudba/souboj/', 'zpětná lomítka z Windows');
  assert.deepEqual(platnaHudba(['souboj.mp3', 'hudba/souboj/', 'souboj.mp3']), ['souboj.mp3', 'hudba/souboj/']);
  assert.equal(platnaHudba(['hudba/souboj/']), 'hudba/souboj/', 'seznam s jednou položkou = ta položka');
  assert.equal(platnaHudba('../hub/'), null);
  assert.equal(platnaHudba('hudba/souboj'), null, 'složka bez lomítka ani soubor bez přípony neplatí');
  assert.equal(platnaHudba([]), null);
  assert.ok(jePlaylist('hudba/souboj/') && jePlaylist(['a.mp3', 'b.mp3']) && !jePlaylist('a.mp3'));
});

test('konec souboje z dat: skupina variant, dozvuk a doznění; starý zápis souborem platí', () => {
  assert.deepEqual(normalizujKonec({ zvuk: 'konec/buben', dozvuk: 'jeskyne', prolnuti_s: 6 }), { zvuk: 'konec/buben', dozvuk: 'jeskyne', prolnutiMs: 6000 });
  assert.deepEqual(normalizujKonec('vitezstvi.mp3'), { zvuk: 'vitezstvi.mp3', dozvuk: 'zadny', prolnutiMs: KONEC_PROLNUTI_MS });
  assert.equal(normalizujKonec({ zvuk: 'konec/buben', dozvuk: 'kosmos', prolnuti_s: 99 }).dozvuk, 'zadny');
  assert.equal(normalizujKonec({ zvuk: 'konec/buben', prolnuti_s: 99 }).prolnutiMs, KONEC_PROLNUTI_MS);
  assert.equal(normalizujKonec({ zvuk: '../x' }), null);
});

test('scéna Start: hraje jen hudba vrstvy start, místo a počasí mlčí; souboj má přednost', () => {
  const vrstvy = {
    pocasi: { dest: { zvuk: { ambient: 'dest.mp3' } } },
    rezim: { start: { zvuk: { hudba: 'hudba/start/' } }, souboj: { zvuk: { hudba: ['souboj.mp3', 'hudba/souboj/'] } } },
  };
  const misto = { zvuk: { den: { hudba: 'les.mp3', ambient: 'les-amb.mp3', nahodne: [{ zvuk: 'nahodne/les/ptak' }] } } };
  const scena = { varianta: 'den', pocasi: ['dest'], intenzita: 1, rezim: 'pruzkum' };
  const start = slozitZvuk({ misto, scena, vrstvy, start: true });
  assert.deepEqual([start.hudba, start.ambient, start.nahodne, start.hrom], ['hudba/start/', [], [], []]);
  const bezStartu = slozitZvuk({ misto, scena, vrstvy, start: false });
  assert.equal(bezStartu.hudba, 'les.mp3');
  assert.equal(bezStartu.ambient.length, 2);
  // Bez vrstvy start hraje i na scéně Start zvuk místa jako dřív.
  assert.equal(slozitZvuk({ misto, scena, vrstvy: { ...vrstvy, rezim: { souboj: vrstvy.rezim.souboj } }, start: true }).hudba, 'les.mp3');
  assert.deepEqual(slozitZvuk({ misto, scena: { ...scena, rezim: 'souboj' }, vrstvy, start: true }).hudba, ['souboj.mp3', 'hudba/souboj/']);
});

const MISTO = `---
schema: 1
id: tabor
typ: misto
nazev: Tábor
verejne: true
ilustrace: []
zvuk:
  den: { hudba: hudba/tabor/, ambient: les.mp3 }
  noc: { hudba: hudba/prazdny/ }
---
Tělo.
`;

const SOUBORY = [
  'les.mp3', 'souboj.mp3', 'hudba/souboj/boj-1.mp3', 'hudba/souboj/boj-2.ogg', 'hudba/tabor/jedina.mp3', 'hudba/start/a.mp3', 'hudba/start/b.mp3',
  'konec/buben-1.mp3', 'konec/buben-2.mp3', 'tahy/tusker.mp3', 'tahy/nepritel.mp3',
];

async function spustitHub() {
  const repo = await docasneRepo();
  const audio = await fs.mkdtemp(path.join(os.tmpdir(), 'dmhub-pl-'));
  await fs.mkdir(path.join(repo.c.kampan, 'mista', 'tabor'), { recursive: true });
  await fs.writeFile(path.join(repo.c.kampan, 'mista', 'tabor', 'tabor.md'), MISTO);
  await fs.mkdir(path.join(repo.c.kampan, 'sceny', 'rezim'), { recursive: true });
  await fs.writeFile(path.join(repo.c.kampan, 'sceny', 'rezim', 'souboj.yaml'), 'zvuk:\n  hudba: [souboj.mp3, hudba/souboj/]\n  konec: { zvuk: konec/buben, dozvuk: jeskyne, prolnuti_s: 5 }\n');
  await fs.writeFile(path.join(repo.c.kampan, 'sceny', 'rezim', 'start.yaml'), 'zvuk: { hudba: hudba/start/ }\n');
  await fs.writeFile(path.join(repo.c.kampan, 'zvuky.yaml'), 'tahy:\n  postavy: { Tusker: tahy/tusker }\n  nepratele: tahy/nepritel\n');
  for (const f of SOUBORY) {
    await fs.mkdir(path.dirname(path.join(audio, ...f.split('/'))), { recursive: true });
    await fs.writeFile(path.join(audio, ...f.split('/')), Buffer.from(`zvuk ${f}`));
  }
  await fs.writeFile(repo.c.env, `OBS_URL="ws://127.0.0.1:4455"\nOBS_HESLO="spravne"\nOBS_SCENA_SOUBOJ="Souboj"\nOBS_SCENA_START="Start"\nZVUK_SLOZKA=${JSON.stringify(audio)}\n`);
  const obs = new FalesnyObs({ heslo: 'spravne' });
  const hub = new Hub({ cesty: repo.c, obsKlient: obs, gitSit: false, port: 0, ziveIniciativa: null });
  await hub.spustit();
  const volat = async (cesta, { metoda = 'GET', telo } = {}) => {
    const r = await fetch(hub.adresa + cesta, { method: metoda, headers: telo ? { 'Content-Type': 'application/json' } : {}, body: telo ? JSON.stringify(telo) : undefined });
    return { status: r.status, data: await r.json() };
  };
  const efekty = [];
  hub.zvuk.on('efekt', (e) => efekty.push(e));
  return {
    hub, repo, obs, audio, volat, efekty,
    zastavit: async () => {
      await hub.zastavit();
      await repo.smazat();
      await fs.rm(audio, { recursive: true, force: true });
    },
  };
}

test('Hub: playlist místa i souboje, Start podle scény v OBS, buben na konci souboje s delším prolnutím', async () => {
  const t = await spustitHub();
  try {
    await t.volat('/api/scena/zobrazit', { metoda: 'POST', telo: { misto: 'tabor' } });
    let z = (await t.volat('/api/zvuk?pro=stranka')).data;
    // Playlist s jedinou skladbou hraje jako obyčejná smyčka.
    assert.equal(z.hudba.soubor, 'hudba/tabor/jedina.mp3');
    assert.ok(!z.hudba.playlist);
    assert.deepEqual(z.predem, [], 'mimo souboj nic předem');

    // Souboj: soubor + složka = playlist tří skladeb; zvuky tahů a buben předem.
    await t.volat('/api/souboj', { metoda: 'POST', telo: { zapnout: true } });
    z = (await t.volat('/api/zvuk?pro=stranka')).data;
    assert.equal(z.hudba.playlist, true);
    assert.equal(z.hudba.soubor, 'souboj.mp3 + hudba/souboj/');
    assert.deepEqual(z.hudba.skladby.map((x) => x.soubor), ['souboj.mp3', 'hudba/souboj/boj-1.mp3', 'hudba/souboj/boj-2.ogg']);
    assert.ok(z.hudba.skladby.every((x) => x.url.startsWith('/audio/')));
    for (const f of ['tahy/tusker.mp3', 'tahy/nepritel.mp3', 'konec/buben-1.mp3', 'konec/buben-2.mp3']) {
      assert.ok(z.predem.some((u) => u.startsWith(`/audio/${f}`)), `předem ${f}`);
    }

    // Konec souboje: buben s dozvukem jeskyně, bez uhnutí hudby; přepnutí s prolnutím 5 s.
    await t.volat('/api/souboj', { metoda: 'POST', telo: { zapnout: false } });
    const buben = t.efekty.at(-1);
    assert.match(buben.soubor, /^konec\/buben-[12]\.mp3$/);
    assert.equal(buben.dozvuk, 'jeskyne');
    assert.ok(!buben.uhnout);
    z = (await t.volat('/api/zvuk?pro=stranka')).data;
    assert.equal(z.prolnutiMs, 5000);
    assert.equal(z.hudba.soubor, 'hudba/tabor/jedina.mp3', 'po souboji zpět hudba místa');

    // Konec potichu: bez bubnu, ale bojová hudba dozní stejně pomalu.
    await t.volat('/api/souboj', { metoda: 'POST', telo: { zapnout: true } });
    const pocet = t.efekty.length;
    await t.volat('/api/souboj', { metoda: 'POST', telo: { zapnout: false, fanfara: false } });
    assert.equal(t.efekty.length, pocet, 'Konec potichu nemá buben');
    assert.equal((await t.volat('/api/zvuk?pro=stranka')).data.prolnutiMs, 5000);

    // Scéna Start v OBS: hraje playlist startu, ambient místa mlčí.
    t.obs.emit('CurrentProgramSceneChanged', { sceneName: 'Start' });
    await dokud(async () => (await t.volat('/api/zvuk?pro=stranka')).data.hudba?.soubor === 'hudba/start/');
    z = (await t.volat('/api/zvuk?pro=stranka')).data;
    assert.equal(z.hudba.skladby.length, 2);
    assert.deepEqual(z.ambient, []);
    t.obs.emit('CurrentProgramSceneChanged', { sceneName: 'Tábor' });
    await dokud(async () => (await t.volat('/api/zvuk?pro=stranka')).data.hudba?.soubor === 'hudba/tabor/jedina.mp3');

    // Kontrola dat: prázdný playlist místa (noc) ohlásí jednou.
    const kontrola = t.hub.zvuk.kontrola();
    assert.deepEqual(kontrola.filter((x) => /Playlist/.test(x.zprava)).map((x) => x.zprava), ['Playlist „hudba/prazdny/“ je prázdný: ve složce zvuku v něm nejsou žádné skladby']);

    // Místa → Zvuk: hudba jde nastavit i jako playlist (složka).
    const r = await t.volat('/api/mista/tabor/zvuk/noc', { metoda: 'PUT', telo: { hudba: 'hudba/souboj/' } });
    assert.equal(r.status, 200);
    assert.match(await fs.readFile(path.join(t.repo.c.kampan, 'mista', 'tabor', 'tabor.md'), 'utf8'), /noc: \{ hudba: hudba\/souboj\/ \}/);
    assert.equal((await t.volat('/api/mista/tabor/zvuk/noc', { metoda: 'PUT', telo: { hudba: '../x/' } })).status, 400);
  } finally {
    await t.zastavit();
  }
});

test('prolnutí po konci souboje platí jen chvíli, pak zase výchozí', async () => {
  const t = await spustitHub();
  try {
    let ted = 1000;
    t.hub.zvuk.hodiny = () => ted;
    t.hub.zvuk.konecSouboje({ zvuk: false });
    assert.equal(t.hub.zvuk.prolnutiMs, 5000);
    ted += 7100;
    assert.equal(t.hub.zvuk.prolnutiMs, PROLNUTI_MS);
  } finally {
    await t.zastavit();
  }
});

/** Falešný WebSocket: zaznamená odeslané zprávy, zprávy serveru posílá test. */
class FalesnyWs extends EventEmitter {
  static instance = [];
  constructor(adresa) {
    super();
    this.adresa = adresa;
    this.odeslano = [];
    FalesnyWs.instance.push(this);
  }
  addEventListener(udalost, fn) {
    this.on(udalost, fn);
  }
  send(x) {
    this.odeslano.push(x);
  }
  close() {
    this.emit('close', {});
  }
  prijmout(text) {
    this.emit('message', { data: text });
  }
}

test('zprávy socket.io: ping, připojení, událost s daty i s číslem potvrzení', () => {
  assert.deepEqual(rozebratZpravu('2'), { typ: 'ping' });
  assert.deepEqual(rozebratZpravu('0{"sid":"x","pingInterval":25000}'), { typ: 'otevreno' });
  assert.deepEqual(rozebratZpravu('40{"sid":"y"}'), { typ: 'pripojeno' });
  assert.deepEqual(rozebratZpravu('42["encounter updated",{"ActiveCombatantId":"a"}]'), { typ: 'udalost', nazev: 'encounter updated', data: { ActiveCombatantId: 'a' } });
  assert.deepEqual(rozebratZpravu('4212["x",1]'), { typ: 'udalost', nazev: 'x', data: 1 });
  assert.equal(rozebratZpravu('42{rozbite'), null);
  assert.equal(rozebratZpravu('6'), null);
});

test('živé spojení: připojí se jako Player View, předá změnu tahu, po výpadku se připojí znovu', async () => {
  FalesnyWs.instance = [];
  const z = new ZivyPlayerView({ WebSocketTrida: FalesnyWs, obnovaMs: { prvni: 10, max: 20 } });
  const stavy = [];
  const spojeni = [];
  z.on('stav', (id, s) => stavy.push([id, s.encounterState.ActiveCombatantId]));
  z.on('spojeni', (x) => spojeni.push(x));
  z.sledovat('enc1');
  const ws = FalesnyWs.instance[0];
  assert.match(ws.adresa, /^wss:\/\/improvedinitiative\.app\/socket\.io\/\?EIO=4&transport=websocket$/);
  ws.prijmout('0{"sid":"a"}');
  assert.deepEqual(ws.odeslano, ['40']);
  ws.prijmout('40{"sid":"b"}');
  assert.deepEqual(ws.odeslano.at(-1), '42["join encounter","enc1"]');
  ws.prijmout('2');
  assert.equal(ws.odeslano.at(-1), '3', 'pong');
  ws.prijmout('42["encounter updated",{"ActiveCombatantId":"tusker","Combatants":[]}]');
  ws.prijmout('42["settings updated",{}]');
  assert.deepEqual(stavy, [['enc1', 'tusker']]);
  // Výpadek: obnova za chvíli novým spojením.
  ws.close();
  await dokud(() => FalesnyWs.instance.length === 2, 1000);
  assert.deepEqual(spojeni, [true, false]);
  z.sledovat('enc1');
  assert.equal(FalesnyWs.instance.length, 2, 'stejné setkání = žádné nové spojení');
  z.sledovat(null);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(FalesnyWs.instance.length, 2, 'bez setkání se už nepřipojuje');
});

test('čtení Player View: živá změna přijde hned, starší výsledek čtení ji nepřepíše', async () => {
  const zive = new EventEmitter();
  zive.sledovat = () => {};
  zive.zastavit = () => {};
  let ted = 0;
  let pustit;
  const c = new CteniPlayerView({
    odkaz: () => 'https://improvedinitiative.app/p/enc1',
    aktivni: () => true,
    zive,
    hodiny: () => ted,
    // Čtení odešlo před změnou tahu a vrátí ještě předchozí tah.
    nacist: () => new Promise((r) => (pustit = () => r({ encounterState: { ActiveCombatantId: 'leta', Combatants: [] }, settings: { a: 1 } }))),
  });
  const stavy = [];
  c.on('stav', (id, s, zdroj) => stavy.push([s.encounterState.ActiveCombatantId, zdroj]));
  ted = 10;
  const krok = c.krok();
  ted = 20;
  zive.emit('stav', 'enc1', { encounterState: { ActiveCombatantId: 'tusker', Combatants: [] } });
  pustit();
  await krok;
  assert.deepEqual(stavy, [['tusker', 'zive']], 'zastaralé čtení se zahodilo');
  zive.emit('stav', 'jine', { encounterState: { ActiveCombatantId: 'x' } });
  assert.equal(stavy.length, 1, 'cizí setkání se nepočítá');
  // Další čtení (po živé změně) už platí a nese i nastavení Player View.
  ted = 30;
  const k2 = c.krok();
  pustit();
  await k2;
  assert.deepEqual(stavy.at(-1), ['leta', 'cteni']);
});

test('sledování tahu: krok během běžícího kroku proběhne hned po něm, změna se neztratí', async () => {
  let stav = { encounterState: { ActiveCombatantId: 'a', Combatants: [{ Id: 'a', Name: 'A' }, { Id: 'b', Name: 'B' }] } };
  let pockat = null;
  const s = new SledovaniHp({
    odkaz: () => 'https://improvedinitiative.app/p/x',
    aktivni: () => true,
    nacist: async () => {
      if (pockat) await pockat;
      return stav;
    },
  });
  const tahy = [];
  s.on('tah', (k) => tahy.push(k.jmeno));
  let pust;
  pockat = new Promise((r) => (pust = r));
  const prvni = s.krok();
  stav = { encounterState: { ...stav.encounterState, ActiveCombatantId: 'b' } };
  const druhy = s.krok(); // běží první: druhý se jen poznamená
  pockat = null;
  pust();
  await Promise.all([prvni, druhy]);
  assert.deepEqual(tahy, ['B']);
});

test('sada: Openverse vynechá výslovnost slov; položka s druhem hudba bere jen hudbu', async () => {
  const vysledky = [
    { id: 'p1', title: 'LL-Q1860 (eng)-Qwertygiy-bagpiper', creator: 'x', duration: 2000, url: 'https://upload.wikimedia.org/a.wav', filetype: 'wav', license: 'cc0', source: 'wikimedia_audio', category: 'pronunciation' },
    { id: 'p2', title: 'Bagpipes tune', creator: 'y', duration: 3000, url: 'https://upload.wikimedia.org/b.ogg', filetype: 'ogg', license: 'cc0', source: 'wikimedia_audio', category: 'music' },
    { id: 'p3', title: 'Battle theme', creator: 'z', duration: 120000, url: 'https://prod-1.storage.jamendo.com/c.mp3', filetype: 'mp3', license: 'by', source: 'jamendo' },
    { id: 'p4', title: 'Sword clash', creator: 'w', duration: 120000, url: 'https://upload.wikimedia.org/d.ogg', filetype: 'ogg', license: 'cc0', source: 'wikimedia_audio', category: 'sound_effect' },
  ];
  const o = new Openverse({ fetch: async () => ({ ok: true, status: 200, json: async () => ({ results: vysledky }) }), odstupMs: 0 });
  const efekt = (await o.hledat({ hledat: 'bagpipe', delka: [0.5, 15], licence: ['cc0'] })).map((k) => k.id);
  assert.deepEqual(efekt, ['ov:p2']);
  const { polozky } = normalizujSadu({ zvuky: { 'hudba/souboj/boj': { druh: 'hudba', hledat: 'battle', delka: [90, 480], variant: 5, licence: ['cc0', 'by'] } } });
  assert.equal(polozky[0].hudba, true);
  const hudba = (await o.hledat(polozky[0])).map((k) => k.id);
  assert.deepEqual(hudba, ['ov:p3'], 'jen hudba (Jamendo), ne zvukový efekt stejné délky');
});
