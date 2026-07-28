import Phaser from 'phaser'
import { TURRETS } from '../data/turrets'
import { ALL_BUILDINGS } from '../data/buildings'
import { drawBuilding } from './buildingArt'

/** Creeds a building can be built in — the five, plus the unaligned default. */
export const BUILDING_CREEDS = ['none', 'carnage', 'ordnance', 'engineering', 'occult', 'blight'] as const
import type { ProjectileId, UnitDef } from '../data/types'
import { UNITS } from '../data/units'
import { FACTION_UNITS } from '../data/factions'
import { AGE_THEMES, UI } from './palette'
import {
  FOG_BAND_HEIGHT,
  FOREGROUND_HEIGHT,
  GROUND_HEIGHT,
  LAYER_WIDTH,
  RIDGE_HEIGHTS
} from './backdropGeom'
import { Canvas2D, makeCanvas } from './painter'
import Pix, { ramp } from './pixel'
import {
  drawCloud,
  drawFogBand,
  drawForeground,
  drawGround,
  drawParticles,
  drawProjectile,
  drawRidge,
  drawLightFalloff,
  drawSky,
  drawSplatBrushes,
  drawSunDisc,
  drawVignette
} from './propArt'
import { buildShadowCanvas, buildUnitArt, RES, RigMetrics } from './unitArt'
import { buildArchetype, type ArchetypeBuild } from './archetypes'
import { drawFortress } from './fortresses'
import { drawTurretHi } from './turretArt'
import { evaluate, partRotation, samplePose } from './rig'

const PROJECTILE_IDS: ProjectileId[] = [
  'stone',
  'arrow',
  'bolt',
  'boulder',
  'musketball',
  'grenade',
  'cannonball',
  'bullet',
  'rocket',
  'shell',
  'mortar',
  'laserbolt',
  'plasmaball',
  'railslug',
  'bomb'
]

export interface UnitArtInfo {
  metrics: RigMetrics
  origins: Record<string, [number, number]>
  parts: string[]
  /**
   * Present when this unit is drawn by a body-plan archetype rather than the
   * original flat part set. The battle scene checks for it and drives the
   * skeleton instead of hand-positioning parts.
   */
  rig?: ArchetypeBuild
}

const unitArtInfo = new Map<string, UnitArtInfo>()

const turretBarrelPivots = new Map<string, [number, number]>()

/** Where a turret's barrel sprite should be anchored, in 0..1 texture space. */
export function turretBarrelPivot(id: string): [number, number] {
  return turretBarrelPivots.get(id) ?? [0.08, 0.5]
}

export function getUnitArt(id: string): UnitArtInfo {
  const info = unitArtInfo.get(id)
  if (!info) throw new Error(`Unit art not generated for "${id}"`)
  return info
}

export function unitPartKey(id: string, part: string): string {
  return `u:${id}:${part}`
}

function addCanvas(scene: Phaser.Scene, key: string, c: Canvas2D): void {
  if (scene.textures.exists(key)) return
  scene.textures.addCanvas(key, c.canvas)
}

/**
 * UI chrome, drawn once and stretched via 9-slice.
 *
 * These are pixel art too. A smoothly rounded, antialiased panel floating over
 * a hard-edged pixel battlefield reads as two different games stitched
 * together, so the frames are chamfered rather than rounded and every edge is
 * a hard one-pixel line. They are authored at half size and emitted at double,
 * which keeps their borders the same weight as the world's.
 */
