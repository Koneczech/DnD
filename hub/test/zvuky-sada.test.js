// Zvuková sada z Freesoundu a srovnání hlasitosti (otevřený bod 86).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Hub } from '../server/app.js';
import { normalizujSadu, souboryPolozky, adresaHledani, adresaOpenverse } from '../server/zvuky-sada.js';
import { zmeritVzorky, ziskNaHladinu } from '../sdilene/mereni.js';
import { docasneRepo, dokud, FalesnyObs } from './pomoc.js';

test('sada: položky, výchozí hodnoty, chyby a jména souborů', () => {
  const { polozky, chyby } = normalizujSadu({
    zvuky: {
      vitezstvi: { hledat: 'fanfare', delka: [3, 15] },
      'nahodne/tabor/kun': { hledat: 'horse whinny', variant: 3, popis: 'Kůň' },
      'spatne.mp3': { hledat: 'x' },
      bez: {},
      'divna/delka': { hledat: 'x', delka: [5, 1], variant: 99 },
    },
  });
  assert.deepEqual(polozky.map((p) => [p.cil, p.variant, p.delka]), [['vitezstvi', 1, [3, 15]], ['nahodne/tabor/kun', 3, [0.3, 30]], ['divna/delka', 6, [0.3, 30]]]);
  assert.equal(chyby.length, 3);
  assert.deepEqual(souboryPolozky(polozky[0]), ['vitezstvi.mp3']);
  assert.deepEqual(souboryPolozky(polozky[1]), ['nahodne/tabor/kun-1.mp3', 'nahodne/tabor/kun-2.mp3', 'nahodne/tabor/kun-3.mp3']);
  const o = new URL(adresaOpenverse({ hledat: 'horse', licence: ['cc0', 'by'] }));
  assert.equal(o.searchParams.get('license'), 'cc0,by,pdm');
  const u = new URL(adresaHledani(polozky[1], 'falesny'));
  assert.equal(u.searchParams.get('filter'), 'license:"Creative Commons 0" duration:[0.3 TO 30]');
  assert.equal(u.searchParams.get('sort'), 'rating_desc');
});

test('měření: sinus 997 Hz kolem −3 LUFS, ticho na začátku, zesílení na hladinu s mezemi', () => {
  const fs_ = 48000;
  const s = new Float32Array(fs_ * 2);
  for (let i = 0; i < s.length; i++) s[i] = Math.sin((2 * Math.PI * 997 * i) / fs_);
  const m = zmeritVzorky([s], fs_);
  assert.ok(Math.abs(m.lufs + 3) < 0.6, `lufs ${m.lufs}`);
  assert.equal(m.spicka, 1);
  const t = new Float32Array(fs_ * 2);
  for (let i = fs_ / 2; i < t.length; i++) t[i] = 0.05 * Math.sin((2 * Math.PI * 440 * i) / fs_);
  const m2 = zmeritVzorky([t, t], fs_);
  assert.ok(Math.abs(m2.zacatek - 0.5) < 0.02, `zacatek ${m2.zacatek}`);
  assert.equal(zmeritVzorky([new Float32Array(1000)], fs_).lufs, null, 'ticho');
  assert.equal(zmeritVzorky([s.slice(0, 4800)], fs_).lufs !== null, true, 'krátký zvuk pod 400 ms');
  assert.equal(ziskNaHladinu({ lufs: -30, spicka: 0.1 }, -18), 3.981);
  assert.equal(ziskNaHladinu({ lufs: -30, spicka: 0.5 }, -18), 2, 'nikdy přes špičku 1');
  assert.equal(ziskNaHladinu({ lufs: 0, spicka: 1 }, -40), 0.1, 'nejvýš −20 dB');
  assert.equal(ziskNaHladinu(null, -18), 1);
});

