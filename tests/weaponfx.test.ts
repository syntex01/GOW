import { describe, it, expect } from 'vitest';
import { classifyWeapon } from '../src/render/fx/archetypes';

describe('weapon FX classification', () => {
  const cases: Array<[string, string[], string]> = [
    ['Synaptic Disintegrator', ['precision', 'heavy'], 'sniper'], // not a lascannon
    ['Heavy Onslaught Gatling Cannon', ['devastatingWounds'], 'bolter'], // rapid dakka, not lance
    ['Heavy Bolt Pistol', ['pistol'], 'bolter'],
    ['Slugga', ['pistol'], 'bolter'], // Ork gun no longer generic
    ['Big Shoota', ['rapidFire2'], 'bolter'],
    ['Twin Big Shoota', ['twinLinked'], 'bolter'],
    ['Grot Blasta', [], 'bolter'],
    ['Doomsday Cannon (Blast)', ['heavy', 'blast'], 'heavy'],
    ['Macro Plasma Incinerator', ['blast'], 'plasma'],
    ['Gauss Flayer Array', ['lethalHits'], 'gauss'],
    ['Multi-melta', ['melta2'], 'melta'],
    ['Icarus Rocket Pod', ['anti:FLY'], 'missile'],
    ['Tachyon Arrow', ['oneShot'], 'sniper'],
    ['Staff of Light', [], 'gauss'],
  ];
  for (const [name, kw, expected] of cases) {
    it(`${name} → ${expected}`, () => {
      expect(classifyWeapon(name, kw)).toBe(expected);
    });
  }
});
