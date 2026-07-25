import Phaser from 'phaser'
import { audio } from '../core/audio'
import { rng } from '../core/rng'
import { save } from '../core/save'
import { session } from '../core/session'
import Peer, { isPeerSupported, type PeerState } from '../net/peer'
import { PROTOCOL_VERSION, type NetMessage } from '../net/protocol'
import { UI } from '../gfx/palette'
import { Button, label, panel } from '../ui/widgets'

type Stage = 'choose' | 'hosting' | 'joining' | 'connecting' | 'ready' | 'error'

/**
 * Peer-to-peer lobby.
 *
 * There is no matchmaking server, no lobby server and no relay. One player
 * hosts and gets a connection code; the other pastes it and returns a reply
 * code. Once those two strings have been exchanged — by any means at all — the
 * two games talk directly to each other.
 */
export default class MultiplayerScene extends Phaser.Scene {
  private peer?: Peer
  private stage: Stage = 'choose'
  private buttons: Button[] = []
  private container!: Phaser.GameObjects.Container
  private domNodes: Phaser.GameObjects.DOMElement[] = []
  private statusText!: Phaser.GameObjects.Text
  private lanOnly = false
  private seed = 0
  private started = false

  constructor() {
    super({ key: 'MultiplayerScene' })
  }

  create(): void {
    this.stage = 'choose'
    this.buttons = []
    this.domNodes = []
    this.started = false
    this.peer = undefined
    this.seed = rng.int(1, 0x7fffffff)

    this.cameras.main.setBackgroundColor(UI.ink)
    this.container = this.add.container(0, 0)

    const cam = this.cameras.main
    this.add.existing(panel(this, 0, 0, cam.width, 92, 'ui:glass'))
    label(this, 34, 18, 'MULTIPLAYER', { size: 34, display: true })
    label(this, 36, 58, 'Direct peer-to-peer. No server, no account, no matchmaking.', {
      size: 15,
      color: UI.textDim
    })

    this.statusText = label(this, cam.width / 2, 108, '', {
      size: 16,
      align: 'center',
      color: UI.textDim,
      wrap: cam.width - 120
    })

    this.addButton(cam.width - 150, 22, {
      width: 120,
      height: 48,
      text: 'BACK',
      accent: UI.panelEdge,
      corner: 'Esc',
      onClick: () => this.leave()
    })

    this.input.keyboard?.on('keydown-ESC', () => this.leave())
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup())

    if (!isPeerSupported()) {
      this.stage = 'error'
      this.setStatus('This browser cannot open peer-to-peer connections.', UI.bad)
      return
    }

