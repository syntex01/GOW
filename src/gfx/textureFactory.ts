import Phaser from 'phaser'
import { TURRETS } from '../data/turrets'
import type { ProjectileId } from '../data/types'
import { UNITS } from '../data/units'
import { AGE_THEMES, UI } from './palette'
import { Canvas2D, css, glow, makeCanvas, roundRect, shade } from './painter'
import {
  drawBase,
  drawCloud,
  drawForeground,
  drawGround,
  drawParticles,
  drawProjectile,
  drawRidge,
  drawTurret,
  drawVignette
} from './propArt'
import { buildShadowCanvas, buildUnitArt, RES, RigMetrics } from './unitArt'

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
}

const unitArtInfo = new Map<string, UnitArtInfo>()

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

/** UI chrome: rounded panels, buttons, meters. Drawn once, stretched via 9-slice. */
function buildUiTextures(scene: Phaser.Scene): void {
  const panel = makeCanvas(64, 64)
  roundRect(panel.ctx, 2, 2, 60, 60, 14)
  const pg = panel.ctx.createLinearGradient(0, 0, 0, 64)
  pg.addColorStop(0, css(UI.panelLight, 0.96))
  pg.addColorStop(1, css(UI.panel, 0.96))
  panel.ctx.fillStyle = pg
  panel.ctx.fill()
  panel.ctx.strokeStyle = css(UI.panelEdge, 0.95)
  panel.ctx.lineWidth = 2
  panel.ctx.stroke()
  addCanvas(scene, 'ui:panel', panel)

  const glass = makeCanvas(64, 64)
  roundRect(glass.ctx, 2, 2, 60, 60, 14)
  glass.ctx.fillStyle = 'rgba(8,12,22,0.72)'
  glass.ctx.fill()
  glass.ctx.strokeStyle = css(UI.panelEdge, 0.7)
  glass.ctx.lineWidth = 2
  glass.ctx.stroke()
  addCanvas(scene, 'ui:glass', glass)

  const button = makeCanvas(64, 64)
  roundRect(button.ctx, 2, 2, 60, 60, 12)
  const bg = button.ctx.createLinearGradient(0, 0, 0, 64)
  bg.addColorStop(0, css(shade(UI.panelLight, 0.24)))
  bg.addColorStop(1, css(shade(UI.panel, -0.1)))
  button.ctx.fillStyle = bg
  button.ctx.fill()
  button.ctx.strokeStyle = css(UI.panelEdge)
  button.ctx.lineWidth = 2
  button.ctx.stroke()
  addCanvas(scene, 'ui:button', button)

  const solid = makeCanvas(8, 8)
  solid.ctx.fillStyle = '#ffffff'
  solid.ctx.fillRect(0, 0, 8, 8)
  addCanvas(scene, 'ui:pixel', solid)

  // Soft rounded bar used for every meter in the HUD.
  const bar = makeCanvas(32, 32)
  roundRect(bar.ctx, 0, 0, 32, 32, 15)
  bar.ctx.fillStyle = '#ffffff'
  bar.ctx.fill()
  addCanvas(scene, 'ui:bar', bar)

  // Star used for campaign ratings.
  const star = makeCanvas(48, 48)
  const sctx = star.ctx
  sctx.beginPath()
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? 22 : 9
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2
    const x = 24 + Math.cos(a) * r
    const y = 24 + Math.sin(a) * r
    if (i === 0) sctx.moveTo(x, y)
    else sctx.lineTo(x, y)
  }
  sctx.closePath()
  sctx.fillStyle = '#ffffff'
  sctx.fill()
  addCanvas(scene, 'ui:star', star)
}

/** Small emblem shown on a unit card so each roster entry is recognisable. */
function buildUnitIcon(scene: Phaser.Scene, id: string): void {
  const key = `icon:${id}`
  if (scene.textures.exists(key)) return
  const art = getUnitArt(id)
  const size = 96
  const c = makeCanvas(size, size)
  const { ctx } = c
  const scale = (size * 0.78) / (art.metrics.height * RES)

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

  for (const unit of UNITS) {
    steps.push({
      label: `Training ${unit.name}`,
      run: () => {
        const art = buildUnitArt(unit.visual, unit.height)
        for (const [part, canvas] of Object.entries(art.parts)) {
          addCanvas(scene, unitPartKey(unit.id, part), canvas)
        }
        unitArtInfo.set(unit.id, {
          metrics: art.metrics,
          origins: art.origins,
          parts: Object.keys(art.parts)
        })
      }
    })
  }

  steps.push({
    label: 'Drawing insignia',
    run: () => {
      for (const unit of UNITS) buildUnitIcon(scene, unit.id)
    }
  })

  steps.push({
    label: 'Raising fortresses',
    run: () => {
      for (let age = 0; age < AGE_THEMES.length; age += 1) {
        addCanvas(scene, `base:${age}:player`, drawBase(age, 'player'))
        addCanvas(scene, `base:${age}:enemy`, drawBase(age, 'enemy'))
      }
    }
  })

  steps.push({
    label: 'Mounting defences',
    run: () => {
      for (const turret of TURRETS) {
        const art = drawTurret(turret.color, turret.barrel, turret.age)
        addCanvas(scene, `turret:${turret.id}:base`, art.base)
        addCanvas(scene, `turret:${turret.id}:barrel`, art.barrel)
      }
    }
  })

  steps.push({
    label: 'Stocking ammunition',
    run: () => {
      for (const id of PROJECTILE_IDS) addCanvas(scene, `proj:${id}`, drawProjectile(id))
      const particles = drawParticles()
      for (const [name, canvas] of Object.entries(particles)) addCanvas(scene, `fx:${name}`, canvas)
      addCanvas(scene, 'fx:shadow', buildShadowCanvas())
    }
  })

  steps.push({
    label: 'Shaping the world',
    run: () => {
      for (let age = 0; age < AGE_THEMES.length; age += 1) {
        addCanvas(scene, `ground:${age}`, drawGround(age, 768, 120))
        addCanvas(scene, `ridge:${age}:0`, drawRidge(age, 0, 1024, 260))
        addCanvas(scene, `ridge:${age}:1`, drawRidge(age, 1, 1024, 230))
        addCanvas(scene, `ridge:${age}:2`, drawRidge(age, 2, 1024, 200))
        addCanvas(scene, `fg:${age}`, drawForeground(age, 1024, 150))
      }
      addCanvas(scene, 'sky:cloud', drawCloud(0xffffff))
      addCanvas(scene, 'fx:vignette', drawVignette(1280, 720))
    }
  })

  steps.push({
    label: 'Lighting the sun',
    run: () => {
      const sun = makeCanvas(256, 256)
      glow(sun.ctx, 128, 128, 126, 0xffffff, 1)
      addCanvas(scene, 'sky:sun', sun)
    }
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
