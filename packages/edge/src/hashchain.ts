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

export async function sha256Hex(input: string): Promise<string> {
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

/**
 * Append one record to a chain.
 *
 * Returns the chained record, the new head hash, AND the exact `canonical` string the hash
 * commits to. Persist `canonical` verbatim: Postgres re-serializes timestamps and jsonb, so
 * reconstructing the hashed bytes from typed columns is fragile. Re-hashing the stored
 * canonical (see `verifyCanonicalChain`) is exact and round-trip-proof.
 */
export async function appendToChain(
  record: Record<string, unknown>,
  prevHash: string,
): Promise<{ chained: ChainedRecord; head: string; canonical: string }> {
  const base = { ...record, prev_hash: prevHash };
  const canonical = canonicalJSON(base);
  const head = await sha256Hex(canonical + prevHash);
  return { chained: { ...base, record_hash: head }, head, canonical };
}

/** A chain row as stored in / loaded from the vault: the two hashes + the integrity witness. */
export interface StoredChainRow {
  prev_hash: string;
  record_hash: string;
  canonical: string;
}

/**
 * Verify a chain loaded from storage by re-hashing each stored `canonical` payload. This is the
 * production path (see the Worker's GET /verify/:key) and is immune to DB type round-tripping,
 * because it never reconstructs the hashed bytes from typed columns.
 */
export async function verifyCanonicalChain(
  rows: StoredChainRow[],
  genesis = GENESIS,
): Promise<{ ok: true } | { ok: false; index: number; reason: string }> {
  let prev = genesis;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.prev_hash !== prev) {
      return { ok: false, index: i, reason: 'prev_hash does not match prior record_hash' };
    }
    const expect = await sha256Hex(r.canonical + r.prev_hash);
    if (expect !== r.record_hash) {
      return { ok: false, index: i, reason: 'record_hash does not match stored canonical (tampered)' };
    }
    prev = r.record_hash;
  }
  return { ok: true };
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
