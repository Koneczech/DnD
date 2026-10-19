// Měření hlasitosti zvukových souborů (bod 86). Stránka Zvuk u stolu soubor jednou dekóduje,
// změří a pošle výsledek Hubu; Hub pak každému souboru přidá zesílení na výchozí hladinu podle druhu.
// Soubory se nemění.
//
// Hlasitost je integrovaná hlasitost podle ITU-R BS.1770 (LUFS): K-váhový filtr, bloky 400 ms
// s překryvem 75 %, absolutní práh −70 LUFS a relativní práh −10 LU. Bez importů: modul jde
// otestovat v Node i načíst v prohlížeči.

/** Koeficienty bikvadu (a0 normalizované na 1). */
function vysokaPolice(fs) {
  const G = 3.999843853973347;
  const Q = 0.7071752369554196;
  const fc = 1681.974450955533;
  const A = 10 ** (G / 40);
  const w0 = (2 * Math.PI * fc) / fs;
  const cos = Math.cos(w0);
  const alfa = Math.sin(w0) / (2 * Q);
  const s = 2 * Math.sqrt(A) * alfa;
  const a0 = A + 1 - (A - 1) * cos + s;
  return {
    b: [(A * (A + 1 + (A - 1) * cos + s)) / a0, (-2 * A * (A - 1 + (A + 1) * cos)) / a0, (A * (A + 1 + (A - 1) * cos - s)) / a0],
    a: [(2 * (A - 1 - (A + 1) * cos)) / a0, (A + 1 - (A - 1) * cos - s) / a0],
  };
}

function horniPropust(fs) {
  const Q = 0.5003270373238773;
  const fc = 38.13547087602444;
  const w0 = (2 * Math.PI * fc) / fs;
  const cos = Math.cos(w0);
  const alfa = Math.sin(w0) / (2 * Q);
  const a0 = 1 + alfa;
  return { b: [(1 + cos) / 2 / a0, -(1 + cos) / a0, (1 + cos) / 2 / a0], a: [(-2 * cos) / a0, (1 - alfa) / a0] };
}

/** K-váhový filtr jednoho kanálu; vrací kvadráty filtrovaných vzorků. */
function kvadratyK(x, fs) {
  const f = [vysokaPolice(fs), horniPropust(fs)];
  const y = new Float32Array(x.length);
  let v = x;
  for (const { b, a } of f) {
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < v.length; i++) {
      const xi = v[i];
      const yi = b[0] * xi + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
      x2 = x1;
      x1 = xi;
      y2 = y1;
      y1 = yi;
      y[i] = yi;
    }
    v = y;
  }
  for (let i = 0; i < y.length; i++) y[i] *= y[i];
  return y;
}

const lufs = (ms) => -0.691 + 10 * Math.log10(ms);

/** Verze měření: změna výpočtu = Hub soubory změří znovu. */
export const VERZE_MERENI = 2;

/**
 * Změří vzorky.
 * @param {Float32Array[]} kanaly vzorky po kanálech (−1 až 1)
 * @param {number} fs vzorkovací kmitočet
 * @returns {{lufs:number|null, spicka:number, zacatek:number, konec:number, delka:number}}
 *   lufs null = ticho; zacatek a konec = kde začíná a končí slyšitelný zvuk (s)
 */
