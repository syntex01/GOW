import { gameEvents, GameEvents } from '../state/events'
import { MatchSnapshot, gameState } from '../state/gameState'

interface HudTexts {
  playerResources: Phaser.GameObjects.Text
  enemyResources: Phaser.GameObjects.Text
  playerBase: Phaser.GameObjects.Text
  enemyBase: Phaser.GameObjects.Text
  age: Phaser.GameObjects.Text
  resultBanner?: Phaser.GameObjects.Text
}

export default class HUDScene extends Phaser.Scene {
  private texts?: HudTexts

  constructor() {
    super({
      key: 'HUDScene'
    })
  }

  create() {
    this.cameras.main.setBackgroundColor(0x000000)
    this.cameras.main.setViewport(0, 0, this.scale.width, this.scale.height)
    this.cameras.main.setScroll(0, 0)
    this.cameras.main.setAlpha(0)

    const settings = gameState.getSettings()
    const snapshot = gameState.getMatchSnapshot()
    this.texts = this.buildHud(snapshot, settings.difficulty)

    gameEvents.on(GameEvents.HUD_UPDATE, this.handleHudUpdate, this)
    gameEvents.on(GameEvents.MATCH_ENDED, this.handleMatchEnded, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      gameEvents.off(GameEvents.HUD_UPDATE, this.handleHudUpdate, this)
      gameEvents.off(GameEvents.MATCH_ENDED, this.handleMatchEnded, this)
    })
  }

  private buildHud(snapshot: MatchSnapshot, difficulty: string): HudTexts {
    const topPadding = 16
    const leftColumnX = 30
    const rightColumnX = this.cameras.main.width - 30

    const playerResources = this.addHudText(leftColumnX, topPadding, `⚡ 0`)
    const enemyResources = this.addHudText(rightColumnX, topPadding, `Enemy: 0 ⚡`, {
      align: 'right'
    })

    const playerBase = this.addHudText(leftColumnX, topPadding + 40, `Base: 0/0`)
    const enemyBase = this.addHudText(rightColumnX, topPadding + 40, `Enemy Base: 0/0`, {
      align: 'right'
    })

    const age = this.add
      .text(this.cameras.main.centerX, topPadding, `🪨 Stone Age — ${difficulty.toUpperCase()}`, {
        fontFamily: 'Arial Black',
        fontSize: '24px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 4
      })
      .setOrigin(0.5, 0)

    const resultBanner = this.add
      .text(this.cameras.main.centerX, this.cameras.main.height - 80, '', {
        fontFamily: 'Arial Black',
        fontSize: '48px',
        color: '#ffffff',
        backgroundColor: '#0f172a',
        padding: { x: 30, y: 20 },
        stroke: '#000000',
        strokeThickness: 6
      })
      .setOrigin(0.5)
      .setAlpha(0)

    return { playerResources, enemyResources, playerBase, enemyBase, age, resultBanner }
  }

  private addHudText(x: number, y: number, text: string, styleOverrides: Partial<Phaser.Types.GameObjects.Text.TextStyle> = {}) {
    return this.add
      .text(x, y, text, {
        fontFamily: 'Arial',
        fontSize: '22px',
        color: '#ffffff',
        backgroundColor: 'rgba(15, 23, 42, 0.7)',
        padding: { x: 16, y: 8 },
        ...styleOverrides
      })
      .setOrigin(styleOverrides.align === 'right' ? 1 : 0, 0)
  }

  private handleHudUpdate = (data: any) => {
    if (!this.texts) {
      return
    }

    this.texts.playerResources.setText(`⚡ ${Math.floor(data.playerResources || 0)}`)
    this.texts.enemyResources.setText(`Enemy: ${Math.floor(data.enemyResources || 0)} ⚡`)
    this.texts.playerBase.setText(`Base: ${Math.floor(data.playerBaseHp || 0)}/${data.playerMaxHp || 0}`)
    this.texts.enemyBase.setText(`Enemy Base: ${Math.floor(data.enemyBaseHp || 0)}/${data.enemyMaxHp || 0}`)

    const playerAge = this.formatAge(data.playerAge || 'stone')
    const difficulty = gameState.getSettings().difficulty || 'normal'
    this.texts.age.setText(`${playerAge} — ${difficulty.toUpperCase()}`)

    if (this.texts.resultBanner) {
      this.texts.resultBanner.setAlpha(0)
    }
  }

  private formatAge(age: string): string {
    const ageMap: Record<string, string> = {
      stone: '🪨 Stone Age',
      medieval: '⚔️ Medieval',
      modern: '🔫 Modern',
      future: '🚀 Future'
    }
    return ageMap[age] || age
  }

  private handleMatchEnded = ({ result }: { result: string }) => {
    if (!this.texts || !this.texts.resultBanner) {
      return
    }

    this.texts.resultBanner.setText(result)
    this.texts.resultBanner.setAlpha(1)
  }
}