/** Falešný Freesound: vyhledávání vrací kandidáty, náhledy bajty s ID. */
function falesnyFreesound({ status = 200, openverse = [] } = {}) {
  const volani = [];
  const vysledky = Array.from({ length: 6 }, (_, i) => ({
    id: 100 + i,
    name: `kun ${i}`,
    username: `autor${i}`,
    license: 'http://creativecommons.org/publicdomain/zero/1.0/',
    duration: 2,
    previews: { 'preview-hq-mp3': `https://cdn.freesound.org/previews/0/${100 + i}-hq.mp3` },
    url: `https://freesound.org/s/${100 + i}/`,
  }));
  vysledky.push({ ...vysledky[0], id: 999, license: 'http://creativecommons.org/licenses/by/4.0/' });
  const f = async (adresa) => {
    volani.push(adresa);
    if (status !== 200 && adresa.includes('freesound.org/apiv2')) return { ok: false, status, json: async () => ({}) };
    if (adresa.includes('api.openverse.org')) return { ok: true, status: 200, json: async () => ({ results: openverse }) };
    if (adresa.includes('/search/text/')) {
      const strana = new URL(adresa).searchParams.get('page');
      return { ok: true, status: 200, json: async () => ({ results: strana === '1' ? vysledky : [] }) };
    }
    const id = (adresa.match(/(\d+)-hq/) ?? adresa.match(/\/([a-z0-9-]+)\.(?:ogg|mp3|wav)$/i))[1];
    return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(`mp3 ${id} `.repeat(200)).buffer };
  };
  return { f, volani };
}

async function spustitHub(freesound) {
  const repo = await docasneRepo();
  const audio = await fs.mkdtemp(path.join(os.tmpdir(), 'dmhub-sada-'));
  await fs.writeFile(path.join(audio, 'dest.mp3'), Buffer.from('dest '.repeat(100)));
  await fs.mkdir(path.join(repo.c.kampan, 'mista', 'les'), { recursive: true });
  await fs.writeFile(path.join(repo.c.kampan, 'mista', 'les', 'les.md'), '---\ntyp: misto\nnazev: Les\nverejne: true\nilustrace: []\nzvuk:\n  den: { ambient: dest.mp3 }\n---\n');
  await fs.writeFile(path.join(repo.c.kampan, 'zvuky-sada.yaml'), 'zvuky:\n  nahodne/tabor/kun: { hledat: horse whinny, delka: [1, 6], variant: 2 }\n  vitezstvi: { hledat: fanfare }\n');
  // Zjevně falešný klíč generovaný za běhu.
  const klic = `test${crypto.randomBytes(12).toString('hex')}`;
  await fs.writeFile(repo.c.env, `OBS_URL="ws://127.0.0.1:4455"\nOBS_HESLO="spravne"\nZVUK_SLOZKA=${JSON.stringify(audio)}\nFREESOUND_KLIC="${klic}"\n`);
  const hub = new Hub({ cesty: repo.c, obsKlient: new FalesnyObs({ heslo: 'spravne' }), gitSit: false, port: 0, fetchZvuky: freesound.f });
  await hub.spustit();
  const volat = async (cesta, { metoda = 'GET', telo } = {}) => {
    const r = await fetch(hub.adresa + cesta, { method: metoda, headers: telo ? { 'Content-Type': 'application/json' } : {}, body: telo ? JSON.stringify(telo) : undefined });
    return { status: r.status, data: await r.json() };
  };
  return {
    hub, repo, audio, volat, klic,
    zastavit: async () => {
      await hub.zastavit();
      await repo.smazat();
      await fs.rm(audio, { recursive: true, force: true });
    },
  };
}

