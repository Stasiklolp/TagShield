/**
 * Consent Proof export — a portable, offline-verifiable bundle of a site's consent hash chain.
 *
 * This is the switching cost: a customer can hand the bundle (+ the bundled verifier) to an
 * auditor or regulator who re-checks the entire chain with zero trust in Tagshield and zero
 * network access. Ripping Tagshield out means abandoning a proof trail they can independently
 * stand behind — so they don't.
 */
import { verifyCanonicalChain, type StoredChainRow, GENESIS } from './hashchain';

export interface ProofBundle {
  product: 'tagshield-consent-proof';
  version: 1;
  site: string;
  exported_at: string;
  genesis: string;
  count: number;
  /** Tagshield's own verification at export time; the verifier re-checks independently. */
  self_check: { ok: true } | { ok: false; index: number; reason: string };
  records: StoredChainRow[];
}

export async function buildProofBundle(
  site: string,
  rows: StoredChainRow[],
  exportedAt: string,
): Promise<ProofBundle> {
  const self_check = await verifyCanonicalChain(rows);
  return {
    product: 'tagshield-consent-proof',
    version: 1,
    site,
    exported_at: exportedAt,
    genesis: GENESIS,
    count: rows.length,
    self_check,
    records: rows,
  };
}

const csvCell = (s: string): string => `"${String(s).replace(/"/g, '""')}"`;

export function bundleToCsv(bundle: ProofBundle): string {
  const header = 'index,prev_hash,record_hash,canonical';
  const lines = bundle.records.map((r, i) =>
    [i, csvCell(r.prev_hash), csvCell(r.record_hash), csvCell(r.canonical)].join(','),
  );
  return [header, ...lines].join('\n') + '\n';
}

/**
 * Standalone, dependency-free Node verifier shipped alongside the bundle. It reproduces exactly
 * the chain rule the edge uses: record_hash === SHA-256(canonical + prev_hash), genesis-anchored.
 * Uses string concatenation (not template interpolation) so it survives being embedded here.
 */
export const VERIFIER_JS = `#!/usr/bin/env node
/* Tagshield Consent Proof verifier - standalone, dependency-free.
   Usage: node verify.js <proof-bundle.json>
   Exit 0 = chain intact; 1 = tampering detected; 2 = usage error. */
const fs = require('fs');
const crypto = require('crypto');
const GENESIS = '0'.repeat(64);
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const file = process.argv[2];
if (!file) { console.error('usage: node verify.js <proof-bundle.json>'); process.exit(2); }
const bundle = JSON.parse(fs.readFileSync(file, 'utf8'));
let prev = bundle.genesis || GENESIS;
for (let i = 0; i < bundle.records.length; i++) {
  const r = bundle.records[i];
  if (r.prev_hash !== prev) {
    console.error('BREAK at ' + i + ': prev_hash does not match prior record_hash');
    process.exit(1);
  }
  if (sha256(r.canonical + r.prev_hash) !== r.record_hash) {
    console.error('BREAK at ' + i + ': record_hash does not match contents (tampered)');
    process.exit(1);
  }
  prev = r.record_hash;
}
console.log('OK: ' + bundle.records.length + ' records verified, chain intact. Head: ' + prev);
process.exit(0);
`;
