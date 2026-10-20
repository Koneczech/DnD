// Spotify přes virtuální kabel (DM 20. 10. 2026): přihlášení, ovládání přehrávání, záloha ze složky.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Hub } from '../server/app.js';
import { Spotify, spotifyUri, platnyKlient, SPOTIFY_LUFS } from '../server/spotify.js';
import { platnaHudba, zalohaHudby } from '../server/zvuk.js';
import { Nastaveni } from '../server/nastaveni.js';
import { docasneRepo, FalesnyObs, dokud } from './pomoc.js';

// Zjevně falešné hodnoty generované za běhu (repo je veřejné).
const KLIENT = crypto.randomBytes(16).toString('hex');
const PLAYLIST_A = 'spotify:playlist:AAAAAAAAAAAAAAAAAAAAAA';
const PLAYLIST_B = 'spotify:playlist:BBBBBBBBBBBBBBBBBBBBBB';

/** Falešné Spotify: účty (token) a Web API. Zaznamená volání. */
function falesneSpotify({ zarizeni = [{ id: 'pc1', name: 'DESKTOP-TEST', type: 'Computer', is_active: false }], play = 204 } = {}) {
  const volani = [];
  const stav = { obnova: `obnova-${crypto.randomUUID()}`, zarizeni, play };
  const odpoved = (status, data) => ({ ok: status < 300, status, json: async () => data });
  const f = async (adresa, volby = {}) => {
    const u = new URL(adresa);
    const metoda = volby.method ?? 'GET';
    volani.push(`${metoda} ${u.pathname}${u.search}`);
    if (u.hostname === 'accounts.spotify.com') {
      const telo = new URLSearchParams(volby.body);
      if (telo.get('grant_type') === 'authorization_code') {
        if (telo.get('code') !== 'dobry-kod' || !telo.get('code_verifier')) return odpoved(400, { error: 'invalid_grant' });
        return odpoved(200, { access_token: 'pristup-1', refresh_token: stav.obnova, expires_in: 3600 });
      }
      if (telo.get('grant_type') === 'refresh_token') {
        if (telo.get('refresh_token') !== stav.obnova) return odpoved(400, { error: 'invalid_grant' });
        return odpoved(200, { access_token: 'pristup-2', expires_in: 3600 });
      }
      return odpoved(400, { error: 'unsupported_grant_type' });
    }
    if (!String(volby.headers?.Authorization ?? '').startsWith('Bearer pristup-')) return odpoved(401, { error: { status: 401 } });
    if (u.pathname === '/v1/me') return odpoved(200, { id: 'matej', display_name: 'Matěj' });
    if (u.pathname === '/v1/me/player/devices') return odpoved(200, { devices: stav.zarizeni });
    if (u.pathname === '/v1/me/playlists') return odpoved(200, { items: [{ uri: PLAYLIST_A, name: 'DM Hub – Souboj' }], next: null });
    if (u.pathname === '/v1/me/player/play') {
      if (stav.play === 404) return odpoved(404, { error: { status: 404, reason: 'NO_ACTIVE_DEVICE', message: 'Player command failed: No active device found' } });
      return odpoved(stav.play, null);
    }
    if (u.pathname.startsWith('/v1/me/player/')) return odpoved(204, null);
    return odpoved(404, { error: { status: 404 } });
  };
  return { f, volani, stav };
}

test('odkaz na Spotify: URI, odkaz ze Sdílet i s ?si= a /intl-cs/; nic jiného', () => {
  assert.equal(spotifyUri(PLAYLIST_A), PLAYLIST_A);
  assert.equal(spotifyUri('https://open.spotify.com/playlist/AAAAAAAAAAAAAAAAAAAAAA?si=x123'), PLAYLIST_A);
  assert.equal(spotifyUri('https://open.spotify.com/intl-cs/album/AAAAAAAAAAAAAAAAAAAAAA'), 'spotify:album:AAAAAAAAAAAAAAAAAAAAAA');
  assert.equal(spotifyUri('https://evil.example/playlist/AAAAAAAAAAAAAAAAAAAAAA'), null);
  assert.equal(spotifyUri('spotify:track:AAAAAAAAAAAAAAAAAAAAAA'), null, 'jen playlist nebo album');
  assert.ok(platnyKlient(KLIENT) && !platnyKlient('abc'));
});