test('sada v Hubu: doplní chybějící z Freesoundu (jen CC0), zapíše autory, Vyměnit vezme další', async () => {
  const fake = falesnyFreesound();
  const t = await spustitHub(fake);
  try {
    let s = (await t.volat('/api/zvuk')).data.sada;
    assert.equal(s.klic, true);
    assert.deepEqual(s.polozky.map((p) => p.chybi), [2, 1]);
    assert.equal(JSON.stringify(s).includes(t.klic), false, 'klíč do panelu nejde');

    const r = await t.volat('/api/zvuk/sada/doplnit', { metoda: 'POST', telo: {} });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.celkem, 3);
    await dokud(async () => !(await t.volat('/api/zvuk')).data.sada.prubeh.bezi, 5000);
    s = (await t.volat('/api/zvuk')).data.sada;
    assert.equal(s.prubeh.chyba, null, s.prubeh.chyba);
    assert.deepEqual(s.polozky.map((p) => p.chybi), [0, 0]);
    assert.match(await fs.readFile(path.join(t.audio, 'nahodne', 'tabor', 'kun-1.mp3'), 'utf8'), /^mp3 100 /);
    assert.match(await fs.readFile(path.join(t.audio, 'nahodne', 'tabor', 'kun-2.mp3'), 'utf8'), /^mp3 101 /);
    const zdroje = JSON.parse(await fs.readFile(path.join(t.audio, 'zdroje.json'), 'utf8'));
    assert.equal(zdroje.soubory['nahodne/tabor/kun-1.mp3'].autor, 'autor0');
    assert.equal(zdroje.soubory['vitezstvi.mp3'].licence, 'CC0');
    assert.equal(s.polozky[0].soubory[0].zdroj.autor, 'autor0');
    assert.ok(fake.volani.every((a) => !a.includes('/999-hq')), 'jiná licence než CC0 se nestáhne');
    assert.ok(t.hub.zvuk.knihovna.nahodne.some((g) => g.id === 'nahodne/tabor/kun' && g.soubory.length === 2), 'Hub soubory hned vidí');

    // Vyměnit: soubory položky dostanou další kandidáty, staré už nepřijdou.
    await t.volat('/api/zvuk/sada/doplnit', { metoda: 'POST', telo: { cil: 'nahodne/tabor/kun', vymenit: true } });
    await dokud(async () => !(await t.volat('/api/zvuk')).data.sada.prubeh.bezi, 5000);
    assert.match(await fs.readFile(path.join(t.audio, 'nahodne', 'tabor', 'kun-1.mp3'), 'utf8'), /^mp3 102 /);
    assert.match(await fs.readFile(path.join(t.audio, 'nahodne', 'tabor', 'kun-2.mp3'), 'utf8'), /^mp3 103 /);
    const z2 = JSON.parse(await fs.readFile(path.join(t.audio, 'zdroje.json'), 'utf8'));
    assert.deepEqual(z2.vynechane['nahodne/tabor/kun'].sort(), ['fs:100', 'fs:101']);
    // Nic nechybí: doplnit nic nedělá.
    assert.equal((await t.volat('/api/zvuk/sada/doplnit', { metoda: 'POST', telo: {} })).data.celkem, 0);
  } finally {
    await t.zastavit();
  }
});

