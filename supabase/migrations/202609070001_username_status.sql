create or replace function public.username_status(p_username text)
returns table (available boolean, suggestions text[])
language plpgsql security definer set search_path = public
as $$
declare
  base text;
  pool text[];
begin
  base := lower(btrim(p_username));
  if base !~ '^[a-z0-9_]{3,32}$' then
    available := false;
    suggestions := '{}';
    return next;
    return;
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