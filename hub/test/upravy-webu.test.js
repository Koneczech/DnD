// Úpravy kánonu z čtecí verze (⚠ bod 148): GitHub API je tu falešné, v paměti.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubSoubory, vytvoritUpravyWebu, doBase64, zBase64 } from '../sdilene/upravy-webu.js';
import { nacistEntitu, vPohledu, textKarty } from '../sdilene/karta-kanonu.js';

const SOUBOR = 'kampan/npc/dorn/dorn.md';
const KARTA = [
  '---', 'schema: 1', 'id: dorn', 'typ: npc', 'nazev: "Dorn Žlutý"', 'verejne: false', 'aliases: []', 'tags: []', '---',
  '# Dorn Žlutý', '', '## Co ví družina', '', '- Trpaslík. %%zná%%', '- Dluží Bruně.', '', '## Příběh', '', 'Kovář z Mirabaru.', '',
].join('\n');
const TUSKER = ['---', 'schema: 1', 'id: tusker', 'typ: postava', 'nazev: Tusker', 'verejne: true', '---', '# Tusker', ''].join('\n');

/** Falešné GitHub contents API: soubory v mapě, sha = počítadlo verzí. */
function falesnyGitHub(soubory) {
  const stav = new Map(Object.entries(soubory).map(([k, v]) => [k, { text: v, sha: 'v1' }]));
  const zapisy = [];
  let verze = 1;
  const fetch = async (url, { method, headers, body }) => {
    assert.match(headers.Authorization, /^Bearer test-/);
    const cesta = decodeURIComponent(new URL(url).pathname.replace('/repos/Ukazka/Repo/contents/', ''));
    const soubor = stav.get(cesta);
    const odpoved = (status, data) => ({ ok: status < 300, status, json: async () => data });
    if (!soubor) return odpoved(404, { message: 'Not Found' });
    if (method === 'GET') return odpoved(200, { sha: soubor.sha, content: doBase64(soubor.text).replace(/(.{60})/g, '$1\n') });
    const data = JSON.parse(body);
    if (data.sha !== soubor.sha) return odpoved(409, { message: `${cesta} does not match ${data.sha}` });
    soubor.text = zBase64(data.content);
    soubor.sha = `v${++verze}`;
    zapisy.push({ cesta, zprava: data.message, vetev: data.branch });
    return odpoved(200, { content: { sha: soubor.sha } });
  };
  return { fetch, stav, zapisy, zmenitJinde: (cesta, text) => Object.assign(stav.get(cesta), { text, sha: `v${++verze}` }) };
}

function priprava() {
  const gh = falesnyGitHub({ [SOUBOR]: KARTA, 'kampan/postavy/tusker/tusker.md': TUSKER });
  const token = `test-${Math.random().toString(36).slice(2)}`;
  const soubory = new GitHubSoubory({ repo: 'Ukazka/Repo', token: () => token, fetch: gh.fetch });
  const entity = [
    nacistEntitu(KARTA, { slozka: 'npc', soubor: SOUBOR, slozkaEntity: true }),
    nacistEntitu(TUSKER, { slozka: 'postavy', soubor: 'kampan/postavy/tusker/tusker.md', slozkaEntity: true }),
  ];
  const balik = {
    seznam: { verze: 1, entity: entity.map((e) => ({ ...vPohledu(e, 'dm', () => null), obrazek: 'web/obrazek.png' })) },
    karty: Object.fromEntries(entity.map((e) => [e.id, { ...vPohledu(e, 'dm', () => null), ...textKarty(e, 'dm'), udalosti: [{ id: 'u1' }] }])),
  };
  let zmen = 0;
  const api = vytvoritUpravyWebu({ soubory, balik: () => balik, poZmene: () => zmen++ });
  return { gh, api, balik, zmen: () => zmen };
}

test('base64: diakritika a emoji tam a zpátky', () => {
  const text = 'Příliš žluťoučký kůň 🐴\n';
  assert.equal(zBase64(doBase64(text)), text);
});

