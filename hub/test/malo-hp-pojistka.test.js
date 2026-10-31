// Málo HP po konci souboje a obnova živého spojení (oprava po sezení 24. 10. 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Hub } from '../server/app.js';
import { ZivyPlayerView } from '../server/iniciativa-zive.js';
import { SledovaniHp } from '../server/iniciativa-hp.js';
import { Svetla } from '../server/svetla.js';
import { docasneRepo, FalesnyObs, dokud, cekej } from './pomoc.js';

const setkani = (hp) => ({
  encounterState: {
    ActiveCombatantId: 'tusker',
    Combatants: [{ Id: 'tusker', Name: 'Tusker', HPDisplay: `${hp}/34`, IsPlayerCharacter: true }],
  },
});

/** WebSocket, který se nikdy nepřipojí ani neselže (visící pokus). */
class VisiciWs {
  static instance = [];
  constructor(adresa) {
    this.adresa = adresa;
    this.zavreno = false;
    this.posluchaci = {};
    VisiciWs.instance.push(this);
  }
  addEventListener(nazev, fn) {
    (this.posluchaci[nazev] ??= []).push(fn);
  }
  send() {}
  close() {
    this.zavreno = true;
  }
}

test('živé spojení: visící pokus o připojení se po limitu zahodí a zkusí znovu', async () => {
  VisiciWs.instance = [];
  const z = new ZivyPlayerView({ WebSocketTrida: VisiciWs, obnovaMs: { prvni: 10, max: 20 }, limitPripojeniMs: 30 });
  z.sledovat('enc1');
  await dokud(() => VisiciWs.instance.length >= 2, 1000);
  assert.equal(VisiciWs.instance[0].zavreno, true, 'visící pokus se zavřel');
  z.sledovat(null);
  const pocet = VisiciWs.instance.length;
  await cekej(100);
  assert.equal(VisiciWs.instance.length, pocet, 'bez setkání se už nepřipojuje');
});

test('sledování tahu: chyba u posluchače se ohlásí, vynulovat ohlásí konec málo HP', async () => {
  let stav = setkani(7);
  const s = new SledovaniHp({ odkaz: () => 'https://improvedinitiative.app/p/x1', aktivni: () => true, nacist: async () => stav });
  const chyby = [];
  const zmeny = [];
  s.on('chyba', (t) => chyby.push(t));
  s.on('tah', () => {
    throw new Error('rozbitý posluchač');
  });
  await s.krok();
  assert.match(chyby[0], /Sledování tahu: rozbitý posluchač/);
  s.removeAllListeners('tah');
  s.on('zmena', (k) => zmeny.push(k));
  await s.krok();
  assert.equal(chyby.at(-1), null, 'další krok bez chyby');
  assert.deepEqual(zmeny, [{ jmeno: 'Tusker', hp: 7, max: 34 }]);
  s.vynulovat();
  s.vynulovat();
  assert.deepEqual(zmeny, [{ jmeno: 'Tusker', hp: 7, max: 34 }, null], 'konec jen jednou');
  stav = setkani(7);
  await s.krok();
  assert.equal(zmeny.length, 3, 'po vynulování další souboj ohlásí znovu');
});

test('světla: chyba u posluchače málo HP nenechá lampu pulzovat', async () => {
  const prikazy = [];
  const wiz = () => ({ nastavit: async (cil) => prikazy.push(cil), stav: async () => ({}) });
  const svetla = new Svetla({
    cesty: { lokalniStav: path.join(os.tmpdir(), 'hub-hp-pojistka'), kampan: path.join(os.tmpdir(), 'hub-hp-neni') },
    nastaveni: () => ({ SVETLA_LAMPA: 'wiz:10.0.0.9' }),
    misto: () => null,
    scena: () => ({ varianta: 'den', pocasi: [], intenzita: 0, rezim: 'souboj' }),
    ovladace: { wiz },
  });
  svetla.sestavitZarizeni();
  svetla.mistni.ridit = true;
  svetla.nastavitKritickeHp({ jmeno: 'Tusker', hp: 7, max: 34 });
  assert.equal(svetla.pulzBezi, true);
  svetla.on('kriticke-hp', (k) => {
    if (!k) throw new Error('rozbitý posluchač');
  });
  assert.throws(() => svetla.nastavitKritickeHp(null), /rozbitý posluchač/);
  assert.equal(svetla.pulzBezi, false, 'pulz skončil i tak');
  assert.equal(svetla.verejny().kritickeHp, null);
  svetla.zastavit();
});

test('Hub: konec souboje ukončí málo HP i bez zprávy ze sledování tahu', async () => {
  const repo = await docasneRepo();
  const audio = await fs.mkdtemp(path.join(os.tmpdir(), 'dmhub-hp-'));
  await fs.writeFile(repo.c.env, `OBS_URL="ws://127.0.0.1:4455"\nOBS_HESLO="spravne"\nOBS_SCENA_SOUBOJ="Souboj"\nZVUK_SLOZKA=${JSON.stringify(audio)}\n`);
  const zive = new EventEmitter();
  zive.sledovat = () => {};
  zive.zastavit = () => {};
  const hub = new Hub({ cesty: repo.c, obsKlient: new FalesnyObs({ heslo: 'spravne' }), gitSit: false, port: 0, ziveIniciativa: zive });
  hub.cteniPlayerView.nacist = async () => {
    throw new Error('bez sítě');
  };
  await hub.spustit();
  const volat = async (cesta, telo) => {
    const r = await fetch(hub.adresa + cesta, { method: telo ? (cesta === '/api/iniciativa' ? 'PUT' : 'POST') : 'GET', headers: telo ? { 'Content-Type': 'application/json' } : {}, body: telo ? JSON.stringify(telo) : undefined });
    return r.json();
  };
  try {
    await volat('/api/iniciativa', { odkaz: 'https://improvedinitiative.app/p/abc12345' });
    await volat('/api/souboj', { zapnout: true });
    await dokud(() => hub.cteniPlayerView.idAktivni === 'abc12345');
    zive.emit('stav', 'abc12345', setkani(7));
    await dokud(() => hub.zvuk.kritickeHp === true);
    assert.equal(hub.svetla.kritickeHp?.jmeno, 'Tusker');
    // Sledování tahu „zamrzne“ (jako 24. 10. ve 14:18): samo konec neohlásí.
    hub.sledovaniHp.zastavit();
    hub.sledovaniHp.krok = async () => {};
    await volat('/api/souboj', { zapnout: false });
    assert.equal(hub.zvuk.kritickeHp, false, 'bez ucpaných uší');
    assert.equal(hub.svetla.kritickeHp, null, 'lampa zpět ke scéně');
    assert.equal(hub.sledovaniHp.stav, null);
  } finally {
    await hub.zastavit();
    await repo.smazat();
    await fs.rm(audio, { recursive: true, force: true });
  }
});

test('Hub: zkouška málo HP z Nastavení mimo souboj doběhne', async () => {
  const repo = await docasneRepo();
  const hub = new Hub({ cesty: repo.c, obsKlient: new FalesnyObs({ heslo: 'spravne' }), gitSit: false, port: 0, ziveIniciativa: null });
  await hub.spustit();
  try {
    hub.svetla.zkusitHp();
    assert.equal(hub.zvuk.kritickeHp, true);
    hub.scena.emit('stav', hub.scena.stav); // jakákoli změna scény mimo souboj
    assert.equal(hub.zvuk.kritickeHp, true, 'zkouška běží dál');
    assert.equal(hub.svetla.kritickeHp?.jmeno, 'Zkouška');
  } finally {
    await hub.zastavit();
    await repo.smazat();
  }
});