function buildUiTextures(scene: Phaser.Scene): void {
  const CORNER = 4

  /**
   * A chamfered frame: square corners knocked back a few pixels, a lit top
   * edge and a shadowed bottom one, so panels have the same implied light
   * direction as everything else on screen.
   */
  const frame = (fillColor: number, edge: number, opts: { alpha?: number; raised?: boolean } = {}) => {
    const s = 32
    const p = new Pix(s, s)
    const alpha = Math.round((opts.alpha ?? 1) * 255)
    const body = ramp(fillColor, { contrast: 0.6 })
    for (let y = 0; y < s; y += 1) {
      for (let x = 0; x < s; x += 1) {
        // Knock the corners back so the frame reads as chamfered, not rounded.
        const cornerX = Math.min(x, s - 1 - x)
        const cornerY = Math.min(y, s - 1 - y)
        if (cornerX + cornerY < CORNER) continue
        // The bevel has to live inside the fixed border bands: 9-slice
        // stretches the middle, so any tone change there smears into one hard
        // line across the centre of every button.
        const bevel = opts.raised ? (y < 6 ? body[3] : y > s - 7 ? body[1] : body[2]) : body[2]
        p.set(x, y, bevel, alpha)
      }
    }
    // One-pixel border, following the chamfer.
    const edgeRamp = ramp(edge, { contrast: 0.5 })
    // An inner bead, three pixels in. Nine-slice stretches the middle of each
    // border band, so a line that runs the length of a band survives the
    // stretch intact — which is what lets a panel of any size keep a drawn
    // edge instead of a drawn rectangle.
    for (let i = CORNER; i < s - CORNER; i += 1) {
      p.set(i, 3, edgeRamp[4], alpha)
      p.set(i, s - 4, edgeRamp[1], alpha)
      p.set(3, i, edgeRamp[3], alpha)
      p.set(s - 4, i, edgeRamp[1], alpha)
    }
    // Corner brackets and their rivets. These live in the corner cells, which
    // are the only parts of a nine-slice that are never stretched, so they stay
    // square on a panel of any proportion.
    for (const [ox, oy, sx, sy] of [
      [0, 0, 1, 1],
      [s - 1, 0, -1, 1],
      [0, s - 1, 1, -1],
      [s - 1, s - 1, -1, -1]
    ] as [number, number, number, number][]) {
      const lit = oy === 0 ? edgeRamp[4] : edgeRamp[1]
      for (let i = 0; i < 5; i += 1) {
        p.set(ox + sx * (CORNER + i), oy + sy * 1, lit, alpha)
        p.set(ox + sx * 1, oy + sy * (CORNER + i), lit, alpha)
      }
      p.set(ox + sx * 5, oy + sy * 5, edgeRamp[oy === 0 ? 4 : 2], alpha)
      p.set(ox + sx * 6, oy + sy * 5, edgeRamp[1], alpha)
      p.set(ox + sx * 5, oy + sy * 6, edgeRamp[1], alpha)
    }
    for (let i = 0; i < s; i += 1) {
      for (const [x, y] of [
        [i, 0],
        [i, s - 1],
        [0, i],
        [s - 1, i]
      ] as [number, number][]) {
        const cornerX = Math.min(x, s - 1 - x)
        const cornerY = Math.min(y, s - 1 - y)
        if (cornerX + cornerY < CORNER) continue
        p.set(x, y, y < 2 ? edgeRamp[4] : y > s - 3 ? edgeRamp[1] : edgeRamp[2], 255)
      }
    }
    // The chamfer itself.
    for (let i = 0; i < CORNER; i += 1) {
      const j = CORNER - 1 - i
      p.set(i, j, edgeRamp[4], 255)
      p.set(s - 1 - i, j, edgeRamp[4], 255)
      p.set(i, s - 1 - j, edgeRamp[1], 255)
      p.set(s - 1 - i, s - 1 - j, edgeRamp[1], 255)
    }
    return p.toCanvasScaled(2) as Canvas2D
  }

  addCanvas(scene, 'ui:panel', frame(UI.panel, UI.panelEdge, { alpha: 0.96 }))
  addCanvas(scene, 'ui:glass', frame(0x080e16, UI.panelEdge, { alpha: 0.74 }))
  addCanvas(scene, 'ui:button', frame(UI.panelLight, UI.panelEdge, { raised: true }))

  const solid = new Pix(4, 4)
  solid.fill(0, 0, 4, 4, 0xffffff)
  addCanvas(scene, 'ui:pixel', solid.toCanvas() as Canvas2D)

  // Meter bar: a hard capsule with the corner pixels cut, so a filling bar has
  // a crisp leading edge instead of a soft one.
  const bar = new Pix(16, 16)
  bar.fill(0, 0, 16, 16, 0xffffff)
  for (const [x, y] of [
    [0, 0],
    [15, 0],
    [0, 15],
    [15, 15]
  ] as [number, number][]) {
    bar.set(x, y, 0, 0)
  }
  addCanvas(scene, 'ui:bar', bar.toCanvasScaled(2) as Canvas2D)

  // Campaign rating star, plotted on the grid rather than stroked.
  const star = new Pix(24, 24)
  const pts: [number, number][] = []
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? 11 : 4.6
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2
    pts.push([12 + Math.cos(a) * r, 12 + Math.sin(a) * r])
  }
  star.poly(pts, 0xffffff)
  addCanvas(scene, 'ui:star', star.toCanvasScaled(2) as Canvas2D)
}

