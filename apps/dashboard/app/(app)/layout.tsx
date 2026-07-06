import type { ReactNode } from 'react';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { supabaseConfigured } from '@/lib/supabase/server';
import { signOut } from '../login/actions';
import SetupNotice from '@/components/SetupNotice';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  if (!supabaseConfigured()) return <SetupNotice />;
  const user = await requireUser();
  return (
    <>
      <header className="appbar">
        <div className="container appbar-inner">
          <Link href="/" className="brand">⚡ Tagshield</Link>
          <div className="row">
            <Link href="/" className="muted">Sites</Link>
            <Link href="/billing" className="muted">Billing</Link>
            <span className="muted" style={{ fontSize: 13 }}>{user.email}</span>
            <form action={signOut}>
              <button className="btn" type="submit">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="container" style={{ paddingBottom: 60 }}>{children}</main>
    </>
  );
}
