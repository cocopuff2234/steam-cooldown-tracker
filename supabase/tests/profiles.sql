-- Run as postgres against a disposable LOCAL Supabase database after migrations.
-- psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/profiles.sql
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000001', 'profile-test-1@example.invalid', '{"username":" Test_User "}'),
  ('00000000-0000-4000-8000-000000000002', 'profile-test-2@example.invalid', '{"username":"other_user"}');

do $$
begin
  assert (select username = 'test_user' from public.profiles
    where id = '00000000-0000-4000-8000-000000000001'), 'Username was not normalized';

  begin
    insert into auth.users (id, email, raw_user_meta_data) values
      ('00000000-0000-4000-8000-000000000003', 'profile-test-3@example.invalid', '{"username":"TEST_USER"}');
    raise exception 'Duplicate signup unexpectedly succeeded';
  exception when unique_violation then null;
  end;
  assert not exists (select 1 from auth.users where id = '00000000-0000-4000-8000-000000000003'),
    'Duplicate username left an Auth user behind';

  begin
    insert into auth.users (id, email, raw_user_meta_data) values
      ('00000000-0000-4000-8000-000000000004', 'profile-test-4@example.invalid', '{}');
    raise exception 'Signup without username unexpectedly succeeded';
  exception when check_violation then null;
  end;
  assert not exists (select 1 from auth.users where id = '00000000-0000-4000-8000-000000000004'),
    'Missing username left an Auth user behind';

  begin
    insert into auth.users (id, email, raw_user_meta_data) values
      ('00000000-0000-4000-8000-000000000005', 'profile-test-5@example.invalid', '{"username":"bad-name"}');
    raise exception 'Invalid username unexpectedly succeeded';
  exception when check_violation then null;
  end;

  assert not has_table_privilege('anon', 'public.profiles', 'SELECT'), 'Anon can read profiles';
  assert not has_table_privilege('authenticated', 'public.profiles', 'INSERT'), 'Client can insert';
  assert not has_table_privilege('authenticated', 'public.profiles', 'UPDATE'), 'Client can update';
  assert not has_table_privilege('authenticated', 'public.profiles', 'DELETE'), 'Client can delete';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
do $$
begin
  assert (select count(*) = 1 from public.profiles), 'Self-select RLS did not filter other profiles';
  assert (select username = 'test_user' from public.profiles), 'Wrong profile visible';
end;
$$;
reset role;

delete from auth.users where id = '00000000-0000-4000-8000-000000000001';
do $$
begin
  assert not exists (select 1 from public.profiles where id = '00000000-0000-4000-8000-000000000001'),
    'Profile did not cascade on user deletion';
end;
$$;

rollback;
