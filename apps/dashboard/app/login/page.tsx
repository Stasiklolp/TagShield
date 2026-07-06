import { signIn, signUp } from './actions';
import { supabaseConfigured } from '@/lib/supabase/server';
import SetupNotice from '@/components/SetupNotice';

export const dynamic = 'force-dynamic';

export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string; message?: string };
}) {
  if (!supabaseConfigured()) return <SetupNotice />;
  return (
    <div className="container" style={{ paddingTop: 80 }}>
      <div className="card stack" style={{ maxWidth: 420, margin: '0 auto' }}>
        <div className="brand">⚡ Tagshield</div>
        <h2 style={{ margin: 0 }}>Sign in</h2>
        {searchParams.error && <div className="notice">{searchParams.error}</div>}
        {searchParams.message && (
          <div className="notice" style={{ borderColor: 'var(--ok)' }}>{searchParams.message}</div>
        )}
        <form className="stack">
          <div>
            <label>Email</label>
            <input name="email" type="email" required autoComplete="email" />
          </div>
          <div>
            <label>Password</label>
            <input name="password" type="password" required minLength={6} autoComplete="current-password" />
          </div>
          <div className="row">
            <button className="btn btn-primary" formAction={signIn}>Sign in</button>
            <button className="btn" formAction={signUp}>Create account</button>
          </div>
        </form>
      </div>
    </div>
  );
}