test('Openverse: bez klíče, jiné přípony, délka a licence, Freesound se neopakuje; odmítnutý klíč nezastaví ostatní', async () => {
  const ov = (id, z) => ({
    id,
    title: `zvuk ${id}`,
    creator: `tvurce-${id}`,
    license: 'cc0',
    duration: 3000,
    filetype: 'ogg',
    source: 'wikimedia_audio',
    url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${id}.ogg`,
    foreign_landing_url: `https://commons.wikimedia.org/wiki/File:${id}.ogg`,
    ...z,
  });
  const openverse = [
    ov('fs-dup', { foreign_landing_url: 'https://freesound.org/people/autor0/sounds/100/', url: 'https://cdn.freesound.org/previews/0/100-hq.mp3', filetype: 'mp3' }),
    ov('dlouhy', { duration: 60000 }),
    ov('licence-by', { license: 'by' }),
    ov('zly-host', { url: 'https://example.com/zly.ogg' }),
    ov('kun-ov-1'),
    ov('kun-ov-2', { license: 'pdm', filetype: 'mp3', url: 'https://upload.wikimedia.org/x/kun-ov-2.mp3' }),
  ];
  const t = await spustitHub(falesnyFreesound({ status: 401, openverse }));
  try {
    await t.volat('/api/zvuk/sada/doplnit', { metoda: 'POST', telo: { cil: 'nahodne/tabor/kun' } });
    await dokud(async () => !(await t.volat('/api/zvuk')).data.sada.prubeh.bezi, 5000);
    let s = (await t.volat('/api/zvuk')).data.sada;
    assert.match(s.prubeh.chyba, /odmítl klíč/, 'chyba Freesoundu se ukáže');
    assert.equal(s.polozky[0].chybi, 0, 'Openverse doplnil i tak');
    // fs:100 přes Openverse prošel (Freesound přímo odmítl klíč); dlouhý, CC BY a cizí host ne.
    const z = JSON.parse(await fs.readFile(path.join(t.audio, 'zdroje.json'), 'utf8')).soubory;
    assert.deepEqual([z['nahodne/tabor/kun-1.mp3'].id, z['nahodne/tabor/kun-2.mp3'].id], ['fs:100', 'ov:kun-ov-1']);
    assert.equal(z['nahodne/tabor/kun-2.mp3'].soubor, 'nahodne/tabor/kun-2.ogg', 'přípona podle souboru');
    assert.match(z['nahodne/tabor/kun-2.mp3'].zdroj, /^Openverse \(wikimedia_audio\)/);
    await fs.access(path.join(t.audio, 'nahodne', 'tabor', 'kun-2.ogg'));
    assert.equal(s.polozky[0].soubory[1].skutecny, 'nahodne/tabor/kun-2.ogg');

    // Vyměnit: místo ogg přijde mp3 a starý ogg zmizí (ve složce nejsou dva).
    await t.volat('/api/zvuk/sada/doplnit', { metoda: 'POST', telo: { cil: 'nahodne/tabor/kun', vymenit: true } });
    await dokud(async () => !(await t.volat('/api/zvuk')).data.sada.prubeh.bezi, 5000);
    const z2 = JSON.parse(await fs.readFile(path.join(t.audio, 'zdroje.json'), 'utf8')).soubory;
    assert.equal(z2['nahodne/tabor/kun-1.mp3'].id, 'ov:kun-ov-2');
    // Na kun-2 už další kandidát nezbyl: starý soubor zůstane a panel to napíše.
    await fs.access(path.join(t.audio, 'nahodne', 'tabor', 'kun-2.ogg'));
    assert.match((await t.volat('/api/zvuk')).data.sada.prubeh.chyba, /kun-2\.mp3: došli kandidáti/);

    // Bez klíče jde sada stahovat taky (jen Openverse).
    await t.volat('/api/nastaveni', { metoda: 'PUT', telo: { smazatFreesoundKlic: true } });
    s = (await t.volat('/api/zvuk')).data.sada;
    assert.deepEqual(s.zdroje, ['openverse']);
    assert.equal((await t.volat('/api/zvuk/sada/doplnit', { metoda: 'POST', telo: {} })).status, 200);
    await dokud(async () => !(await t.volat('/api/zvuk')).data.sada.prubeh.bezi, 5000);
    assert.equal((await t.volat('/api/nastaveni', { metoda: 'PUT', telo: { freesoundKlic: 'kratky' } })).status, 400);
  } finally {
    await t.zastavit();
  }
});

test('srovnání hlasitosti: měření ze stránky, zisk podle druhu, vypnutí a hladiny', async () => {
  const t = await spustitHub(falesnyFreesound());
  try {
    await t.volat('/api/scena/zobrazit', { metoda: 'POST', telo: { misto: 'les' } });
    let s = (await t.volat('/api/zvuk?pro=stranka')).data;
    const k = s.zmerit.find((x) => x.soubor === 'dest.mp3');
    assert.ok(k, 'nezměřený soubor jde stránce k měření');
    assert.equal(s.ambient[0].zisk, undefined);
    assert.equal((await t.volat('/api/zvuk/mereni', { metoda: 'POST', telo: { soubor: 'dest.mp3', klic: 'jiny', lufs: -30 } })).data.ok, false);
    assert.equal((await t.volat('/api/zvuk/mereni', { metoda: 'POST', telo: { soubor: '../ven.mp3', klic: 'x', lufs: -30 } })).status, 404);
    await t.volat('/api/zvuk/mereni', { metoda: 'POST', telo: { soubor: 'dest.mp3', klic: k.klic, lufs: -30, spicka: 0.2, zacatek: 0.4, konec: 5, delka: 5 } });
    s = (await t.volat('/api/zvuk?pro=stranka')).data;
    assert.equal(s.ambient[0].zisk, 1.995, 'ambient −24 LUFS: +6 dB');
    assert.equal(s.ambient[0].zacatek, undefined, 'ambient začíná od začátku');
    assert.equal(s.zmerit.some((x) => x.soubor === 'dest.mp3'), false);
    const panel = (await t.volat('/api/zvuk')).data.srovnani;
    assert.equal(panel.zmereno, 1);
    await t.volat('/api/zvuk', { metoda: 'PUT', telo: { hladiny: { ambient: -30 } } });
    assert.equal((await t.volat('/api/zvuk?pro=stranka')).data.ambient[0].zisk, undefined, 'na hladině = beze změny');
    assert.equal((await t.volat('/api/zvuk', { metoda: 'PUT', telo: { hladiny: { ambient: -80 } } })).status, 400);
    await t.volat('/api/zvuk', { metoda: 'PUT', telo: { hladiny: { ambient: -24 }, srovnat: false } });
    assert.equal((await t.volat('/api/zvuk?pro=stranka')).data.ambient[0].zisk, undefined, 'vypnuté srovnání');
    // Efekt (hrom, soundboard) dostane zisk i začátek bez ticha.
    await t.volat('/api/zvuk', { metoda: 'PUT', telo: { srovnat: true } });
    const efekty = [];
    t.hub.zvuk.on('efekt', (e) => efekty.push(e));
    await t.volat('/api/zvuk/efekt', { metoda: 'POST', telo: { soubor: 'dest.mp3' } });
    assert.equal(efekty[0].zisk, 3.981, 'efekty −18 LUFS: +12 dB (strop 4×, špička by snesla 5×)');
    assert.equal(efekty[0].zacatek, 0.4, 'ticho na začátku se přeskočí');
  } finally {
    await t.zastavit();
  }
});

