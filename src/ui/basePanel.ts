import Phaser from 'phaser'
import { audio } from '../core/audio'
import {
  ALL_BUILDINGS,
  CORE_BUILDINGS,
  DEFENCE_BUILDINGS,
  DOCTRINE_BUILDINGS,
  REBUILD_FRACTION,
  SEAT_PLOTS,
  buildingCost,
  maxTierFor,
  type BuildingDef,
  type PlotFace
} from '../data/buildings'
import { FORTRESS_TRACKS } from '../data/fortress'
import { TECHS_BY_ID } from '../data/tech'
import { rosterForAge } from '../data/units'
import { UI } from '../gfx/palette'
import type Battlefield from '../sim/battlefield'
import type Building from '../sim/building'
import type { Faction } from '../sim/types'
import { Button, formatNumber, hex, label, panel } from './widgets'

/**
 * The outworks, as a place rather than as a menu.
 *
 * The building system was fully simulated and completely unreachable: plots,
 * tiers, doctrine buildings, fortress tracks and derelict garrisons all existed
 * and could only be driven through the debug API. This is the door.
 *
 * It is laid out as the yard actually is, because that is the whole design.
 * The middle column is a plan of your seat — the fortress on the road, the rear
 * plots behind it, the flanks out to either side, the one forward plot that
 * only defences may stand on. You pick a piece of ground, and then you pick
 * what goes on it. A menu of buildings sorted by name would have hidden the
 * single fact the player most needs: *where* a thing stands decides how easily
 * it can be burned.
 */

const CREED_ACCENT: Record<string, number> = {
  carnage: 0xc0392b,
  ordnance: 0xff8a30,
  engineering: 0x76c7ff,
  occult: 0xb46bff,
  blight: 0x8ed86a
}

const FACE_NAME: Record<PlotFace, string> = {
  front: 'FORWARD',
  flank: 'FLANK',
  rear: 'REAR'
}

const FACE_NOTE: Record<PlotFace, string> = {
  front: 'Out in front of the gate. Only defences will stand here.',
  flank: 'Beside the road, in a file that cannot touch your gate. Reachable, and worth reaching.',
  rear: 'Behind the fortress — the last ground an attacker gets to, and the safest place to spend.'
}

/** What a seat is called, by the age that founded it. */
const SEAT_NAME = ['Camp', 'Stone Hold', 'Keep', 'Bastion', 'Citadel']

export default class BasePanel {
  private scene: Phaser.Scene
  private bf: Battlefield
  private faction: Faction
  private container: Phaser.GameObjects.Container
  private buttons: Button[] = []
  /** Rebuilt wholesale on every change — this panel is small and rarely open. */
  private body: Phaser.GameObjects.Container
  private detailName: Phaser.GameObjects.Text
  private detailBody: Phaser.GameObjects.Text
  private destroyed = false

  /** Which plot of the active seat is being worked on. */
  private selected = 0
  /** What the detail strip is currently describing. */
  private focus: { name: string; text: string } | null = null

  private readonly onBuild: (plot: number, id: string) => void
  private readonly onRaze: (plot: number) => void
  private readonly onFortify: (track: string) => void
  private readonly onGarrison: (seat: number, id: string) => void

  private readonly px: number
  private readonly py: number
  private readonly panelW: number
  private readonly panelH: number

