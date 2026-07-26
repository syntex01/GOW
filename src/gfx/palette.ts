/** Colour language for the whole game: UI chrome, faction identity, age themes. */

export const UI = {
  ink: 0x05070d,
  panel: 0x101828,
  panelLight: 0x1b2639,
  panelEdge: 0x2f3f5c,
  text: 0xe9eefb,
  textDim: 0x93a3c4,
  gold: 0xf2c14e,
  goldDark: 0x9a7420,
  xp: 0x6ec7ff,
  good: 0x4ade80,
  warn: 0xfbbf24,
  bad: 0xf87171,
  player: 0x3d8bff,
  enemy: 0xff5646,
  accent: 0x8b5cf6
} as const

export interface AgeTheme {
  name: string
  tagline: string
  /** Sky gradient, top to horizon. */
  sky: [number, number, number]
  sun: number
  /** Far mountains, mid hills, near hills. */
  ridges: [number, number, number]
  ground: number
  groundDark: number
  groundAccent: number
  fog: number
  /** Silhouette props scattered on the parallax layers. */
  props: 'ferns' | 'pines' | 'oaks' | 'ruins' | 'towers'
  weather: 'clear' | 'ash' | 'rain' | 'snow' | 'embers'
  /** Faction structure colours for this age. */
  playerStructure: number
  enemyStructure: number
  metal: number
}

export const AGE_THEMES: AgeTheme[] = [
  {
    name: 'Stone Age',
    tagline: 'Bone, flint and fury.',
    sky: [0x2b1f3a, 0x8c4a3f, 0xe0a05a],
    sun: 0xffd79a,
    ridges: [0x3b2f45, 0x4a3a45, 0x5c4a42],
    ground: 0x6b5334,
    groundDark: 0x4a3823,
    groundAccent: 0x8c7042,
    fog: 0xd9a06a,
    props: 'ferns',
    weather: 'embers',
    playerStructure: 0x8a6b3f,
    enemyStructure: 0x7a4436,
    metal: 0x8d8371
  },
  {
    name: 'Medieval Age',
    tagline: 'Steel, faith and siege.',
    // Deliberately deeper than it looks like it should be on paper. Everything
    // the environment draws is derived from these, and this age's horizon and
    // haze used to sit so close to the value of its own hills that the ranges,
    // the ground and the soldiers standing on it all washed into one pale
    // field — measurably: seventeen points of separation where the other ages
    // had fifty-six.
    sky: [0x0c1528, 0x223c5e, 0x46637a],
    sun: 0xffedc4,
    ridges: [0x1b2734, 0x233242, 0x27402f],
    ground: 0x2c4020,
    groundDark: 0x18280f,
    groundAccent: 0x466030,
    fog: 0x6d8ba3,
    props: 'pines',
    weather: 'clear',
    playerStructure: 0x9aa3b5,
    enemyStructure: 0x8a5b52,
    metal: 0xb8c0cc
  },
  {
    name: 'Renaissance',
    tagline: 'Powder, drill and cannon.',
    sky: [0x1d2140, 0x4d4c70, 0xa8977a],
    sun: 0xffe6b8,
    ridges: [0x2c2f4a, 0x3a3950, 0x453f36],
    ground: 0x565030,
    groundDark: 0x393420,
    groundAccent: 0x726939,
    fog: 0xb5a686,
    props: 'oaks',
    weather: 'rain',
    playerStructure: 0x8f9ab0,
    enemyStructure: 0x9c5c48,
    metal: 0xc2b28a
  },
  {
    name: 'Modern Age',
    tagline: 'Armour, artillery and air power.',
    sky: [0x14202e, 0x2e4356, 0x6d7f86],
    sun: 0xd8e6ea,
    ridges: [0x232f3c, 0x2c3a45, 0x36443f],
    ground: 0x4a5340,
    groundDark: 0x30382a,
    groundAccent: 0x646d50,
    fog: 0x8f9ea6,
    props: 'ruins',
    weather: 'ash',
    playerStructure: 0x6e7b86,
    enemyStructure: 0x7d5a4a,
    metal: 0x9aa6b0
  },
  {
    name: 'Future Age',
    tagline: 'Plasma, alloy and orbital fire.',
    sky: [0x090b1f, 0x1c1350, 0x4b2a7a],
    sun: 0xb6a5ff,
    ridges: [0x141a3a, 0x1b2148, 0x232a55],
    ground: 0x2b3050,
    groundDark: 0x1a1e36,
    groundAccent: 0x3f4878,
    fog: 0x6c5bb0,
    props: 'towers',
    weather: 'snow',
    playerStructure: 0x4f6fbd,
    enemyStructure: 0xa5486c,
    metal: 0xc9d6ff
  }
]

export const FACTION_COLOR = {
  player: UI.player,
  enemy: UI.enemy
} as const

/** Rarity/tier accent used on unit cards and turret icons. */
export const TIER_COLORS = [0x9aa3b5, 0x6ec7ff, 0x8b5cf6, 0xf2c14e, 0xff6b6b]
