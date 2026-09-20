-- Hardening: server-side rate limits (P0-a / V1 F10).
--
-- username_status previously let an anonymous caller probe the entire
-- namespace byte-for-byte with no throttle. This migration adds:
--   1. a short-lived, in-table counter (TTL-swept, no IP/identity tracking),
--   2. a SECURITY DEFINER helper the RPCs call internally, and
--   3. a rate-limited rewrite of username_status (same signature + grants).
--
-- No IP or identifier is stored: anonymous budgets are keyed by a SHA-512 of
-- the client IP (transient, counter-only) plus a global fallback bucket so a
-- single source cannot enumerate the namespace even when the header is missing.

-- 1. Short-lived server-side counters.
create table public.rate_counters (
  key text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 0
);
alter table public.rate_counters enable row level security;
-- Not readable or writable by any client role: only SECURITY DEFINER functions
-- (owned by the migration superuser) may touch it.
revoke all on table public.rate_counters from anon;
revoke all on table public.rate_counters from authenticated;
revoke all on table public.rate_counters from public;

-- 2. Internal helper: enforce a budget, returning true when allowed.
create or replace function public.rate_limited(p_key text, p_max integer, p_window interval)
returns boolean
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_count integer;
  v_start timestamptz;
begin
  if p_max <= 0 then
    return false;
  end if;
  -- Opportunistic TTL sweep keeps the counter table small without a job.
  if floor(random() * 256) = 0 then
    delete from public.rate_counters where window_start < now() - interval '1 day';
  end if;
  select count, window_start into v_count, v_start
    from public.rate_counters
   where key = p_key
     for update;
  if v_start is null or now() - v_start >= p_window then
    insert into public.rate_counters (key, window_start, count)
    values (p_key, now(), 1)
    on conflict (key) do update
      set window_start = now(), count = 1;
    return true;
  end if;
  update public.rate_counters
     set count = v_count + 1
   where key = p_key;
  return (v_count + 1) <= p_max;
end;
$$;
revoke all on function public.rate_limited(text, integer, interval) from anon;
revoke all on function public.rate_limited(text, integer, interval) from authenticated;
revoke all on function public.rate_limited(text, integer, interval) from public;

-- 3. Rate-limited username_status (same contract as 202609070001).
create or replace function public.username_status(p_username text)
returns table (available boolean, suggestions text[])
language plpgsql volatile security definer set search_path = public
as $$
declare
  base text;
  pool text[];
  client_key text;
begin
  base := lower(btrim(p_username));
  if base !~ '^[a-z0-9_]{3,32}$' then
    available := false;
    suggestions := '{}';
    return next;
    return;
  end if;
  -- Throttle bursts before any probe work. Authenticated first-party checks
  -- get a roomier budget; anonymous callers are keyed by a hash of their
  -- client IP (never stored in the clear) plus a global cap.
  if auth.uid() is not null then
    client_key := 'username_status:user:' || auth.uid()::text;
    if not public.rate_limited(client_key, 120, interval '10 minutes') then
      raise exception 'Too many requests. Please slow down.';
    end if;
  else
    client_key := 'username_status:anon:' || encode(
      digest(coalesce(
        nullif(current_setting('request.headers', true)::jsonb->>'x-forwarded-for', ''),
        'unknown'), 'sha512'), 'hex');
    if not public.rate_limited(client_key, 20, interval '10 minutes') then
      raise exception 'Too many requests. Please slow down.';
    end if;
    if not public.rate_limited('username_status:anon:global', 200, interval '5 minutes') then
      raise exception 'Too many requests. Please slow down.';
    end if;
  end if;
  available := not exists (select 1 from public.profiles where username = base);
  select array_agg(c) into pool
  from (
    select (base || suffix) as c
    from unnest(array['1','2','3','_off','20','_1','_2','_99']) as suffix
    where char_length(base || suffix) <= 32
      and not exists (select 1 from public.profiles where username = base || suffix)
  ) candidates;
  suggestions := pool[1:4];
  return next;
end;
$$;
revoke all on function public.username_status(text) from public;
grant execute on function public.username_status(text) to anon, authenticated;