  constructor(
    scene: Phaser.Scene,
    bf: Battlefield,
    faction: Faction,
    handlers: {
      build: (plot: number, id: string) => void
      raze: (plot: number) => void
      fortify: (track: string) => void
      garrison: (seat: number, id: string) => void
      close: () => void
    }
  ) {
    this.scene = scene
    this.bf = bf
    this.faction = faction
    this.onBuild = handlers.build
    this.onRaze = handlers.raze
    this.onFortify = handlers.fortify
    this.onGarrison = handlers.garrison

    const cam = scene.cameras.main
    this.container = scene.add.container(0, 0).setDepth(3000).setScrollFactor(0)
    const backdrop = scene.add.rectangle(0, 0, cam.width, cam.height, 0x03060d, 0.92).setOrigin(0, 0).setInteractive()
    this.container.add(backdrop)

    this.panelW = cam.width - 40
    this.panelH = cam.height - 40
    this.px = 20
    this.py = 20
    this.container.add(panel(scene, this.px, this.py, this.panelW, this.panelH, 'ui:glass'))

    this.container.add(
      label(scene, this.px + 24, this.py + 12, 'THE OUTWORKS', { size: 26, display: true, color: UI.text })
    )
    this.container.add(
      label(
        scene,
        this.px + 26,
        this.py + 46,
        'Push the gate to win the game, or push the flanks to starve it. Your economy stands where an enemy can walk up to it.',
        { size: 12, color: UI.textDim, wrap: this.panelW - 300 }
      )
    )

    const close = new Button(scene, this.px + this.panelW - 122, this.py + 12, {
      width: 106,
      height: 36,
      text: 'CLOSE',
      accent: UI.panelEdge,
      corner: 'Esc',
      onClick: () => {
        audio.play('ui_click', 0.5)
        handlers.close()
      }
    })
    close.setDepth(3002)
    this.buttons.push(close)

    // The detail strip: one sentence about whatever the eye is on, so no tile
    // has to carry its own explanation.
    const stripY = this.py + this.panelH - 74
    this.container.add(panel(scene, this.px + 16, stripY, this.panelW - 32, 62, 'ui:panel'))
    this.detailName = label(scene, this.px + 30, stripY + 8, '', { size: 14, bold: true, color: UI.text })
    this.detailBody = label(scene, this.px + 30, stripY + 28, '', {
      size: 12,
      color: UI.textDim,
      wrap: this.panelW - 70
    })
    this.container.add([this.detailName, this.detailBody])

    this.body = scene.add.container(0, 0)
    this.container.add(this.body)
    this.refresh()
  }

  /** The plots of the seat this commander currently occupies. */
  private get plots(): Building[] {
    return this.bf.activeSeat(this.faction).plots
  }

  private get army() {
    return this.faction === 'player' ? this.bf.player : this.bf.enemy
  }

  private say(name: string, text: string): void {
    this.focus = { name, text }
    this.detailName.setText(name)
    this.detailBody.setText(text)
  }

  /**
   * Everything a plot can take, in the order the panel shows it: the four
   * anyone can raise, then defences, then whatever this commander's creed has
   * unlocked. Buildings the plot's face rejects never appear at all — a menu
   * that lists things you cannot have is a menu that has to be read twice.
   */
  private optionsFor(plot: Building, face: PlotFace): BuildingDef[] {
    const standing = plot.def
    if (standing) return [standing]
    return [...CORE_BUILDINGS, ...DEFENCE_BUILDINGS, ...DOCTRINE_BUILDINGS].filter(d => d.faces.includes(face))
  }

  /** The highest tier the seat this panel is looking at will carry. */
  private get seatCeiling(): number {
    return maxTierFor(this.bf.activeSeat(this.faction).generation)
  }

  /**
   * What raising or lifting this def on this plot would cost right now.
   *
   * `capped` is the interesting case: the ground is willing but the seat is too
   * small. That has to read differently from MAX TIER, because one is the end of
   * the ladder and the other is a reason to age up.
   */
  private priceOf(
    plot: Building,
    def: BuildingDef
  ): { cost: number; tier: number; rebuild: boolean; capped: boolean } | null {
    const razed = !plot.alive && plot.def !== null
    const tier = plot.alive && plot.def ? plot.tier + 1 : razed && plot.def?.id === def.id ? plot.tier : 0
    if (tier >= def.tiers.length) return null
    const full = buildingCost(def, tier, this.army.age)
    return {
      cost: razed ? Math.round(full * REBUILD_FRACTION) : full,
      tier,
      rebuild: razed,
      capped: tier > this.seatCeiling
    }
  }

