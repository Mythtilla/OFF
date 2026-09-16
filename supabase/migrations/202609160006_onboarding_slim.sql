-- Slim onboarding ceremony to Recovery + Profile only.
-- Country detection and interest selection are removed from the flow.
-- This migration replaces complete_profile and complete_onboarding so the
-- new 2-step ceremony is the only valid path. Everything is idempotent
-- (create or replace) so it can be pasted into a dashboard SQL editor
-- safely, even if older versions of these functions already exist.

-- 1. complete_profile: marks the profile step done, auto-handles country and
--    interest bookkeeping, and grants World membership (the only universal room).
create or replace function public.complete_profile(new_display_name text, new_bio text)
returns void
language plpgsql security definer set search_path=public as $$
declare uid uuid := auth.uid();
begin
  perform require_authenticated();
  if char_length(coalesce(new_display_name,'')) > 80 or char_length(coalesce(new_bio,'')) > 500 then
    raise exception 'Invalid profile';
  end if;
  perform set_config('app.onboarding_rpc','1',true);
  update profiles
     set display_name       = nullif(trim(new_display_name),''),
         bio                = nullif(trim(new_bio),''),
         profile_completed_at   = coalesce(profile_completed_at, now()),
         country_handled_at     = coalesce(country_handled_at, now()),
         interests_handled_at   = coalesce(interests_handled_at, now())
   where id = uid;
  -- Grant World membership — required by complete_onboarding and the
  -- core app experience.  Previously this happened inside
  -- set_onboarding_interests, which is no longer called.
  insert into room_members(room_id, user_id, role)
    select id, uid, 'member' from rooms where kind = 'world'
    on conflict (room_id, user_id) do nothing;
end $$;

-- 2. complete_onboarding: now only requires recovery + profile + World
--    membership.  Country/interests bookkeeping is handled inside
--    complete_profile so users never see those steps.
create or replace function public.complete_onboarding()
returns boolean
language plpgsql security definer set search_path=public as $$
declare uid uuid := auth.uid();
begin
  perform require_authenticated();
  perform set_config('app.onboarding_rpc','1',true);
  if not exists (
    select 1 from profiles
     where id = uid
       and recovery_acknowledged_at is not null
       and profile_completed_at is not null
  ) then
    raise exception 'Onboarding steps are incomplete';
  end if;
  if not exists (
    select 1 from room_members m
    join rooms r on r.id = m.room_id
     where m.user_id = uid and r.kind = 'world'
  ) then
    raise exception 'World membership is required';
  end if;
  update profiles set onboarding_completed = true where id = uid;
  return true;
end $$;

-- Revoke/grant matches the originals (010/013).
revoke all on function public.complete_profile(text,text) from public;
grant  execute on function public.complete_profile(text,text) to authenticated;
revoke all on function public.complete_onboarding() from public;
grant  execute on function public.complete_onboarding() to authenticated;
