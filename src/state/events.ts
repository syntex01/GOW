export const gameEvents = new Phaser.Events.EventEmitter()

export enum GameEvents {
  HUD_UPDATE = 'hud:update',
  MATCH_ENDED = 'match:ended',
  MATCH_STARTED = 'match:started'
}
