/**
 * PeerTransport — Transport over WebRTC using peerjs.
 *
 * peerjs handles the WebRTC signalling for us via its free public broker
 * (0.peerjs.com), so this works on a plain HTTPS static host (e.g. GitHub
 * Pages) with NO server of our own. The broker is only used to exchange the
 * initial connection handshake; once the DataConnection is open, game traffic
 * flows peer-to-peer.
 *
 * Roles:
 *  - host: creates a Peer whose id IS the room code (a short generated code).
 *    If the broker rejects that id we fall back to whatever id it assigns and
 *    expose that as the roomCode.
 *  - guest: creates an anonymous Peer, then dials the host's room code.
 *
 * The free broker has no SLA. For production you can pass your own PeerJS
 * server config via the constructor options; the defaults target the public
 * broker which is fine for casual / dev use.
 */

import { Peer } from 'peerjs';
import type { DataConnection } from 'peerjs';
import type { NetMessage, NetStatus, Transport } from './Transport';

/** Connection-open watchdog: if the broker/peer never opens, surface 'error'. */
const CONNECT_TIMEOUT_MS = 20000;

export interface PeerTransportOptions {
  /** Optional display name forwarded in the opening 'hello'. */
  name?: string;
  /** Optional peerjs server overrides (host/port/path/key/secure). */
  peerOptions?: ConstructorParameters<typeof Peer>[1];
}

/** Generate a short, human-friendly, unambiguous room code (no 0/O/1/I). */
export function generateRoomCode(len = 6): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export class PeerTransport implements Transport {
  readonly role: 'host' | 'guest';
  private _roomCode: string;

  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private messageCbs: Array<(m: NetMessage) => void> = [];
  private statusCbs: Array<(s: NetStatus) => void> = [];
  private opts: PeerTransportOptions;
  private connected = false;
  private closed = false;
  private timeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param role  'host' creates the room, 'guest' joins it.
   * @param roomCode for host: the desired peer id (defaults to a generated
   *   code); for guest: the host's room code to dial.
   */
  constructor(role: 'host' | 'guest', roomCode?: string, opts: PeerTransportOptions = {}) {
    this.role = role;
    this.opts = opts;
    this._roomCode = roomCode ?? (role === 'host' ? generateRoomCode() : '');
    if (role === 'guest' && !this._roomCode) {
      throw new Error('PeerTransport(guest) requires a roomCode to join.');
    }
  }

  get roomCode(): string {
    return this._roomCode;
  }

  connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.emitStatus('connecting');

      // Host registers under the room code; guest is anonymous (undefined id).
      const peerId = this.role === 'host' ? this._roomCode : undefined;
      const peer = new Peer(peerId as string, this.opts.peerOptions);
      this.peer = peer;

      let settled = false;
      const fail = (err: unknown): void => {
        if (settled) return;
        settled = true;
        this.clearTimeout();
        this.emitStatus('error');
        reject(err instanceof Error ? err : new Error(String(err)));
      };
      const succeed = (): void => {
        if (settled) return;
        settled = true;
        this.clearTimeout();
        resolve();
      };

      this.timeout = setTimeout(
        () => fail(new Error('Connection timed out')),
        CONNECT_TIMEOUT_MS,
      );

      peer.on('error', (err) => {
        // After we're connected, a transient broker error shouldn't kill us;
        // before connection it's fatal for this attempt.
        if (this.connected) {
          this.emitStatus('error');
        } else {
          fail(err);
        }
      });

      peer.on('open', (id) => {
        // The broker may have assigned a different id than we asked for.
        if (this.role === 'host') {
          this._roomCode = id;
          // Host waits for the guest to dial in.
          peer.on('connection', (c) => {
            // Accept the first connection only; ignore extras for v1.
            if (this.conn) {
              c.close();
              return;
            }
            this.bindConnection(c, succeed);
          });
        } else {
          // Guest dials the host's room code.
          const c = peer.connect(this._roomCode, { reliable: true });
          this.bindConnection(c, succeed);
        }
      });
    });
  }

  send(msg: NetMessage): void {
    if (!this.connected || !this.conn) return;
    try {
      this.conn.send(JSON.stringify(msg));
    } catch {
      // Swallow send errors; status changes drive reconnect decisions.
    }
  }

  onMessage(cb: (m: NetMessage) => void): void {
    this.messageCbs.push(cb);
  }

  onStatus(cb: (s: NetStatus) => void): void {
    this.statusCbs.push(cb);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.connected = false;
    this.clearTimeout();
    try {
      this.conn?.close();
    } catch {
      /* ignore */
    }
    try {
      this.peer?.destroy();
    } catch {
      /* ignore */
    }
    this.conn = null;
    this.peer = null;
    this.emitStatus('disconnected');
  }

  /** Wire a DataConnection's lifecycle into our callbacks. */
  private bindConnection(c: DataConnection, onOpen: () => void): void {
    this.conn = c;

    c.on('open', () => {
      this.connected = true;
      this.emitStatus('connected');
      // Send our greeting so the peer can show a name.
      this.send({ t: 'hello', name: this.opts.name });
      onOpen();
    });

    c.on('data', (data) => {
      const msg = this.parse(data);
      if (msg) for (const cb of this.messageCbs) cb(msg);
    });

    c.on('close', () => {
      this.connected = false;
      this.emitStatus('disconnected');
    });

    c.on('error', () => {
      this.emitStatus('error');
    });
  }

  /** Parse inbound data (JSON string, or already-decoded object) into a NetMessage. */
  private parse(data: unknown): NetMessage | null {
    try {
      const obj = typeof data === 'string' ? JSON.parse(data) : data;
      if (obj && typeof obj === 'object' && typeof (obj as { t?: unknown }).t === 'string') {
        return obj as NetMessage;
      }
    } catch {
      /* ignore malformed frames */
    }
    return null;
  }

  private emitStatus(s: NetStatus): void {
    for (const cb of this.statusCbs) cb(s);
  }

  private clearTimeout(): void {
    if (this.timeout != null) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }
}
