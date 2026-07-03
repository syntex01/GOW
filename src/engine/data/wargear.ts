/* =========================================================================
   WARGEAR CATALOGUE — faithful 10th-edition loadout options per datasheet.

   Each entry lists the extra weapon definitions a unit can swap INTO and the
   mutually-exclusive option groups that model the datasheet's "can replace /
   can be equipped with" choices. The factory (resolveUnitWeapons) starts from a
   datasheet's default weapons and applies the picked choice for each option,
   removing swapped-out weapons and adding swapped-in ones. A datasheet with no
   entry here keeps its fixed default loadout.

   Weapon stat NUMBERS follow 10th-edition datasheets; AP is a non-negative
   magnitude (AP -2 => 2). Names are functional terms only — no rules prose.
   ========================================================================= */
import type { Weapon, WeaponKeyword, WargearCatalogue } from '../types';

/** Parse concise keyword tokens into structured WeaponKeywords.
 *  Tokens: `rapidFire:2`, `sustainedHits:1`, `anti:INFANTRY:4`, `melta:2`,
 *  or bare flags like `lethalHits`, `devastatingWounds`, `precision`, … */
export function parseKeywords(tokens: string[]): WeaponKeyword[] {
  const out: WeaponKeyword[] = [];
  for (const raw of tokens) {
    const [t, a, b] = raw.split(':');
    switch (t) {
      case 'rapidFire': out.push({ t: 'rapidFire', x: Number(a) }); break;
      case 'sustainedHits': out.push({ t: 'sustainedHits', x: Number(a) }); break;
      case 'melta': out.push({ t: 'melta', x: Number(a) }); break;
      case 'anti': out.push({ t: 'anti', keyword: a, x: Number(b) }); break;
      case 'lethalHits': out.push({ t: 'lethalHits' }); break;
      case 'devastatingWounds': out.push({ t: 'devastatingWounds' }); break;
      case 'twinLinked': out.push({ t: 'twinLinked' }); break;
      case 'blast': out.push({ t: 'blast' }); break;
      case 'heavy': out.push({ t: 'heavy' }); break;
      case 'assault': out.push({ t: 'assault' }); break;
      case 'pistol': out.push({ t: 'pistol' }); break;
      case 'torrent': out.push({ t: 'torrent' }); break;
      case 'precision': out.push({ t: 'precision' }); break;
      case 'lance': out.push({ t: 'lance' }); break;
      case 'indirectFire': out.push({ t: 'indirectFire' }); break;
      case 'ignoresCover': out.push({ t: 'ignoresCover' }); break;
      case 'hazardous': out.push({ t: 'hazardous' }); break;
      case 'extraAttacks': out.push({ t: 'extraAttacks' }); break;
      case 'oneShot': out.push({ t: 'oneShot' }); break;
      default: break; // ignore unknown tokens rather than crash
    }
  }
  return out;
}

/** Concise weapon builder: `[id, name, kind, range, attacks, skill, S, AP, D, kw[]]`. */
type WSpec = [string, string, Weapon['kind'], number, Weapon['attacks'], number, number, number, Weapon['damage'], string[]?];
export function w(spec: WSpec): Weapon {
  const [id, name, kind, range, attacks, skill, strength, ap, damage, kw = []] = spec;
  return { id, name, kind, range, attacks, skill, strength, ap, damage, keywords: parseKeywords(kw) };
}

/**
 * Per-datasheet wargear catalogues, keyed by datasheet id. Populated from the
 * research pass; datasheets absent here keep their fixed loadout.
 */
export const WARGEAR: Record<string, WargearCatalogue> = {};
