// Builds the banner to dist/b.js and HARD-FAILS if it exceeds the 10KB gzip budget.
// The size gate is the product's core promise — never raise it without a deliberate decision.
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';

const BUDGET_BYTES = 10 * 1024; // 10KB gzipped — the line incumbents can't cross.

const result = await build({
  entryPoints: ['src/banner.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2019'],
  legalComments: 'none',
  outfile: 'dist/b.js',
  write: true,
});

if (result.errors.length) {
  console.error(result.errors);
  process.exit(1);
}

const raw = readFileSync('dist/b.js');
const gz = gzipSync(raw, { level: 9 });
const kb = (n) => (n / 1024).toFixed(2) + ' KB';

console.log(`banner: ${kb(raw.length)} raw / ${kb(gz.length)} gzip  (budget ${kb(BUDGET_BYTES)})`);
writeFileSync('dist/b.js.gz', gz);

if (gz.length > BUDGET_BYTES) {
  console.error(
    `\n✗ SIZE GATE FAILED: ${kb(gz.length)} gzip exceeds the ${kb(BUDGET_BYTES)} budget.\n` +
      `  Move logic to the edge or trim the runtime. This is the moat — do not bump the budget.`,
  );
  process.exit(1);
}
console.log('✓ size gate passed');
