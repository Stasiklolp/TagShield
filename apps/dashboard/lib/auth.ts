import { redirect } from 'next/navigation';
import { createClient } from './supabase/server';
import { adminClient } from './supabase/admin';

export interface Org {
  id: string;
  name: string;
  plan: string;
  billing_visitor_quota: number;
  stripe_customer_id: string | null;
}

/** The current authenticated auth user, or null. */
export async function getUser() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Ensure there is a signed-in user; otherwise redirect to /login. */
export async function requireUser() {
  const user = await getUser();
  if (!user) redirect('/login');
  return user;
}

/**
 * Resolve (and lazily bootstrap) the user's organization. On first login this mirrors the auth
 * user into `users`, then creates a personal org + owner membership. Uses the admin client because
 * bootstrapping tenancy rows is a privileged operation.
 */
export async function getCurrentOrg(userId: string, email: string): Promise<Org> {
  const db = adminClient();
  await db.from('users').upsert({ id: userId, email }, { onConflict: 'id' });

  const { data: mem } = await db
    .from('memberships')
    .select('org_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (mem?.org_id) {
    const { data: org } = await db.from('organizations').select('*').eq('id', mem.org_id).single();
    return org as Org;
  }

  const { data: org, error } = await db
    .from('organizations')
    .insert({ name: `${email.split('@')[0]}'s workspace` })
    .select()
    .single();
  if (error || !org) throw new Error(`org bootstrap failed: ${error?.message}`);
  await db.from('memberships').insert({ user_id: userId, org_id: org.id, role: 'owner' });
  return org as Org;
}

/** Convenience: require a user AND resolve their org in one call. */
export async function requireOrg(): Promise<{ userId: string; email: string; org: Org }> {
  const user = await requireUser();
  const org = await getCurrentOrg(user.id, user.email!);
  return { userId: user.id, email: user.email!, org };
}