test('hudba ze Spotify v datech: se zálohou ze složky, záloha se pozná všude', () => {
  assert.deepEqual(platnaHudba({ spotify: PLAYLIST_A, zaloha: 'hudba/souboj/' }), { spotify: PLAYLIST_A, zaloha: 'hudba/souboj/' });
  assert.deepEqual(platnaHudba({ spotify: 'https://open.spotify.com/playlist/AAAAAAAAAAAAAAAAAAAAAA', zaloha: ['a.mp3', 'hudba/x/'] }), { spotify: PLAYLIST_A, zaloha: ['a.mp3', 'hudba/x/'] });
  assert.deepEqual(platnaHudba(PLAYLIST_A), { spotify: PLAYLIST_A });
  assert.equal(platnaHudba({ spotify: 'nesmysl', zaloha: 'a.mp3' }), 'a.mp3', 'neplatný Spotify = jen záloha');
  assert.equal(platnaHudba({ spotify: PLAYLIST_A, zaloha: '../x/' }).zaloha, undefined);
  assert.equal(zalohaHudby({ spotify: PLAYLIST_A, zaloha: 'a.mp3' }), 'a.mp3');
  assert.equal(zalohaHudby('a.mp3'), 'a.mp3');
});

function spotifyProTest(fake, hodnoty = {}) {
  const h = { SPOTIFY_KLIENT: KLIENT, SPOTIFY_OBNOVA: '', ...hodnoty };
  const ulozene = [];
  const cekani = [];
  const sp = new Spotify({
    nastaveni: () => h,
    ulozit: async (z) => {
      ulozene.push(z);
      if (z.spotifyObnova) h.SPOTIFY_OBNOVA = z.spotifyObnova;
      if (z.smazatSpotify) h.SPOTIFY_OBNOVA = '';
    },
    port: () => 7420,
    prolnutiMs: () => 2000,
    fetch: fake.f,
    cekat: async (ms) => cekani.push(ms),
  });
  return { sp, h, ulozene, cekani };
}

test('přihlášení PKCE: adresa se státem a výzvou, kód za tokeny, obnovovací do .env, cizí stát odmítne', async () => {
  const fake = falesneSpotify();
  const { sp, h } = spotifyProTest(fake);
  assert.equal(sp.prihlaseno, false);
  const u = new URL(sp.zacitPrihlaseni());
  assert.equal(u.origin + u.pathname, 'https://accounts.spotify.com/authorize');
  assert.equal(u.searchParams.get('client_id'), KLIENT);
  assert.equal(u.searchParams.get('redirect_uri'), 'http://127.0.0.1:7420/spotify/prihlaseni');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.match(u.searchParams.get('scope'), /user-modify-playback-state/);
  await assert.rejects(sp.dokoncitPrihlaseni({ code: 'dobry-kod', state: 'cizi' }), /vypršelo nebo nepatří/);
  sp.zacitPrihlaseni();
  const state = sp.cekajici.state;
  const v = await sp.dokoncitPrihlaseni({ code: 'dobry-kod', state });
  assert.equal(h.SPOTIFY_OBNOVA, fake.stav.obnova);
  assert.equal(v.prihlaseno, true);
  assert.equal(v.uzivatel, 'Matěj');
  assert.equal(v.zarizeni, 'DESKTOP-TEST');
  assert.equal(sp.cekajici, null, 'kód jde použít jen jednou');
  await assert.rejects(sp.dokoncitPrihlaseni({ error: 'access_denied', state }), /zrušil/);
});

test('přehrávání: playlist s náhodným pořadím, přepnutí až po ztlumení, pauza, když Spotify nikdo nechce', async () => {
  const fake = falesneSpotify();
  const { sp, cekani } = spotifyProTest(fake, { SPOTIFY_OBNOVA: fake.stav.obnova });
  await sp.overit();
  assert.equal(sp.pripraveno, true);
  fake.volani.length = 0;
  sp.chci(PLAYLIST_A);
  await sp.fronta;
  assert.deepEqual(fake.volani, [
    `PUT /v1/me/player/play?device_id=pc1`,
    `PUT /v1/me/player/shuffle?device_id=pc1&state=true`,
    `POST /v1/me/player/next?device_id=pc1`,
    `PUT /v1/me/player/volume?device_id=pc1&volume_percent=100`,
  ]);
  assert.equal(sp.hraje, PLAYLIST_A);
  assert.deepEqual(cekani, [], 'první playlist hned');
  sp.chci(PLAYLIST_A);
  await sp.fronta;
  assert.equal(fake.volani.length, 4, 'stejný playlist = nic');
  // Jiný playlist: nejdřív stránka ztlumí (čekání na prolnutí), pak přepnout; hlasitost už jen jednou.
  sp.chci(PLAYLIST_B);
  await sp.fronta;
  assert.deepEqual(cekani, [2000]);
  assert.equal(sp.hraje, PLAYLIST_B);
  assert.ok(!fake.volani.slice(4).some((v) => v.includes('/volume')));
  // Nic ze Spotify: pauza až po minutě (časovač); tady rovnou krok fronty.
  sp.chci(null);
  clearTimeout(sp.casovacPauzy);
  await sp.naplanovat();
  assert.equal(fake.volani.at(-1), 'PUT /v1/me/player/pause?device_id=pc1');
  assert.equal(sp.hraje, null);
  sp.zastavit();
});

