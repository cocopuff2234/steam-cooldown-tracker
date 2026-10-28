begin;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  constraint profiles_username_format check (
    username = lower(btrim(username))
    and username ~ '^[a-z0-9_]{3,24}$'
  )
);

alter table public.profiles enable row level security;
revoke all on table public.profiles from public, anon, authenticated;
grant select on table public.profiles to authenticated;
grant select, insert, update, delete on table public.profiles to service_role;

create policy profiles_select_self on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

-- Preserve the identities in src/users.ts before considering editable metadata.
insert into public.profiles (id, username)
select u.id, legacy.username
from auth.users u
join (values
  ('myrka', 'asicubhaiuofhaioufaho@gmail.com'),
  ('rio', 'aflweujfbawefuba@gmail.com')
) as legacy(username, email) on lower(u.email) = legacy.email
order by u.created_at, u.id
on conflict do nothing;

-- Invalid, missing and conflicting usernames must not block existing users.
insert into public.profiles (id, username)
select u.id, lower(btrim(u.raw_user_meta_data ->> 'username'))
from auth.users u
where jsonb_typeof(u.raw_user_meta_data -> 'username') = 'string'
  and lower(btrim(u.raw_user_meta_data ->> 'username')) ~ '^[a-z0-9_]{3,24}$'
  and not exists (select 1 from public.profiles p where p.id = u.id)
order by u.created_at, u.id
on conflict do nothing;

create function public.create_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_username text;
begin
  normalized_username := lower(btrim(new.raw_user_meta_data ->> 'username'));
  if jsonb_typeof(new.raw_user_meta_data -> 'username') is distinct from 'string'
     or normalized_username is null
     or normalized_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'A valid username is required' using errcode = '23514';
  end if;

  -- A uniqueness failure aborts the auth.users insert in the same transaction.
  insert into public.profiles (id, username) values (new.id, normalized_username);
  return new;
end;
$$;

revoke all on function public.create_profile_for_auth_user() from public, anon, authenticated;

create trigger on_auth_user_created_create_profile
  after insert on auth.users
  for each row execute function public.create_profile_for_auth_user();

commit;
