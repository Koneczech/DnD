// List postavy jako vlastní záložka stránky postavy (rozhodnutí 76, DM 21. 10. 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { oddelitList, souhrnListu, oddilyListu, jeTabulkaVlastnosti } from '../sdilene/list-postavy.js';
import { oznacitBloky } from '../sdilene/odkryvani.js';
import { rozebrat } from '../sdilene/frontmatter.js';

const KOREN_REPA = path.resolve(import.meta.dirname, '..', '..');

const TELO = `# Alba

Úvod.

## Příběh

Text.

## List postavy

*Stav k 21. 8.*

### Ability Scores

| Stat | Hodnota | Modifikátor |
|---|---|---|
| Strength | 9 | -1 |
| Dexterity | 12 | +1 |
| Constitution | 15 | +2 |
| Intelligence | 11 | +0 |
| Wisdom | 15 | +2 |
| Charisma | 12 | +1 |

### Skills
Passive Perception 12, Passive Insight 12

### Combat
- Initiative: +1
- Armor Class: 11 ✅ potvrzeno
- Max HP: 18 (v rozsahu)
- Hit Dice: 3d8
- Proficiency Bonus: +2
- Speed: 30 ft (walking)

### Weapon Attacks
| Zbraň | Hit |
|---|---|
| Sickle | +1 |

### Spells (Druid, WIS, Spell DC 12, Spell Attack +4)

Cantripy.

## Dotazník

Odpovědi.
`;

test('List postavy: oddělí se od textu karty, zbytek zůstane v pořadí', () => {
  const { list, zbytek } = oddelitList(TELO);
  assert.match(list, /^\n\*Stav k 21\. 8\.\*/);
  assert.match(list, /Spell DC 12/);
  assert.doesNotMatch(list, /Dotazník/);
  assert.equal(zbytek, '# Alba\n\nÚvod.\n\n## Příběh\n\nText.\n\n## Dotazník\n\nOdpovědi.\n');
  assert.deepEqual(oddelitList('# X\n\n## Příběh\n'), { zbytek: '# X\n\n## Příběh\n', list: null });
  // List na konci karty a nadpis bez diakritiky.
  assert.equal(oddelitList('# X\n\n## list postavy\n\n- a').list, '\n- a');
});

test('List postavy: souhrn z tabulky vlastností a odrážek Combat', () => {
  const s = souhrnListu(oddelitList(TELO).list);
  assert.deepEqual(s.vlastnosti.map((v) => [v.zkratka, v.hodnota, v.oprava]), [
    ['SIL', 9, '−1'], ['OBR', 12, '+1'], ['ODL', 15, '+2'], ['INT', 11, '+0'], ['MDR', 15, '+2'], ['CHA', 12, '+1'],
  ]);
  assert.deepEqual(s.boj.map((b) => [b.zkratka, b.hodnota]), [
    ['OČ', '11'], ['BV', '18'], ['Iniciativa', '+1'], ['Rychlost', '30 ft'], ['ZB', '+2'], ['Kostky obnovy', '3d8'], ['Pas. vnímání', '12'],
  ]);
  assert.equal(s.kouzla, 'SO 12 · útok kouzlem +4');
  // Značky odkrývání v textu souhrn neruší.
  const oznaceny = oddelitList(oznacitBloky(TELO)).list;
  assert.deepEqual(souhrnListu(oznaceny), s);
  assert.deepEqual(souhrnListu('Nic.'), { vlastnosti: [], boj: [], kouzla: null });
});

test('List postavy: pododdíly jako karty, tabulka vlastností se pozná', () => {
  const { uvod, oddily } = oddilyListu(oddelitList(TELO).list);
  assert.equal(uvod, '*Stav k 21. 8.*');
  assert.deepEqual(oddily.map((o) => o.nadpis), ['Ability Scores', 'Skills', 'Combat', 'Weapon Attacks', 'Spells (Druid, WIS, Spell DC 12, Spell Attack +4)']);
  assert.ok(jeTabulkaVlastnosti('Ability Scores'));
  assert.ok(!jeTabulkaVlastnosti('Skills'));
});

test('List postavy: všechny postavy v kampani mají úplný souhrn', async () => {
  for (const id of ['tusker', 'koudur', 'alba', 'leta']) {
    const r = rozebrat(await fs.readFile(path.join(KOREN_REPA, 'kampan', 'postavy', id, `${id}.md`), 'utf8'));
    const { list } = oddelitList(r.telo);
    assert.ok(list, `${id} nemá List postavy`);
    const s = souhrnListu(list);
    assert.equal(s.vlastnosti.length, 6, `${id}: vlastnosti`);
    assert.deepEqual(s.boj.map((b) => b.zkratka), ['OČ', 'BV', 'Iniciativa', 'Rychlost', 'ZB', 'Kostky obnovy', 'Pas. vnímání'], `${id}: bojové hodnoty`);
  }
});
