import Phaser from 'phaser'
import { audio } from '../core/audio'
import { save } from '../core/save'
import type Battlefield from '../sim/battlefield'
import { UI } from '../gfx/palette'
import { label, panel } from './widgets'

interface TutorialStep {
  /** Shown in the hint panel. */
  text: string
  /** Advance once this returns true. */
  done: (bf: Battlefield) => boolean
  /** Minimum time the step stays on screen, so hints are readable. */
  minMs?: number
}

const STEPS: TutorialStep[] = [
  {
    text: 'Train your first unit — click a card in the command bar, or press 1.',
    done: bf => bf.player.queue.length > 0 || bf.units.some(u => u.faction === 'player')
  },
  {
    text: 'Units march out and fight on their own. Gold arrives every second — keep spending it.',
    done: bf => bf.units.filter(u => u.alive && u.faction === 'player').length >= 2,
    minMs: 3500
  },
  {
    text: 'Every kill pays gold and experience. Watch the EVOLUTION bar at the top left.',
    done: bf => bf.player.xp > 0,
    minMs: 3000
  },
  {
    text: 'Defend the approach: click a turret slot to mount a permanent defence on your fortress.',
    done: bf => bf.playerBase.slots.some(s => s.def !== null) || bf.player.xp > bf.player.xpToAdvance * 0.55,
    minMs: 5000
  },
  {
    text: 'Your special ability is charging. Press Q when it reads READY to clear the field.',
    done: bf => bf.player.abilityCharge >= 1 || bf.stats.abilitiesUsed > 0,
    minMs: 4000
  },
  {
    text: 'EVOLUTION bar full? Press E to advance an age — new units, more income, a tougher fortress.',
    done: bf => bf.player.age > 0,
    minMs: 4000
  },
  {
    text: 'That is everything. Break their fortress before they break yours. Good luck, commander.',
    done: () => false,
    minMs: 6000
  }
]

/**
 * A short, non-blocking hint sequence shown on a player's first campaign
 * mission. Each step waits for the player to actually do the thing, so it
 * never races ahead of them.
 */
export default class Tutorial {
  private scene: Phaser.Scene
  private bf: Battlefield
  private container: Phaser.GameObjects.Container
  private text: Phaser.GameObjects.Text
  private index = -1
  private elapsed = 0
  private finished = false

  constructor(scene: Phaser.Scene, bf: Battlefield) {
    this.scene = scene
    this.bf = bf

    const width = 700
    const x = (scene.cameras.main.width - width) / 2
    this.container = scene.add.container(0, 0).setDepth(1300).setAlpha(0)
    const bg = panel(scene, x, 96, width, 62, 'ui:glass')
    this.text = label(scene, x + width / 2, 112, '', {
      size: 17,
      align: 'center',
      color: UI.text,
      wrap: width - 40
    })
    const tag = label(scene, x + 16, 102, 'TRAINING', { size: 10, color: UI.gold, bold: true })
    this.container.add([bg, tag, this.text])

    this.advance()
  }

  /** True when this player has never finished the opening mission. */
  static shouldRun(levelId: string): boolean {
    return levelId === 'l1_first_blood' && (save.campaign.stars[levelId] ?? 0) === 0
  }

  private advance(): void {
    this.index += 1
    this.elapsed = 0
    if (this.index >= STEPS.length) {
      this.dismiss()
      return
    }
    this.text.setText(STEPS[this.index].text)
    audio.play('ui_hover', 0.4)
    this.scene.tweens.add({
      targets: this.container,
      alpha: 1,
      duration: 260,
      ease: 'Quad.easeOut'
    })
  }

  update(dtMs: number): void {
    if (this.finished) return
    this.elapsed += dtMs
    const step = STEPS[this.index]
    if (!step) return
    if (this.elapsed < (step.minMs ?? 1200)) return

    // The closing line simply times out.
    if (this.index === STEPS.length - 1) {
      if (this.elapsed > (step.minMs ?? 6000)) this.dismiss()
      return
    }
    if (step.done(this.bf)) this.advance()
  }

  dismiss(): void {
    if (this.finished) return
    this.finished = true
    this.scene.tweens.add({
      targets: this.container,
      alpha: 0,
      duration: 320,
      onComplete: () => this.container.destroy()
    })
  }

  destroy(): void {
    this.finished = true
    this.container.destroy()
  }
}
