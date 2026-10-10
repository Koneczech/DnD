// Blok 5: zvuk. Skládání hudby a ambientu, soubory jen přes localhost a s Range, souboj,
// Ticho, hlášení stránek, hrom po blesku, zvuk místa v hlavičce, Kontrola dat a hook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Hub } from '../server/app.js';
import { slozitZvuk, platneJmeno, normalizujZvukMista } from '../server/zvuk.js';
import { najdiProblemy, jeZvukovySoubor } from '../hooks/pre-commit.js';
import { docasneRepo, dokud, FalesnyObs } from './pomoc.js';

const VRSTVY = {
  pocasi: {
    dest: { zvuk: { ambient: 'dest.mp3', hlasitost_podle_intenzity: true } },
    bourka: { zvuk: { ambient: 'bourka.mp3', hrom: ['hrom-1.mp3', '../ven.mp3'] } },
  },
  rezim: { souboj: { zvuk: { hudba: 'souboj.mp3' } } },
};
const MISTO_ZVUK = { zvuk: { den: { hudba: 'les-den.mp3', ambient: 'les-den-amb.mp3' }, noc: { ambient: 'les-noc.mp3' } } };
const sc = (z = {}) => ({ varianta: 'den', pocasi: [], intenzita: 0, rezim: 'pruzkum', ...z });

test('skládání zvuku: hudba z místa, ambient místa a počasí současně, intenzita zesílí počasí', () => {
  const v = slozitZvuk({ misto: MISTO_ZVUK, scena: sc({ pocasi: ['dest'], intenzita: 1 }), vrstvy: VRSTVY });
  assert.equal(v.hudba, 'les-den.mp3');
  assert.deepEqual(v.ambient.map((a) => [a.soubor, a.hlasitost]), [['les-den-amb.mp3', 1], ['dest.mp3', 0.7]]);
  const noc = slozitZvuk({ misto: MISTO_ZVUK, scena: sc({ varianta: 'noc' }), vrstvy: VRSTVY });
  assert.equal(noc.hudba, null, 'noc má vlastní zvuk bez hudby');
  assert.equal(noc.ambient[0].soubor, 'les-noc.mp3');
  const bezNoci = slozitZvuk({ misto: { zvuk: { den: MISTO_ZVUK.zvuk.den } }, scena: sc({ varianta: 'noc' }), vrstvy: VRSTVY });
  assert.equal(bezNoci.hudba, 'les-den.mp3', 'noc bez zvuku hraje den');
});

test('skládání zvuku: souboj vymění hudbu, ambient počasí nechá a ambient místa ztlumí; hrom jen platná jména', () => {
  const v = slozitZvuk({ misto: MISTO_ZVUK, scena: sc({ rezim: 'souboj', pocasi: ['bourka'] }), vrstvy: VRSTVY });
  assert.equal(v.hudba, 'souboj.mp3');
  assert.deepEqual(v.ambient.map((a) => [a.soubor, a.hlasitost]), [['les-den-amb.mp3', 0.35], ['bourka.mp3', 1]]);
  assert.deepEqual(v.hrom, ['hrom-1.mp3']);
});

test('jména zvukových souborů: jen uvnitř složky a jen zvukové přípony', () => {
  assert.equal(platneJmeno('efekty/dvere.mp3'), 'efekty/dvere.mp3');
  assert.equal(platneJmeno('efekty\\dvere.ogg'), 'efekty/dvere.ogg');
  for (const spatne of ['../hub/.env', '/etc/passwd.mp3', 'C:/x.mp3', 'a//b.mp3', 'skript.js', '', null]) assert.equal(platneJmeno(spatne), null, String(spatne));
  assert.deepEqual(normalizujZvukMista({ den: { hudba: 'a.mp3', ambient: '../b.mp3' }, poledne: {} }), { den: { hudba: 'a.mp3' } });
});

test('hook: zvukové soubory do repa nesmí', () => {
  assert.ok(jeZvukovySoubor('audio/les.MP3'));
  assert.ok(!jeZvukovySoubor('kampan/mista/les/les.md'));
  const p = najdiProblemy([{ cesta: 'kampan/zvuk/hrom.wav', obsah: null }]);
  assert.match(p[0].duvod, /zvukový soubor/);
});

/* ---------- Hub se zvukem ---------- */