export function zmeritVzorky(kanaly, fs) {
  const n = kanaly[0]?.length ?? 0;
  const delka = n / fs;
  let spicka = 0;
  let prvni = -1;
  let posledni = -1;
  const PRAH_TICHA = 0.01; // −40 dBFS
  for (const k of kanaly) {
    for (let i = 0; i < n; i++) {
      const a = Math.abs(k[i]);
      if (a > spicka) spicka = a;
      if (a > PRAH_TICHA) {
        if (prvni < 0 || i < prvni) prvni = i;
        if (i > posledni) posledni = i;
      }
    }
  }
  const okraje = prvni < 0 ? { zacatek: 0, konec: delka } : { zacatek: Math.max(0, prvni / fs - 0.01), konec: Math.min(delka, posledni / fs + 0.05) };
  // Krátký zvuk (do 10 s): začátek až tam, kde je zvuk opravdu slyšet, ne první šum. Obálka po 10 ms,
  // začátek = první okno aspoň −15 dB pod nejhlasitějším oknem (harfa s pozvolným náběhem, šum nahrávky).
  if (prvni >= 0 && delka <= 10) {
    const okno = Math.max(1, Math.round(0.01 * fs));
    const obalka = [];
    for (let z = 0; z < n; z += okno) {
      let s = 0;
      for (const k of kanaly) for (let i = z; i < Math.min(n, z + okno); i++) s += k[i] * k[i];
      obalka.push(Math.sqrt(s / (Math.min(n, z + okno) - z) / kanaly.length));
    }
    const max = Math.max(...obalka);
    const prah = max * 0.18;
    const i = obalka.findIndex((r) => r >= prah);
    if (i > 0) okraje.zacatek = Math.max(okraje.zacatek, (i * okno) / fs - 0.02);
  }

  const kv = kanaly.slice(0, 2).map((k) => kvadratyK(k, fs));
  const blok = Math.round(0.4 * fs);
  const krok = Math.round(0.1 * fs);
  const bloky = [];
  // Krátký zvuk (pod 400 ms): jeden blok přes celý soubor.
  const delkaBloku = Math.min(blok, n);
  for (let z = 0; z + delkaBloku <= n; z += n < blok ? n : krok) {
    let soucet = 0;
    for (const q of kv) for (let i = z; i < z + delkaBloku; i++) soucet += q[i];
    bloky.push(soucet / delkaBloku);
    if (n < blok) break;
  }
  const nadAbs = bloky.filter((m) => m > 0 && lufs(m) > -70);
  if (!nadAbs.length) return { lufs: null, spicka: zaokr(spicka, 4), ...zaokrOkraje(okraje), delka: zaokr(delka, 2), verze: VERZE_MERENI };
  const prumer = (s) => s.reduce((a, b) => a + b, 0) / s.length;
  const relPrah = lufs(prumer(nadAbs)) - 10;
  const brane = nadAbs.filter((m) => lufs(m) > relPrah);
  return { lufs: zaokr(lufs(prumer(brane)), 1), spicka: zaokr(spicka, 4), ...zaokrOkraje(okraje), delka: zaokr(delka, 2), verze: VERZE_MERENI };
}

const zaokr = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
const zaokrOkraje = ({ zacatek, konec }) => ({ zacatek: zaokr(zacatek, 3), konec: zaokr(konec, 3) });

/** Prohlížeč: stáhne, dekóduje a změří soubor. */
export async function zmeritUrl(ctx, url) {
  const data = await (await fetch(url)).arrayBuffer();
  const buffer = await ctx.decodeAudioData(data);
  const kanaly = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, i) => buffer.getChannelData(i));
  return zmeritVzorky(kanaly, buffer.sampleRate);
}

/** Výchozí hladiny podle druhu zvuku (LUFS). Ambient tišší, ať podkresluje; hrom nejvýraznější. */
export const HLADINY = Object.freeze({ hudba: -18, ambient: -24, nahodne: -24, efekty: -18, hrom: -16 });

/**
 * Zesílení souboru na cílovou hladinu: nejvýš +12 dB, nejméně −20 dB a nikdy přes špičku 1.
 * Bez měření (ještě nezměřeno, nebo ticho) 1.
 */
export function ziskNaHladinu(mereni, cil) {
  if (!mereni || !Number.isFinite(mereni.lufs) || !Number.isFinite(cil)) return 1;
  let g = 10 ** ((cil - mereni.lufs) / 20);
  if (mereni.spicka > 0) g = Math.min(g, 1 / mereni.spicka);
  return zaokr(Math.max(0.1, Math.min(4, g)), 3);
}
