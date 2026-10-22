import type { Config } from './config.js';
import type { Db } from './db/db.js';
import type { Logger } from './lib/logger.js';
import type { ObjectStore } from './lib/objectStore.js';
import type { RateLimiter } from './lib/rateLimit.js';
import type { ModelGateway } from './modules/ai/gateway.js';
import type { CryptoModule } from './modules/crypto/index.js';
import type { PaymentGateway } from './modules/billing/gateway.js';
import type { EmailTransport } from './modules/notify/email.js';
import { loadRightsMatrix, type RightsMatrix } from './modules/ref/rights.js';
import type { VendorAdapter } from './pipeline/vendor.js';

export interface AppContext {
  cfg: Config;
  db: Db;
  store: ObjectStore;
  log: Logger;
  clock: () => Date;
  limiter: RateLimiter;
  email: EmailTransport;
  payments: PaymentGateway;
  ai: ModelGateway;
  vendor: VendorAdapter;
  rights: () => Promise<RightsMatrix>;
  /** ATLAS Digital Assets (crypto data, scheduler, live feed). */
  crypto?: CryptoModule;
}

export interface SessionUser {
  userId: string;
  email: string;
  role: 'user' | 'support' | 'data_ops' | 'admin';
  verified: boolean;
  mfaVerified: boolean;
  totpEnabled: boolean;
  sessionHash: string;
  displayName: string | null;
  experienceLevel: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
    anonId?: string;
  }
}

export function cachedRights(db: Db, cfg: Config, ttlMs = 60_000): () => Promise<RightsMatrix> {
  let cache: { at: number; m: RightsMatrix } | null = null;
  return async () => {
    if (cache && Date.now() - cache.at < ttlMs) return cache.m;
    const m = await loadRightsMatrix(db, { allowDevLicences: cfg.allowSyntheticData });
    cache = { at: Date.now(), m };
    return m;
  };
}
