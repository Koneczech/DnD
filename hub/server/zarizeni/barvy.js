// Barvy pro světla: převod RGB na souřadnice xy (Hue), omezení sytosti a posun teploty.

const lin = (c) => {
  const v = c / 255;
  return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92;
};

/** sRGB [r,g,b] 0–255 → CIE xy (Hue CLIP API v2: color.xy). Gamut žárovky omezí bridge sám. */
export function rgbNaXy([r, g, b]) {
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const X = R * 0.4124 + G * 0.3576 + B * 0.1805;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = R * 0.0193 + G * 0.1192 + B * 0.9505;
  const soucet = X + Y + Z;
  if (soucet === 0) return { x: 0.3127, y: 0.329 }; // černá → bílý bod D65
  return { x: Math.round((X / soucet) * 10000) / 10000, y: Math.round((Y / soucet) * 10000) / 10000 };
}

const gama = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

/** CIE xy (+ jas 0–1) → sRGB [r,g,b], pro Zachytit světla z Hue. */
export function xyNaRgb({ x, y }) {
  if (!y) return [255, 255, 255];
  const Y = 1;
  const X = (Y / y) * x;
  const Z = (Y / y) * (1 - x - y);
  let r = X * 3.2406 - Y * 1.5372 - Z * 0.4986;
  let g = -X * 0.9689 + Y * 1.8758 + Z * 0.0415;
  let b = X * 0.0557 - Y * 0.204 + Z * 1.057;
  const max = Math.max(r, g, b, 1e-6);
  [r, g, b] = [r / max, g / max, b / max].map((v) => Math.max(0, Math.min(1, gama(Math.max(0, v)))));
  return [r, g, b].map((v) => Math.round(v * 255));
}

/** Sytost 0–1 (HSV). */
export function sytost([r, g, b]) {
  const max = Math.max(r, g, b);
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
}

/** Omezí sytost na `max` (0–1) smícháním s bílou; odstín zůstane. */
export function omezSytost(rgb, max) {
  const s = sytost(rgb);
  if (s <= max || s === 0) return rgb;
  const k = max / s; // podíl původní barvy
  const svetla = Math.max(...rgb);
  return rgb.map((c) => Math.round(svetla - (svetla - c) * k));
}

/**
 * Posun teploty: záporný = chladněji (k modré), kladný = tepleji (k oranžové).
 * Hodnota je zhruba v kelvinech (−1500 až +1500), účinek je jen přibližný.
 */
export function posunTeploty([r, g, b], posun) {
  const k = Math.max(-1, Math.min(1, posun / 1500)) * 0.35;
  const cil = k < 0 ? [150, 180, 255] : [255, 170, 90];
  const m = Math.abs(k);
  return [r, g, b].map((c, i) => Math.round(c * (1 - m) + cil[i] * m));
}

/** Kelvin → mirek (Hue color_temperature) a zpět. */
export const kelvinNaMirek = (k) => Math.round(1e6 / k);
export const mirekNaKelvin = (m) => Math.round(1e6 / m);
