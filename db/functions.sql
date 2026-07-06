-- Tagshield — helper SQL functions. Apply after schema.sql:
--   psql "$DATABASE_URL" -f db/functions.sql

-- Month-to-date unique billable visitors across an org's sites (the flat per-visitor meter).
-- SECURITY DEFINER so the dashboard can call it via PostgREST RPC regardless of RLS.
create or replace function org_month_uniques(p_org uuid, p_since timestamptz)
returns bigint
language sql stable security definer set search_path = public as $$
  select count(distinct cl.visitor_pseudo_id)
  from consent_logs cl
  join sites s on s.id = cl.site_id
  where s.org_id = p_org
    and cl.created_at >= p_since
$$;
