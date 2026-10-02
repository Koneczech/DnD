// Git: stav lokálního klonu, kontrola novějších změn na GitHubu a Stáhnout změny.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const spust = promisify(execFile);

export async function git(koren, argumenty, { timeout = 30000 } = {}) {
  const { stdout } = await spust('git', argumenty, {
    cwd: koren,
    timeout,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return stdout.trim();
}

export class Git {
  constructor(koren) {
    this.koren = koren;
    this.stav = { dostupny: null, vetev: null, zmeneno: 0, pozadu: 0, napred: 0, upstream: null, chyba: null, kontrolovano: null };
  }

  /** Lokální stav bez sítě. */
  async lokalniStav() {
    try {
      await git(this.koren, ['rev-parse', '--git-dir']);
      let vetev;
      try {
        vetev = await git(this.koren, ['symbolic-ref', '--short', '-q', 'HEAD']);
      } catch {
        vetev = 'HEAD'; // odpojená HEAD
      }
      const porcelain = await git(this.koren, ['status', '--porcelain']);
      let upstream = null;
      try {
        upstream = await git(this.koren, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
      } catch {
        upstream = null;
      }
      Object.assign(this.stav, {
        dostupny: true,
        vetev,
        upstream,
        zmeneno: porcelain ? porcelain.split('\n').length : 0,
        chyba: null,
      });
    } catch (e) {
      Object.assign(this.stav, {
        dostupny: false,
        chyba: e.code === 'ENOENT' ? 'Git není nainstalovaný nebo není v PATH.' : 'Složka není Git repozitář.',
      });
    }
    return this.stav;
  }

  /** Stáhne informace z GitHubu (git fetch) a spočítá, o kolik commitů je klon pozadu. */
  async zkontrolovatVzdaleny() {
    await this.lokalniStav();
    if (!this.stav.dostupny || !this.stav.upstream) return this.stav;
    try {
      await git(this.koren, ['fetch', '--quiet']);
      const [pozadu, napred] = (await git(this.koren, ['rev-list', '--left-right', '--count', '@{u}...HEAD'])).split(/\s+/).map(Number);
      Object.assign(this.stav, { pozadu, napred, chyba: null, kontrolovano: new Date().toISOString() });
    } catch {
      this.stav.chyba = 'GitHub není dostupný (bez internetu nebo bez přihlášení). Pracuje se s lokální kopií.';
    }
    return this.stav;
  }

  /**
   * Uložit do GitHubu: commit dat kampaně (jen složka kampan/) a push.
   * Kód Hubu ani nic jiného se tímto tlačítkem necommituje.
   * @returns {Promise<{commit:boolean, push:boolean, zprava:string}>}
   */
  async ulozit(zprava, cesty = ['kampan']) {
    await this.lokalniStav();
    if (!this.stav.dostupny) throw Object.assign(new Error(this.stav.chyba || 'Git není dostupný.'), { status: 409 });
    await git(this.koren, ['add', '--', ...cesty]);
    const zmeny = await git(this.koren, ['diff', '--cached', '--name-only', '--', ...cesty]);
    let commit = false;
    if (zmeny) {
      try {
        await git(this.koren, ['commit', '-q', '-m', zprava, '--', ...cesty], { timeout: 60000 });
        commit = true;
      } catch (e) {
        const vystup = String(e.stderr || e.stdout || e.message).trim();
        const duvod = /DM Hub: commit zastaven/.test(vystup)
          ? `Commit zastavil hook, repo je veřejné: ${vystup.split('\n').filter((r) => /^\s{2}\S/.test(r)).map((r) => r.trim()).join('; ')}`
          : /user\.(name|email)|Author identity/i.test(vystup)
            ? 'Git neví, kdo commituje. Nastav git config user.name a user.email.'
            : `Commit se nepodařil: ${vystup.split('\n')[0]}`;
        throw Object.assign(new Error(duvod), { status: 409 });
      }
    }
    let push = false;
    let chybaPush = null;
    if (this.stav.upstream) {
      try {
        await git(this.koren, ['push', '--quiet'], { timeout: 60000 });
        push = true;
      } catch {
        chybaPush = 'Uloženo jen lokálně, odeslání na GitHub se nepodařilo (internet nebo přihlášení). Zkus Uložit znovu později.';
      }
    } else {
      chybaPush = 'Větev nemá vzdálenou větev na GitHubu; uloženo jen lokálně.';
    }
    await this.lokalniStav();
    return { commit, push, chybaPush, zmeneno: zmeny ? zmeny.split('\n').length : 0 };
  }

  /** Stáhnout změny: jen fast-forward, aby se nikdy nic nepřepsalo. */
  async stahnout() {
    await this.lokalniStav();
    if (!this.stav.upstream) throw Object.assign(new Error('Větev nemá nastavenou vzdálenou větev na GitHubu.'), { status: 409 });
    try {
      await git(this.koren, ['pull', '--ff-only', '--quiet']);
    } catch (e) {
      const zprava = String(e.stderr || e.message);
      const duvod = /local changes|would be overwritten/i.test(zprava)
        ? 'Máš neuložené změny ve stejných souborech. Ulož je do GitHubu, pak stáhni.'
        : /Not possible to fast-forward|diverged/i.test(zprava)
          ? 'Lokální a GitHubová verze se rozešly. Je potřeba je sloučit ručně.'
          : 'Stažení se nepodařilo. Zkontroluj připojení a přihlášení ke GitHubu.';
      throw Object.assign(new Error(duvod), { status: 409 });
    }
    return this.zkontrolovatVzdaleny();
  }
}
