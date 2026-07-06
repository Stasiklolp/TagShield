import { createClient } from '@supabase/supabase-js';

/**
 * Service-role client for trusted server-side writes/reads (bypasses RLS). NEVER import this into
 * a Client Component — the service-role key must never reach the browser. All queries made with it
 * MUST be explicitly scoped to the authenticated user's org.
 */
export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