  refresh(): void {
    if (this.destroyed) return
    for (const b of this.buttons.slice(1)) b.destroy()
    this.buttons.length = 1
    this.body.removeAll(true)

    const top = this.py + 78
    const colH = this.panelH - 78 - 86
    const gap = 14
    const yardW = 380
    const shopW = 460
    const seatW = this.panelW - 32 - yardW - shopW - gap * 2

    this.drawYard(this.px + 16, top, yardW, colH)
    this.drawShop(this.px + 16 + yardW + gap, top, shopW, colH)
    this.drawSeat(this.px + 16 + yardW + shopW + gap * 2, top, seatW, colH)

    if (this.focus) this.say(this.focus.name, this.focus.text)
    else this.say('YOUR YARD', 'Pick a piece of ground on the left, then pick what stands on it.')
  }

  // ───────────────────────────── the yard ─────────────────────────────

  /**
   * A plan of the seat. The fortress sits on the road with the plots arranged
   * around it exactly as they are on the battlefield, so the panel and the
   * board are the same picture.
   */
  private drawYard(x: number, y: number, w: number, h: number): void {
    const scene = this.scene
    this.body.add(panel(scene, x, y, w, h, 'ui:panel'))
    const seat = this.bf.activeSeat(this.faction)
    const specs = SEAT_PLOTS[seat.generation]
    this.body.add(
      label(scene, x + 16, y + 10, `YOUR ${(SEAT_NAME[seat.generation] ?? 'SEAT').toUpperCase()}`, {
        size: 15,
        display: true,
        color: UI.text
      })
    )
    const gate = [...seat.gateLanes].sort()
    this.body.add(
      label(
        scene,
        x + 16,
        y + 32,
        `${specs.length} plots · carries to tier ${this.seatCeiling + 1} · gate open from ${gate.length} of 5 files`,
        { size: 11, color: UI.textDim }
      )
    )

    // The fortress, drawn where it stands: on the road, mid-height.
    const planX = x + 20
    const planY = y + 56
    const planW = w - 40
    const planH = h - 76
    this.body.add(scene.add.rectangle(planX, planY, planW, planH, 0x0a1220, 0.55).setOrigin(0, 0))
    // Five file lines, so "which file" is readable off the plan.
    for (let lane = 0; lane < 5; lane += 1) {
      const ly = planY + planH * ((lane + 0.5) / 5)
      const lit = seat.gateLanes.has(lane)
      this.body.add(
        scene.add.rectangle(planX + 6, ly, planW - 12, 1, lit ? 0xff6b5a : 0x24314a, lit ? 0.5 : 0.7).setOrigin(0, 0.5)
      )
    }

    // Forward is to the RIGHT of the plan for the player, which is the way the
    // board reads. dx runs positive toward the enemy in both cases.
    const dxs = specs.map(s => s.dx)
    const lo = Math.min(-140, ...dxs)
    const hi = Math.max(160, ...dxs)
    const atX = (dx: number): number => planX + 30 + ((dx - lo) / (hi - lo)) * (planW - 96)
    const atY = (lane: number): number => planY + planH * ((lane + 0.5) / 5)

    // The fortress: drawn as a keep with a gate in it, sized so it is obviously
    // the thing everything else is arranged around.
    const kx = atX(0)
    const ky = atY(2)
    const keep = scene.add.rectangle(kx, ky, 46, 62, 0x243652, 1).setOrigin(0.5)
    keep.setStrokeStyle(2, 0x7f9bc6)
    this.body.add(keep)
    for (const dx of [-16, 0, 16]) {
      this.body.add(scene.add.rectangle(kx + dx, ky - 31, 10, 10, 0x7f9bc6, 1).setOrigin(0.5, 0.5))
    }
    this.body.add(scene.add.rectangle(kx, ky + 14, 14, 18, 0x0d1626, 1).setOrigin(0.5))
    this.body.add(
      label(scene, kx, ky + 34, 'YOUR GATE', { size: 9, color: 0x9fb4d6, align: 'center' })
    )

    specs.forEach((spec, index) => {
      const plot = this.plots[index]
      if (!plot) return
      const cx = atX(spec.dx)
      const cy = atY(spec.lane)
      const chosen = index === this.selected
      const def = plot.def
      const tone = def ? def.color : 0x33445f
      const tile = new Button(scene, cx - 34, cy - 22, {
        width: 68,
        height: 44,
        text: def ? def.name.split(' ')[0].slice(0, 8) : '·',
        subtext: plot.underConstruction
          ? 'building'
          : def
            ? plot.alive
              ? `T${plot.tier + 1}`
              : 'rubble'
            : FACE_NAME[spec.face],
        fontSize: 11,
        accent: chosen ? UI.gold : tone,
        onClick: () => {
          this.selected = index
          audio.play('ui_click', 0.4)
          this.refresh()
        },
        onHover: () => this.describePlot(index)
      })
      tile.setDepth(3001)
      this.buttons.push(tile)
      if (plot.alive && plot.maxHp > 0 && plot.hp < plot.maxHp) {
        const frac = Math.max(0, plot.hp / plot.maxHp)
        this.body.add(scene.add.rectangle(cx - 30, cy + 20, 60, 3, 0x1a2030, 1).setOrigin(0, 0.5))
        this.body.add(
          scene.add.rectangle(cx - 30, cy + 20, 60 * frac, 3, frac < 0.4 ? 0xff6b5a : 0x8ed86a, 1).setOrigin(0, 0.5)
        )
      }
    })
  }

