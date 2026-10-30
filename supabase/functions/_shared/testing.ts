/** Minimal assertions for Deno tests (jsr:@std/assert is not reachable from every build environment). */
export function assert(cond: unknown, msg = 'assertion failed'): asserts cond {
  if (!cond) throw new Error(msg);
}
export function assertFalse(cond: unknown, msg = 'expected false'): void {
  if (cond) throw new Error(msg);
}
export function assertEquals(actual: unknown, expected: unknown, msg?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg ? msg + ': ' : ''}expected ${e}, got ${a}`);
}
export async function assertRejects(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error('expected rejection');
}
