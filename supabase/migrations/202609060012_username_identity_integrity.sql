-- Username is immutable because it deterministically maps to the internal Auth identity.
alter table public.profiles drop constraint if exists profiles_username_check;
alter table public.profiles add constraint profiles_username_check check(username ~ '^[a-z0-9_]{3,32}$');
create unique index if not exists profiles_username_lower_unique on public.profiles(lower(username));
create or replace function public.guard_profile_identity() returns trigger language plpgsql security definer set search_path=public as $$ begin if new.username is distinct from old.username then raise exception 'Username cannot be changed'; end if; return new; end $$;
drop trigger if exists guard_profile_identity_trigger on public.profiles; create trigger guard_profile_identity_trigger before update on public.profiles for each row execute procedure public.guard_profile_identity();