/** Small emblem shown on a unit card so each roster entry is recognisable. */
function buildUnitIcon(scene: Phaser.Scene, id: string): void {
  const key = `icon:${id}`
  if (scene.textures.exists(key)) return
  const art = getUnitArt(id)
  const size = 96
  const c = makeCanvas(size, size)
  const { ctx } = c
  // Fit by height for a soldier, but a tank is three times wider than it is
  // tall — fit those by width or they get cropped to a slab of hull.
  const bulk = art.metrics.bodyW / (art.metrics.height * 0.25)
  const widest = art.parts.includes('body')
    ? art.metrics.height * 2 * bulk * RES
    : art.metrics.height * 0.6 * RES
  const scale = Math.min((size * 0.78) / (art.metrics.height * RES), (size * 0.94) / widest)

  // The icon composites the parts straight from their canvases via the texture
  // manager, so it always matches the in-game sprite.
  const compose = (part: string, dx: number, dy: number, rot = 0) => {
    const texKey = unitPartKey(id, part)
    if (!scene.textures.exists(texKey)) return
    const source = scene.textures.get(texKey).getSourceImage() as HTMLCanvasElement
    const [ox, oy] = art.origins[part] ?? [0.5, 0.5]
    ctx.save()
    ctx.translate(size / 2 + dx * scale, size * 0.86 + dy * scale)
    ctx.rotate(rot)
    ctx.scale(scale, scale)
    ctx.drawImage(source, -source.width * ox, -source.height * oy)
    ctx.restore()
  }

  const m = art.metrics
  const R = RES

  // An archetype-driven unit is composed from its own skeleton at rest, which
  // is the only thing that can be right for every body plan. The old code
  // reached for part names — 'mount', 'body', 'leg', 'torso' — that the new
  // rigs simply do not have, so every card in the command bar had decayed into
  // whichever two parts happened to still match.
  if (art.rig) {
    const rig = art.rig
    const transforms = evaluate(rig.skeleton, samplePose(rig.clips.idle, 0))
    const drawn = rig.skeleton
      .filter(b => b.part && art.parts.includes(b.part))
      .sort((a, b) => a.depth - b.depth)

    // Fit the assembled rig rather than guessing from metrics: a tank is three
    // times wider than it is tall and a titan is the other way round.
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const b of drawn) {
      const t = transforms[b.name]
      if (!t) continue
      const src = scene.textures.get(unitPartKey(id, b.part as string)).getSourceImage() as HTMLCanvasElement
      const px = t.x * rig.height * R
      const py = t.y * rig.height * R
      // A generous box, since the part may be rotated any which way.
      const reach = Math.max(src.width, src.height) * 0.75
      minX = Math.min(minX, px - reach)
      maxX = Math.max(maxX, px + reach)
      minY = Math.min(minY, py - reach)
      maxY = Math.max(maxY, py + reach)
    }
    const fit = Math.min((size * 0.92) / Math.max(1, maxX - minX), (size * 0.92) / Math.max(1, maxY - minY))
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2

    for (const b of drawn) {
      const t = transforms[b.name]
      if (!t) continue
      const src = scene.textures.get(unitPartKey(id, b.part as string)).getSourceImage() as HTMLCanvasElement
      const [ox, oy] = art.origins[b.part as string] ?? [0.5, 0.5]
      ctx.save()
      ctx.translate(size / 2 + (t.x * rig.height * R - cx) * fit, size / 2 + (t.y * rig.height * R - cy) * fit)
      ctx.rotate(partRotation(t.angle, t.orient))
      ctx.scale(fit, fit)
      ctx.drawImage(src, -src.width * ox, -src.height * oy)
      ctx.restore()
    }
    scene.textures.addCanvas(key, c.canvas)
    return
  }

  if (art.parts.includes('mount')) {
    compose('mount', 0, -m.height * 0.34 * R)
    compose('mountLeg', -m.height * 0.28 * R, -m.height * 0.28 * R)
    compose('torso', 0, -m.height * 0.5 * R)
    compose('head', 0, -m.height * 0.84 * R)
    compose('armF', m.height * 0.09 * R, -m.height * 0.72 * R, 0.5)
  } else if (art.parts.includes('body')) {
    compose('body', 0, -m.height * 0.4 * R)
  } else {
    compose(art.parts.includes('leg') ? 'leg' : 'legB', -m.height * 0.06 * R, -m.height * 0.42 * R)
    compose(art.parts.includes('leg') ? 'leg' : 'legF', m.height * 0.06 * R, -m.height * 0.42 * R)
    compose('torso', 0, -m.legLen * R)
    compose('head', 0, m.neckY * R)
    compose(art.parts.includes('arm') ? 'arm' : 'armF', m.height * 0.06 * R, m.shoulderY * R, 0.35)
  }

  scene.textures.addCanvas(key, c.canvas)
}

