// Sloučit rozešlé verze (Blok 2b): lokální commity a novinky na GitHubu se nesmí ztratit ani přepsat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Git, git } from '../server/git.js';

// Autor commitů v dočasných repozitářích (testy nesahají na globální nastavení Gitu).
Object.assign(process.env, {
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
});

/** Na Windows může Git při checkoutu vyměnit konce řádků (autocrlf), proto se čte s normalizací. */
async function precist(koren, relativni) {
  return (await fs.readFile(path.join(koren, ...relativni.split('/')), 'utf8')).replace(/\r\n/g, '\n');
}

async function zapsat(koren, relativni, text) {
  const cil = path.join(koren, ...relativni.split('/'));
  await fs.mkdir(path.dirname(cil), { recursive: true });
  await fs.writeFile(cil, text);
}

/** Vzdálený repozitář a dva klony (A = „GitHub strana“, B = Hub). Obě strany mají společný první commit. */
async function dvaKlony() {
  const koren = await fs.mkdtemp(path.join(os.tmpdir(), 'dmhub-sloucit-'));
  const vzdaleny = path.join(koren, 'origin.git');
  const a = path.join(koren, 'a');
  const b = path.join(koren, 'b');
  await fs.mkdir(vzdaleny);
  await git(vzdaleny, ['init', '--bare', '-q', '-b', 'main']);
  await git(koren, ['clone', '-q', vzdaleny, 'a']);
  await git(a, ['checkout', '-q', '-B', 'main']);
  await zapsat(a, 'kampan/stav.md', 'datum: 1\n');
  await git(a, ['add', '.']);
  await git(a, ['commit', '-q', '-m', 'základ']);
  await git(a, ['push', '-q', '-u', 'origin', 'main']);
  await git(koren, ['clone', '-q', vzdaleny, 'b']);
  return { koren, a, b, smazat: () => fs.rm(koren, { recursive: true, force: true }) };
}

async function ulozit(klon, relativni, text, zprava, { push = false } = {}) {
  await zapsat(klon, relativni, text);
  await git(klon, ['add', '.']);
  await git(klon, ['commit', '-q', '-m', zprava]);
  if (push) await git(klon, ['push', '-q']);
}

test('sloučení čistě rozešlých verzí: lokální commit se přiskládá za novinky a odešle', async () => {
  const k = await dvaKlony();
  try {
    await ulozit(k.a, 'hub/novy.js', 'z GitHubu\n', 'novinka', { push: true });
    await ulozit(k.b, 'kampan/poznamka.md', 'moje\n', 'data', {});
    const hub = new Git(k.b);
    const vychozi = await hub.zkontrolovatVzdaleny();
    assert.equal(vychozi.pozadu, 1);
    assert.equal(vychozi.napred, 1);
    await assert.rejects(hub.stahnout(), /Sloučit/, 'Stáhnout změny rozešlé verze nesloučí, ale pošle na Sloučit');

    const r = await hub.sloucit();
    assert.equal(r.sloucene, true);
    assert.equal(r.push, true);
    assert.equal(r.uschovna, false);
    assert.equal(hub.stav.pozadu, 0);
    assert.equal(hub.stav.napred, 0);
    assert.equal(await precist(k.b, 'hub/novy.js'), 'z GitHubu\n');
    assert.equal(await precist(k.b, 'kampan/poznamka.md'), 'moje\n');
    // Druhá strana vidí obojí.
    await git(k.a, ['pull', '-q', '--ff-only']);
    assert.equal(await precist(k.a, 'kampan/poznamka.md'), 'moje\n');
  } finally {
    await k.smazat();
  }
});

test('sloučení s rozdělanou prací: nic se neztratí, ani když soubor existuje i na GitHubu', async () => {
  const k = await dvaKlony();
  try {
    await ulozit(k.a, 'hub/novy.js', 'z GitHubu\n', 'novinka', { push: true });
    await ulozit(k.b, 'kampan/poznamka.md', 'moje\n', 'data', {});
    // Skutečný případ z provozu: neuložená kopie souboru, který mezitím přibyl na GitHubu, a rozdělaná data.
    await zapsat(k.b, 'hub/novy.js', 'moje neuložená kopie\n');
    await zapsat(k.b, 'kampan/stav.md', 'datum: 2\n');

    const hub = new Git(k.b);
    const r = await hub.sloucit();
    assert.equal(r.sloucene, true);
    assert.equal(r.uschovna, true);
    assert.equal(await precist(k.b, 'hub/novy.js'), 'z GitHubu\n', 'platí verze z GitHubu');

    const uschovna = await git(k.b, ['stash', 'list']);
    const rozdelanaPrace = await precist(k.b, 'kampan/stav.md').catch(() => '');
    // Buď se rozdělaná data vrátila do složky, nebo zůstala v úschovně. Ztratit se nesmí ani jedno.
    assert.ok(rozdelanaPrace === 'datum: 2\n' || /dm-hub-pred-slucovanim/.test(uschovna), 'rozdělaná data nesmí zmizet');
    if (r.uschovnaNevracena) assert.match(uschovna, /dm-hub-pred-slucovanim/);
  } finally {
    await k.smazat();
  }
});

