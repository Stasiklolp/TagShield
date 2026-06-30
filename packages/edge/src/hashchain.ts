/**
 * Tamper-evident consent log.
 *
 * Each consent record for a site is appended to a hash chain:
 *   record_hash = SHA-256( canonicalJSON(record) + prev_hash )
 *
 * Altering any past record changes its hash and breaks every downstream hash, so a tampered
 * log fails verification. The daily chain head is anchored externally (vault_anchors + R2
 * object-lock) so even the operator cannot silently rewrite history.
 *
 * Uses Web Crypto (crypto.subtle), available in Cloudflare Workers and modern Node.
 */

export const GENESIS = '0'.repeat(64);

/** Deterministic JSON: object keys sorted recursively. Arrays preserve order. */
export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJSON(obj[k])).join(',') + '}';
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compute the hash for a record given the previous record's hash. */
export async function recordHash(record: unknown, prevHash: string): Promise<string> {
  return sha256Hex(canonicalJSON(record) + prevHash);
}

export interface ChainedRecord {
  prev_hash: string;
  record_hash: string;
  [k: string]: unknown;
}

/** Append one record to a chain, returning the chained record + the new head hash. */
export async function appendToChain(
  record: Record<string, unknown>,
  prevHash: string,
): Promise<{ chained: ChainedRecord; head: string }> {
  const base = { ...record, prev_hash: prevHash };
  const head = await recordHash(base, prevHash);
  return { chained: { ...base, record_hash: head }, head };
}

/**
 * Verify an ordered list of chained records. Returns the first break (or null if intact).
 * Use this in the "Verify integrity" endpoint and in exported proof bundles.
 */
export async function verifyChain(
  records: ChainedRecord[],
  genesis = GENESIS,
): Promise<{ ok: true } | { ok: false; index: number; reason: string }> {
  let prev = genesis;
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.prev_hash !== prev) {
      return { ok: false, index: i, reason: 'prev_hash does not match prior record_hash' };
    }
    const { record_hash, ...rest } = r;
    const expect = await recordHash(rest, r.prev_hash);
    if (expect !== record_hash) {
      return { ok: false, index: i, reason: 'record_hash does not match contents (tampered)' };
    }
    prev = record_hash;
  }
  return { ok: true };
}