const MISTO = `---
schema: 1
id: les
typ: misto
nazev: Les
verejne: true
popis_obrazu: "" # komentář, který musí přežít
ilustrace: []
zvuk:
  den: { hudba: les-den.mp3, ambient: les.mp3 }
---
Tělo, které Hub nesmí přepsat.
`;

async function spustitHub() {
  const repo = await docasneRepo();
  const audio = await fs.mkdtemp(path.join(os.tmpdir(), 'dmhub-audio-'));
  const slozka = path.join(repo.c.kampan, 'mista', 'les');
  await fs.mkdir(slozka, { recursive: true });
  await fs.writeFile(path.join(slozka, 'les.md'), MISTO);
  for (const d of ['pocasi', 'rezim']) await fs.mkdir(path.join(repo.c.kampan, 'sceny', d), { recursive: true });
  await fs.writeFile(path.join(repo.c.kampan, 'sceny', 'pocasi', 'bourka.yaml'), 'zvuk:\n  ambient: bourka.mp3\n  hrom: [hrom-1.mp3]\n');
  await fs.writeFile(path.join(repo.c.kampan, 'sceny', 'rezim', 'souboj.yaml'), 'zvuk: { hudba: souboj.mp3 }\n');
  await fs.mkdir(path.join(audio, 'efekty'), { recursive: true });
  // Obsah nemusí být skutečné MP3: server jen posílá bajty, přehrávají stránky.
  for (const f of ['les-den.mp3', 'les.mp3', 'bourka.mp3', 'hrom-1.mp3', 'souboj.mp3', 'efekty/dvere.ogg']) {
    await fs.writeFile(path.join(audio, ...f.split('/')), Buffer.from(`zvuk ${f} `.repeat(50)));
  }
  await fs.writeFile(path.join(audio, 'poznamky.txt'), 'nezvuk');
  await fs.writeFile(repo.c.env, `OBS_URL="ws://127.0.0.1:4455"\nOBS_HESLO="spravne"\nOBS_SCENA_SOUBOJ="Souboj"\nZVUK_SLOZKA=${JSON.stringify(audio)}\n`);
  const obs = new FalesnyObs({ heslo: 'spravne' });
  const hub = new Hub({ cesty: repo.c, obsKlient: obs, gitSit: false, port: 0 });
  await hub.spustit();
  const volat = async (cesta, { metoda = 'GET', telo, hlavicky = {} } = {}) => {
    const r = await fetch(hub.adresa + cesta, { method: metoda, headers: { ...(telo ? { 'Content-Type': 'application/json' } : {}), ...hlavicky }, body: telo ? JSON.stringify(telo) : undefined });
    const typ = r.headers.get('content-type') ?? '';
    return { status: r.status, hlavicky: r.headers, data: typ.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  return {
    hub, obs, repo, audio, volat,
    zastavit: async () => {
      await hub.zastavit();
      await repo.smazat();
      await fs.rm(audio, { recursive: true, force: true });
    },
  };
}

test('stránky dostanou co hrát; chybějící soubor se vynechá a panel ho ukáže', async () => {
  const t = await spustitHub();
  try {
    assert.equal(t.hub.zvuk.soubory.length, 6, 'jen zvukové soubory, i v podsložce');
    await t.volat('/api/scena/zobrazit', { metoda: 'POST', telo: { misto: 'les' } });
    let r = await t.volat('/api/zvuk?pro=stranka');
    assert.equal(r.data.hudba.url, '/audio/les-den.mp3');
    assert.deepEqual(r.data.ambient.map((a) => a.soubor), ['les.mp3']);
    assert.equal(r.data.prolnutiMs, 2000);
    await fs.rm(path.join(t.audio, 'les.mp3'));
    await t.volat('/api/zvuk/prohledat', { metoda: 'POST', telo: {} });
    r = await t.volat('/api/zvuk?pro=stranka');
    assert.deepEqual(r.data.ambient, []);
    const panel = await t.volat('/api/zvuk');
    assert.deepEqual(panel.data.chybiTed, ['les.mp3']);
    assert.deepEqual(panel.data.efekty, ['efekty/dvere.ogg']);
    await dokud(async () => (await t.hub.data.zkontrolovat()).problemy.some((p) => p.zprava === 'Zvuk „les.mp3“ není ve složce zvuku'));
  } finally {
    await t.zastavit();
  }
});

test('soubory zvuku: celé i po částech (Range), nic mimo složku, nic z domácí sítě', async () => {
  const t = await spustitHub();
  try {
    const cele = await t.volat('/audio/les-den.mp3');
    assert.equal(cele.status, 200);
    assert.equal(cele.hlavicky.get('content-type'), 'audio/mpeg');
    assert.equal(cele.hlavicky.get('accept-ranges'), 'bytes');
    const cast = await t.volat('/audio/les-den.mp3', { hlavicky: { Range: 'bytes=5-9' } });
    assert.equal(cast.status, 206);
    assert.equal(cast.data.toString(), cele.data.subarray(5, 10).toString());
    assert.match(cast.hlavicky.get('content-range'), /^bytes 5-9\/\d+$/);
    assert.equal((await t.volat('/audio/efekty/dvere.ogg')).status, 200);
    for (const zle of ['/audio/..%2F..%2Fhub%2F.env', '/audio/poznamky.txt', '/audio/neni.mp3', '/audio/%2E%2E/x.mp3']) {
      assert.equal((await t.volat(zle)).status, 404, zle);
    }
    // Z domácí sítě (s PINem) by panel fungoval, zvuk ne: soubory jdou jen na tento počítač.
    await assert.rejects(
      () => t.hub.zvukovySoubor({ method: 'GET', headers: {}, socket: { remoteAddress: '192.168.0.50' } }, {}, new URL('http://x/audio/les.mp3')),
      (e) => e.status === 403,
    );
  } finally {
    await t.zastavit();
  }
});

test('souboj vymění hudbu a ambient počasí nechá; Konec souboje vrátí hudbu místa', async () => {
  const t = await spustitHub();
  try {
    await dokud(() => t.hub.obs.pripojeno);
    await t.volat('/api/scena/zobrazit', { metoda: 'POST', telo: { misto: 'les' } });
    await t.volat('/api/scena', { metoda: 'PUT', telo: { pocasi: ['bourka'] } });
    const udalosti = [];
    t.hub.zvuk.on('zvuk', (z) => udalosti.push(z));
    await t.volat('/api/souboj', { metoda: 'POST', telo: { zapnout: true } });
    let z = udalosti.at(-1);
    assert.equal(z.hudba.soubor, 'souboj.mp3');
    assert.deepEqual(z.ambient.map((a) => [a.soubor, a.hlasitost]), [['les.mp3', 0.35], ['bourka.mp3', 1]]);
    await t.volat('/api/souboj', { metoda: 'POST', telo: { zapnout: false } });
    z = udalosti.at(-1);
    assert.equal(z.hudba.soubor, 'les-den.mp3');
    assert.deepEqual(z.ambient.map((a) => a.hlasitost), [1, 1]);
    // Střídání ilustrací scénu mění, zvuk ne: stránky nedostanou nic navíc.
    const pocet = udalosti.length;
    t.hub.scena.oznam(false);
    assert.equal(udalosti.length, pocet);
  } finally {
    await t.zastavit();
  }
});

test('Ticho a hlasitost se uloží a pošlou stránkám; hlášení stránek je v panelu', async () => {
  const t = await spustitHub();
  try {
    const r = await t.volat('/api/zvuk', { metoda: 'PUT', telo: { ticho: true, hudba: 0.5 } });
    assert.equal(r.data.ticho, true);
    assert.equal(r.data.hlasitost.hudba, 0.5);
    assert.equal((await t.volat('/api/zvuk', { metoda: 'PUT', telo: { ambient: 3 } })).status, 400);
    const ulozeno = JSON.parse(await fs.readFile(path.join(t.repo.c.lokalniStav, 'zvuk.json'), 'utf8'));
    assert.equal(ulozeno.ticho, true);
    assert.equal((await t.volat('/api/zvuk')).data.stranky.stul.pripojeno, false);
    await t.volat('/api/zvuk/hlaseni', { metoda: 'POST', telo: { stranka: 'stul', odemceno: true, hraje: ['les.mp3'], vystup: { nazev: 'BT reproduktor', ok: false, vybrany: true } } });
    const s = (await t.volat('/api/zvuk')).data.stranky.stul;
    assert.equal(s.pripojeno, true);
    assert.deepEqual(s.hraje, ['les.mp3']);
    assert.equal(s.vystup.ok, false, 'odpojený reproduktor kontrolka ukáže');
    assert.equal((await t.volat('/api/zvuk/hlaseni', { metoda: 'POST', telo: { stranka: 'jina' } })).status, 400);
  } finally {
    await t.zastavit();
  }
});

test('hrom zazní po blesku do 1 s (nad námi), efekty a zkušební zvuk jdou na správnou stránku', async () => {
  const t = await spustitHub();
  try {
    await t.volat('/api/scena', { metoda: 'PUT', telo: { pocasi: ['bourka'], bourka: 'nad-nami' } });
    const efekty = [];
    t.hub.zvuk.on('efekt', (e) => efekty.push({ ...e, cas: Date.now() }));
    const zacatek = Date.now();
    const b = await t.volat('/api/svetla/blesk', { metoda: 'POST', telo: {} });
    assert.equal(b.data.blesk, true);
    await dokud(() => efekty.length === 1, 1500);
    assert.ok(efekty[0].cas - zacatek <= 1100);
    assert.deepEqual([efekty[0].cil, efekty[0].url, efekty[0].hlasitost], ['stul', '/audio/hrom-1.mp3', 1]);
    await t.volat('/api/zvuk/efekt', { metoda: 'POST', telo: { soubor: 'efekty/dvere.ogg' } });
    assert.equal(efekty.at(-1).url, '/audio/efekty/dvere.ogg');
    assert.equal((await t.volat('/api/zvuk/efekt', { metoda: 'POST', telo: { soubor: '../x.mp3' } })).status, 404);
    const test_ = await t.volat('/api/zvuk/efekt', { metoda: 'POST', telo: { test: true, cil: 'hudba' } });
    assert.equal(test_.data.pripojeno, false);
    assert.deepEqual([efekty.at(-1).cil, efekty.at(-1).test], ['hudba', true]);
  } finally {
    await t.zastavit();
  }
});

test('zvuk místa se ukládá do hlavičky bez ztráty komentářů; prázdná volba ho smaže', async () => {
  const t = await spustitHub();
  try {
    const r = await t.volat('/api/mista/les/zvuk/noc', { metoda: 'PUT', telo: { ambient: 'bourka.mp3', hudba: 'souboj.mp3' } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const soubor = path.join(t.repo.c.kampan, 'mista', 'les', 'les.md');
    let text = await fs.readFile(soubor, 'utf8');
    assert.match(text, /# komentář, který musí přežít/);
    assert.match(text, /noc: \{ hudba: souboj\.mp3, ambient: bourka\.mp3 \}/);
    assert.match(text, /den: \{ hudba: les-den\.mp3, ambient: les\.mp3 \}/);
    assert.match(text, /Tělo, které Hub nesmí přepsat\./);
    await t.volat('/api/mista/les/zvuk/noc', { metoda: 'PUT', telo: { ambient: null, hudba: '' } });
    text = await fs.readFile(soubor, 'utf8');
    assert.doesNotMatch(text, /noc:/);
    assert.equal((await t.volat('/api/mista/les/zvuk/noc', { metoda: 'PUT', telo: { hudba: '../../hub/.env' } })).status, 400);
    assert.deepEqual(t.hub.mista.get('les').zvuk, { den: { hudba: 'les-den.mp3', ambient: 'les.mp3' } });
  } finally {
    await t.zastavit();
  }
});

test('nastavení zvuku: složka musí být celá cesta, nová složka se hned načte', async () => {
  const t = await spustitHub();
  try {
    assert.equal((await t.volat('/api/nastaveni', { metoda: 'PUT', telo: { zvukSlozka: 'relativni/cesta' } })).status, 400);
    const prazdna = await fs.mkdtemp(path.join(os.tmpdir(), 'dmhub-audio2-'));
    const r = await t.volat('/api/nastaveni', { metoda: 'PUT', telo: { zvukSlozka: prazdna, zvukOtevrit: false } });
    assert.equal(r.data.nastaveni.zvukSlozka, prazdna);
    assert.equal(r.data.nastaveni.zvukOtevrit, false);
    assert.equal(t.hub.zvuk.soubory.length, 0);
    await fs.rm(prazdna, { recursive: true, force: true });
  } finally {
    await t.zastavit();
  }
});