test('sloučení s konfliktem: vrátí vše zpět a řekne, který soubor to je', async () => {
  const k = await dvaKlony();
  try {
    await ulozit(k.a, 'kampan/stav.md', 'datum: z GitHubu\n', 'změna na GitHubu', { push: true });
    await ulozit(k.b, 'kampan/stav.md', 'datum: u mě\n', 'změna u mě', {});
    await zapsat(k.b, 'kampan/rozdelane.md', 'rozdělané\n');
    const hlava = await git(k.b, ['rev-parse', 'HEAD']);

    const hub = new Git(k.b);
    await assert.rejects(hub.sloucit(), (e) => e.status === 409 && /stav\.md/.test(e.message) && /Nic se nezměnilo/.test(e.message));

    assert.equal(await git(k.b, ['rev-parse', 'HEAD']), hlava, 'místní commit zůstal na místě');
    await assert.rejects(fs.access(path.join(k.b, '.git', 'rebase-merge')), 'rebase nezůstal rozdělaný');
    await assert.rejects(fs.access(path.join(k.b, '.git', 'rebase-apply')), 'rebase nezůstal rozdělaný');
    assert.equal(await precist(k.b, 'kampan/stav.md'), 'datum: u mě\n');
    assert.equal(await precist(k.b, 'kampan/rozdelane.md'), 'rozdělané\n', 'rozdělaná práce se vrátila');
    assert.equal(await git(k.b, ['stash', 'list']), '', 'úschovna je prázdná, protože se vše vrátilo');
  } finally {
    await k.smazat();
  }
});

test('sloučení odmítne případy, kdy se verze nerozešly', async () => {
  const k = await dvaKlony();
  try {
    const hub = new Git(k.b);
    await assert.rejects(hub.sloucit(), /Není co sloučit/);
    await ulozit(k.a, 'hub/novy.js', 'x\n', 'novinka', { push: true });
    await assert.rejects(hub.sloucit(), /Stáhnout změny/);
  } finally {
    await k.smazat();
  }
});

test('sloučení: neuložená změna souboru, který se změnil i na GitHubu, nenechá značky konfliktu (audit V1)', async () => {
  const k = await dvaKlony();
  try {
    await ulozit(k.a, 'kampan/stav.md', 'datum: z GitHubu\n', 'změna na GitHubu', { push: true });
    await ulozit(k.b, 'kampan/poznamka.md', 'moje\n', 'data', {});
    await zapsat(k.b, 'kampan/stav.md', 'datum: rozdělané u mě\n');

    const hub = new Git(k.b);
    const r = await hub.sloucit();
    assert.equal(r.sloucene, true);
    assert.equal(r.uschovnaNevracena, true);
    assert.deepEqual(r.vracenoZGitHubu, ['kampan/stav.md']);
    assert.equal(await precist(k.b, 'kampan/stav.md'), 'datum: z GitHubu\n', 'platí sloučená verze, bez značek');
    assert.equal(await git(k.b, ['diff', '--name-only', '--diff-filter=U']), '', 'nic nezůstalo nesloučené');
    assert.match(await git(k.b, ['stash', 'list']), /dm-hub-pred-slucovanim/, 'rozdělaná verze je v úschovně');
  } finally {
    await k.smazat();
  }
});

test('Uložit odmítne soubor se značkami konfliktu (audit V1)', async () => {
  const k = await dvaKlony();
  try {
    const znacky = `${'<'.repeat(7)} Updated upstream\ndatum: 1\n${'='.repeat(7)}\ndatum: 2\n${'>'.repeat(7)} Stashed changes\n`;
    await zapsat(k.b, 'kampan/stav.md', znacky);
    const hub = new Git(k.b);
    await assert.rejects(hub.ulozit('test'), (e) => e.status === 409 && /značky konfliktu/.test(e.message));
    assert.equal(await git(k.b, ['diff', '--cached', '--name-only']), '', 'nic nezůstalo připravené ke commitu');
  } finally {
    await k.smazat();
  }
});

test('Uložit pozná, že GitHub je napřed, a nabídne Sloučit (audit S4)', async () => {
  const k = await dvaKlony();
  try {
    await ulozit(k.a, 'hub/novy.js', 'x\n', 'novinka', { push: true });
    await zapsat(k.b, 'kampan/poznamka.md', 'moje\n');
    const hub = new Git(k.b);
    const r = await hub.ulozit('data');
    assert.equal(r.commit, true);
    assert.equal(r.push, false);
    assert.match(r.chybaPush, /Sloučit/);
    assert.equal(hub.stav.pozadu, 1);
    assert.equal(hub.stav.napred, 1);
  } finally {
    await k.smazat();
  }
});

test('operace Gitu běží za sebou: dvojí Sloučit se nesrazí o zámek (audit S4)', async () => {
  const k = await dvaKlony();
  try {
    await ulozit(k.a, 'hub/novy.js', 'x\n', 'novinka', { push: true });
    await ulozit(k.b, 'kampan/poznamka.md', 'moje\n', 'data', {});
    const hub = new Git(k.b);
    const [prvni, druhe] = await Promise.allSettled([hub.sloucit(), hub.sloucit()]);
    assert.equal(prvni.status, 'fulfilled');
    assert.equal(druhe.status, 'rejected');
    assert.match(druhe.reason.message, /Není co sloučit|nerozešly/);
  } finally {
    await k.smazat();
  }
});
