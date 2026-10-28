begin;

create table public.login_rate_limit_buckets (
  bucket_start timestamptz not null,
  scope text not null check (scope in ('global', 'username', 'ip')),
  bucket_key text not null,
  attempts integer not null check (attempts > 0),
  primary key (bucket_start, scope, bucket_key)
);

alter table public.login_rate_limit_buckets enable row level security;
-- Access only through the definer RPC, including for service_role.
revoke all on table public.login_rate_limit_buckets from public, anon, authenticated, service_role;

create function public.consume_username_login_attempt(
  p_username text,
  p_verified_ip inet default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  minute_start timestamptz := date_trunc('minute', clock_timestamp());
  attempt_count integer;
  ip_key text;
begin
  if p_username is null or p_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'Invalid limiter input' using errcode = '22023';
  end if;
  if p_verified_ip is not null then
    if masklen(p_verified_ip) <> case family(p_verified_ip) when 4 then 32 else 128 end then
      raise exception 'Expected a single IP address' using errcode = '22023';
    end if;
    ip_key := encode(sha256(convert_to(host(p_verified_ip), 'UTF8')), 'hex');
  end if;

  -- The PK starts with time: no full-table scan or unbounded delete. Concurrent
  -- requests skip locked rows; idle stale rows are pruned when traffic resumes.
  delete from public.login_rate_limit_buckets b
  using (
    select bucket_start, scope, bucket_key
    from public.login_rate_limit_buckets
    where bucket_start < minute_start - interval '2 minutes'
    order by bucket_start, scope, bucket_key
    limit 100
    for update skip locked
  ) stale
  where b.bucket_start = stale.bucket_start
    and b.scope = stale.scope and b.bucket_key = stale.bucket_key;

  -- Global first bounds new per-identity rows, even for random username misses.
  -- Saturation prevents overflow while continuing to account for blocked calls.
  insert into public.login_rate_limit_buckets as b (bucket_start, scope, bucket_key, attempts)
  values (minute_start, 'global', 'all', 1)
  on conflict (bucket_start, scope, bucket_key)
  do update set attempts = least(b.attempts + 1, 301)
  returning attempts into attempt_count;
  if attempt_count > 300 then return false; end if;

  if ip_key is not null then
    insert into public.login_rate_limit_buckets as b (bucket_start, scope, bucket_key, attempts)
    values (minute_start, 'ip', ip_key, 1)
    on conflict (bucket_start, scope, bucket_key)
    do update set attempts = least(b.attempts + 1, 31)
    returning attempts into attempt_count;
    if attempt_count > 30 then return false; end if;
  end if;

  insert into public.login_rate_limit_buckets as b (bucket_start, scope, bucket_key, attempts)
  values (minute_start, 'username', encode(sha256(convert_to(p_username, 'UTF8')), 'hex'), 1)
  on conflict (bucket_start, scope, bucket_key)
  do update set attempts = least(b.attempts + 1, 11)
  returning attempts into attempt_count;
  return attempt_count <= 10;
end;
$$;

revoke all on function public.consume_username_login_attempt(text, inet) from public, anon, authenticated;
grant execute on function public.consume_username_login_attempt(text, inet) to service_role;

commit;
