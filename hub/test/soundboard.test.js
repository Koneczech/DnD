// Soundboard, zvuky na tahu a fanfára (bod 76).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Hub } from '../server/app.js';
import { idSkupiny, sestavitKnihovnu, najitSkupinu, vybratVariantu, normalizujMapu, zvukTahu, platneId } from '../server/zvuky-knihovna.js';
import { naTahu, SledovaniHp } from '../server/iniciativa-hp.js';
import { docasneRepo, dokud, FalesnyObs } from './pomoc.js';

const bezVerze = (u) => String(u).replace(/\?v=[^&]*$/, '');

const SOUBORY = [
  'jednorazove/boj/mec-1.mp3', 'jednorazove/boj/mec-2.mp3', 'jednorazove/boj/mec-3.mp3',
  'jednorazove/zvirata/vlk-vyti.ogg', 'efekty/dvere.ogg', 'jednorazove/splouchnuti.wav',
  'smycky/poplasny-zvon.mp3', 'smycky/priroda/reka.mp3',
  'tahy/tusker.mp3', 'tahy/alba.mp3', 'tahy/nepritel.mp3', 'les.mp3',
];

test('knihovna: skupiny variant, kategorie podle složek, efekty/ jako jednorázové', () => {
  assert.equal(idSkupiny('jednorazove/boj/mec-2.mp3'), 'jednorazove/boj/mec');
  assert.equal(idSkupiny('smycky/reka.mp3'), 'smycky/reka');
  const mapa = normalizujMapu({ zvuky: { 'smycky/poplasny-zvon': { nazev: 'Poplašný zvon', limit_s: 20 } } });
  const k = sestavitKnihovnu(SOUBORY, mapa);
  const mec = k.jednorazove.find((x) => x.id === 'jednorazove/boj/mec');
  assert.equal(mec.soubory.length, 3);
  assert.equal(mec.kategorie, 'boj');
  assert.equal(mec.nazev, 'Mec');
  assert.equal(k.jednorazove.find((x) => x.id === 'efekty/dvere').kategorie, 'efekty');
  assert.equal(k.jednorazove.find((x) => x.id === 'jednorazove/splouchnuti').kategorie, 'ostatní');
  const zvon = k.smycky.find((x) => x.id === 'smycky/poplasny-zvon');
  assert.deepEqual([zvon.nazev, zvon.limit_s], ['Poplašný zvon', 20]);
  assert.equal(k.tahy.length, 3);
  assert.ok(!JSON.stringify(k).includes('les.mp3'), 'soubory mimo složky soundboardu se nepočítají');
  assert.equal(najitSkupinu(k, 'zvirata/vlk-vyti').skupina.id, 'jednorazove/zvirata/vlk-vyti', 'krátké ID bez kořene');
  assert.equal(najitSkupinu(k, 'tahy/tusker').druh, 'tahy');
  assert.equal(najitSkupinu(k, '../ven'), null);
  assert.equal(platneId('a/../b'), null);
});

test('varianty se neopakují dvakrát za sebou', () => {
  const s = { soubory: ['a.mp3', 'b.mp3'] };
  for (let i = 0; i < 20; i++) assert.equal(vybratVariantu(s, 'a.mp3', Math.random), 'b.mp3');
  assert.equal(vybratVariantu({ soubory: ['x.mp3'] }, 'x.mp3'), 'x.mp3');
});

test('zvuk na tah: tag postavy, tag pro kohokoli, výchozí zvuk, společný zvuk nepřátel', () => {
  const mapa = normalizujMapu({
    tahy: {
      postavy: { Tusker: 'tahy/tusker', Alba: { vychozi: 'tahy/alba', podle_tagu: { Vlk: 'zvirata/vlk-vyti' } } },
      tagy: { Unconscious: 'tahy/srdce' },
      nepratele: 'tahy/nepritel',
    },
  });
  assert.equal(zvukTahu(mapa, { jmeno: 'Tusker', hrac: true, tagy: [] }), 'tahy/tusker');
  assert.equal(zvukTahu(mapa, { jmeno: 'Alba Nox', hrac: true, tagy: ['vlk'] }), 'zvirata/vlk-vyti', 'jméno začíná klíčem, tag bez ohledu na velikost písmen');
  assert.equal(zvukTahu(mapa, { jmeno: 'Alba', hrac: true, tagy: ['Concentrating'] }), 'tahy/alba');
  assert.equal(zvukTahu(mapa, { jmeno: 'Tusker', hrac: true, tagy: ['Unconscious'] }), 'tahy/srdce');
  assert.equal(zvukTahu(mapa, { jmeno: 'Bandit 3', hrac: false, tagy: [] }), 'tahy/nepritel');
  assert.equal(zvukTahu(mapa, { jmeno: 'Koudur', hrac: true, tagy: [] }), null, 'postava hráče bez zápisu je potichu');
});

