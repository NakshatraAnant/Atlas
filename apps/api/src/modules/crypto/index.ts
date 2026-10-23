import type { Config } from '../../config.js';
import type { Db } from '../../db/db.js';
import type { Logger } from '../../lib/logger.js';
import { ProviderClient, offlineFetch, type FetchLike } from './http.js';
import { closeInterruptedJobs, type CryptoRuntime } from './ingest.js';
import { LiveFeed, type WsFactory } from './live.js';
import { syncRegistry } from './registry.js';
import { cryptoTick } from './scheduler.js';

// Wiring for ATLAS Digital Assets: registry sync, provider client, scheduler and live feed.

export interface CryptoModule {
  rt: CryptoRuntime;
  live: LiveFeed | null;
  /** Start the scheduler and live feed (API process only). Returns a stop function. */
  start(): () => void;
}

export interface CryptoOptions {
  fetch?: FetchLike;
  ws?: WsFactory;
  now?: () => number;
}

export async function createCryptoModule(db: Db, cfg: Config, log: Logger, opts: CryptoOptions = {}): Promise<CryptoModule> {
  await syncRegistry(db);
  const now = opts.now ?? (() => Date.now());
  // Tests never reach the network: without an explicit fetch they get one that always fails.
  const fetchImpl: FetchLike = opts.fetch ?? (cfg.NODE_ENV === 'test' ? offlineFetch : (globalThis.fetch as unknown as FetchLike));
  const client = new ProviderClient(db, fetchImpl, now);
  // A free Demo key raises CoinGecko's limit; ATLAS still stays well inside it.
  if (cfg.COINGECKO_DEMO_API_KEY) {
    client.setBudget('coingecko', 25);
    // Demo plan: 10,000 calls a month (verified 23 Oct 2026).
    client.setMonthlyCap('coingecko', 10_000);
  }
  const rt: CryptoRuntime = {
    db, client, log: log.child({ module: 'crypto' }), now,
    settings: {
      coingeckoDemoKey: cfg.COINGECKO_DEMO_API_KEY,
      universeSize: cfg.CRYPTO_UNIVERSE_SIZE,
      historyAssets: cfg.CRYPTO_HISTORY_ASSETS,
      backfillRequestsPerRun: cfg.CRYPTO_BACKFILL_REQUESTS_PER_RUN,
      ethereumRpcUrl: cfg.ETHEREUM_RPC_URL,
      ingestion: cfg.cryptoIngestion,
      liveFeed: cfg.cryptoLiveFeed,
    },
  };
  const wsFactory: WsFactory | null = opts.ws ?? (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'function' ? (url) => new (globalThis as unknown as { WebSocket: new (u: string) => never }).WebSocket(url) : null);
  const live = cfg.cryptoLiveFeed && wsFactory ? new LiveFeed(cfg.CRYPTO_LIVE_SYMBOLS.split(',').map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9]{4,20}$/.test(s)).slice(0, 12), wsFactory, now) : null;

  return {
    rt,
    live,
    start() {
      const timers: NodeJS.Timeout[] = [];
      let busy = false;
      const tick = async () => {
        if (busy || !rt.settings.ingestion) return;
        busy = true;
        try {
          await cryptoTick(rt);
        } catch (err) {
          rt.log.error('crypto scheduler tick failed', { error: err instanceof Error ? err.message : String(err) });
        } finally {
          busy = false;
        }
      };
      void closeInterruptedJobs(db, new Date(now())).then((n) => n && rt.log.warn('closed crypto jobs interrupted by a previous stop', { jobs: n }));
      if (rt.settings.ingestion) {
        timers.push(setTimeout(() => void tick(), 5_000));
        timers.push(setInterval(() => void tick(), 30_000));
      }
      live?.start();
      return () => {
        timers.forEach((t) => clearInterval(t));
        live?.stop();
      };
    },
  };
}
