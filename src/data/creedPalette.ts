import { fromHsl, toHsl } from '../gfx/pixel'
import type { UnitDef, UnitVisual } from './types'
import type { FactionId } from './factions'

/**
 * A creed is a colour FAMILY, not a colour.
 *
 * The five paths were each authored as one five-colour palette shared by every
 * soldier in the roster, which made the creeds read instantly at a distance and
 * made the units inside them indistinguishable up close: ten Nekrotics in the
 * same greys, eleven of the Circle in the same violet. A commander could tell
 * which war they were in and not which soldier was about to reach them.
 *
 * This places every unit at its own point inside its creed's territory. The
 * creed still owns the hue — a Nekrotic is bone and grave-green whatever else
 * it is — but three things move within it:
 *
 *  RANK. Age is the strongest signal. Age-1 chaff is washed out, low-contrast,
 *  cheap-looking; an age-5 engine is saturated, high-contrast, and its metal
 *  catches light. You should be able to price a silhouette by its colour.
 *
 *  ROLE. Each role has a temperament, and it is the same temperament in every
 *  creed, so the vocabulary transfers: tanks are the darkest and least
 *  saturated with the heaviest metal; ranged are lighter and cooler so they
 *  read at the back of a formation; melee run warm; siege go rust and ochre;
 *  air are pale and high-value against the sky; support carry the brightest
 *  accent of anyone, because finding the healer in a crowd is a decision.
 *
 *  THE UNIT ITSELF. A hash of the id nudges hue and lightness a few degrees, so
 *  two soldiers of the same creed, age and role still refuse to be the same
 *  colour.
 *
 * The result is that a roster still reads as one army, and no two of its
 * soldiers read as the same soldier.
 */

/** The centre of a creed's territory: the colours a unit is a variation on. */
interface Family {
  /** Flesh, hide, or whatever this path uses instead. */
  skin: number
  /** Primary and secondary cloth, the bulk of the silhouette. */
  cloth: number
  cloth2: number
  /** Plate, bone, chitin — whatever catches the light. */
  metal: number
  /** The creed's signature emission. Never leaves its own hue neighbourhood. */
  accent: number
  /** How far, in hue turns, a unit may wander from the accent. ±this. */
  accentSpread: number
  /** How far the skin may wander. Some paths are far more uniform than others. */
  skinSpread: number
}

const FAMILIES: Record<FactionId, Family> = {
  // Bone, grave-mould and old meat. Wanders widely — nothing here was issued.
  nekrotics: {
    skin: 0xa9b3a0,
    cloth: 0x3a2f3d,
    cloth2: 0x27202a,
    metal: 0x8e9384,
    accent: 0x7fd6a0,
    accentSpread: 0.055,
    skinSpread: 0.05
  },
  // Issued steel and cold light. The most uniform of the five, deliberately:
  // this is the only army that was manufactured.
  cyborgs: {
    skin: 0x93a0b0,
    cloth: 0x2b3444,
    cloth2: 0x1b222d,
    metal: 0xc9d6ff,
    accent: 0x5ce1ff,
    accentSpread: 0.03,
    skinSpread: 0.022
  },
  // Vestments and lamplight. Robes vary because rank is the whole religion.
  dark_circle: {
    skin: 0xb09a8c,
    cloth: 0x1b1426,
    cloth2: 0x120d1a,
    metal: 0x6b5f86,
    accent: 0xb46bff,
    accentSpread: 0.05,
    skinSpread: 0.035
  },
  // Soot, scorched leather and ember. Wide, because everything here is burnt
  // to a different degree.
  cinder_host: {
    skin: 0x6a4f42,
    cloth: 0x2a201c,
    cloth2: 0x1a1310,
    metal: 0x8a7266,
    accent: 0xff7a2a,
    accentSpread: 0.045,
    skinSpread: 0.045
  },
  // Husk, leaf-rot and fruiting body. The widest: a garden is not uniform.
  hollow_bloom: {
    skin: 0xb8a87c,
    cloth: 0x4c5c33,
    cloth2: 0x333f22,
    metal: 0x8f8a63,
    accent: 0xd98ec4,
    accentSpread: 0.07,
    skinSpread: 0.06
  }
}

/** What a role does to a family's colours. All five creeds speak this dialect. */
interface Temperament {
  /** Hue push on cloth and metal, in turns. Positive is warmer. */
  warmth: number
  /** Lightness offset on cloth: negative is a darker, heavier silhouette. */
  clothLight: number
  /** Lightness offset on metal. */
  metalLight: number
  /** Saturation scale on cloth and metal. */
  sat: number
  /** Lightness offset on the accent — how loudly this role glows. */
  accentLight: number
}

