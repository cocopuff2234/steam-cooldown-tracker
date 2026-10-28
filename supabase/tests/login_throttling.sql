-- Disposable LOCAL database only, after both migrations. All changes roll back.
-- psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/login_throttling.sql
begin;
truncate public.login_rate_limit_buckets;

do $$
begin
  assert has_function_privilege('service_role', 'public.consume_username_login_attempt(text,inet)', 'EXECUTE');
  assert not has_function_privilege('anon', 'public.consume_username_login_attempt(text,inet)', 'EXECUTE');
  assert not has_function_privilege('authenticated', 'public.consume_username_login_attempt(text,inet)', 'EXECUTE');
  assert not has_table_privilege('anon', 'public.login_rate_limit_buckets', 'SELECT');
  assert not has_table_privilege('authenticated', 'public.login_rate_limit_buckets', 'INSERT');
  assert not has_table_privilege('service_role', 'public.login_rate_limit_buckets', 'SELECT');
end;
$$;

set local role anon;
do $$
begin
  begin
    perform public.consume_username_login_attempt('test_user');
    raise exception 'Anonymous RPC call succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
set local role authenticated;
do $$
begin
  begin
    perform public.consume_username_login_attempt('test_user');
    raise exception 'Authenticated RPC call succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set local role service_role;
do $$
begin
  -- No profile exists for this username; misses consume the same quota.
  for n in 1..10 loop
    assert public.consume_username_login_attempt('limiter_missing'), 'Username throttled too early';
  end loop;
  assert not public.consume_username_login_attempt('limiter_missing'), 'Username quota not enforced';
  assert public.consume_username_login_attempt('limiter_other'), 'Username buckets not independent';
end;
$$;
reset role;

do $$
begin
  assert (select attempts = 11 from public.login_rate_limit_buckets where scope = 'username'
    and bucket_key = encode(sha256(convert_to('limiter_missing', 'UTF8')), 'hex'));
  assert not exists (select 1 from public.login_rate_limit_buckets where scope = 'ip'),
    'Unverified requests created IP buckets';
  assert not exists (select 1 from public.login_rate_limit_buckets
    where scope <> 'global' and bucket_key !~ '^[a-f0-9]{64}$'), 'Identity keys are not hashed';
end;
$$;
truncate public.login_rate_limit_buckets;

set local role service_role;
do $$
begin
  for n in 1..30 loop
    assert public.consume_username_login_attempt('ip_test_' || n, '2001:db8::1');
  end loop;
  assert not public.consume_username_login_attempt('ip_blocked', '2001:0db8:0:0:0:0:0:1'),
    'Equivalent IPv6 addresses bypassed IP quota';
  assert public.consume_username_login_attempt('ip_other', '192.0.2.2'), 'IP buckets not independent';
  begin
    perform public.consume_username_login_attempt('ip_network', '192.0.2.0/24');
    raise exception 'IP network unexpectedly accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.consume_username_login_attempt('NOT_NORMALIZED');
    raise exception 'Unnormalized username unexpectedly accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$$;
reset role;
truncate public.login_rate_limit_buckets;

set local role service_role;
do $$
begin
  for n in 1..300 loop
    assert public.consume_username_login_attempt('global_' || n), 'Global throttled too early';
  end loop;
  for n in 301..310 loop
    assert not public.consume_username_login_attempt('global_' || n), 'Global quota not enforced';
  end loop;
end;
$$;
reset role;
do $$
begin
  assert (select attempts = 301 from public.login_rate_limit_buckets where scope = 'global'),
    'Global counter did not saturate';
  assert (select count(*) = 300 from public.login_rate_limit_buckets where scope = 'username'),
    'Global denials allocated extra identity buckets';
end;
$$;
truncate public.login_rate_limit_buckets;

-- Previous-minute buckets must not block this minute. One call deletes at most
-- 100 expired rows, retaining recent buckets; subsequent traffic drains the rest.
insert into public.login_rate_limit_buckets values
  (date_trunc('minute', clock_timestamp()) - interval '1 minute', 'global', 'all', 301);
insert into public.login_rate_limit_buckets
select date_trunc('minute', clock_timestamp()) - interval '10 minutes', 'username', n::text, 1
from generate_series(1, 150) n;
set local role service_role;
do $$ begin assert public.consume_username_login_attempt('fresh_minute'); end; $$;
reset role;
do $$
begin
  assert (select count(*) = 50 from public.login_rate_limit_buckets
    where bucket_start < date_trunc('minute', clock_timestamp()) - interval '2 minutes'),
    'Pruning was not bounded at 100';
  assert exists (select 1 from public.login_rate_limit_buckets where scope = 'global' and attempts = 301),
    'Pruning removed recent buckets';
end;
$$;
set local role service_role;
do $$ begin assert public.consume_username_login_attempt('fresh_minute'); end; $$;
reset role;
do $$
begin
  assert not exists (select 1 from public.login_rate_limit_buckets
    where bucket_start < date_trunc('minute', clock_timestamp()) - interval '2 minutes'),
    'Subsequent call did not drain stale buckets';
end;
$$;

rollback;
