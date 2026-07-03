/**
 * Per-unit death / hit FX assignment.
 *
 * The archetype catalog and the per-unit fit were designed by a fan-out of
 * per-model agents (see the death-fx-design workflow) and are applied here as a
 * small data table. `deathAnims.ts` implements each archetype procedurally; this
 * module only says WHICH archetype + colour each datasheet uses, with sane
 * silhouette/faction fallbacks so any future unit still gets a fitting death.
 */

export type DeathArchetype =
  | 'reanimation-failed'
  | 'phase-out'
  | 'green-disintegrate'
  | 'catastrophic-hull-detonation'
  | 'burning-wreck-topple'
  | 'rigid-topple'
  | 'spark-slump'
  | 'squig-green-splat'
  | 'ork-timber-faceplant'
  | 'warp-pyre-immolation'
  | 'warp-dissolve-ash'
  | 'topple-crumble';

export type FlinchKind = 'recoil' | 'stagger' | 'shudder' | 'spark-only' | 'none';
export type ColorRole = 'faction' | 'blood' | 'spark' | 'green-energy' | 'fire' | 'warp';

export interface DeathFxConfig {
  archetype: DeathArchetype;
  flinch: FlinchKind;
  color: ColorRole;
  debris: 'none' | 'shards' | 'chunks' | 'ash' | 'sparks' | 'hull-plates';
  explosion: boolean;
}

/** Resolve a colour role to an RGB int, given the unit's faction tint. */
export function roleColor(role: ColorRole, factionColor: number): number {
  switch (role) {
    case 'faction': return factionColor;
    case 'blood': return 0x8a1a12;
    case 'spark': return 0xffd27a;
    case 'green-energy': return 0x39ff7a;
    case 'fire': return 0xff7a2a;
    case 'warp': return 0x9a3cff;
  }
}

/** Exact per-datasheet assignments (keys are lower-cased unit names). */
const BY_NAME: Record<string, DeathFxConfig> = {
  'necron warriors': { archetype: 'reanimation-failed', flinch: 'shudder', color: 'faction', debris: 'sparks', explosion: false },
  'necron overlord': { archetype: 'phase-out', flinch: 'spark-only', color: 'green-energy', debris: 'none', explosion: false },
  'immortals': { archetype: 'green-disintegrate', flinch: 'recoil', color: 'faction', debris: 'none', explosion: false },
  'lychguard': { archetype: 'reanimation-failed', flinch: 'stagger', color: 'green-energy', debris: 'sparks', explosion: false },
  'royal warden': { archetype: 'phase-out', flinch: 'spark-only', color: 'green-energy', debris: 'none', explosion: false },
  'canoptek scarab swarms': { archetype: 'green-disintegrate', flinch: 'shudder', color: 'green-energy', debris: 'none', explosion: false },
  'canoptek wraiths': { archetype: 'green-disintegrate', flinch: 'shudder', color: 'green-energy', debris: 'none', explosion: false },
  'skorpekh destroyers': { archetype: 'reanimation-failed', flinch: 'stagger', color: 'green-energy', debris: 'none', explosion: false },
  'doomsday ark': { archetype: 'catastrophic-hull-detonation', flinch: 'shudder', color: 'faction', debris: 'hull-plates', explosion: true },
  'intercessor squad': { archetype: 'rigid-topple', flinch: 'recoil', color: 'spark', debris: 'none', explosion: false },
  'assault intercessor squad': { archetype: 'rigid-topple', flinch: 'recoil', color: 'faction', debris: 'sparks', explosion: false },
  'hellblaster squad': { archetype: 'rigid-topple', flinch: 'stagger', color: 'faction', debris: 'none', explosion: false },
  'eradicator squad': { archetype: 'rigid-topple', flinch: 'stagger', color: 'faction', debris: 'shards', explosion: false },
  'bladeguard veteran squad': { archetype: 'rigid-topple', flinch: 'stagger', color: 'faction', debris: 'none', explosion: false },
  'terminator squad': { archetype: 'rigid-topple', flinch: 'recoil', color: 'faction', debris: 'none', explosion: false },
  'captain': { archetype: 'spark-slump', flinch: 'recoil', color: 'faction', debris: 'none', explosion: false },
  'lieutenant': { archetype: 'spark-slump', flinch: 'stagger', color: 'faction', debris: 'none', explosion: false },
  'redemptor dreadnought': { archetype: 'catastrophic-hull-detonation', flinch: 'stagger', color: 'faction', debris: 'hull-plates', explosion: true },
  'boyz': { archetype: 'squig-green-splat', flinch: 'stagger', color: 'faction', debris: 'chunks', explosion: false },
  'nobz': { archetype: 'ork-timber-faceplant', flinch: 'stagger', color: 'faction', debris: 'none', explosion: false },
  'warboss': { archetype: 'ork-timber-faceplant', flinch: 'stagger', color: 'blood', debris: 'none', explosion: false },
  'trukk': { archetype: 'catastrophic-hull-detonation', flinch: 'shudder', color: 'faction', debris: 'hull-plates', explosion: true },
  'legionaries': { archetype: 'warp-pyre-immolation', flinch: 'stagger', color: 'warp', debris: 'ash', explosion: false },
  'chosen': { archetype: 'warp-pyre-immolation', flinch: 'recoil', color: 'warp', debris: 'ash', explosion: false },
  'chaos lord': { archetype: 'warp-pyre-immolation', flinch: 'stagger', color: 'warp', debris: 'ash', explosion: false },
  'master of possession': { archetype: 'warp-pyre-immolation', flinch: 'stagger', color: 'warp', debris: 'ash', explosion: false },
  'accursed cultists': { archetype: 'warp-dissolve-ash', flinch: 'shudder', color: 'warp', debris: 'none', explosion: false },
  'raptors': { archetype: 'warp-pyre-immolation', flinch: 'stagger', color: 'warp', debris: 'ash', explosion: false },
  'helbrute': { archetype: 'burning-wreck-topple', flinch: 'stagger', color: 'warp', debris: 'hull-plates', explosion: true },
};

/** Fallback death by silhouette + faction keyword when a unit isn't in the table. */
function fallback(silhouette: string | undefined, keywords: string[]): DeathFxConfig {
  const kw = keywords.map((k) => k.toLowerCase());
  const has = (s: string) => kw.some((k) => k.includes(s));
  const vehicle = silhouette === 'vehicle' || silhouette === 'monster';
  if (vehicle) {
    return { archetype: has('walker') || has('daemon') ? 'burning-wreck-topple' : 'catastrophic-hull-detonation',
      flinch: 'shudder', color: 'fire', debris: 'hull-plates', explosion: true };
  }
  if (has('necron')) return { archetype: 'green-disintegrate', flinch: 'shudder', color: 'green-energy', debris: 'none', explosion: false };
  if (has('chaos') || has('daemon')) return { archetype: 'warp-dissolve-ash', flinch: 'shudder', color: 'warp', debris: 'ash', explosion: false };
  if (has('ork')) return { archetype: 'squig-green-splat', flinch: 'stagger', color: 'faction', debris: 'chunks', explosion: false };
  return { archetype: 'topple-crumble', flinch: 'recoil', color: 'faction', debris: 'sparks', explosion: false };
}

/** Resolve the death/hit FX config for a unit by exact name, else fallback. */
export function resolveDeathFx(
  unitName: string,
  silhouette: string | undefined,
  keywords: string[],
): DeathFxConfig {
  return BY_NAME[unitName.toLowerCase()] ?? fallback(silhouette, keywords);
}
