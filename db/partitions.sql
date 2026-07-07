-- Tagshield — automatic monthly partitioning for consent_logs.
-- Without this, inserts FAIL once created_at passes the last hand-made partition (2026-09).
-- Apply after schema.sql:  psql "$DATABASE_URL" -f db/partitions.sql

create or replace function ensure_consent_log_partitions(months_ahead int default 3)
returns void language plpgsql as $$
declare
  base  date := date_trunc('month', now())::date;
  i     int;
  start_d date;
  end_d   date;
  part    text;
begin
  for i in 0..months_ahead loop
    start_d := (base + make_interval(months => i))::date;
    end_d   := (start_d + interval '1 month')::date;
    part    := 'consent_logs_' || to_char(start_d, 'YYYY_MM');
    if not exists (select 1 from pg_class where relname = part) then
      execute format(
        'create table if not exists %I partition of consent_logs for values from (%L) to (%L)',
        part, start_d, end_d);
    end if;
  end loop;
end;
$$;

-- Backfill the current month + the next 3 right now.
select ensure_consent_log_partitions(3);

-- Auto-create ahead on the 1st of each month (only if pg_cron is enabled — safe no-op otherwise).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ensure-consent-partitions', '5 0 1 * *',
      'select ensure_consent_log_partitions(3)');
  end if;
end $$;
