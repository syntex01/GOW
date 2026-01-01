import Phaser from 'phaser'
import Base, { BaseSide } from './base'

export type UnitFaction = BaseSide

export interface UnitBlueprint {
  key: string
  maxHp: number
  speed: number
  damage: number
  attackInterval: number
  range: number
  tint: number
  width?: number
  height?: number
}

export interface SpawnedUnit {
  faction: UnitFaction
  laneIndex: number
  sprite: Phaser.GameObjects.Rectangle
  hp: number
  maxHp: number
  speed: number
  damage: number
  attackInterval: number
  attackCooldown: number
  range: number
  blueprintKey: string
  isDestroyed?: boolean
}

interface LaneDefinition {
  index: number
  y: number
  displayRect: Phaser.GameObjects.Rectangle
  units: SpawnedUnit[]
}

export interface LaneManagerCallbacks {
  onUnitKilled: (faction: UnitFaction) => void
  onBaseDamaged: (
    target: UnitFaction,
    amount: number,
    remainingHp: number,
    destroyed: boolean
  ) => void
}

export interface LaneManagerConfig {
  scene: Phaser.Scene
  battlefieldBounds: Phaser.Geom.Rectangle
  laneCount: number
  playerBase: Base
  enemyBase: Base
  callbacks: LaneManagerCallbacks
}

export default class LaneManager {
  private scene: Phaser.Scene
  private lanes: LaneDefinition[] = []
  private playerBase: Base
  private enemyBase: Base
  private callbacks: LaneManagerCallbacks

  constructor(config: LaneManagerConfig) {
    const { scene, battlefieldBounds, laneCount, playerBase, enemyBase, callbacks } = config
    this.scene = scene
    this.playerBase = playerBase
    this.enemyBase = enemyBase
    this.callbacks = callbacks

    const laneHeight = battlefieldBounds.height / (laneCount + 1)
    for (let i = 0; i < laneCount; i += 1) {
      const y = laneHeight * (i + 1)
      const rect = scene.add.rectangle(
        battlefieldBounds.centerX,
        y,
        battlefieldBounds.width - 160,
        laneHeight - 30,
        0x12304b,
        0.35
      )
      rect.setStrokeStyle(2, 0x2a6f97, 0.8)
      rect.setOrigin(0.5)
      this.lanes.push({ index: i, y, displayRect: rect, units: [] })
    }
  }

  getLaneIndexAt(y: number) {
    const lane = this.lanes.find(entry => {
      const bounds = entry.displayRect.getBounds()
      return y >= bounds.top && y <= bounds.bottom
    })
    return lane ? lane.index : -1
  }

  spawnUnit(faction: UnitFaction, laneIndex: number, blueprint: UnitBlueprint) {
    const lane = this.lanes[laneIndex]
    if (!lane) {
      return undefined
    }

    const width = blueprint.width !== undefined ? blueprint.width : 48
    const height = blueprint.height !== undefined ? blueprint.height : 32
    const offsetFromBase = 32
    const startX =
      faction === 'player'
        ? this.playerBase.getImpactX() + offsetFromBase
        : this.enemyBase.getImpactX() - offsetFromBase

    const sprite = this.scene.add.rectangle(startX, lane.y, width, height, blueprint.tint, 1)
    sprite.setStrokeStyle(2, faction === 'player' ? 0x22c55e : 0xef4444, 0.8)
    sprite.setOrigin(0.5)

    const unit: SpawnedUnit = {
      faction,
      laneIndex,
      sprite,
      hp: blueprint.maxHp,
      maxHp: blueprint.maxHp,
      speed: blueprint.speed,
      damage: blueprint.damage,
      attackInterval: blueprint.attackInterval,
      attackCooldown: Phaser.Math.Between(0, blueprint.attackInterval),
      range: blueprint.range,
      blueprintKey: blueprint.key
    }

    lane.units.push(unit)
    return unit
  }

  update(delta: number) {
    this.lanes.forEach(lane => {
      const opponentsByFaction = this.partitionByFaction(lane.units)
      lane.units.forEach(unit => {
        if (unit.isDestroyed) {
          return
        }
        unit.attackCooldown -= delta

        const direction = unit.faction === 'player' ? 1 : -1
        const opponents = unit.faction === 'player' ? opponentsByFaction.enemy : opponentsByFaction.player
        const target = this.findTarget(unit, opponents, direction)

        if (target) {
          const distance = Math.abs(target.sprite.x - unit.sprite.x)
          if (distance <= unit.range) {
            if (unit.attackCooldown <= 0) {
              this.applyDamage(unit, target)
              unit.attackCooldown = unit.attackInterval
            }
          } else {
            this.advanceUnit(unit, delta, direction, target.sprite.x - direction * (target.range * 0.5))
          }
        } else {
          this.advanceTowardsBase(unit, delta, direction)
        }
      })

      const aliveUnits = lane.units.filter(entry => !entry.isDestroyed)
      lane.units = aliveUnits
    })
  }

  private partitionByFaction(units: SpawnedUnit[]) {
    const player: SpawnedUnit[] = []
    const enemy: SpawnedUnit[] = []
    units.forEach(unit => {
      if (unit.faction === 'player') {
        player.push(unit)
      } else {
        enemy.push(unit)
      }
    })
    return { player, enemy }
  }

  private findTarget(unit: SpawnedUnit, opponents: SpawnedUnit[], direction: number) {
    const sorted = opponents
      .filter(opponent => !opponent.isDestroyed)
      .filter(opponent => (opponent.sprite.x - unit.sprite.x) * direction >= 0)
      .sort(
        (a, b) =>
          (a.sprite.x - unit.sprite.x) * direction - (b.sprite.x - unit.sprite.x) * direction
      )
    return sorted[0]
  }

  private applyDamage(attacker: SpawnedUnit, defender: SpawnedUnit) {
    defender.hp -= attacker.damage
    if (defender.hp <= 0) {
      defender.isDestroyed = true
      defender.sprite.destroy()
      this.callbacks.onUnitKilled(defender.faction)
    }
  }

  private advanceUnit(unit: SpawnedUnit, delta: number, direction: number, stopX: number) {
    const distancePerMs = unit.speed / 1000
    const moveBy = distancePerMs * delta * direction
    const nextX = unit.sprite.x + moveBy

    if ((direction === 1 && nextX >= stopX) || (direction === -1 && nextX <= stopX)) {
      unit.sprite.x = stopX
    } else {
      unit.sprite.x = nextX
    }
  }

  private advanceTowardsBase(unit: SpawnedUnit, delta: number, direction: number) {
    const targetBase = unit.faction === 'player' ? this.enemyBase : this.playerBase
    const impactX = targetBase.getImpactX()
    const distanceToBase = Math.abs(impactX - unit.sprite.x)

    if (distanceToBase <= unit.range) {
      if (unit.attackCooldown <= 0) {
        const destroyed = targetBase.takeDamage(unit.damage)
        this.callbacks.onBaseDamaged(
          targetBase.side,
          unit.damage,
          targetBase.getHp(),
          destroyed
        )
        unit.attackCooldown = unit.attackInterval
        if (destroyed) {
          unit.attackCooldown = Number.MAX_SAFE_INTEGER
        }
      }
      return
    }

    const offset = direction === 1 ? impactX - unit.range : impactX + unit.range
    this.advanceUnit(unit, delta, direction, offset)
  }
}