  private describePlot(index: number): void {
    const seat = this.bf.activeSeat(this.faction)
    const spec = SEAT_PLOTS[seat.generation][index]
    const plot = this.plots[index]
    if (!spec || !plot) return
    if (plot.underConstruction) {
      this.say(`${FACE_NAME[spec.face]} PLOT — under construction`, `${Math.ceil(plot.rebuildMs / 1000)}s until the crew is finished. Nothing can be done with this ground until then.`)
      return
    }
    if (plot.def && !plot.alive) {
      this.say(`${FACE_NAME[spec.face]} PLOT — rubble`, `${plot.def.name} was burned here. Putting it back costs ${Math.round(REBUILD_FRACTION * 100)}% of what it cost to raise.`)
      return
    }
    if (plot.def) {
      const tier = plot.def.tiers[plot.tier]
      this.say(`${plot.def.name} — tier ${plot.tier + 1}`, `${tier.effect}  ·  ${Math.round(plot.hp)}/${Math.round(plot.maxHp)} structure.`)
      return
    }
    this.say(`${FACE_NAME[spec.face]} PLOT — empty`, FACE_NOTE[spec.face])
  }

  // ─────────────────────────── the catalogue ───────────────────────────

  private drawShop(x: number, y: number, w: number, h: number): void {
    const scene = this.scene
    this.body.add(panel(scene, x, y, w, h, 'ui:panel'))
    const seat = this.bf.activeSeat(this.faction)
    const spec = SEAT_PLOTS[seat.generation][this.selected]
    const plot = this.plots[this.selected]
    if (!spec || !plot) return

    this.body.add(
      label(scene, x + 16, y + 10, `${FACE_NAME[spec.face]} PLOT`, { size: 15, display: true, color: UI.text })
    )
    this.body.add(label(scene, x + 16, y + 32, FACE_NOTE[spec.face], { size: 11, color: UI.textDim, wrap: w - 32 }))

    let row = y + 68
    if (plot.underConstruction) {
      this.body.add(
        label(scene, x + 16, row, `A crew is working here — ${Math.ceil(plot.rebuildMs / 1000)}s left.`, {
          size: 13,
          color: UI.warn
        })
      )
      return
    }

    const options = this.optionsFor(plot, spec.face)
    // With something already standing there is exactly one button, which left
    // most of the column empty and told the player nothing about where the
    // building is going. Lay the whole ladder out instead: what it does now,
    // and what each remaining tier would add.
    if (plot.def && plot.alive) {
      const def = plot.def
      let ry = row
      const ceiling = this.seatCeiling
      def.tiers.forEach((tier, i) => {
        const owned = i <= plot.tier
        const beyond = i > ceiling
        const price = i === plot.tier + 1 && !beyond ? buildingCost(def, i, this.army.age) : null
        // A tier the seat will never carry is marked as ground the seat does not
        // have, not as something unaffordable — the fix is an age, not gold.
        const note = price ? `  ·  ${formatNumber(price)}g` : beyond ? '  ·  NEEDS A GREATER SEAT' : ''
        this.body.add(
          label(scene, x + 20, ry, `${owned ? '■' : beyond ? '·' : '□'}  TIER ${i + 1}${note}`, {
            size: 11,
            color: owned ? def.color : UI.textDim
          })
        )
        this.body.add(
          label(scene, x + 34, ry + 16, tier.effect, {
            size: 11,
            color: owned ? UI.text : UI.textDim,
            wrap: w - 66
          })
        )
        ry += 22 + Math.max(16, Math.ceil(tier.effect.length / 58) * 15)
      })
      row = Math.min(ry + 8, y + h - 120)
    }
    for (const def of options) {
      if (row > y + h - 56) break
      const price = this.priceOf(plot, def)
      const locked = def.requires ? !this.army.techs.has(def.requires) : false
      const capped = price?.capped ?? false
      const creed = def.branch ? CREED_ACCENT[def.branch] ?? UI.accent : def.color
      const affordable = price !== null && this.army.gold >= price.cost && !locked && !capped

      const caption = price === null
        ? 'MAX TIER'
        : locked
          ? `NEEDS ${(TECHS_BY_ID[def.requires!]?.name ?? 'research').toUpperCase()}`
          : capped
            ? `T${price.tier + 1} NEEDS A GREATER SEAT`
            : `${formatNumber(price.cost)}g${price.rebuild ? '  REBUILD' : price.tier > 0 ? `  → T${price.tier + 1}` : ''}`

      const button = new Button(scene, x + 16, row, {
        width: w - 32,
        height: 42,
        text: def.name,
        subtext: caption,
        fontSize: 13,
        accent: locked ? 0x33445f : creed,
        onClick: () => {
          if (price === null || locked || capped) {
            audio.play('ui_denied', 0.4)
            return
          }
          this.onBuild(this.selected, def.id)
        },
        onHover: () => {
          const tierIndex = price?.tier ?? plot.tier
          const tier = def.tiers[Math.min(def.tiers.length - 1, tierIndex)]
          const need = locked ? `  ·  Needs ${TECHS_BY_ID[def.requires!]?.name ?? 'research'}.` : ''
          const small = capped
            ? `  ·  A ${SEAT_NAME[this.bf.activeSeat(this.faction).generation] ?? 'seat'} will not carry a tier ${(price?.tier ?? 0) + 1} building. Age up and raise it on the new seat.`
            : ''
          this.say(
            `${def.name}${price && price.tier > 0 ? ` — tier ${price.tier + 1}` : ''}`,
            `${def.blurb}  ${tier.effect}${need}${small}`
          )
        }
      })
      button.setDepth(3001)
      if (!affordable) button.setMuted(true)
      this.buttons.push(button)
      row += 48
    }

    if (plot.alive && plot.def) {
      const raze = new Button(scene, x + 16, y + h - 50, {
        width: w - 32,
        height: 38,
        text: 'CLEAR THIS PLOT',
        subtext: `+${formatNumber(Math.round(buildingCost(plot.def, plot.tier, this.army.age) * 0.5))}g back`,
        fontSize: 12,
        accent: 0xff6b5a,
        onClick: () => this.onRaze(this.selected),
        onHover: () =>
          this.say('CLEAR THIS PLOT', 'Pulls it down yourself and takes half the money back. The ground is free again immediately — no crew, no timer.')
      })
      raze.setDepth(3001)
      this.buttons.push(raze)
    }
  }

