export default function SetupNotice() {
  return (
    <div className="container" style={{ paddingTop: 60 }}>
      <div className="card stack" style={{ maxWidth: 640, margin: '0 auto' }}>
        <h2>Finish Supabase setup</h2>
        <p className="muted">
          The dashboard needs Supabase credentials. Copy <code>.env.example</code> to{' '}
          <code>.env.local</code> and fill in your project URL, anon key, and service-role key, then
          apply the schema:
        </p>
        <pre>
{`cp .env.example .env.local     # then edit it
psql "$DATABASE_URL" -f ../../db/schema.sql
psql "$DATABASE_URL" -f ../../db/rls.sql
pnpm --filter @tagshield/dashboard dev`}
        </pre>
        <p className="muted">Restart the dev server after editing env vars.</p>
      </div>
    </div>
  );
}
