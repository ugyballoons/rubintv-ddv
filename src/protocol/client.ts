import ReconnectingWebSocket from 'reconnecting-websocket';
import type { Command, Envelope, ErrorContent } from './types';

export type ConnectionStatus = 'connecting' | 'open' | 'stale' | 'closed';

export interface DdvClientOptions {
  /** Interval between pings; the worker answers `{"type":"pong"}`. */
  pingIntervalMs?: number;
  /** Silence after which the socket is considered stale and reconnected. */
  pongTimeoutMs?: number;
  /** Default per-request timeout. */
  requestTimeoutMs?: number;
  /** WebSocket constructor, for tests and non-browser environments. */
  WebSocket?: typeof WebSocket;
  newRequestId?: () => string;
}

interface Pending {
  resolve(env: Envelope): void;
  reject(err: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export class ProtocolError extends Error {
  readonly content: ErrorContent;
  constructor(content: ErrorContent) {
    super(`${content.error}: ${content.description}`);
    this.name = 'ProtocolError';
    this.content = content;
  }
}

/**
 * One websocket, one request/response correlation table.
 * Replaces the Flutter pattern of a broadcast stream every bloc filters by hand.
 */
export class DdvClient {
  private ws: ReconnectingWebSocket | null = null;
  private readonly pending = new Map<string, Pending>();
  private readonly statusListeners = new Set<(s: ConnectionStatus) => void>();
  private readonly messageListeners = new Set<(env: Envelope) => void>();
  private readonly errorListeners = new Set<(err: ProtocolError) => void>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastPong = 0;
  private _status: ConnectionStatus = 'closed';
  private readonly opts: Required<DdvClientOptions>;

  readonly url: string;

  constructor(url: string, options: DdvClientOptions = {}) {
    this.url = url;
    this.opts = {
      pingIntervalMs: options.pingIntervalMs ?? 5_000,
      pongTimeoutMs: options.pongTimeoutMs ?? 20_000,
      requestTimeoutMs: options.requestTimeoutMs ?? 60_000,
      WebSocket: options.WebSocket ?? globalThis.WebSocket,
      newRequestId: options.newRequestId ?? (() => crypto.randomUUID()),
    };
  }

  get status(): ConnectionStatus {
    return this._status;
  }

  connect(): void {
    if (this.ws) return;
    this.setStatus('connecting');
    this.ws = new ReconnectingWebSocket(this.url, [], {
      WebSocket: this.opts.WebSocket,
      maxEnqueuedMessages: 0,
    });
    this.ws.addEventListener('open', () => {
      this.lastPong = Date.now();
      this.setStatus('open');
      this.startPing();
    });
    this.ws.addEventListener('close', () => {
      this.stopPing();
      this.setStatus(this.ws ? 'connecting' : 'closed');
    });
    this.ws.addEventListener('message', (ev) => this.handleRaw(String(ev.data)));
  }

  close(): void {
    this.stopPing();
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(`client closed while request ${id} was pending`));
    }
    this.pending.clear();
    this.setStatus('closed');
  }

  onStatus(cb: (s: ConnectionStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  /** Every non-pong envelope, including replies, for consumers that need unsolicited messages. */
  onMessage(cb: (env: Envelope) => void): () => void {
    this.messageListeners.add(cb);
    return () => this.messageListeners.delete(cb);
  }

  private handleRaw(raw: string): void {
    let env: Envelope;
    try {
      env = JSON.parse(raw) as Envelope;
    } catch {
      return;
    }
    if (env.type === 'pong') {
      this.lastPong = Date.now();
      if (this._status === 'stale') this.setStatus('open');
      return;
    }
    if (env.type === 'error') {
      const err = new ProtocolError(env.content as ErrorContent);
      const p = env.requestId ? this.pending.get(env.requestId) : undefined;
      if (p && env.requestId) {
        this.pending.delete(env.requestId);
        clearTimeout(p.timer);
        p.reject(err);
      } else {
        // The service does not echo requestId on errors today (see plan §6), so
        // errors are surfaced globally; pending requests fall back to their timeout.
        for (const cb of this.errorListeners) cb(err);
      }
      return;
    }
    if (env.requestId) {
      const p = this.pending.get(env.requestId);
      if (p) {
        this.pending.delete(env.requestId);
        clearTimeout(p.timer);
        p.resolve(env);
      }
    }
    for (const cb of this.messageListeners) cb(env);
  }

  onError(cb: (err: ProtocolError) => void): () => void {
    this.errorListeners.add(cb);
    return () => this.errorListeners.delete(cb);
  }

  /** Fire-and-forget. */
  send(command: Command): void {
    if (!this.ws) throw new Error('not connected');
    this.ws.send(JSON.stringify(command));
  }

  /** Send a command and resolve with the correlated reply. */
  request<T = unknown>(
    name: string,
    parameters: Record<string, unknown>,
    options: { timeoutMs?: number } = {},
  ): Promise<Envelope<T>> {
    const requestId = this.opts.newRequestId();
    const timeoutMs = options.timeoutMs ?? this.opts.requestTimeoutMs;
    return new Promise<Envelope<T>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`request "${name}" (${requestId}) timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve: resolve as (e: Envelope) => void, reject, timer });
      try {
        this.send({ name, parameters, requestId });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(e as Error);
      }
    });
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (!this.ws) return;
      if (Date.now() - this.lastPong > this.opts.pongTimeoutMs) {
        this.setStatus('stale');
        this.ws.reconnect();
        return;
      }
      this.ws.send(JSON.stringify({ type: 'ping' }));
    }, this.opts.pingIntervalMs);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private setStatus(s: ConnectionStatus): void {
    if (s === this._status) return;
    this._status = s;
    for (const cb of this.statusListeners) cb(s);
  }
}