  // ──────────────────────── the seat and its ghosts ────────────────────────

  private drawSeat(x: number, y: number, w: number, h: number): void {
    const scene = this.scene
    this.body.add(panel(scene, x, y, w, h, 'ui:panel'))
    this.body.add(label(scene, x + 16, y + 10, 'THE SEAT', { size: 15, display: true, color: UI.text }))
    this.body.add(
      label(scene, x + 16, y + 32, 'Bought at the fortress. Nobody can burn these down.', {
        size: 11,
        color: UI.textDim,
        wrap: w - 32
      })
    )

    let row = y + 60
    for (const track of FORTRESS_TRACKS) {
      const level = this.army.tracks[track.id]
      const cost = this.army.trackCost(track.id)
      const pips = track.levels.map((_, i) => (i < level ? '■' : '□')).join(' ')
      const button = new Button(scene, x + 16, row, {
        width: w - 32,
        height: 44,
        text: `${track.name}  ${pips}`,
        subtext: cost === null ? 'COMPLETE' : `${formatNumber(cost)}g`,
        fontSize: 12,
        accent: track.color,
        onClick: () => {
          if (cost === null) {
            audio.play('ui_denied', 0.4)
            return
          }
          this.onFortify(track.id)
        },
        onHover: () => {
          const next = track.levels[level]
          this.say(
            `${track.name} ${level + 1 <= track.levels.length ? level + 1 : track.levels.length}`,
            next ? `${track.blurb}  ${next.effect}` : `${track.blurb}  Every level is bought.`
          )
        }
      })
      button.setDepth(3001)
      if (cost !== null && this.army.gold < cost) button.setMuted(true)
      this.buttons.push(button)
      row += 50
    }

    // The towns you have left behind. They cannot be built on any more; the one
    // decision they still offer is what they turn out for nothing.
    const derelicts = this.bf.seats[this.faction].filter(s => s.derelict && s.alive)
    row += 10
    this.body.add(label(scene, x + 16, row, 'ABANDONED TOWNS', { size: 13, display: true, color: UI.textDim }))
    row += 22
    if (derelicts.length === 0) {
      this.body.add(
        label(scene, x + 16, row, 'None yet. Ageing up founds a new seat and strands the one you are standing in.', {
          size: 11,
          color: UI.textDim,
          wrap: w - 32
        })
      )
      return
    }
    for (const seat of derelicts) {
      if (row > y + h - 50) break
      const index = this.bf.seats[this.faction].indexOf(seat)
      const roster = rosterForAge(seat.generation)
      const current = roster.findIndex(d => d.id === seat.garrisonUnitId)
      const next = roster[(current + 1) % Math.max(1, roster.length)]
      const name = roster[current]?.name ?? 'nothing'
      const button = new Button(scene, x + 16, row, {
        width: w - 32,
        height: 40,
        text: `${SEAT_NAME[seat.generation] ?? 'Seat'} · ${name}`,
        subtext: `turns one out every 13s — tap to cycle`,
        fontSize: 11,
        accent: 0x7f8ca6,
        onClick: () => next && this.onGarrison(index, next.id),
        onHover: () =>
          this.say(
            `${SEAT_NAME[seat.generation] ?? 'Seat'} — abandoned`,
            'It keeps its buildings and their effects, and it still turns out soldiers of its own age, free, forever. It is also something your enemy now has a reason to walk up to and knock down.'
          )
      })
      button.setDepth(3001)
      this.buttons.push(button)
      row += 46
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    for (const b of this.buttons) b.destroy()
    this.buttons.length = 0
    this.container.destroy(true)
  }
}

/** Every building in the game, for anything that wants to enumerate them. */
export const PANEL_BUILDINGS = ALL_BUILDINGS

/** Exposed for the harness: colours the panel uses per creed. */
export { CREED_ACCENT, hex }
