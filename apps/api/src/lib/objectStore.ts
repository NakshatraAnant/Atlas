import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

// Object storage for immutable raw vendor files, documents, backtest series and exports.
// Local filesystem in development; the interface matches what an S3 adapter must provide
// (versioned bucket, block public access — Blueprint §4.2, §9.1).

export interface ObjectStore {
  put(key: string, body: Buffer | string): Promise<{ key: string; sha256: string; bytes: number }>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
}

export function sha256(body: Buffer | string): string {
  return createHash('sha256').update(body).digest('hex');
}

function safeKey(key: string): string {
  const n = normalize(key).replace(/\\/g, '/');
  if (n.startsWith('..') || n.startsWith('/') || n.includes('/../')) throw new Error(`Unsafe object key: ${key}`);
  return n;
}

export class LocalObjectStore implements ObjectStore {
  constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true });
  }
  async put(key: string, body: Buffer | string) {
    const k = safeKey(key);
    const path = join(this.root, k);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
    const buf = typeof body === 'string' ? Buffer.from(body) : body;
    return { key: k, sha256: sha256(buf), bytes: buf.length };
  }
  async get(key: string) {
    return readFileSync(join(this.root, safeKey(key)));
  }
  async exists(key: string) {
    return existsSync(join(this.root, safeKey(key)));
  }
}

export class MemoryObjectStore implements ObjectStore {
  private readonly items = new Map<string, Buffer>();
  async put(key: string, body: Buffer | string) {
    const k = safeKey(key);
    const buf = typeof body === 'string' ? Buffer.from(body) : body;
    this.items.set(k, buf);
    return { key: k, sha256: sha256(buf), bytes: buf.length };
  }
  async get(key: string) {
    const v = this.items.get(safeKey(key));
    if (!v) throw new Error(`Object not found: ${key}`);
    return v;
  }
  async exists(key: string) {
    return this.items.has(safeKey(key));
  }
}
