/** A same-site path to go to after an action, or null. Browsers read "/\host" and "/<tab>/host" as "//host". */
export function safeInternalPath(v: string | null | undefined): string | null {
  if (!v || !v.startsWith('/') || /[\\\u0000-\u001f\u007f]/.test(v)) return null;
  try {
    const base = 'https://atlas.invalid';
    const u = new URL(v, base);
    return u.origin === base && !u.pathname.startsWith('//') ? u.pathname + u.search + u.hash : null;
  } catch {
    return null;
  }
}
