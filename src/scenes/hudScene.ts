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

    const playerResources = this.addHudText(leftColumnX, topPadding, `Resources: ${snapshot.playerResources}`)
    const enemyResources = this.addHudText(rightColumnX, topPadding, `Enemy Resources: ${snapshot.enemyResources}`, {
      align: 'right'
    })

    const playerBase = this.addHudText(leftColumnX, topPadding + 40, `Base HP: ${snapshot.playerBaseHp}`)
    const enemyBase = this.addHudText(rightColumnX, topPadding + 40, `Enemy Base HP: ${snapshot.enemyBaseHp}`, {
      align: 'right'
    })

    const age = this.add
      .text(this.cameras.main.centerX, topPadding, `Age ${snapshot.age} — ${difficulty.toUpperCase()}`, {
        fontFamily: 'Arial Black',
        fontSize: '24px',
        color: '#ffffff'
      })
      .setOrigin(0.5, 0)

    const resultBanner = this.add
      .text(this.cameras.main.centerX, this.cameras.main.height - 80, '', {
        fontFamily: 'Arial Black',
        fontSize: '32px',
        color: '#ffffff',
        backgroundColor: '#0f172a',
        padding: { x: 20, y: 12 }
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

  private handleHudUpdate = ({ snapshot }: { snapshot: MatchSnapshot }) => {
    if (!this.texts) {
      return
    }

    this.texts.playerResources.setText(`Resources: ${snapshot.playerResources}`)
    this.texts.enemyResources.setText(`Enemy Resources: ${snapshot.enemyResources}`)
    this.texts.playerBase.setText(`Base HP: ${snapshot.playerBaseHp}`)
    this.texts.enemyBase.setText(`Enemy Base HP: ${snapshot.enemyBaseHp}`)
    this.texts.age.setText(`Age ${snapshot.age} — ${gameState.getSettings().difficulty.toUpperCase()}`)

    if (this.texts.resultBanner) {
      this.texts.resultBanner.setAlpha(0)
    }
  }

  private handleMatchEnded = ({ result }: { result: string }) => {
    if (!this.texts?.resultBanner) {
      return
    }

    this.texts.resultBanner.setText(result)
    this.texts.resultBanner.setAlpha(1)
  }
}