test('editor: načte text z GitHubu a uloží text i pole jedním commitem', async () => {
  const { gh, api, balik, zmen } = priprava();
  const z = await api('/api/kanon/entita/dorn/zdroj');
  assert.equal(z.hash, 'v1');
  assert.equal(z.pole.nazev, 'Dorn Žlutý');
  assert.match(z.telo, /^# Dorn Žlutý/);
  const r = await api('/api/kanon/entita/dorn/zdroj', { metoda: 'PUT', telo: { telo: z.telo.replace('Kovář', 'Zbrojíř'), zaklad: z.hash, pole: { nazev: 'Dorn' } } });
  assert.equal(r.vysledek, 'ulozeno');
  assert.equal(r.hash, 'v2');
  const text = gh.stav.get(SOUBOR).text;
  assert.match(text, /Zbrojíř z Mirabaru/);
  assert.match(text, /^nazev: "Dorn"$/m);
  assert.match(text, /^schema: 1$/m, 'zbytek hlavičky zůstal');
  assert.deepEqual(gh.zapisy, [{ cesta: SOUBOR, zprava: 'Web: Dorn Žlutý (text karty)', vetev: 'main' }]);
  // Seznam a karta se obnoví hned, obrázky a dopočítané části zůstanou ze sestavení.
  assert.equal(balik.seznam.entity[0].nazev, 'Dorn');
  assert.equal(balik.seznam.entity[0].obrazek, 'web/obrazek.png');
  assert.match(balik.karty.dorn.telo, /Zbrojíř/);
  assert.deepEqual(balik.karty.dorn.udalosti, [{ id: 'u1' }]);
  assert.equal(zmen(), 1);
  // Další uložení navazuje na novou verzi (sha z odpovědi), i když GitHub chvíli vrací starou.
  gh.stav.get(SOUBOR).sha = 'v1';
  gh.stav.get(SOUBOR).text = KARTA;
  const z2 = await api('/api/kanon/entita/dorn/zdroj');
  assert.equal(z2.hash, 'v2', 'vlastní zápis se nepřepíše opožděnou kopií');
});

test('editor: karta změněná jinde se nepřepíše, nabídne konflikt', async () => {
  const { gh, api } = priprava();
  const z = await api('/api/kanon/entita/dorn/zdroj');
  gh.zmenitJinde(SOUBOR, KARTA.replace('Kovář', 'Pekař'));
  await assert.rejects(api('/api/kanon/entita/dorn/zdroj', { metoda: 'PUT', telo: { telo: 'nový text\n', zaklad: z.hash } }), (e) => {
    assert.equal(e.kod, 'konflikt');
    assert.match(e.telo, /Pekař/);
    return true;
  });
  assert.match(gh.stav.get(SOUBOR).text, /Pekař/, 'nic se nepřepsalo');
  const r = await api('/api/kanon/entita/dorn/zdroj', { metoda: 'PUT', telo: { telo: 'nový text\n', zaklad: z.hash, prepsat: true } });
  assert.equal(r.vysledek, 'ulozeno');
  assert.match(gh.stav.get(SOUBOR).text, /---\nnový text\n$/);
});

test('rychlé úpravy: Družina zná, Ve hře, přezdívky a odrážky Co ví družina', async () => {
  const { gh, api, balik } = priprava();
  let r = await api('/api/kanon/entita/dorn', { metoda: 'PUT', telo: { verejne: true } });
  assert.equal(r.karta.verejne, true);
  assert.match(gh.stav.get(SOUBOR).text, /^verejne: true$/m);
  r = await api('/api/kanon/entita/dorn', { metoda: 'PUT', telo: { aktualni: true } });
  assert.equal(balik.seznam.entity[0].aktualni, true);
  r = await api('/api/kanon/entita/dorn', { metoda: 'PUT', telo: { aliases: ['Žlutý'] } });
  assert.deepEqual(r.karta.aliases, ['Žlutý']);
  r = await api('/api/kanon/entita/dorn/druzina/1', { metoda: 'PUT', telo: { zna: true } });
  assert.match(gh.stav.get(SOUBOR).text, /- Dluží Bruně\. %%zná%%/);
  assert.equal(r.karta.druzina.filter((b) => b.zna).length, 2);
  r = await api('/api/kanon/entita/dorn/druzina', { metoda: 'POST', telo: { text: 'Má dceru.', zna: false } });
  assert.match(gh.stav.get(SOUBOR).text, /- Má dceru\.\n/);
  assert.equal(gh.zapisy.length, 5);
  assert.deepEqual(gh.zapisy.map((z) => z.zprava.replace(/^Web: Dorn Žlutý /, '')), ['(družina zná)', '(ve hře)', '(přezdívky)', '(odkryto v Co ví družina)', '(nová odrážka Co ví družina)']);
});

test('oko u odstavce textu karty (rozhodnutí 75)', async () => {
  const { gh, api } = priprava();
  const r = await api('/api/kanon/entita/dorn/text', { metoda: 'PUT', telo: { prvni: 'Kovář z Mirabaru.', poradi: 0, zna: true } });
  assert.equal(r.vysledek, 'ulozeno');
  assert.match(gh.stav.get(SOUBOR).text, /Kovář z Mirabaru\. %%zná%%/);
  assert.deepEqual(gh.zapisy.map((z) => z.zprava), ['Web: Dorn Žlutý (odkryt odstavec)']);
  await assert.rejects(api('/api/kanon/entita/dorn/text', { metoda: 'PUT', telo: { prvni: 'Nic takového.', zna: true } }), /odstavec v kartě není/);
});

test('rychlá úprava se souběžnou změnou jinde: počítá se znovu z nové verze', async () => {
  const { gh } = priprava();
  const puvodniFetch = gh.fetch;
  let jednou = true;
  // Mezi čtením a zápisem kartu změní někdo jiný (Hub doma).
  const soubory = new GitHubSoubory({
    repo: 'Ukazka/Repo', token: () => 'test-x', fetch: async (url, o) => {
      if (o.method === 'PUT' && jednou) {
        jednou = false;
        gh.zmenitJinde(SOUBOR, KARTA.replace('Kovář', 'Pekař'));
      }
      return puvodniFetch(url, o);
    },
  });
  const balik = { seznam: { entity: [{ ...vPohledu(nacistEntitu(KARTA, { slozka: 'npc', soubor: SOUBOR, slozkaEntity: true }), 'dm', () => null) }] }, karty: { dorn: {} } };
  const api2 = vytvoritUpravyWebu({ soubory, balik: () => balik });
  const r = await api2('/api/kanon/entita/dorn', { metoda: 'PUT', telo: { verejne: true } });
  assert.equal(r.vysledek, 'ulozeno');
  const text = gh.stav.get(SOUBOR).text;
  assert.match(text, /Pekař/, 'cizí změna zůstala');
  assert.match(text, /^verejne: true$/m, 'moje změna je v ní');
});

test('chyby: bez tokenu, neplatná hodnota, cizí adresa', async () => {
  const { api } = priprava();
  await assert.rejects(api('/api/kanon/entita/dorn', { metoda: 'PUT', telo: { verejne: 'ano' } }), /verejne musí být/);
  await assert.rejects(api('/api/kanon/entita/dorn/zdroj', { metoda: 'PUT', telo: { pole: { nazev: '' }, zaklad: 'v1' } }), /potřebuje název/);
  await assert.rejects(api('/api/kanon/entita/nikdo/zdroj'), /v kánonu není/);
  assert.equal(await api('/api/kanon/entity', { metoda: 'POST', telo: {} }), undefined, 'nová karta zůstává Hubu');
  const bez = vytvoritUpravyWebu({ soubory: new GitHubSoubory({ repo: 'Ukazka/Repo', token: () => '', fetch: () => assert.fail('bez tokenu se nevolá') }), balik: () => ({ seznam: { entity: [{ id: 'dorn', soubor: SOUBOR }] }, karty: {} }) });
  await assert.rejects(bez('/api/kanon/entita/dorn/zdroj'), (e) => e.kod === 'token');
});
