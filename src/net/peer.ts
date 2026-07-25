import type { NetMessage } from './protocol'

/**
 * A serverless peer link.
 *
 * There is no signalling server and no relay. The host produces a connection
 * code, the guest pastes it and produces a reply code, and the host pastes
 * that back — after which the two browsers talk directly over a WebRTC data
 * channel. The codes are just the compressed session descriptions, so they can
 * travel over any channel the players already have: chat, email, a phone call.
 */

export type PeerState = 'idle' | 'creating' | 'awaiting-answer' | 'connecting' | 'open' | 'closed' | 'failed'

export interface PeerOptions {
  /**
   * LAN mode contacts nothing at all — candidates are limited to addresses the
   * machine already knows. Internet mode uses public STUN servers purely to
   * discover the public address; no game data ever passes through them.
   */
  lanOnly: boolean
  onMessage: (message: NetMessage) => void
  onStateChange: (state: PeerState, detail?: string) => void
}

const PUBLIC_STUN = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
  'stun:stun.cloudflare.com:3478'
]

export default class Peer {
  private pc: RTCPeerConnection | null = null
  private channel: RTCDataChannel | null = null
  private options: PeerOptions
  private currentState: PeerState = 'idle'
  /** Queued outbound messages while the channel finishes opening. */
  private outbox: string[] = []

  constructor(options: PeerOptions) {
    this.options = options
  }

  get state(): PeerState {
    return this.currentState
  }

  get isOpen(): boolean {
    return this.channel?.readyState === 'open'
  }

  private setState(state: PeerState, detail?: string): void {
    if (this.currentState === state) return
    this.currentState = state
    this.options.onStateChange(state, detail)
  }

  private createConnection(): RTCPeerConnection {
    const pc = new RTCPeerConnection({
      iceServers: this.options.lanOnly ? [] : [{ urls: PUBLIC_STUN }],
      iceCandidatePoolSize: 2
    })
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState
      if (s === 'failed') this.setState('failed', 'connection failed')
      else if (s === 'disconnected' || s === 'closed') this.setState('closed', s)
    }
    this.pc = pc
    return pc
  }

  private bindChannel(channel: RTCDataChannel): void {
    this.channel = channel
    channel.binaryType = 'arraybuffer'
    channel.onopen = () => {
      this.setState('open')
      for (const queued of this.outbox) channel.send(queued)
      this.outbox.length = 0
    }
    channel.onclose = () => this.setState('closed', 'channel closed')
    channel.onerror = () => this.setState('failed', 'channel error')
    channel.onmessage = event => {
      try {
        const parsed = JSON.parse(String(event.data)) as NetMessage
        this.options.onMessage(parsed)
      } catch {
        /* A malformed frame is ignored rather than killing the match. */
      }
    }
  }

  /**
   * Host side. Returns the code the other player needs to paste. Resolves once
   * ICE gathering has finished so the code is complete and self-contained —
   * no trickle, no side channel.
   */
  async createOffer(): Promise<string> {
    this.setState('creating')
    const pc = this.createConnection()
    // Ordered + reliable: the command stream must not reorder or drop.
    const channel = pc.createDataChannel('gow', { ordered: true })
    this.bindChannel(channel)

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    await waitForIceGathering(pc)
    this.setState('awaiting-answer')
    return encodeCode(pc.localDescription?.sdp ?? '', 'O')
  }

  /** Guest side. Consumes the host's code and returns the reply code. */
  async acceptOffer(code: string): Promise<string> {
    this.setState('creating')
    const sdp = decodeCode(code, 'O')
    const pc = this.createConnection()
    pc.ondatachannel = event => this.bindChannel(event.channel)

    await pc.setRemoteDescription({ type: 'offer', sdp })
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    await waitForIceGathering(pc)
    this.setState('connecting')
    return encodeCode(pc.localDescription?.sdp ?? '', 'A')
  }

  /** Host side. Completes the handshake with the guest's reply code. */
  async acceptAnswer(code: string): Promise<void> {
    if (!this.pc) throw new Error('No offer in progress')
    const sdp = decodeCode(code, 'A')
    await this.pc.setRemoteDescription({ type: 'answer', sdp })
    this.setState('connecting')
  }

  send(message: NetMessage): void {
    const payload = JSON.stringify(message)
    if (this.channel?.readyState === 'open') this.channel.send(payload)
    else if (this.outbox.length < 256) this.outbox.push(payload)
  }

  close(reason = 'closed'): void {
    try {
      if (this.channel?.readyState === 'open') {
        this.channel.send(JSON.stringify({ k: 'bye', reason }))
      }
    } catch {
      /* Already gone. */
    }
    this.channel?.close()
    this.pc?.close()
    this.channel = null
    this.pc = null
    this.setState('closed', reason)
  }
}

/** Resolves when the peer connection has finished collecting ICE candidates. */
function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise(resolve => {
    // Gathering can stall behind an unreachable STUN server; cap the wait so
    // the player always gets a usable code.
    const timer = window.setTimeout(finish, 4000)
    function finish() {
      window.clearTimeout(timer)
      pc.removeEventListener('icegatheringstatechange', onChange)
      resolve()
    }
    function onChange() {
      if (pc.iceGatheringState === 'complete') finish()
    }
    pc.addEventListener('icegatheringstatechange', onChange)
  })
}

// ───────────────────────────── Connection codes ─────────────────────────────

/**
 * SDP is verbose, so codes are stripped of everything the other side can infer
 * and then base64'd. A short prefix identifies the direction so a player who
 * pastes the wrong code gets told so instead of hitting a cryptic failure.
 */
function encodeCode(sdp: string, kind: 'O' | 'A'): string {
  const compact = sdp
    .split('\r\n')
    .filter(line => line.length > 0)
    .join('\n')
  return `GOW${kind}1:` + base64Encode(compact)
}

function decodeCode(code: string, expected: 'O' | 'A'): string {
  const trimmed = code.trim().replace(/\s+/g, '')
  const match = /^GOW([OA])1:(.+)$/.exec(trimmed)
  if (!match) throw new Error('That does not look like a GOW connection code.')
  if (match[1] !== expected) {
    throw new Error(
      expected === 'O'
        ? 'That is a reply code. Paste the host code here instead.'
        : 'That is a host code. Paste the reply code here instead.'
    )
  }
  return base64Decode(match[2]).split('\n').join('\r\n') + '\r\n'
}

function base64Encode(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/=+$/, '')
}

function base64Decode(text: string): string {
  const padded = text + '='.repeat((4 - (text.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

/** True when this environment can host a peer-to-peer match at all. */
export function isPeerSupported(): boolean {
  return typeof RTCPeerConnection !== 'undefined'
}
