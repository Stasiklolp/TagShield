import { describe, it, expect } from 'vitest';
import {
  canonicalJSON,
  appendToChain,
  verifyChain,
  verifyCanonicalChain,
  GENESIS,
  type ChainedRecord,
  type StoredChainRow,
} from '../src/hashchain';

describe('canonicalJSON', () => {
  it('is deterministic regardless of key insertion order', () => {
    expect(canonicalJSON({ b: 1, a: 2 })).toBe(canonicalJSON({ a: 2, b: 1 }));
  });

  it('sorts nested object keys but preserves array order', () => {
    expect(canonicalJSON({ z: { y: 1, x: 2 }, a: [3, 1, 2] })).toBe(
      '{"a":[3,1,2],"z":{"x":2,"y":1}}',
    );
  });

  it('handles null and primitives', () => {
    expect(canonicalJSON(null)).toBe('null');
    expect(canonicalJSON(42)).toBe('42');
    expect(canonicalJSON('x')).toBe('"x"');
  });
});

async function buildChain(n: number): Promise<ChainedRecord[]> {
  const rows: ChainedRecord[] = [];
  let head = GENESIS;
  for (let i = 0; i < n; i++) {
    const { chained, head: next } = await appendToChain(
      { site_key: 's', visitor: `v${i}`, i },
      head,
    );
    rows.push(chained);
    head = next;
  }
  return rows;
}

describe('hash chain', () => {
  it('links each record to the prior head, genesis-anchored', async () => {
    const rows = await buildChain(3);
    expect(rows[0].prev_hash).toBe(GENESIS);
    expect(rows[1].prev_hash).toBe(rows[0].record_hash);
    expect(rows[2].prev_hash).toBe(rows[1].record_hash);
  });

  it('verifies an intact chain of 1,000 records', async () => {
    const rows = await buildChain(1000);
    expect(await verifyChain(rows)).toEqual({ ok: true });
  });

  it('detects tampering with a record payload', async () => {
    const rows = await buildChain(50);
    (rows[20] as unknown as { i: number }).i = 999; // rewrite history
    const res = await verifyChain(rows);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.index).toBe(20);
      expect(res.reason).toMatch(/tampered/);
    }
  });

  it('detects a deleted/spliced record via broken linkage', async () => {
    const rows = await buildChain(10);
    rows.splice(5, 1);
    const res = await verifyChain(rows);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.index).toBe(5);
  });

  it('detects a swapped record_hash', async () => {
    const rows = await buildChain(10);
    rows[7].record_hash = rows[8].record_hash;
    const res = await verifyChain(rows);
    expect(res.ok).toBe(false);
  });
});

async function buildStored(n: number): Promise<StoredChainRow[]> {
  const rows: StoredChainRow[] = [];
  let head = GENESIS;
  for (let i = 0; i < n; i++) {
    const { chained, head: next, canonical } = await appendToChain({ site_id: 's', i }, head);
    rows.push({ prev_hash: chained.prev_hash, record_hash: chained.record_hash, canonical });
    head = next;
  }
  return rows;
}

describe('verifyCanonicalChain (the production storage path)', () => {
  it('verifies an intact stored chain', async () => {
    expect(await verifyCanonicalChain(await buildStored(200))).toEqual({ ok: true });
  });

  it('detects a tampered canonical payload', async () => {
    const rows = await buildStored(30);
    rows[10].canonical = rows[10].canonical.replace('"i":10', '"i":999');
    const res = await verifyCanonicalChain(rows);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.index).toBe(10);
  });

  it('detects a broken link (deleted row)', async () => {
    const rows = await buildStored(10);
    rows.splice(4, 1);
    const res = await verifyCanonicalChain(rows);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.index).toBe(4);
  });
});
