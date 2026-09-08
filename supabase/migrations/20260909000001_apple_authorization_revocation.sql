-- Apple refresh token is server-only revocation material. The private schema is
-- absent from the Data API, and its functions below are service_role-only.
create schema if not exists private;
revoke all on schema private from public;

create table if not exists private.apple_refresh_tokens (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null check (char_length(client_id) between 1 and 255),
  ciphertext text check (ciphertext is null or char_length(ciphertext) between 1 and 8192),
  nonce text check (nonce is null or char_length(nonce) between 1 and 128),
  key_version text check (key_version is null or char_length(key_version) between 1 and 64),
  revoked_at timestamptz,
  manual_required_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, client_id),
  check ((revoked_at is null and manual_required_at is null and ciphertext is not null and nonce is not null and key_version is not null)
      or ((revoked_at is not null or manual_required_at is not null) and ciphertext is null and nonce is null and key_version is null)),
  check (revoked_at is null or manual_required_at is null)
);

revoke all on table private.apple_refresh_tokens from public, anon, authenticated;

create or replace function public.store_apple_refresh_token(p_user_id uuid, p_client_id text, p_ciphertext text, p_nonce text, p_key_version text)
returns void
language plpgsql
security definer
set search_path = private, pg_temp
as $$
begin
  if p_user_id is null or p_client_id is null or char_length(p_client_id) not between 1 and 255 or p_ciphertext is null or char_length(p_ciphertext) not between 1 and 8192 or p_nonce is null or char_length(p_nonce) not between 1 and 128 or p_key_version is null or char_length(p_key_version) not between 1 and 64 then
    raise exception 'invalid_apple_refresh_token';
  end if;
  insert into private.apple_refresh_tokens (user_id, client_id, ciphertext, nonce, key_version, revoked_at, manual_required_at, updated_at)
  values (p_user_id, p_client_id, p_ciphertext, p_nonce, p_key_version, null, null, now())
  on conflict (user_id, client_id) do update
    set ciphertext = excluded.ciphertext, nonce = excluded.nonce, key_version = excluded.key_version, revoked_at = null, manual_required_at = null, updated_at = excluded.updated_at;
end;
$$;

create or replace function public.mark_apple_refresh_token_manual_required(p_user_id uuid, p_client_id text)
returns void language plpgsql security definer set search_path = private, pg_temp as $$
begin
  update private.apple_refresh_tokens set ciphertext = null, nonce = null, key_version = null, manual_required_at = now(), updated_at = now()
  where user_id = p_user_id and client_id = p_client_id and revoked_at is null and manual_required_at is null;
  if not found then raise exception 'apple_token_not_found_or_already_marked'; end if;
end;
$$;

create or replace function public.get_apple_refresh_tokens(p_user_id uuid)
returns table(client_id text, ciphertext text, nonce text, key_version text, revoked_at timestamptz, manual_required_at timestamptz)
language sql
security definer
set search_path = private, pg_temp
stable
as $$
  select t.client_id, t.ciphertext, t.nonce, t.key_version, t.revoked_at, t.manual_required_at from private.apple_refresh_tokens t where t.user_id = p_user_id
$$;

create or replace function public.mark_apple_refresh_token_revoked(p_user_id uuid, p_client_id text)
returns void
language plpgsql
security definer
set search_path = private, pg_temp
as $$
begin
  update private.apple_refresh_tokens
     set ciphertext = null, nonce = null, key_version = null, revoked_at = now(), updated_at = now()
   where user_id = p_user_id and client_id = p_client_id and revoked_at is null;
  if not found then raise exception 'apple_token_not_found_or_already_revoked'; end if;
end;
$$;

revoke all on function public.store_apple_refresh_token(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.get_apple_refresh_tokens(uuid) from public, anon, authenticated;
revoke all on function public.mark_apple_refresh_token_revoked(uuid, text) from public, anon, authenticated;
revoke all on function public.mark_apple_refresh_token_manual_required(uuid, text) from public, anon, authenticated;
grant execute on function public.store_apple_refresh_token(uuid, text, text, text, text) to service_role;
grant execute on function public.get_apple_refresh_tokens(uuid) to service_role;
grant execute on function public.mark_apple_refresh_token_revoked(uuid, text) to service_role;
grant execute on function public.mark_apple_refresh_token_manual_required(uuid, text) to service_role;
