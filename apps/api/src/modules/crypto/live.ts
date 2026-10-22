// Venue-specific streaming prices from Binance's public market-data WebSocket (miniTicker streams).
// "Live" is a claim about data, not about a socket: the feed reports `live` only while valid messages
// keep arriving. An open connection with no recent messages is `stale`; the UI shows the difference.
// Reconnection uses bounded exponential back-off; the stream subscribes only to a small set of pairs.

export interface LiveTicker {
  product_id: string;
  last: number;
  open_24h: number;
  high_24h: number;
  low_24h: number;
  volume_24h: number;
  event_time: string;
  received_at: string;
}

export type FeedState = 'disabled' | 'connecting' | 'live' | 'stale' | 'disconnected';

export interface WsLike {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  close(): void;
}
export type WsFactory = (url: string) => WsLike;

export const LIVE_STREAM_BASE = 'wss://data-stream.binance.vision/stream?streams=';
export const STALE_AFTER_MS = 15_000;

export function parseMiniTicker(raw: unknown, receivedAt: number): LiveTicker | null {
  let msg: any;
  try {
    msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  const d = msg?.data ?? msg;
  if (!d || d.e !== '24hrMiniTicker' || typeof d.s !== 'string' || typeof d.E !== 'number') return null;
  const n = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? Number(v) : NaN);
  const last = n(d.c);
  const open = n(d.o);
  const high = n(d.h);
  const low = n(d.l);
  const vol = n(d.v);
  if (![last, open, high, low, vol].every(Number.isFinite) || last <= 0 || high < low) return null;
  return { product_id: d.s, last, open_24h: open, high_24h: high, low_24h: low, volume_24h: vol, event_time: new Date(d.E).toISOString(), received_at: new Date(receivedAt).toISOString() };
}

export class LiveFeed {
  private ws: WsLike | null = null;
  private readonly tickers = new Map<string, LiveTicker>();
  private state: FeedState = 'disabled';
  private lastMessageAt: number | null = null;
  private connectedAt: number | null = null;
  private attempts = 0;
  private reconnects = 0;
  private dropped = 0;
  private timer: NodeJS.Timeout | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private stopped = true;
  private lastError: string | null = null;

  constructor(private readonly symbols: string[], private readonly factory: WsFactory, private readonly now: () => number = () => Date.now()) {}

  start(): void {
    if (!this.stopped || !this.symbols.length) return;
    this.stopped = false;
    this.connect();
    this.watchdog = setInterval(() => this.check(), 5_000);
    this.watchdog.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.watchdog) clearInterval(this.watchdog);
    this.timer = null;
    this.watchdog = null;
    try {
      this.ws?.close();
    } catch {
      // already closed
    }
    this.ws = null;
    this.state = 'disabled';
  }

  private connect(): void {
    if (this.stopped) return;
    this.state = 'connecting';
    const url = LIVE_STREAM_BASE + this.symbols.map((s) => `${s.toLowerCase()}@miniTicker`).join('/');
    let ws: WsLike;
    try {
      ws = this.factory(url);
    } catch (err) {
      this.lastError = (err as Error).message;
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.connectedAt = this.now();
      this.attempts = 0;
    };
    ws.onmessage = (ev) => this.handle(ev.data);
    ws.onerror = (ev) => {
      this.lastError = (ev as { message?: string })?.message ?? 'WebSocket error';
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.state = 'disconnected';
      this.scheduleReconnect();
    };
  }

  /** Exposed for tests: handle one raw stream message. */
  handle(raw: unknown): void {
    const t = parseMiniTicker(raw, this.now());
    if (!t) {
      this.dropped++;
      return;
    }
    const prior = this.tickers.get(t.product_id);
    // Out-of-order or duplicate events are ignored: the newest event time wins.
    if (prior && Date.parse(prior.event_time) >= Date.parse(t.event_time)) return;
    this.tickers.set(t.product_id, t);
    this.lastMessageAt = this.now();
    this.state = 'live';
  }

  private check(): void {
    if (this.stopped) return;
    if (this.state === 'live' && this.lastMessageAt !== null && this.now() - this.lastMessageAt > STALE_AFTER_MS) {
      this.state = 'stale';
      // A silent connection is replaced rather than trusted.
      try {
        this.ws?.close();
      } catch {
        // ignore
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.attempts++;
    this.reconnects++;
    const delay = Math.min(60_000, 1_000 * 2 ** Math.min(this.attempts - 1, 6));
    this.timer = setTimeout(() => this.connect(), delay);
    this.timer.unref?.();
  }

  snapshot() {
    const now = this.now();
    const fresh = this.lastMessageAt !== null && now - this.lastMessageAt <= STALE_AFTER_MS;
    const state: FeedState = this.stopped ? 'disabled' : this.state === 'live' && !fresh ? 'stale' : this.state;
    return {
      venue: 'binance',
      state,
      symbols: this.symbols,
      last_message_at: this.lastMessageAt ? new Date(this.lastMessageAt).toISOString() : null,
      connected_at: this.connectedAt ? new Date(this.connectedAt).toISOString() : null,
      stale_after_seconds: STALE_AFTER_MS / 1000,
      reconnects: this.reconnects,
      dropped_messages: this.dropped,
      last_error: this.lastError,
      tickers: [...this.tickers.values()].map((t) => ({ ...t, stale: now - Date.parse(t.received_at) > STALE_AFTER_MS })),
    };
  }
}