    // Own the wire until the battle scene takes over.
    session.setNetHandler(message => this.handleMessage(message))
    this.showChoose()
  }

  // ─────────────────────────────── Helpers ───────────────────────────────

  private addButton(x: number, y: number, options: ConstructorParameters<typeof Button>[3]): Button {
    const button = new Button(this, x, y, options)
    this.buttons.push(button)
    return button
  }

  private setStatus(message: string, color: number = UI.textDim): void {
    this.statusText.setText(message).setColor(`#${color.toString(16).padStart(6, '0')}`)
  }

  private clearStage(): void {
    // Keep the header buttons (BACK is index 0) and drop everything else.
    this.buttons.slice(1).forEach(b => b.destroy())
    this.buttons = this.buttons.slice(0, 1)
    this.domNodes.forEach(n => n.destroy())
    this.domNodes = []
    this.container.removeAll(true)
  }

  /** A read-only field holding a code, with a one-click copy button. */
  private codeField(x: number, y: number, width: number, labelText: string, value: string): void {
    this.container.add(label(this, x, y, labelText, { size: 13, bold: true, color: UI.gold }))

    const area = document.createElement('textarea')
    area.value = value
    area.readOnly = true
    area.spellcheck = false
    Object.assign(area.style, CODE_STYLE, { width: `${width - 130}px`, height: '78px' })
    const dom = this.add.dom(x, y + 22, area).setOrigin(0, 0)
    this.domNodes.push(dom)

    const copy = this.addButton(x + width - 118, y + 22, {
      width: 118,
      height: 78,
      text: 'COPY',
      subtext: 'to clipboard',
      fontSize: 18,
      accent: UI.good,
      onClick: () => {
        area.select()
        void navigator.clipboard?.writeText(value).catch(() => document.execCommand('copy'))
        copy.setText('COPIED')
        this.time.delayedCall(1200, () => copy.setText('COPY'))
      }
    })
  }

  /** An editable field the player pastes a code into. */
  private pasteField(x: number, y: number, width: number, labelText: string): () => string {
    this.container.add(label(this, x, y, labelText, { size: 13, bold: true, color: UI.xp }))
    const area = document.createElement('textarea')
    area.placeholder = 'Paste the code here…'
    area.spellcheck = false
    Object.assign(area.style, CODE_STYLE, { width: `${width}px`, height: '78px' })
    const dom = this.add.dom(x, y + 22, area).setOrigin(0, 0)
    this.domNodes.push(dom)
    return () => area.value.trim()
  }

  // ─────────────────────────────── Stages ───────────────────────────────

  private showChoose(): void {
    this.clearStage()
    this.stage = 'choose'
    const cam = this.cameras.main
    const cx = cam.width / 2
    this.setStatus('One player hosts and sends a code. The other joins and sends one back.')

    this.addButton(cx - 330, 190, {
      width: 320,
      height: 130,
      text: 'HOST A BATTLE',
      subtext: 'create a code to share',
      fontSize: 24,
      accent: UI.good,
      onClick: () => void this.startHosting()
    })
    this.addButton(cx + 10, 190, {
      width: 320,
      height: 130,
      text: 'JOIN A BATTLE',
      subtext: 'paste a code you were sent',
      fontSize: 24,
      accent: UI.player,
      onClick: () => this.showJoining()
    })

    const lanButton = this.addButton(cx - 330, 344, {
      width: 650,
      height: 62,
      text: '',
      subtext: 'Same network only — contacts nothing outside your machine',
      fontSize: 17,
      accent: this.lanOnly ? UI.good : UI.panelEdge,
      onClick: () => {
        this.lanOnly = !this.lanOnly
        lanButton.setAccent(this.lanOnly ? UI.good : UI.panelEdge)
        lanButton.setText(`LAN MODE: ${this.lanOnly ? 'ON' : 'OFF'}`)
        lanButton.setSubtext(
          this.lanOnly
            ? 'Same network only — contacts nothing outside your machine'
            : 'Uses public STUN to find your address. No game data leaves the peers.',
          UI.textDim
        )
      }
    })
    lanButton.setText(`LAN MODE: ${this.lanOnly ? 'ON' : 'OFF'}`)

    this.container.add(
      label(
        this,
        cx,
        432,
        'Both players must be running the same version of GOW.\n' +
          'The host commands the left fortress, the joiner the right.',
        { size: 14, align: 'center', color: UI.textDim }
      )
    )
  }

  private createPeer(): Peer {
    const peer = new Peer({
      lanOnly: this.lanOnly,
      onMessage: message => session.deliver(message),
      onStateChange: (state, detail) => this.handlePeerState(state, detail)
    })
    this.peer = peer
    session.peer = peer
    return peer
  }

  private async startHosting(): Promise<void> {
    this.clearStage()
    this.stage = 'hosting'
    this.setStatus('Generating your connection code…', UI.warn)
    audio.play('ui_click', 0.5)

    try {
      const peer = this.createPeer()
      const code = await peer.createOffer()
      this.clearStage()
      const cam = this.cameras.main
      const x = 90
      const width = cam.width - 180

      this.setStatus('Send step 1 to your opponent, then paste their reply into step 2.')
      this.codeField(x, 160, width, 'STEP 1 — SEND THIS CODE TO YOUR OPPONENT', code)
      const readReply = this.pasteField(x, 300, width - 130, 'STEP 2 — PASTE THEIR REPLY CODE')

      this.addButton(x + width - 118, 322, {
        width: 118,
        height: 78,
        text: 'CONNECT',
        fontSize: 18,
        accent: UI.gold,
        onClick: () => {
          const reply = readReply()
          if (!reply) {
            this.setStatus('Paste the reply code first.', UI.warn)
            return
          }
          this.setStatus('Connecting…', UI.warn)
          peer.acceptAnswer(reply).catch(err => this.setStatus(String(err.message ?? err), UI.bad))
        }
      })
    } catch (err) {
      this.stage = 'error'
      this.setStatus(`Could not create a connection: ${describe(err)}`, UI.bad)
    }
  }

  private showJoining(): void {
    this.clearStage()
    this.stage = 'joining'
    audio.play('ui_click', 0.5)
    const cam = this.cameras.main
    const x = 90
    const width = cam.width - 180

    this.setStatus('Paste the code the host sent you.')
    const readOffer = this.pasteField(x, 170, width - 130, 'STEP 1 — PASTE THE HOST CODE')

    this.addButton(x + width - 118, 192, {
      width: 118,
      height: 78,
      text: 'ACCEPT',
      fontSize: 18,
      accent: UI.gold,
      onClick: () => {
        const offer = readOffer()
        if (!offer) {
          this.setStatus('Paste the host code first.', UI.warn)
          return
        }
        void this.acceptHostCode(offer)
      }
    })
  }

  private async acceptHostCode(offer: string): Promise<void> {
    this.setStatus('Generating your reply code…', UI.warn)
    try {
      const peer = this.createPeer()
      const reply = await peer.acceptOffer(offer)
      this.clearStage()
      const cam = this.cameras.main
      this.setStatus('Send this reply back to the host. The battle starts as soon as they connect.')
      this.codeField(90, 190, cam.width - 180, 'STEP 2 — SEND THIS REPLY CODE BACK', reply)
    } catch (err) {
      this.stage = 'error'
      this.setStatus(`That code was not accepted: ${describe(err)}`, UI.bad)
    }
  }

  // ───────────────────────────── Peer events ─────────────────────────────

  private handlePeerState(state: PeerState, detail?: string): void {
    if (state === 'open') {
      this.setStatus('Connected. Starting battle…', UI.good)
      audio.play('shield', 0.8)
      // The host owns the seed and announces it the moment the link is live.
      if (this.stage === 'hosting') {
        this.peer?.send({
          k: 'hello',
          v: PROTOCOL_VERSION,
          seed: this.seed,
          side: 'player',
          name: 'Host'
        })
      }
    } else if (state === 'failed') {
      this.stage = 'error'
      this.setStatus(`Connection failed${detail ? `: ${detail}` : ''}. Check the codes and try again.`, UI.bad)
    } else if (state === 'closed' && !this.started) {
      this.setStatus('Connection closed.', UI.warn)
    }
  }

  private handleMessage(message: NetMessage): void {
    if (message.k !== 'hello') {
      // Tick traffic can start arriving before the battle scene exists; hold
      // it so nothing is lost during the handover.
      session.bufferNet(message)
      return
    }
    {
      if (message.v !== PROTOCOL_VERSION) {
        this.stage = 'error'
        this.setStatus('Version mismatch — both players need the same build of GOW.', UI.bad)
        this.peer?.close('version mismatch')
        return
      }
      session.opponentName = message.name
      if (this.stage === 'joining' || this.stage === 'connecting') {
        // Guest adopts the host's seed and answers so the host knows to begin.
        this.seed = message.seed
        this.peer?.send({
          k: 'hello',
          v: PROTOCOL_VERSION,
          seed: message.seed,
          side: 'enemy',
          name: 'Challenger'
        })
        this.beginMatch('guest')
      } else if (this.stage === 'hosting') {
        this.beginMatch('host')
      }
    }
  }

  private beginMatch(role: 'host' | 'guest'): void {
    if (this.started) return
    this.started = true
    session.netEndReason = null
    session.start({
      mode: 'skirmish',
      difficulty: save.settings.difficulty,
      seed: this.seed,
      netRole: role
    })
    // The battle scene takes ownership of incoming messages from here; until
    // its handler is installed, traffic queues in the session inbox.
    session.setNetHandler(null)
    this.cameras.main.fadeOut(240, 0, 0, 0)
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start('BattleScene')
    })
  }

  private leave(): void {
    if (!this.started) session.endNetworkMatch('cancelled')
    this.scene.start('MenuScene')
  }

  private cleanup(): void {
    this.buttons.forEach(b => b.destroy())
    this.buttons = []
    this.domNodes.forEach(n => n.destroy())
    this.domNodes = []
    this.input.keyboard?.removeAllListeners()
  }
}

const CODE_STYLE: Partial<CSSStyleDeclaration> = {
  background: '#0d1524',
  color: '#c9d6f0',
  border: '1px solid #2f3f5c',
  borderRadius: '8px',
  padding: '10px',
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
  fontSize: '11px',
  lineHeight: '1.35',
  resize: 'none',
  outline: 'none'
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
