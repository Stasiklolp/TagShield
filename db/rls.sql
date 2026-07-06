-- Tagshield — Row-Level Security.
-- The dashboard performs privileged writes with the Supabase service-role key (which BYPASSES
-- RLS), so these policies are defense-in-depth: they isolate tenants for any access made with the
-- anon key + a user JWT (e.g. if you later query directly from the browser). Apply after schema.sql:
--   psql "$DATABASE_URL" -f db/rls.sql

-- Set of org_ids the current auth user belongs to. SECURITY DEFINER avoids recursive RLS when a
-- policy on another table references memberships.
create or replace function auth_org_ids() returns setof uuid
  language sql stable security definer set search_path = public as $$
  select org_id from memberships where user_id = auth.uid()
$$;

alter table organizations  enable row level security;
alter table users          enable row level security;
alter table memberships    enable row level security;
alter table sites          enable row level security;
alter table banner_configs enable row level security;
alter table scans          enable row level security;
alter table site_cookies   enable row level security;
alter table integrations   enable row level security;
alter table exports        enable row level security;
alter table vault_anchors  enable row level security;
alter table api_keys       enable row level security;
-- consent_logs is written only by the edge service role and is high-volume: RLS on, no policy
-- (deny-all to non-service clients).
alter table consent_logs   enable row level security;

create policy org_read   on organizations  for select using (id in (select auth_org_ids()));
create policy user_self   on users          for select using (id = auth.uid());
create policy mem_self    on memberships    for select using (user_id = auth.uid());
create policy sites_tenant on sites         for select using (org_id in (select auth_org_ids()));

create policy banner_tenant on banner_configs for select using (
  site_id in (select id from sites where org_id in (select auth_org_ids())));
create policy scans_tenant on scans for select using (
  site_id in (select id from sites where org_id in (select auth_org_ids())));
create policy cookies_tenant on site_cookies for select using (
  site_id in (select id from sites where org_id in (select auth_org_ids())));
create policy integrations_tenant on integrations for select using (
  site_id in (select id from sites where org_id in (select auth_org_ids())));
create policy exports_tenant on exports for select using (org_id in (select auth_org_ids()));
create policy anchors_tenant on vault_anchors for select using (
  site_id in (select id from sites where org_id in (select auth_org_ids())));
create policy apikeys_tenant on api_keys for select using (org_id in (select auth_org_ids()));

-- cookie_definitions and jurisdiction_rules are global reference data — left readable (no RLS).
