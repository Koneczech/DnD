// Čtení ZIP archivů bez dalších knihoven (bod 88): balíčky zvuků (Kenney) se stáhnou jednou
// do složky zvuku a Hub z nich vybírá jednotlivé soubory. Umí uložené i deflate položky, ne ZIP64
// ani šifrování (zvukové balíčky je nepoužívají).
import zlib from 'node:zlib';

const MAX_POLOZEK = 5000;
const MAX_ROZBALENO = 60 * 1024 * 1024;

const chyba = (zprava) => Object.assign(new Error(zprava), { status: 422 });

/**
 * Seznam položek archivu.
 * @param {Buffer} zip
 * @returns {Array<{nazev:string, metoda:number, velikost:number, komprimovano:number, offset:number}>}
 */
export function polozkyZip(zip) {
  // Konec centrálního adresáře: hledá se od konce (za ním může být komentář do 64 kB).
  let konec = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      konec = i;
      break;
    }
  }
  if (konec < 0) throw chyba('Soubor není ZIP archiv.');
  const pocet = zip.readUInt16LE(konec + 10);
  let p = zip.readUInt32LE(konec + 16);
  if (pocet > MAX_POLOZEK) throw chyba('Archiv má příliš mnoho souborů.');
  const polozky = [];
  for (let i = 0; i < pocet; i++) {
    if (p + 46 > zip.length || zip.readUInt32LE(p) !== 0x02014b50) throw chyba('Poškozený ZIP archiv.');
    const delkaJmena = zip.readUInt16LE(p + 28);
    const extra = zip.readUInt16LE(p + 30);
    const komentar = zip.readUInt16LE(p + 32);
    polozky.push({
      nazev: zip.toString('utf8', p + 46, p + 46 + delkaJmena),
      metoda: zip.readUInt16LE(p + 10),
      komprimovano: zip.readUInt32LE(p + 20),
      velikost: zip.readUInt32LE(p + 24),
      offset: zip.readUInt32LE(p + 42),
    });
    p += 46 + delkaJmena + extra + komentar;
  }
  return polozky;
}

/** Obsah jedné položky. */
export function rozbalit(zip, polozka) {
  const o = polozka.offset;
  if (o + 30 > zip.length || zip.readUInt32LE(o) !== 0x04034b50) throw chyba('Poškozený ZIP archiv.');
  const zacatek = o + 30 + zip.readUInt16LE(o + 26) + zip.readUInt16LE(o + 28);
  const data = zip.subarray(zacatek, zacatek + polozka.komprimovano);
  if (polozka.velikost > MAX_ROZBALENO) throw chyba('Soubor v archivu je příliš velký.');
  if (polozka.metoda === 0) return Buffer.from(data);
  if (polozka.metoda === 8) return zlib.inflateRawSync(data, { maxOutputLength: MAX_ROZBALENO });
  throw chyba(`Neznámá komprese v archivu (${polozka.metoda}).`);
}
