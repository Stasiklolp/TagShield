/**
 * Lightweight KV fixed-window rate limiter for the public endpoints.
 *
 * Keyed by client IP + a time window. Not perfectly atomic (KV get→put can race under burst
 * concurrency), but coarse limiting is exactly what these endpoints need: it caps a single abuser
 * hammering the free /scan tool (which does a server-side fetch per call) without adding a hot-path
 * dependency. For strict volumetric protection, layer Cloudflare's native rate-limiting rules on top.
 */
export async function rateLimited(
  kv: KVNamespace,
  bucket: string,
  ip: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  if (!ip) return false; // can't attribute — don't block (WAF handles the no-IP case)
  const window = Math.floor(Date.now() / 1000 / windowSec);
  const key = `rl:${bucket}:${ip}:${window}`;
  const current = parseInt((await kv.get(key)) || '0', 10);
  if (current >= limit) return true;
  await kv.put(key, String(current + 1), { expirationTtl: windowSec * 2 });
  return false;
}
