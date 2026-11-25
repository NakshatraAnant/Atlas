import { describe, expect, it } from 'vitest';
import { safeInternalPath } from './safe-path';

describe('safeInternalPath', () => {
  it('keeps same-site paths', () => {
    for (const p of ['/app', '/app/x?a=1#b', '/']) expect(safeInternalPath(p)).toBe(p);
  });
  it('refuses anything a browser could read as another site', () => {
    for (const p of [null, '', 'app', '//evil.example', '/\\evil.example', '/\t/evil.example', '/\n/evil.example', 'https://evil.example', 'javascript:alert(1)', '/..//evil.example']) expect(safeInternalPath(p)).toBeNull();
  });
});