test('aplikace Spotify neběží nebo playlist nejde: chyba, selhalo (hraje záloha), propadlé přihlášení se smaže', async () => {
  const fake = falesneSpotify({ zarizeni: [] });
  const { sp, h } = spotifyProTest(fake, { SPOTIFY_OBNOVA: fake.stav.obnova });
  await sp.overit();
  assert.equal(sp.pripraveno, false);
  assert.match(sp.chyba, /neběží/);
  fake.stav.zarizeni = [{ id: 'pc1', name: 'DESKTOP-TEST', type: 'Computer' }];
  fake.stav.play = 404;
  await sp.overit();
  sp.chci(PLAYLIST_A);
  await sp.fronta;
  assert.equal(sp.selhalo, PLAYLIST_A);
  assert.equal(sp.hraje, null);
  // Obnovovací token už neplatí (DM zrušil přístup): Hub se odhlásí a řekne proč.
  fake.stav.obnova = 'jiny';
  sp.pristup = null;
  sp.uzivatel = null;
  await sp.overit();
  assert.match(sp.chyba, /Přihlas se znovu/);
  assert.equal(h.SPOTIFY_OBNOVA, '');
  assert.equal(sp.prihlaseno, false);
});

test('nastavení: Client ID se kontroluje, jiné Client ID zruší přihlášení, token jen ze serveru', async () => {
  const slozka = await fs.mkdtemp(path.join(os.tmpdir(), 'dmhub-sp-'));
  try {
    const n = await new Nastaveni(path.join(slozka, '.env')).nacist();
    await assert.rejects(n.ulozit({ spotifyKlient: 'abc' }), /32 znaků/);
    await n.ulozit({ spotifyKlient: KLIENT, spotifyObnova: 'tajne-123456' });
    assert.equal(n.verejne().spotifyPrihlaseno, true);
    assert.ok(!JSON.stringify(n.verejne()).includes('tajne-123456'), 'panel token nevidí');
    assert.ok(n.tajneHodnoty().includes('tajne-123456'), 'hook ho hlídá');
    await n.ulozit({ spotifyKlient: crypto.randomBytes(16).toString('hex') });
    assert.equal(n.verejne().spotifyPrihlaseno, false);
  } finally {
    await fs.rm(slozka, { recursive: true, force: true });
  }
});

const MISTO = `---
schema: 1
id: tabor
typ: misto
nazev: Tábor
verejne: true
ilustrace: []
zvuk:
  den: { hudba: { spotify: ${PLAYLIST_A}, zaloha: hudba/tabor/ }, ambient: les.mp3 }
---
Tělo.
`;

