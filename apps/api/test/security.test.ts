import { describe, expect, it } from 'vitest';
import { isLoopbackOrigin } from '../src/app.js';

describe('origin checks (CSRF defence in depth)', () => {
  it('accepts only exact loopback hosts', () => {
    for (const o of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000', 'https://localhost']) expect(isLoopbackOrigin(o)).toBe(true);
    for (const o of ['http://localhost.attacker.example', 'http://127.0.0.1.nip.io', 'http://evil.com/localhost', 'file://localhost', 'null', '']) expect(isLoopbackOrigin(o)).toBe(false);
  });
});
