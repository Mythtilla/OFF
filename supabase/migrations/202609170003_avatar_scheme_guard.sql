-- Hardening: avatar URL scheme enforcement (audit F6).
--
-- A rendered avatar <img> is harmless even against non-https schemes, but the
-- profile PATCH path would otherwise accept and later re-render arbitrary URL
-- values (e.g. javascript: strings). Enforce server-side that stored avatars
-- are http(s) URLs or inline images (the app uploads data:image/jpeg from the
-- canvas downscaler), then sanitize any existing bad rows to NULL.

update public.profiles
   set avatar_url = null
 where avatar_url is not null
   and avatar_url !~* '^https://'
   and avatar_url !~* '^data:image/';

alter table public.profiles
  add constraint profiles_avatar_url_scheme
  check (
    avatar_url is null
    or avatar_url ~* '^https://'
    or avatar_url ~* '^data:image/'
  );