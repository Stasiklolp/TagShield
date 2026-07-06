-- Tagshield — Postgres schema
-- Core relational model + the high-volume, tamper-evident consent log.
-- Apply with:  psql "$DATABASE_URL" -f db/schema.sql
-- Target: Postgres 14+ (Supabase/Neon). Row-Level Security policies are sketched but commented;
-- enable + tune them for your auth provider before production.

create extension if not exists "pgcrypto";   -- gen_random_uuid()

-- ─────────────────────────────────────────────────────────────────────────────
-- Tenancy
-- ─────────────────────────────────────────────────────────────────────────────
create table organizations (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  type                text not null default 'smb' check (type in ('smb','agency')),
  plan                text not null default 'free' check (plan in ('free','starter','pro','business','agency')),
  stripe_customer_id  text,
  billing_visitor_quota integer not null default 5000,
  whitelabel_enabled  boolean not null default false,
  whitelabel_domain   text,
  created_at          timestamptz not null default now()
);

create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  name          text,
  auth_provider text not null default 'email',
  created_at    timestamptz not null default now()
);

create table memberships (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null references users(id) on delete cascade,
  org_id   uuid not null references organizations(id) on delete cascade,
  role     text not null default 'owner' check (role in ('owner','admin','editor','viewer')),
  unique (user_id, org_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Sites (+ agency sub-accounts via self-referencing parent_client_id)
-- ─────────────────────────────────────────────────────────────────────────────
create table sites (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  parent_client_id  uuid references sites(id) on delete set null,  -- agency client workspace
  domain            text not null,
  public_site_key   text not null unique,                          -- served to the edge / banner
  ruleset_version   integer not null default 1,
  banner_config_id  uuid,                                          -- fk added after banner_configs
  status            text not null default 'pending_install'
                      check (status in ('active','pending_install','paused')),
  install_verified_at timestamptz,
  created_at        timestamptz not null default now()
);
create index on sites (org_id);
create index on sites (public_site_key);

create table banner_configs (
  id                  uuid primary key default gen_random_uuid(),
  site_id             uuid not null references sites(id) on delete cascade,
  version             integer not null,                 -- immutable rows; vault references this
  layout              text not null default 'bottom',
  theme_json          jsonb not null default '{}'::jsonb,
  copy_json           jsonb not null default '{}'::jsonb,
  languages           text[] not null default array['en'],
  branding_removed    boolean not null default false,
  compiled_blob_hash  text,                             -- points to the edge KV artifact
  created_at          timestamptz not null default now(),
  unique (site_id, version)
);
alter table sites
  add constraint sites_banner_config_fk
  foreign key (banner_config_id) references banner_configs(id) on delete set null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Cookie scanning + categorization (deterministic, no LLM)
-- ─────────────────────────────────────────────────────────────────────────────
create table cookie_definitions (
  id            bigserial primary key,
  name_pattern  text not null,                          -- exact or wildcard (e.g. "_ga*")
  source_domain text,
  category      text not null check (category in ('necessary','analytics','marketing','functional','unclassified')),
  vendor        text,
  description   text,
  purpose       text,
  source        text not null default 'open_db' check (source in ('open_db','curated','user'))
);
create index on cookie_definitions (name_pattern);

create table scans (
  id           uuid primary key default gen_random_uuid(),
  site_id      uuid not null references sites(id) on delete cascade,
  status       text not null default 'queued' check (status in ('queued','running','done','error')),
  pages_crawled integer not null default 0,
  cookies_found integer not null default 0,
  new_count    integer not null default 0,
  started_at   timestamptz,
  finished_at  timestamptz
);

create table site_cookies (
  id            uuid primary key default gen_random_uuid(),
  site_id       uuid not null references sites(id) on delete cascade,
  scan_id       uuid references scans(id) on delete set null,
  cookie_name   text not null,
  domain        text,
  category      text not null,
  definition_id bigint references cookie_definitions(id),
  is_user_override boolean not null default false,
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  unique (site_id, cookie_name, domain)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Jurisdiction rules — centrally versioned, pushed to the edge KV.
-- (Ideally fed by a licensed legal-tracking feed, not hand-maintained.)
-- ─────────────────────────────────────────────────────────────────────────────
create table jurisdiction_rules (
  id            bigserial primary key,
  region_code   text not null,                          -- e.g. 'EEA','US-CA','US-TX','BR'
  version       integer not null default 1,
  consent_basis text not null check (consent_basis in ('opt_in','opt_out','notice')),
  gpc_binding   boolean not null default false,
  requires_do_not_sell boolean not null default false,
  requires_optout_honored_display boolean not null default false,
  default_consent_mode_json jsonb not null default '{}'::jsonb,
  effective_date date,
  note          text,
  unique (region_code, version)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Integrations, exports, anchors, API surface
-- ─────────────────────────────────────────────────────────────────────────────
create table integrations (
  id          uuid primary key default gen_random_uuid(),
  site_id     uuid not null references sites(id) on delete cascade,
  type        text not null check (type in ('gtm','ga4','google_ads','meta','tcf')),
  config_json jsonb not null default '{}'::jsonb,
  enabled     boolean not null default true
);

create table exports (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  site_id     uuid references sites(id) on delete set null,
  requested_by uuid references users(id) on delete set null,
  format      text not null check (format in ('csv','json','pdf')),
  filter_json jsonb not null default '{}'::jsonb,
  file_key    text,
  status      text not null default 'queued',
  created_at  timestamptz not null default now()
);

-- Daily checkpoint of each site's hash-chain head (anchored to R2 object-lock too).
create table vault_anchors (
  id            bigserial primary key,
  site_id       uuid not null references sites(id) on delete cascade,
  anchor_date   date not null,
  chain_head_hash char(64) not null,
  record_count  bigint not null,
  r2_object_key text,
  emailed_to    text,
  created_at    timestamptz not null default now(),
  unique (site_id, anchor_date)
);

create table api_keys (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  name        text,
  key_hash    text not null,                            -- store a hash, never the raw key
  scopes      text[] not null default array['read'],
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- consent_logs — the high-volume, append-only, hash-chained vault.
-- Partitioned monthly by created_at. visitor_pseudo_id is a salted hash — NEVER raw PII.
-- The (prev_hash, record_hash) columns make the log tamper-evident (see packages/edge/hashchain.ts).
-- ─────────────────────────────────────────────────────────────────────────────
create table consent_logs (
  id                    bigint generated always as identity,
  site_id               uuid not null,                  -- not FK-enforced on a partitioned hot table
  visitor_pseudo_id     text not null,                  -- salted hash of (IP+UA), pseudonymous
  consent_state         jsonb not null,                 -- {ad_storage, analytics_storage, ...}
  tc_string             text,                           -- only if TCF ever enabled
  region_code           text,
  ip_country            text,
  signal_source         text not null
                          check (signal_source in ('banner_accept','banner_reject','banner_save','gpc','auto_notice','import')),
  banner_config_version text,
  gpc_present           boolean not null default false,
  user_agent_hash       text,
  prev_hash             char(64) not null,
  record_hash           char(64) not null,
  -- Exact canonical JSON the record_hash commits to. Stored verbatim so integrity verification
  -- re-hashes these bytes directly (immune to timestamp/jsonb round-tripping). See hashchain.ts.
  canonical             text not null,
  created_at            timestamptz not null default now(),
  primary key (id, created_at)
) partition by range (created_at);

create index on consent_logs (site_id, created_at);
create index on consent_logs (site_id, visitor_pseudo_id);

-- Example partitions — automate creation (pg_partman / a monthly cron) in production.
create table consent_logs_2026_06 partition of consent_logs
  for values from ('2026-06-01') to ('2026-07-01');
create table consent_logs_2026_07 partition of consent_logs
  for values from ('2026-07-01') to ('2026-08-01');
create table consent_logs_2026_08 partition of consent_logs
  for values from ('2026-08-01') to ('2026-09-01');

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: a few jurisdiction rules (expand to all 20 states + global from a legal feed).
-- ─────────────────────────────────────────────────────────────────────────────
insert into jurisdiction_rules (region_code, consent_basis, gpc_binding, requires_do_not_sell, requires_optout_honored_display, effective_date, note) values
  ('EEA',   'opt_in',  false, false, false, '2018-05-25', 'GDPR — prior opt-in for non-essential.'),
  ('GB',    'opt_in',  false, false, false, '2018-05-25', 'UK GDPR / PECR.'),
  ('US-CA', 'opt_out', true,  true,  true,  '2026-01-01', 'CCPA/CPRA — GPC binding; must display Opt-Out Honored (2026).'),
  ('US-CO', 'opt_out', true,  true,  false, '2023-07-01', 'CPA — universal opt-out / GPC.'),
  ('US-CT', 'opt_out', true,  true,  false, '2023-07-01', 'CTDPA — universal opt-out / GPC.'),
  ('US-TX', 'opt_out', true,  true,  false, '2024-07-01', 'TDPSA — universal opt-out.'),
  ('US-XX', 'notice',  false, false, false, null,        'Other US states — notice-only fallback.'),
  ('BR',    'opt_in',  false, false, false, '2020-09-18', 'LGPD — treated opt-in (conservative).')
on conflict (region_code, version) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS sketch (enable + adapt to your auth provider, e.g. Supabase auth.uid()):
-- alter table sites enable row level security;
-- create policy sites_tenant on sites using (org_id in (
--   select org_id from memberships m where m.user_id = auth.uid()
-- ));
-- ─────────────────────────────────────────────────────────────────────────────