/** Malý ZIP pro testy: jedna položka uložená, ostatní deflate (jako balíčky Kenney). */
async function vytvoritZip(soubory) {
  const zlib = await import('node:zlib');
  const mistni = [];
  const centralni = [];
  let offset = 0;
  Object.entries(soubory).forEach(([nazev, obsah], i) => {
    const data = Buffer.from(obsah);
    const metoda = i === 0 ? 0 : 8;
    const komprimovano = metoda ? zlib.deflateRawSync(data) : data;
    const jmeno = Buffer.from(nazev);
    const crc = zlib.crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(metoda, 8);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(komprimovano.length, 18);
    h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(jmeno.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(metoda, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(komprimovano.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(jmeno.length, 28);
    c.writeUInt32LE(offset, 42);
    mistni.push(h, jmeno, komprimovano);
    centralni.push(c, jmeno);
    offset += 30 + jmeno.length + komprimovano.length;
  });
  const cd = Buffer.concat(centralni);
  const konec = Buffer.alloc(22);
  konec.writeUInt32LE(0x06054b50, 0);
  konec.writeUInt16LE(Object.keys(soubory).length, 8);
  konec.writeUInt16LE(Object.keys(soubory).length, 10);
  konec.writeUInt32LE(cd.length, 12);
  konec.writeUInt32LE(offset, 16);
  return Buffer.concat([...mistni, cd, konec]);
}

test('dotazy: náhradní a zkrácené, nikdy pod dvě slova', async () => {
  const { dotazyPolozky, Kenney } = await import('../server/zvuky-sada.js');
  assert.deepEqual(dotazyPolozky({ hledat: 'war drum hit' }), ['war drum hit', 'war drum', 'drum hit']);
  assert.deepEqual(dotazyPolozky({ hledat: 'war cry' }), ['war cry']);
  assert.deepEqual(dotazyPolozky({ dotazy: ['lute strum', 'harp'] }), ['lute strum', 'harp']);
  const html = '<a href="https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip">Download</a>';
  assert.equal(Kenney.odkazZip(html, 'rpg-audio'), 'https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip');
  assert.equal(Kenney.odkazZip(html, 'jiny'), null);
});

test('ZIP: seznam položek a rozbalení uložené i deflate položky', async () => {
  const { polozkyZip, rozbalit } = await import('../server/zip.js');
  const zip = await vytvoritZip({ 'License.txt': 'CC0', 'Audio/chop.ogg': 'OggS sekani'.repeat(100), 'Audio/creak1.ogg': 'OggS vrz' });
  const p = polozkyZip(zip);
  assert.deepEqual(p.map((x) => x.nazev), ['License.txt', 'Audio/chop.ogg', 'Audio/creak1.ogg']);
  assert.equal(rozbalit(zip, p[1]).toString(), 'OggS sekani'.repeat(100));
  assert.equal(rozbalit(zip, p[0]).toString(), 'CC0');
  assert.throws(() => polozkyZip(Buffer.from('není zip')), /není ZIP/);
});

test('balíček Kenney: stáhne ZIP jednou do baliky/, vybere soubory podle jména a dál pracuje lokálně', async () => {
  const zip = await vytvoritZip({ 'License.txt': 'CC0 '.repeat(300), 'Audio/doorOpen_1.ogg': 'OggS dvere 1 '.repeat(80), 'Audio/doorOpen_2.ogg': 'OggS dvere 2 '.repeat(80) });
  const volani = [];
  const f = async (adresa) => {
    volani.push(adresa);
    if (adresa === 'https://kenney.nl/assets/rpg-audio') {
      return { ok: true, status: 200, text: async () => '<a href="https://kenney.nl/media/pages/assets/rpg-audio/abc123-1/kenney_rpg-audio.zip">Download</a>' };
    }
    if (adresa.endsWith('kenney_rpg-audio.zip')) return { ok: true, status: 200, arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.length) };
    return { ok: true, status: 200, json: async () => ({ results: [] }) };
  };
  const t = await spustitHub({ f });
  try {
    await fs.writeFile(
      path.join(t.repo.c.kampan, 'zvuky-sada.yaml'),
      'zvuky:\n  jednorazove/predmety/dvere: { balik: kenney/rpg-audio, soubory: [doorOpen_1, DOOROPEN_2] }\n  jednorazove/predmety/chybi: { balik: kenney/rpg-audio, soubory: [nic] }\n',
    );
    await t.hub.zvuk.nacistSadu();
    const r = await t.volat('/api/zvuk/sada/doplnit', { metoda: 'POST', telo: {} });
    assert.equal(r.data.celkem, 3);
    await dokud(async () => !(await t.volat('/api/zvuk')).data.sada.prubeh.bezi, 5000);
    const s = (await t.volat('/api/zvuk')).data.sada;
    assert.match(s.prubeh.chyba, /v balíčku rpg-audio není „nic“/);
    assert.match(await fs.readFile(path.join(t.audio, 'jednorazove', 'predmety', 'dvere-2.ogg'), 'utf8'), /^OggS dvere 2 /);
    await fs.access(path.join(t.audio, 'baliky', 'kenney_rpg-audio.zip'));
    const z = JSON.parse(await fs.readFile(path.join(t.audio, 'zdroje.json'), 'utf8')).soubory['jednorazove/predmety/dvere-1.mp3'];
    assert.deepEqual([z.autor, z.licence, z.zdroj, z.soubor], ['Kenney', 'CC0', 'Kenney (rpg-audio)', 'jednorazove/predmety/dvere-1.ogg']);
    assert.ok(s.polozky[0].balik.startsWith('Kenney: rpg-audio'));
    assert.ok(t.hub.zvuk.knihovna.jednorazove.some((g) => g.id === 'jednorazove/predmety/dvere' && g.soubory.length === 2));
    // Podruhé už se nic nestahuje: ZIP je ve složce.
    const pred = volani.filter((a) => a.includes('kenney.nl')).length;
    await fs.rm(path.join(t.audio, 'jednorazove', 'predmety', 'dvere-1.ogg'));
    await t.volat('/api/zvuk/prohledat', { metoda: 'POST', telo: {} });
    await t.volat('/api/zvuk/sada/doplnit', { metoda: 'POST', telo: { cil: 'jednorazove/predmety/dvere' } });
    await dokud(async () => !(await t.volat('/api/zvuk')).data.sada.prubeh.bezi, 5000);
    await fs.access(path.join(t.audio, 'jednorazove', 'predmety', 'dvere-1.ogg'));
    assert.equal(volani.filter((a) => a.includes('kenney.nl')).length, pred);
    // Vyměnit u balíčku nejde: mění se jméno v sadě.
    assert.equal((await t.volat('/api/zvuk/sada/doplnit', { metoda: 'POST', telo: { cil: 'jednorazove/predmety/dvere', vymenit: true } })).status, 400);
  } finally {
    await t.zastavit();
  }
});