let generated = false

export interface TextureJob {
  label: string
  run: () => void
}

/**
 * Builds the list of texture-generation jobs. The preloader runs them a few at
 * a time so the browser keeps painting the progress bar instead of freezing.
 */
export function createTextureJobs(scene: Phaser.Scene): TextureJob[] {
  if (generated) return []

  const steps: TextureJob[] = []

  steps.push({
    label: 'Forging interface',
    run: () => buildUiTextures(scene)
  })

  // Faction rosters are generated too: ascension mid-match must not stall
  // the game building thirty sprites.
  for (const unit of [...UNITS, ...FACTION_UNITS]) {
    steps.push({
      label: `Training ${unit.name}`,
      run: () => registerUnitArt(scene, unit)
    })
  }

  steps.push({
    label: 'Drawing insignia',
    run: () => {
      for (const unit of [...UNITS, ...FACTION_UNITS]) buildUnitIcon(scene, unit.id)
    }
  })

  steps.push({
    label: 'Raising fortresses',
    run: () => {
      for (let age = 0; age < AGE_THEMES.length; age += 1) {
        addCanvas(scene, `base:${age}:player`, drawFortress(age, 'player'))
        addCanvas(scene, `base:${age}:enemy`, drawFortress(age, 'enemy'))
      }
    }
  })

  steps.push({
    label: 'Raising the outworks',
    run: () => {
      // One texture per building, per tier, per creed. Small canvases and a
      // small vocabulary, so the whole set is a fraction of a unit's part sheet.
      for (const def of ALL_BUILDINGS) {
        for (let tier = 0; tier < def.tiers.length; tier += 1) {
          for (const creed of BUILDING_CREEDS) {
            addCanvas(scene, `bld:${def.id}:${tier}:${creed}`, drawBuilding(def, tier, creed))
          }
        }
      }
    }
  })

  steps.push({
    label: 'Mounting defences',
    run: () => {
      for (const turret of TURRETS) {
        const art = drawTurretHi(turret)
        addCanvas(scene, `turret:${turret.id}:base`, art.base)
        addCanvas(scene, `turret:${turret.id}:barrel`, art.barrel)
        // Each barrel rotates about its own trunnion rather than a shared
        // guess, so a mortar tube and a railgun sled can pivot where they
        // actually would.
        turretBarrelPivots.set(turret.id, art.barrelPivot)
      }
    }
  })

  steps.push({
    label: 'Stocking ammunition',
    run: () => {
      for (const id of PROJECTILE_IDS) addCanvas(scene, `proj:${id}`, drawProjectile(id))
      const particles = drawParticles()
      for (const [name, canvas] of Object.entries(particles)) addCanvas(scene, `fx:${name}`, canvas)
      const splats = drawSplatBrushes()
      for (const [name, canvas] of Object.entries(splats)) addCanvas(scene, name, canvas)
      addCanvas(scene, 'fx:shadow', buildShadowCanvas())
      addCanvas(scene, 'fx:light', drawLightFalloff())
    }
  })

  steps.push({
    label: 'Shaping the world',
    run: () => {
      for (let age = 0; age < AGE_THEMES.length; age += 1) {
        // Sizes come from the shared backdrop geometry, not from numbers picked
        // here: the background sizes its bands from the same constants, and a
        // band whose art is shorter than itself tiles the art and draws the
        // same ridge crest twice up the screen.
        addCanvas(scene, `ground:${age}`, drawGround(age, LAYER_WIDTH, GROUND_HEIGHT))
        for (let band = 0; band < RIDGE_HEIGHTS.length; band += 1) {
          addCanvas(
            scene,
            `ridge:${age}:${band}`,
            drawRidge(age, band as 0 | 1 | 2, LAYER_WIDTH, RIDGE_HEIGHTS[band])
          )
        }
        addCanvas(scene, `fg:${age}`, drawForeground(age, LAYER_WIDTH, FOREGROUND_HEIGHT))
        addCanvas(scene, `fog:${age}`, drawFogBand(age, LAYER_WIDTH, FOG_BAND_HEIGHT))
        addCanvas(scene, `sky:${age}`, drawSky(age, 1280, 720))
      }
      addCanvas(scene, 'sky:cloud', drawCloud(0xffffff))
      addCanvas(scene, 'fx:vignette', drawVignette(1280, 720))
    }
  })

  steps.push({
    label: 'Lighting the sun',
    run: () => addCanvas(scene, 'sky:sun', drawSunDisc())
  })

  steps.push({
    label: 'Ready',
    run: () => {
      generated = true
    }
  })

  return steps
}

