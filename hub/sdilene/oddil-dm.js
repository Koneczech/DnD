// Oddíly karty jen pro DM: nadpis začínající „DM“ (`## DM`, `## DM — co postava neví`) a oddíl
// Neplatné, kam Návrh po sezení přesouvá vyřazený text (rozhodnutí 77). Ani jeden se nikdy neukáže
// družině (pohled družiny, hráčská stránka) a nejde odkrýt. Jedno místo pro server, panel i web.

/** Nadpis oddílu s vyřazeným textem na konci karty. */
export const ODDIL_NEPLATNE = 'Neplatné';

export const jeNadpisNeplatne = (nadpis) => /^neplatn[eé]$/i.test(String(nadpis ?? '').normalize('NFC').trim());

/** Nadpis začíná DM (bez oddílu Neplatné). */
export const jeNadpisJenDm = (nadpis) => /^DM(\b|\s|—|-|:|$)/.test(String(nadpis ?? '').trim());

/** Oddíl jen pro DM: DM… nebo Neplatné. */
export const jeNadpisDm = (nadpis) => jeNadpisJenDm(nadpis) || jeNadpisNeplatne(nadpis);