test('Player View: kdo je na tahu a jeho viditelné tagy; událost tah jen při změně', async () => {
  const stav = (aktivni) => ({
    encounterState: {
      ActiveCombatantId: aktivni,
      Combatants: [
        { Id: 'a', Name: 'Alba', IsPlayerCharacter: true, HPDisplay: '18/18', Tags: [{ Text: 'Vlk', DurationRemaining: 0 }, { Text: '  ' }] },
        { Id: 'b', Name: 'Bandit 1', IsPlayerCharacter: false, HPDisplay: 'Healthy' },
      ],
    },
  });
  assert.deepEqual(naTahu(stav('a')), { id: 'a', jmeno: 'Alba', hrac: true, tagy: ['Vlk'] });
  assert.deepEqual(naTahu(stav('b')).tagy, []);
  let aktivni = 'a';
  let souboj = true;
  const s = new SledovaniHp({ odkaz: () => 'https://improvedinitiative.app/p/x1', aktivni: () => souboj, hlidatHp: () => false, nacist: async () => stav(aktivni) });
  const tahy = [];
  const hp = [];
  s.on('tah', (k) => tahy.push(k.jmeno));
  s.on('zmena', (k) => hp.push(k));
  await s.krok();
  await s.krok();
  aktivni = 'b';
  await s.krok();
  souboj = false;
  await s.krok();
  souboj = true;
  await s.krok();
  assert.deepEqual(tahy, ['Alba', 'Bandit 1', 'Bandit 1'], 'nový souboj ohlásí prvního na tahu znovu');
  assert.deepEqual(hp, [], 's vypnutými světly podle HP nic neohlásí');
});

/* ---------- Hub ---------- */

const MISTO = `---
schema: 1
id: tabor
typ: misto
nazev: Tábor
verejne: true
ilustrace: []
zvuk:
  den: { ambient: les.mp3 } # komentář, který musí přežít
---
Tělo.
`;

async function spustitHub() {
  const repo = await docasneRepo();
  const audio = await fs.mkdtemp(path.join(os.tmpdir(), 'dmhub-sb-'));
  await fs.mkdir(path.join(repo.c.kampan, 'mista', 'tabor'), { recursive: true });
  await fs.writeFile(path.join(repo.c.kampan, 'mista', 'tabor', 'tabor.md'), MISTO);
  await fs.mkdir(path.join(repo.c.kampan, 'sceny', 'rezim'), { recursive: true });
  await fs.writeFile(path.join(repo.c.kampan, 'sceny', 'rezim', 'souboj.yaml'), 'zvuk: { hudba: souboj.mp3, konec: vitezstvi.mp3 }\n');
  await fs.writeFile(path.join(repo.c.kampan, 'zvuky.yaml'), [
    'zvuky:',
    '  smycky/poplasny-zvon: { nazev: Poplašný zvon, limit_s: 1 }',
    'tahy:',
    '  postavy: { Tusker: tahy/tusker }',
    '  nepratele: tahy/nepritel',
    '  tagy: { Unconscious: tahy/srdce }',
    '',
  ].join('\n'));
  for (const f of [...SOUBORY, 'souboj.mp3', 'vitezstvi.mp3']) {
    await fs.mkdir(path.dirname(path.join(audio, ...f.split('/'))), { recursive: true });
    await fs.writeFile(path.join(audio, ...f.split('/')), Buffer.from(`zvuk ${f}`));
  }
  await fs.writeFile(repo.c.env, `OBS_URL="ws://127.0.0.1:4455"\nOBS_HESLO="spravne"\nOBS_SCENA_SOUBOJ="Souboj"\nZVUK_SLOZKA=${JSON.stringify(audio)}\n`);
  const obs = new FalesnyObs({ heslo: 'spravne' });
  const hub = new Hub({ cesty: repo.c, obsKlient: obs, gitSit: false, port: 0 });
  await hub.spustit();
  const volat = async (cesta, { metoda = 'GET', telo } = {}) => {
    const r = await fetch(hub.adresa + cesta, { method: metoda, headers: telo ? { 'Content-Type': 'application/json' } : {}, body: telo ? JSON.stringify(telo) : undefined });
    return { status: r.status, data: await r.json() };
  };
  const efekty = [];
  hub.zvuk.on('efekt', (e) => efekty.push(e));
  return {
    hub, repo, audio, volat, efekty,
    zastavit: async () => {
      await hub.zastavit();
      await repo.smazat();
      await fs.rm(audio, { recursive: true, force: true });
    },
  };
}

