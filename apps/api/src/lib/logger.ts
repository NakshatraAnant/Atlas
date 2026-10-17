// Structured JSON logging with correlation IDs (NFR-09). One line per event; personal data is
// never logged — callers pass user IDs, never emails or names.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

const REDACT = /(password|token|secret|authorization|cookie|totp|otp|card|upi)/i;

function redact(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = REDACT.test(k) ? '[redacted]' : v instanceof Error ? { message: v.message, stack: v.stack } : v;
  return out;
}

export function createLogger(level: LogLevel = 'info', base: Record<string, unknown> = {}, sink: (line: string) => void = (l) => process.stdout.write(`${l}\n`)): Logger {
  const emit = (lvl: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (ORDER[lvl] < ORDER[level]) return;
    sink(JSON.stringify({ ts: new Date().toISOString(), level: lvl, msg, ...base, ...(fields ? redact(fields) : {}) }));
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (fields) => createLogger(level, { ...base, ...fields }, sink),
  };
}