/**
 * Swings are deliberately small on cloth and metal and large on the accent.
 *
 * Cloth and metal are most of a soldier's pixels, so moving them far is what
 * makes a creed stop reading as one army — measured: pushing them hard drops
 * nearest-centroid recognition to 45%. The accent is a handful of pixels that
 * the eye goes straight to, so it can carry most of the per-unit difference
 * without costing the family anything. Role temperament therefore whispers in
 * the mass and shouts in the trim.
 */
const TEMPERAMENT: Record<string, Temperament> = {
  // Warm, close, and bloodied. The colour of something already in your face.
  melee: { warmth: 0.01, clothLight: 0.0, metalLight: 0.0, sat: 1.03, accentLight: -0.02 },
  // Cool and light, so a shooter reads at the back of its own formation.
  ranged: { warmth: -0.009, clothLight: 0.028, metalLight: 0.022, sat: 0.97, accentLight: 0.04 },
  // The darkest, heaviest, least saturated thing on the field. It is a wall.
  tank: { warmth: -0.004, clothLight: -0.03, metalLight: -0.016, sat: 0.9, accentLight: -0.06 },
  // Rust and ochre: machinery that has been outdoors for a long time.
  siege: { warmth: 0.018, clothLight: -0.014, metalLight: -0.028, sat: 1.06, accentLight: -0.03 },
  // Pale and high-value, because it is seen against sky rather than ground.
  air: { warmth: -0.007, clothLight: 0.05, metalLight: 0.038, sat: 0.93, accentLight: 0.09 },
  // The brightest accent anyone carries. Finding the healer is a decision.
  support: { warmth: -0.002, clothLight: 0.02, metalLight: 0.011, sat: 1.0, accentLight: 0.14 }
}

/** Small, stable, and different for every id. Not random — reproducible. */
function idJog(id: string): { hue: number; light: number; sat: number } {
  let h = 2166136261
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  // Three independent slices of the same hash, each mapped to −1..1.
  const slice = (shift: number): number => (((h >>> shift) & 0xff) / 255) * 2 - 1
  return { hue: slice(0), light: slice(8), sat: slice(16) }
}

interface Shift {
  hue?: number
  light?: number
  sat?: number
}

function shift(colour: number, { hue = 0, light = 0, sat = 1 }: Shift): number {
  const [h, s, l] = toHsl(colour)
  return fromHsl(h + hue, Math.min(1, Math.max(0, s * sat)), Math.min(0.95, Math.max(0.04, l + light)))
}

/**
 * Where this unit sits inside its creed's territory.
 *
 * Exported because the tests read it: a palette system whose promise ("no two
 * units share a palette") is not checkable is a palette system that will drift
 * back to five colours the first time somebody adds a roster.
 */
export function creedColours(
  faction: FactionId,
  def: Pick<UnitDef, 'id' | 'age' | 'role' | 'cost'>
): Pick<UnitVisual, 'skin' | 'cloth' | 'cloth2' | 'metal' | 'accent'> {
  const family = FAMILIES[faction]
  const temper = TEMPERAMENT[def.role] ?? TEMPERAMENT.melee
  const jog = idJog(def.id)

  // Rank, 0 at the bottom of the roster and 1 at the top. Age carries most of
  // it; cost breaks ties inside an age, so the expensive soldier of a pair is
  // visibly the expensive one.
  const rank = Math.min(1, def.age / 4) * 0.78 + Math.min(1, def.cost / 3200) * 0.22

  // Chaff is washed out and flat. Engines are saturated and high-contrast —
  // but only within a band narrow enough that the creed survives it.
  const rankSat = 0.86 + rank * 0.28
  const rankContrast = (rank - 0.5) * 0.05

  const hue = temper.warmth + jog.hue * family.accentSpread * 0.3

  return {
    skin: shift(family.skin, {
      hue: jog.hue * family.skinSpread,
      light: jog.light * 0.05 + rank * 0.02,
      sat: 0.9 + rank * 0.25
    }),
    cloth: shift(family.cloth, {
      hue: hue,
      light: temper.clothLight - rankContrast + jog.light * 0.018,
      sat: rankSat * temper.sat
    }),
    // The second cloth is the first one's shadow, so a unit's two garments
    // always belong to each other however far the unit has wandered.
    cloth2: shift(family.cloth2, {
      hue: hue - 0.006,
      light: temper.clothLight * 0.7 - rankContrast * 1.3 + jog.light * 0.014,
      sat: rankSat * temper.sat * 1.05
    }),
    metal: shift(family.metal, {
      hue: hue * 0.6,
      light: temper.metalLight + rankContrast * 1.6 + jog.light * 0.022,
      sat: (0.72 + rank * 0.4) * temper.sat
    }),
    // The accent never leaves the creed's neighbourhood — that is the whole
    // point of a family — but it is a different light on every soldier.
    accent: shift(family.accent, {
      hue: jog.hue * family.accentSpread,
      light: temper.accentLight + rank * 0.08 + jog.light * 0.055,
      sat: 0.8 + rank * 0.3 + jog.sat * 0.1
    })
  }
}
