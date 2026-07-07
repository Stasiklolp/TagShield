import { describe, it, expect } from 'vitest';
import { rateLimited } from '../src/guard';

function fakeKV() {
  const store = new Map<string, string>();
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => {
      store.set(k, v);
    },
  } as unknown as KVNamespace;
}

describe('rateLimited', () => {
  it('allows up to the limit, then blocks', async () => {
    const kv = fakeKV();
    const results: boolean[] = [];
    for (let i = 0; i < 12; i++) results.push(await rateLimited(kv, 'scan', '1.2.3.4', 10, 60));
    expect(results.slice(0, 10).every((r) => r === false)).toBe(true);
    expect(results.slice(10).every((r) => r === true)).toBe(true);
  });

  it('tracks each IP independently', async () => {
    const kv = fakeKV();
    for (let i = 0; i < 10; i++) await rateLimited(kv, 'scan', '1.1.1.1', 10, 60);
    expect(await rateLimited(kv, 'scan', '1.1.1.1', 10, 60)).toBe(true);
    expect(await rateLimited(kv, 'scan', '2.2.2.2', 10, 60)).toBe(false);
  });

  it('does not block when the IP is unknown', async () => {
    expect(await rateLimited(fakeKV(), 'scan', '', 1, 60)).toBe(false);
  });
});
