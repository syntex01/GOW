import { gameEvents, GameEvents } from '../state/events'
import { DifficultySetting, gameState } from '../state/gameState'

const DIFFICULTIES: DifficultySetting[] = ['easy', 'normal', 'hard']

export default class MenuScene extends Phaser.Scene {
  private difficultyButtons: Map<DifficultySetting, Phaser.GameObjects.Text> = new Map()
  private audioToggle?: Phaser.GameObjects.Text
  private speedToggle?: Phaser.GameObjects.Text

  constructor() {
    super({
      key: 'MenuScene'
    })
  }

  create() {
    this.cameras.main.setBackgroundColor('#101a26')
    const { centerX, centerY, height } = this.cameras.main

    this.add
      .text(centerX, 100, '⚔️ Age of War ⚔️', {
        fontFamily: 'Arial Black',
        fontSize: '48px',
        color: '#f5f7fa'
      })
      .setOrigin(0.5)

    this.add
      .text(centerX, 160, 'Configure your battle before deploying!', {
        fontFamily: 'Arial',
        fontSize: '20px',
        color: '#d0d7e1'
      })
      .setOrigin(0.5)

    this.createDifficultyButtons(centerX, centerY - 40)
    this.createSettingToggles(centerX, centerY + 60)
    this.createActionButtons(centerX, height - 120)
  }

  private createDifficultyButtons(centerX: number, y: number) {
    const settings = gameState.getSettings()
    const label = this.add
      .text(centerX, y - 50, 'Difficulty', {
        fontFamily: 'Arial',
        fontSize: '26px',
        color: '#f0f4ff'
      })
      .setOrigin(0.5)
    label.setAlpha(0.9)

    DIFFICULTIES.forEach((difficulty, index) => {
      const button = this.add
        .text(centerX + (index - 1) * 160, y, difficulty.toUpperCase(), {
          fontFamily: 'Arial Black',
          fontSize: '24px',
          color: '#9fb3c8',
          backgroundColor: '#1c2a3a',
          padding: { x: 20, y: 10 }
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })

      button.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => this.updateDifficulty(difficulty))
      this.difficultyButtons.set(difficulty, button)
    })

    this.updateDifficulty(settings.difficulty)
  }

  private createSettingToggles(centerX: number, y: number) {
    const settings = gameState.getSettings()

    this.audioToggle = this.addToggle(
      centerX - 150,
      y,
      `Audio: ${settings.audioEnabled ? 'ON' : 'OFF'}`,
      () => {
        const current = gameState.getSettings().audioEnabled
        gameState.updateSettings({ audioEnabled: !current })
        if (this.audioToggle) {
          this.audioToggle.setText(`Audio: ${!current ? 'ON' : 'OFF'}`)
        }
      }
    )

    this.speedToggle = this.addToggle(
      centerX + 150,
      y,
      `Speed: ${settings.fastForward ? 'FAST' : 'NORMAL'}`,
      () => {
        const current = gameState.getSettings().fastForward
        gameState.updateSettings({ fastForward: !current })
        if (this.speedToggle) {
          this.speedToggle.setText(`Speed: ${!current ? 'FAST' : 'NORMAL'}`)
        }
      }
    )
  }

  private addToggle(x: number, y: number, text: string, onClick: () => void) {
    const toggle = this.add
      .text(x, y, text, {
        fontFamily: 'Arial',
        fontSize: '20px',
        color: '#ffffff',
        backgroundColor: '#1c2a3a',
        padding: { x: 16, y: 10 }
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })

    toggle.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => toggle.setStyle({ color: '#f8fafc' }))
    toggle.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => toggle.setStyle({ color: '#ffffff' }))
    toggle.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, onClick)

    return toggle
  }

  private createActionButtons(centerX: number, y: number) {
    const startButton = this.add
      .text(centerX, y, 'Deploy Troops', {
        fontFamily: 'Arial Black',
        fontSize: '32px',
        color: '#ffffff',
        backgroundColor: '#2c7a4b',
        padding: { x: 40, y: 18 }
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })

    startButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => this.launchBattle())

    const instructions = this.add
      .text(centerX, y + 70, 'Instructions', {
        fontFamily: 'Arial',
        fontSize: '22px',
        color: '#d9e2ef',
        backgroundColor: '#1c2a3a',
        padding: { x: 30, y: 12 }
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })

    instructions.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => this.showInstructions())
  }

  private showInstructions() {
    const overlay = this.add
      .rectangle(0, 0, this.cameras.main.width, this.cameras.main.height, 0x000000, 0.65)
      .setOrigin(0)
    const text = this.add
      .text(this.cameras.main.centerX, this.cameras.main.centerY, this.instructionsCopy(), {
        fontFamily: 'Arial',
        fontSize: '20px',
        color: '#ffffff',
        align: 'left',
        wordWrap: { width: this.cameras.main.width - 120 }
      })
      .setOrigin(0.5)

    const close = () => {
      overlay.destroy()
      text.destroy()
      this.input.off(Phaser.Input.Events.POINTER_UP, close)
    }

    this.input.once(Phaser.Input.Events.POINTER_UP, close)
  }

  private instructionsCopy() {
    return (
      '⚔️ HOW TO PLAY ⚔️\n\n' +
      '🎯 OBJECTIVE: Destroy the enemy base before they destroy yours!\n\n' +
      '💰 RESOURCES: Earn resources passively over time. Kill enemies for bonus resources.\n\n' +
      '🏗️ UNITS: Click unit buttons at the bottom, then click a lane to spawn.\n' +
      '  • Different units have different strengths and costs\n' +
      '  • Balance your army composition for victory\n\n' +
      '⬆️ AGES: Upgrade to new ages for stronger units and better income.\n' +
      '  • Stone Age → Medieval → Modern → Future\n' +
      '  • Each age unlocks powerful new units\n\n' +
      '🎮 CONTROLS:\n' +
      '  • Click lanes to spawn selected unit\n' +
      '  • 1/2/3 keys for quick lane spawn\n' +
      '  • SPACE to upgrade age\n' +
      '  • ESC to return to menu\n\n' +
      'Click anywhere to close'
    )
  }

  private updateDifficulty(difficulty: DifficultySetting) {
    gameState.updateSettings({ difficulty })
    this.difficultyButtons.forEach((button, key) => {
      const isSelected = key === difficulty
      button.setStyle({
        color: isSelected ? '#ffffff' : '#9fb3c8',
        backgroundColor: isSelected ? '#405879' : '#1c2a3a'
      })
      button.setAlpha(isSelected ? 1 : 0.8)
    })
  }

  private launchBattle() {
    gameState.resetMatchSnapshot()
    gameEvents.emit(GameEvents.MATCH_STARTED, gameState.getSettings())
    this.scene.start('BattleScene')
  }
}
