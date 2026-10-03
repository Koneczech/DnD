// Ilustrační dílna (Blok 2): prompt pro ChatGPT z dat místa a stylu v reference/styl-ilustraci.md.
// Ořez a zvětšení obrázku dělá panel v prohlížeči (canvas), server jen uloží hotové PNG.
import fs from 'node:fs/promises';
import path from 'node:path';

export const ZABERY = Object.freeze({
  celek: 'A wide establishing view of',
  detail: 'A close-up detail view within',
  interier: 'An interior view inside',
  vyhled: 'A distant panoramic view toward',
});

const VARIANTY = {
  den: 'in daylight under an overcast sky',
  noc: 'at night, lit only by cold moonlight and a few warm lanterns or fires',
};

const POCASI = {
  dest: 'Steady rain is falling; wet surfaces, puddles and dark streaks of water.',
  snih: 'Snow is falling and a thin layer of snow covers roofs and ground.',
  mlha: 'Thick low fog hangs in the air and softens everything in the distance.',
};

/** Vytáhne text mezi značkami <!-- NAZEV-START --> a <!-- NAZEV-KONEC -->. */
export function mezi(text, nazev) {
  const a = text.indexOf(`<!-- ${nazev}-START -->`);
  const b = text.indexOf(`<!-- ${nazev}-KONEC -->`);
  if (a < 0 || b < a) return '';
  return text.slice(a + `<!-- ${nazev}-START -->`.length, b).trim();
}

export async function nacistStyl(koren) {
  try {
    const text = await fs.readFile(path.join(koren, 'reference', 'styl-ilustraci.md'), 'utf8');
    return { styl: mezi(text, 'STYL'), technika: mezi(text, 'TECHNIKA') };
  } catch {
    return { styl: '', technika: '' };
  }
}

/**
 * Prompt pro novou ilustraci místa. S `predloha: true` jde o jinou variantu existujícího
 * obrázku (noc, jiný stav): ChatGPT dostane obrázek a má zachovat kompozici.
 */
export function sestavPrompt({ misto, zaber = 'celek', varianta = 'den', stav = null, pocasi = 'zadne', predloha = false, styl }) {
  const popis = misto.popisObrazu?.trim() || `${misto.nazev}, a place on the northern Sword Coast`;
  const casti = [];
  if (predloha) {
    casti.push(
      'Use the attached image as the exact reference. Keep the same composition, camera angle, buildings, terrain and objects. ' +
        `Change only what is described below: show the scene ${VARIANTY[varianta] ?? VARIANTY.den}.`,
    );
  } else {
    casti.push(`${ZABERY[zaber] ?? ZABERY.celek} ${popis}, ${VARIANTY[varianta] ?? VARIANTY.den}.`);
  }
  if (stav) casti.push(`State of the place: ${stav.replace(/-/g, ' ')} (describe the change here).`);
  if (POCASI[pocasi]) casti.push(POCASI[pocasi]);
  if (styl.styl) casti.push(styl.styl);
  if (styl.technika) casti.push(styl.technika);
  return casti.join('\n\n');
}