test('Hub: Spotify hraje přes kabel, jen když stránka u stolu kabel otevřela; jinak záloha ze složky', async () => {
  const fake = falesneSpotify();
  const repo = await docasneRepo();
  const audio = await fs.mkdtemp(path.join(os.tmpdir(), 'dmhub-sp-audio-'));
  await fs.mkdir(path.join(repo.c.kampan, 'mista', 'tabor'), { recursive: true });
  await fs.writeFile(path.join(repo.c.kampan, 'mista', 'tabor', 'tabor.md'), MISTO);
  for (const f of ['les.mp3', 'hudba/tabor/a.mp3', 'hudba/tabor/b.mp3']) {
    await fs.mkdir(path.dirname(path.join(audio, ...f.split('/'))), { recursive: true });
    await fs.writeFile(path.join(audio, ...f.split('/')), 'x');
  }
  await fs.writeFile(repo.c.env, `OBS_URL="ws://127.0.0.1:4455"\nOBS_HESLO="spravne"\nZVUK_SLOZKA=${JSON.stringify(audio)}\nSPOTIFY_KLIENT="${KLIENT}"\nSPOTIFY_OBNOVA="${fake.stav.obnova}"\n`);
  const hub = new Hub({ cesty: repo.c, obsKlient: new FalesnyObs({ heslo: 'spravne' }), gitSit: false, port: 0, ziveIniciativa: null, fetchSpotify: fake.f });
  await hub.spustit();
  const volat = async (cesta, { metoda = 'GET', telo } = {}) => {
    const r = await fetch(hub.adresa + cesta, { method: metoda, headers: telo ? { 'Content-Type': 'application/json' } : {}, body: telo ? JSON.stringify(telo) : undefined });
    return { status: r.status, data: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() };
  };
  try {
    await dokud(() => hub.spotify.pripraveno);
    await volat('/api/scena/zobrazit', { metoda: 'POST', telo: { misto: 'tabor' } });
    let z = (await volat('/api/zvuk?pro=stranka')).data;
    assert.equal(z.spotifyKabel, 'CABLE Output', 'stránka má hlídat kabel');
    assert.equal(z.hudba.playlist, true, 'bez otevřeného kabelu hraje záloha');
    assert.equal(hub.spotify.cil, null);

    // Stránka u stolu kabel otevřela: hraje Spotify (nejdřív ztlumené, pak „hraje“).
    await volat('/api/zvuk/hlaseni', { metoda: 'POST', telo: { stranka: 'stul', odemceno: true, kabel: { ok: true, nazev: 'CABLE Output (VB-Audio Virtual Cable)' } } });
    await hub.spotify.fronta;
    z = (await volat('/api/zvuk?pro=stranka')).data;
    assert.deepEqual([z.hudba.spotify, z.hudba.uri, z.hudba.hraje, z.hudba.kabel], [true, PLAYLIST_A, true, 'CABLE Output']);
    assert.equal(z.hudba.zisk, Math.round(10 ** ((-18 - SPOTIFY_LUFS) / 20) * 1000) / 1000, 'normalizace Spotify dorovnaná na hladinu hudby');
    assert.ok(fake.volani.includes('PUT /v1/me/player/play?device_id=pc1'));
    const panel = (await volat('/api/zvuk')).data.spotify;
    assert.equal(panel.hrajeTed, true);
    assert.equal(panel.kabel.nazev, 'CABLE Output (VB-Audio Virtual Cable)');

    // Hudba v OBS: kabel tam nejde, hraje záloha a Spotify dostane pokyn „nic“.
    await volat('/api/zvuk', { metoda: 'PUT', telo: { hudbaKde: 'obs' } });
    z = (await volat('/api/zvuk?pro=stranka')).data;
    assert.equal(z.hudba.playlist, true);
    assert.equal(hub.spotify.cil, null);
    await volat('/api/zvuk', { metoda: 'PUT', telo: { hudbaKde: 'stul' } });

    // Kabel přestal jít: záloha.
    await volat('/api/zvuk/hlaseni', { metoda: 'POST', telo: { stranka: 'stul', odemceno: true, kabel: { ok: false, chyba: 'nenalezen' } } });
    z = (await volat('/api/zvuk?pro=stranka')).data;
    assert.equal(z.hudba.playlist, true);

    // Playlisty pro výběr v Místa → Zvuk a uložení hudby ze Spotify k místu.
    assert.deepEqual((await volat('/api/spotify/playlisty')).data.playlisty, [{ uri: PLAYLIST_A, nazev: 'DM Hub – Souboj' }]);
    const r = await volat('/api/mista/tabor/zvuk/den', { metoda: 'PUT', telo: { hudba: { spotify: PLAYLIST_B, zaloha: 'hudba/tabor/' } } });
    assert.equal(r.status, 200);
    assert.match(await fs.readFile(path.join(repo.c.kampan, 'mista', 'tabor', 'tabor.md'), 'utf8'), /spotify: spotify:playlist:BBBBBBBBBBBBBBBBBBBBBB/);

    // Návrat z přihlášení s cizím stavem: stránka s chybou, nic se neuloží. Panel token nedostane.
    const navrat = await volat('/spotify/prihlaseni?code=x&state=cizi');
    assert.equal(navrat.status, 400);
    assert.match(navrat.data, /Spotify se nepřipojil/);
    assert.ok(!JSON.stringify((await volat('/api/nastaveni')).data).includes(fake.stav.obnova));
    const prihlasit = (await volat('/api/spotify/prihlasit', { metoda: 'POST', telo: {} })).data;
    assert.match(prihlasit.url, /^https:\/\/accounts\.spotify\.com\/authorize\?/);
  } finally {
    await hub.zastavit();
    await repo.smazat();
    await fs.rm(audio, { recursive: true, force: true });
  }
});