test('soundboard v Hubu: jednorázový zvuk s variantou, smyčka zap/vyp i sama skončí, připnutí k místu', async () => {
  const t = await spustitHub();
  try {
    const stav = (await t.volat('/api/zvuk')).data;
    assert.equal(stav.knihovna.jednorazove.length, 4);
    assert.equal(stav.knihovna.smycky.length, 2);
    await t.volat('/api/zvuk/efekt', { metoda: 'POST', telo: { zvuk: 'jednorazove/boj/mec' } });
    await t.volat('/api/zvuk/efekt', { metoda: 'POST', telo: { zvuk: 'boj/mec' } });
    assert.equal(t.efekty.length, 2);
    assert.notEqual(t.efekty[0].soubor, t.efekty[1].soubor, 'dvakrát za sebou jiná varianta');
    assert.ok(t.efekty.every((e) => e.obmena && e.uhnout && e.cil === 'stul'));

    let r = await t.volat('/api/zvuk/smycka', { metoda: 'PUT', telo: { zvuk: 'smycky/priroda/reka', zap: true, hlasitost: 0.6 } });
    assert.deepEqual(r.data.zapnuteSmycky, ['smycky/priroda/reka']);
    let pro = (await t.volat('/api/zvuk?pro=stranka')).data;
    assert.deepEqual(pro.smycky.map((x) => [x.soubor, x.hlasitost, bezVerze(x.url)]), [['smycky/priroda/reka', 0.6, '/audio/smycky/priroda/reka.mp3']]);
    // Klik na smyčku v soundboardu (stejné API jako jednorázový zvuk) ji přepne.
    await t.volat('/api/zvuk/efekt', { metoda: 'POST', telo: { zvuk: 'smycky/poplasny-zvon' } });
    assert.equal((await t.volat('/api/zvuk')).data.zapnuteSmycky.length, 2);
    await dokud(async () => !(await t.volat('/api/zvuk')).data.zapnuteSmycky.includes('smycky/poplasny-zvon'));
    r = await t.volat('/api/zvuk/smycky/zastavit', { metoda: 'POST', telo: {} });
    assert.deepEqual(r.data.zapnuteSmycky, []);
    assert.equal((await t.volat('/api/zvuk/smycka', { metoda: 'PUT', telo: { zvuk: 'boj/mec' } })).status, 404, 'jednorázový zvuk není smyčka');

    r = await t.volat('/api/mista/tabor/zvuk-pripnute', { metoda: 'PUT', telo: { pripnute: ['smycky/poplasny-zvon', 'jednorazove/boj/mec'] } });
    assert.deepEqual(r.data.misto.zvuk.pripnute, ['smycky/poplasny-zvon', 'jednorazove/boj/mec']);
    const text = await fs.readFile(path.join(t.repo.c.kampan, 'mista', 'tabor', 'tabor.md'), 'utf8');
    assert.match(text, /pripnute: \[ smycky\/poplasny-zvon, jednorazove\/boj\/mec \]/);
    assert.match(text, /# komentář, který musí přežít/);
    assert.equal((await t.volat('/api/mista/tabor/zvuk-pripnute', { metoda: 'PUT', telo: { pripnute: ['../ven'] } })).status, 400);
    r = await t.volat('/api/mista/tabor/zvuk-pripnute', { metoda: 'PUT', telo: { pripnute: [] } });
    assert.equal(r.data.misto.zvuk.pripnute, undefined);
  } finally {
    await t.zastavit();
  }
});

test('zvuky na tahu a fanfára při Konci souboje (Konec bez fanfáry ji vynechá)', async () => {
  const t = await spustitHub();
  try {
    t.hub.zvuk.tah({ jmeno: 'Tusker', hrac: true, tagy: [] });
    t.hub.zvuk.tah({ jmeno: 'Bandit 2', hrac: false, tagy: [] });
    t.hub.zvuk.tah({ jmeno: 'Koudur', hrac: true, tagy: [] });
    assert.deepEqual(t.efekty.map((e) => e.soubor), ['tahy/tusker.mp3', 'tahy/nepritel.mp3']);
    await t.volat('/api/zvuk', { metoda: 'PUT', telo: { tahyJenHraci: true } });
    t.hub.zvuk.tah({ jmeno: 'Bandit 2', hrac: false, tagy: [] });
    await t.volat('/api/zvuk', { metoda: 'PUT', telo: { tahy: false } });
    t.hub.zvuk.tah({ jmeno: 'Tusker', hrac: true, tagy: [] });
    assert.equal(t.efekty.length, 2, 'jen hráči a pak vypnuto: nic dalšího');
    // Kontrola dat: tahy/srdce v mapě, ve složce chybí.
    await dokud(async () => (await t.hub.data.zkontrolovat()).problemy.some((p) => p.soubor === 'kampan/zvuky.yaml' && /tahy\/srdce/.test(p.zprava)));

    await t.volat('/api/souboj', { metoda: 'POST', telo: { zapnout: true } });
    await t.volat('/api/souboj', { metoda: 'POST', telo: { zapnout: false } });
    assert.equal(t.efekty.at(-1).soubor, 'vitezstvi.mp3');
    const pocet = t.efekty.length;
    await t.volat('/api/souboj', { metoda: 'POST', telo: { zapnout: true } });
    await t.volat('/api/souboj', { metoda: 'POST', telo: { zapnout: false, fanfara: false } });
    await t.volat('/api/souboj', { metoda: 'POST', telo: { zapnout: false } });
    assert.equal(t.efekty.length, pocet, 'bez fanfáry a Konec bez běžícího souboje nehraje');
  } finally {
    await t.zastavit();
  }
});