/** Synchronous variant, handy for tests and for scenes that need art now. */
export function generateAllTextures(
  scene: Phaser.Scene,
  onProgress?: (ratio: number, label: string) => void
): void {
  const steps = createTextureJobs(scene)
  if (steps.length === 0) {
    onProgress?.(1, 'Ready')
    return
  }
  steps.forEach((step, i) => {
    step.run()
    onProgress?.((i + 1) / steps.length, step.label)
  })
}

export function texturesReady(): boolean {
  return generated
}

/**
 * Draws one unit's parts and registers them.
 *
 * Archetype-driven units and legacy units go through the same door, so the
 * load-time pass and the lazy morph path can never drift apart.
 */
function registerUnitArt(scene: Phaser.Scene, def: UnitDef): void {
  const rig = buildArchetype(def.visual, def.height)
  if (rig) {
    for (const [part, art] of Object.entries(rig.parts)) {
      addCanvas(scene, unitPartKey(def.id, part), art.canvas)
    }
    unitArtInfo.set(def.id, {
      metrics: buildUnitArt(def.visual, def.height).metrics,
      origins: Object.fromEntries(Object.entries(rig.parts).map(([k, a]) => [k, a.origin])),
      parts: Object.keys(rig.parts),
      rig
    })
    return
  }
  const art = buildUnitArt(def.visual, def.height)
  for (const [part, canvas] of Object.entries(art.parts)) {
    addCanvas(scene, unitPartKey(def.id, part), canvas)
  }
  unitArtInfo.set(def.id, {
    metrics: art.metrics,
    origins: art.origins,
    parts: Object.keys(art.parts)
  })
}

/**
 * Builds art for a unit that was not in the authored roster.
 *
 * Doctrine morphs derive new defs at runtime — a Clubman five doctrines deep
 * is a different sprite with a different silhouette — and there are far too
 * many possible combinations to pre-render all of them at load. So a morph's
 * art is drawn the first time that morph is actually built, which costs a few
 * milliseconds once and nothing afterwards. This is purely cosmetic work, so
 * it cannot affect the lockstep hash even though it happens at different
 * moments on different machines.
 */
export function ensureUnitArt(scene: Phaser.Scene, def: UnitDef): void {
  if (unitArtInfo.has(def.id)) return
  registerUnitArt(scene, def)
  buildUnitIcon(scene, def.id)
}
