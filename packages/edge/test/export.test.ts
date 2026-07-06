import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendToChain, GENESIS, type StoredChainRow } from '../src/hashchain';
import { buildProofBundle, bundleToCsv, VERIFIER_JS } from '../src/export';

async function chain(n: number): Promise<StoredChainRow[]> {
  const rows: StoredChainRow[] = [];
  let head = GENESIS;
  for (let i = 0; i < n; i++) {
    const { chained, head: next, canonical } = await appendToChain({ site_id: 's', i }, head);
    rows.push({ prev_hash: chained.prev_hash, record_hash: chained.record_hash, canonical });
    head = next;
  }
  return rows;
}

/** Write the shipped verifier + a bundle to a temp dir and run it exactly as a customer would. */
function runVerifier(bundleJson: string): { code: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tsproof-'));
  const vfile = join(dir, 'verify.js');
  const bfile = join(dir, 'bundle.json');
  writeFileSync(vfile, VERIFIER_JS);
  writeFileSync(bfile, bundleJson);
  try {
    return { code: 0, out: execFileSync('node', [vfile, bfile], { encoding: 'utf8' }) };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: (err.stdout || '') + (err.stderr || '') };
  }
}

describe('proof export', () => {
  it('self-check passes on an intact chain', async () => {
    const b = await buildProofBundle('demo', await chain(25), '2026-07-06T00:00:00.000Z');
    expect(b.self_check).toEqual({ ok: true });
    expect(b.count).toBe(25);
  });

  it('CSV has a header and one line per record', async () => {
    const b = await buildProofBundle('demo', await chain(5), '2026-07-06T00:00:00.000Z');
    const lines = bundleToCsv(b).trim().split('\n');
    expect(lines[0]).toBe('index,prev_hash,record_hash,canonical');
    expect(lines).toHaveLength(6); // header + 5 records
  });

  it('the bundled offline verifier passes on an intact bundle', async () => {
    const b = await buildProofBundle('demo', await chain(20), '2026-07-06T00:00:00.000Z');
    const res = runVerifier(JSON.stringify(b));
    expect(res.code).toBe(0);
    expect(res.out).toMatch(/chain intact/);
  });

  it('the bundled offline verifier fails on a tampered bundle', async () => {
    const b = await buildProofBundle('demo', await chain(20), '2026-07-06T00:00:00.000Z');
    b.records[8].canonical = b.records[8].canonical.replace('"i":8', '"i":8888');
    const res = runVerifier(JSON.stringify(b));
    expect(res.code).toBe(1);
    expect(res.out).toMatch(/BREAK at 8/);
  });
});
