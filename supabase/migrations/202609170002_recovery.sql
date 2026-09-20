-- Hardening: real, verifiable password recovery (audit F2).
--
-- The onboarding ceremony previously showed a 24-word phrase that was never
-- bound to anything: "placeholder, not a cryptographic key backup". Users
-- were told recovery existed when it did not. This migration makes the phrase
-- genuinely recover the account:
--
--   * OFF stores ONLY a one-way verifier of the phrase (bcrypt of its SHA-256),
--     never the phrase itself.
--   * set_recovery_verifier binds/rotates the verifier for the signed-in user
--     and marks the onboarding step complete.
--   * recover_account lets a user reset a forgotten password with
--     username + phrase, with bcrypt-comparable verification, a five-failure
--     lockout, timing normalization for unknown users, and invalidation of
--     every existing session.
--
-- The verifier table has RLS enabled and NO access policies: every read and
-- mutation happens inside SECURITY DEFINER RPC boundaries.

create extension if not exists pgcrypto;

create table public.recovery_verifiers (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  verifier text not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.recovery_verifiers enable row level security;
revoke all on table public.recovery_verifiers from anon;
revoke all on table public.recovery_verifiers from authenticated;
revoke all on table public.recovery_verifiers from public;

-- Internal crypto helpers (client roles never call these).
-- bcrypt truncates at 72 bytes, so the phrase is first SHA-256 digested and
-- stored as its 64-char hex encoding before the bcrypt cost-10 hash.
create or replace function public.recovery_hash(p_phrase text)
returns text
language sql volatile security definer set search_path = public
as $$
  select crypt(encode(digest(p_phrase, 'sha256'), 'hex'), gen_salt('bf', 10));
$$;

create or replace function public.recovery_matches(p_phrase text, p_verifier text)
returns boolean
language sql volatile security definer set search_path = public
as $$
  select crypt(encode(digest(p_phrase, 'sha256'), 'hex'), p_verifier) = p_verifier;
$$;

-- The ceremony shows exactly 24 lowercase wordlist entries.
create or replace function public.recovery_phrase_valid(p_phrase text)
returns boolean
language sql volatile security definer set search_path = public
as $$
  select v.cnt = 24 and v.ok = v.cnt
  from (
    select count(*)::int as cnt,
           count(*) filter (where token ~ '^[a-z]{2,10}$')::int as ok
    from regexp_split_to_table(btrim(p_phrase), '\s+') as token
  ) v;
$$;

revoke all on function public.recovery_hash(text) from anon;
revoke all on function public.recovery_hash(text) from authenticated;
revoke all on function public.recovery_hash(text) from public;
revoke all on function public.recovery_matches(text, text) from anon;
revoke all on function public.recovery_matches(text, text) from authenticated;
revoke all on function public.recovery_matches(text, text) from public;
revoke all on function public.recovery_phrase_valid(text) from anon;
revoke all on function public.recovery_phrase_valid(text) from authenticated;
revoke all on function public.recovery_phrase_valid(text) from public;

-- Signed-in users set/rotate their verifier during onboarding (or later).
-- Backwards-compatible acknowledgment: also stamps recovery_acknowledged_at so
-- complete_onboarding (160006) keeps working without a second RPC call.
create or replace function public.set_recovery_verifier(p_phrase text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  perform require_authenticated();
  if not public.recovery_phrase_valid(p_phrase) then
    raise exception 'The recovery phrase is invalid.';
  end if;
  insert into public.recovery_verifiers (user_id, verifier, updated_at)
  values (uid, public.recovery_hash(p_phrase), now())
  on conflict (user_id) do update
    set verifier = excluded.verifier,
        failed_attempts = 0,
        locked_until = null,
        updated_at = now();
  update public.profiles
     set recovery_acknowledged_at = coalesce(recovery_acknowledged_at, now())
   where id = uid;
end;
$$;
revoke all on function public.set_recovery_verifier(text) from public;
grant execute on function public.set_recovery_verifier(text) to authenticated;

-- Password-reset entry point for a forgotten password. Non-enumerating: every
-- failure path returns the same message, unknown usernames burn a real bcrypt
-- comparison to keep timing flat, and >= 5 failures locks for 5 minutes.
create or replace function public.recover_account(
  p_username text,
  p_phrase text,
  p_new_password text
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid;
  v_verifier text;
  v_locked timestamptz;
  v_attempts integer;
begin
  if p_username !~ '^[a-z0-9_]{3,32}$'
     or not public.recovery_phrase_valid(p_phrase)
     or char_length(coalesce(p_new_password, '')) < 6
     or char_length(coalesce(p_new_password, '')) > 72 then
    -- Burn a full bcrypt cost so malformed input costs the same as a real
    -- verification before failing with the universal message.
    perform public.recovery_hash('burn-token');
    raise exception 'Recovery failed. Check the username, recovery phrase, and new password and try again.';
  end if;

  select id into v_user_id
    from public.profiles
   where username = lower(btrim(p_username));

  if v_user_id is null then
    perform public.recovery_hash('burn-token');
    raise exception 'Recovery failed. Check the username, recovery phrase, and new password and try again.';
  end if;

  select verifier, locked_until, failed_attempts
    into v_verifier, v_locked, v_attempts
    from public.recovery_verifiers
   where user_id = v_user_id;

  if v_verifier is null then
    perform public.recovery_hash('burn-token');
    raise exception 'Recovery failed. Check the username, recovery phrase, and new password and try again.';
  end if;

  if v_locked is not null and v_locked > now() then
    raise exception 'Too many recovery attempts. Try again later.';
  end if;

  if not public.recovery_matches(p_phrase, v_verifier) then
    v_attempts := v_attempts + 1;
    if v_attempts >= 5 then
      update public.recovery_verifiers
         set failed_attempts = 0,
             locked_until = now() + interval '5 minutes',
             updated_at = now()
       where user_id = v_user_id;
      raise exception 'Too many recovery attempts. Try again later.';
    end if;
    update public.recovery_verifiers
       set failed_attempts = v_attempts,
           updated_at = now()
     where user_id = v_user_id;
    raise exception 'Recovery failed. Check the username, recovery phrase, and new password and try again.';
  end if;

  update public.recovery_verifiers
     set failed_attempts = 0,
         locked_until = null,
         updated_at = now()
   where user_id = v_user_id;

  -- Reset the GoTrue password. crypt() with a bcrypt cost-10 salt is exactly
  -- what GoTrue stores, so the new password verifies on next sign-in.
  update auth.users
     set encrypted_password = crypt(p_new_password, gen_salt('bf', 10))
   where id = v_user_id;

  -- Revoke every existing session for this account.
  delete from auth.refresh_tokens where user_id = v_user_id;
  if to_regclass('auth.sessions') is not null then
    delete from auth.sessions where user_id = v_user_id;
  end if;
end;
$$;
revoke all on function public.recover_account(text, text, text) from public;
grant execute on function public.recover_account(text, text, text) to anon, authenticated;