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
      const vetev = await git(this.koren, ['rev-parse', '--abbrev-ref', 'HEAD']);
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
