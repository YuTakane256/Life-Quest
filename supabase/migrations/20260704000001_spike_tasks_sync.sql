-- #511 同期スパイク: tasks 1テーブルでの縦切り検証
-- DDL適用順序は #501 の規約に従う:
--   拡張 → sync_versions → next_sync_version → pull_sync_batch(最小) →
--   profiles(最小) → tasks → 書き込み関数 → RLS/revoke → handle_new_user
-- #501（全テーブル）はこのマイグレーションの上に差分を追加する。

-- 1. 拡張
create extension if not exists pgcrypto;

-- 2. 同期バージョン管理（ADR-005: ユーザー単位・全テーブル共通の単一タイムライン）
create table public.sync_versions (
    user_id uuid primary key references auth.users (id) on delete cascade,
    current_version bigint not null default 0
);

-- 3. 採番関数（ADR-005）
--    行ロック(UPDATE)で同一ユーザーの書き込みトランザクションを直列化する。
--    ロックは呼び出し元トランザクションのコミット/ロールバックまで保持されるため
--    「採番順＝コミット順」が構造的に保証される。
--    sync_versions 行はアカウント作成時に必ず生成される（handle_new_user）。
--    初回INSERT分岐は持たず、行が無ければ不変条件違反として例外にする。
--    呼び出し規約: 1つの業務操作(1トランザクション)につき1回だけ呼び、
--    書き換える全テーブル・全行に同じ戻り値を設定する。
create function public.next_sync_version(p_user_id uuid) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_version bigint;
begin
    update public.sync_versions
       set current_version = current_version + 1
     where user_id = p_user_id
    returning current_version into v_version;

    if not found then
        raise exception 'sync_versions row missing for user %', p_user_id;
    end if;

    return v_version;
end;
$$;

revoke all on function public.next_sync_version(uuid) from public, anon, authenticated;

-- 4. profiles（スパイク最小版: handle_new_user の受け皿）
create table public.profiles (
    user_id uuid primary key references auth.users (id) on delete cascade,
    display_name text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
create policy profiles_select on public.profiles for select using ((select auth.uid()) = user_id);
grant select on public.profiles to authenticated;
revoke insert, update, delete on public.profiles from anon, authenticated;

-- 5. tasks（スパイク対象テーブル）
create table public.tasks (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    name text not null check (char_length(name) <= 200),
    completed boolean not null default false,
    completed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(), -- LWW専用。カーソルには使わない
    deleted_at timestamptz,
    version bigint not null,
    unique (id, user_id) -- #501でsubtasksの複合FK参照先になる
);

create index tasks_user_version_idx on public.tasks (user_id, version);

alter table public.tasks enable row level security;
create policy tasks_select on public.tasks for select using ((select auth.uid()) = user_id);
-- SELECTのみ許可（RLSで自分の行に限定）。直接書き込みは全面禁止。
grant select on public.tasks to authenticated;
revoke insert, update, delete on public.tasks from anon, authenticated;

-- 6. 操作冪等性の台帳（ADR-004）
create table public.idempotency_keys (
    user_id uuid not null references auth.users (id) on delete cascade,
    key text not null,
    operation text not null,
    status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
    result jsonb,
    created_at timestamptz not null default now(),
    primary key (user_id, key)
);

alter table public.idempotency_keys enable row level security;
revoke all on public.idempotency_keys from anon, authenticated; -- SELECTも不可の内部台帳

-- 7. 報酬台帳（スパイク最小版。kind体系の全量は #502）
create table public.reward_transactions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    kind text not null,
    source_id text not null,
    xp_delta integer not null,
    created_at timestamptz not null default now(),
    unique (user_id, kind, source_id)
);

alter table public.reward_transactions enable row level security;
create policy reward_transactions_select on public.reward_transactions for select using ((select auth.uid()) = user_id);
grant select on public.reward_transactions to authenticated;
revoke insert, update, delete on public.reward_transactions from anon, authenticated;

-- 8. 書き込み関数（クライアント公開: upsert_task / 削除墓標）
--    auth.uid() を関数内で直接使い、リクエスト由来のuser_idを受け取らない（ADR-007）。
create function public.upsert_task(
    p_id uuid,
    p_name text,
    p_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_version bigint;
    v_reserved integer;
    v_existing jsonb;
begin
    if v_user_id is null then
        raise exception 'unauthenticated';
    end if;

    -- 冪等キー予約（ADR-004）。既存キーなら過去の結果を返し副作用なし。
    insert into public.idempotency_keys (user_id, key, operation)
    values (v_user_id, p_key, 'upsert_task')
    on conflict (user_id, key) do nothing;
    get diagnostics v_reserved = row_count;
    if v_reserved = 0 then
        select result into v_existing from public.idempotency_keys
         where user_id = v_user_id and key = p_key;
        return coalesce(v_existing, jsonb_build_object('replayed', true));
    end if;

    -- 1操作1version（ADR-005）
    v_version := public.next_sync_version(v_user_id);

    insert into public.tasks (id, user_id, name, version)
    values (p_id, v_user_id, p_name, v_version)
    on conflict (id) do update
        set name = excluded.name,
            updated_at = now(),
            version = excluded.version
        where public.tasks.user_id = v_user_id; -- 他人の行は更新しない（PK衝突攻撃対策）

    update public.idempotency_keys
       set status = 'completed', result = jsonb_build_object('id', p_id, 'version', v_version)
     where user_id = v_user_id and key = p_key;

    return jsonb_build_object('id', p_id, 'version', v_version);
end;
$$;

revoke all on function public.upsert_task(uuid, text, text) from public, anon;
grant execute on function public.upsert_task(uuid, text, text) to authenticated;

create function public.delete_task(p_id uuid, p_key text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_version bigint;
    v_reserved integer;
begin
    if v_user_id is null then
        raise exception 'unauthenticated';
    end if;

    insert into public.idempotency_keys (user_id, key, operation)
    values (v_user_id, p_key, 'delete_task')
    on conflict (user_id, key) do nothing;
    get diagnostics v_reserved = row_count;
    if v_reserved = 0 then
        return jsonb_build_object('replayed', true);
    end if;

    v_version := public.next_sync_version(v_user_id);

    -- 論理削除（墓標）。物理DELETEはしない。
    update public.tasks
       set deleted_at = now(), updated_at = now(), version = v_version
     where id = p_id and user_id = v_user_id;

    update public.idempotency_keys
       set status = 'completed', result = jsonb_build_object('id', p_id, 'version', v_version)
     where user_id = v_user_id and key = p_key;

    return jsonb_build_object('id', p_id, 'version', v_version);
end;
$$;

revoke all on function public.delete_task(uuid, text) from public, anon;
grant execute on function public.delete_task(uuid, text) to authenticated;

-- 9. complete_task（サーバー権威の最小版。Edge Functionからservice_roleで呼ぶ。
--    XP額はEdge Functionが @life-quest/core で算出して渡す = ADR-002の案B検証）
create function public.complete_task_authoritative(
    p_user_id uuid,
    p_task_id uuid,
    p_xp integer,
    p_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_version bigint;
    v_reserved integer;
    v_granted integer;
    v_existing jsonb;
begin
    -- service_role専用（EXECUTE権限で制御）。p_user_idはEdge FunctionがJWTから導出済み。
    if p_user_id is null then
        raise exception 'missing user';
    end if;
    if p_xp is null or p_xp < 0 or p_xp > 1000 then
        raise exception 'invalid xp';
    end if;

    -- 冪等キー予約（同一トランザクション内。ADR-004）
    insert into public.idempotency_keys (user_id, key, operation)
    values (p_user_id, p_key, 'complete_task')
    on conflict (user_id, key) do nothing;
    get diagnostics v_reserved = row_count;
    if v_reserved = 0 then
        select result into v_existing from public.idempotency_keys
         where user_id = p_user_id and key = p_key;
        return coalesce(v_existing, jsonb_build_object('replayed', true));
    end if;

    -- 所有者検証（RLSに頼らない。ADR-007）
    perform 1 from public.tasks where id = p_task_id and user_id = p_user_id and deleted_at is null;
    if not found then
        raise exception 'not_found_or_forbidden';
    end if;

    -- 1操作1version（ADR-005）
    v_version := public.next_sync_version(p_user_id);

    update public.tasks
       set completed = true, completed_at = now(), updated_at = now(), version = v_version
     where id = p_task_id;

    -- ADR-003: 報酬（スパイクではXP記録のみ）は台帳へ新規挿入できた初回のみ
    insert into public.reward_transactions (user_id, kind, source_id, xp_delta)
    values (p_user_id, 'task_complete', p_task_id::text, p_xp)
    on conflict (user_id, kind, source_id) do nothing;
    get diagnostics v_granted = row_count;

    update public.idempotency_keys
       set status = 'completed',
           result = jsonb_build_object('granted', v_granted = 1, 'version', v_version)
     where user_id = p_user_id and key = p_key;

    return jsonb_build_object('granted', v_granted = 1, 'version', v_version);
end;
$$;

revoke all on function public.complete_task_authoritative(uuid, uuid, integer, text) from public, anon, authenticated;
-- publicからのrevokeでservice_roleが継承していた既定EXECUTEも消えるため、明示的にgrantする
grant execute on function public.complete_task_authoritative(uuid, uuid, integer, text) to service_role;

-- 10. pull_sync_batch（ADR-008、スパイクではtasksのみ返す最小版。#501が全テーブルへ拡張）
create function public.pull_sync_batch(p_after_version bigint, p_max_versions integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_ceiling bigint;
    v_next_cursor bigint;
begin
    if v_user_id is null then
        raise exception 'unauthenticated';
    end if;
    -- 範囲検証（ADR-008）
    if p_after_version is null or p_after_version < 0 then
        raise exception 'invalid p_after_version';
    end if;
    if p_max_versions is null or p_max_versions < 1 or p_max_versions > 500 then
        raise exception 'invalid p_max_versions: must be between 1 and 500';
    end if;

    -- 対象version帯の上限（同一version値を複数バッチに割らない境界原子性）
    select v into v_ceiling from (
        select distinct version as v
          from public.tasks
         where user_id = v_user_id and version > p_after_version
         order by v
        offset p_max_versions limit 1
    ) capped;

    select coalesce(max(version), p_after_version) into v_next_cursor
      from public.tasks
     where user_id = v_user_id
       and version > p_after_version
       and (v_ceiling is null or version < v_ceiling);

    return jsonb_build_object(
        'next_cursor', v_next_cursor,
        'has_more', v_ceiling is not null,
        'tasks', (
            select coalesce(jsonb_agg(to_jsonb(t) order by t.version, t.id), '[]'::jsonb)
              from public.tasks t
             where t.user_id = v_user_id
               and t.version > p_after_version
               and (v_ceiling is null or t.version < v_ceiling)
        )
    );
end;
$$;

revoke all on function public.pull_sync_batch(bigint, integer) from public, anon;
grant execute on function public.pull_sync_batch(bigint, integer) to authenticated;

-- 11. アカウント作成時に profiles と sync_versions を必ず生成する（ADR-005/#501）
create function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.profiles (user_id) values (new.id);
    insert into public.sync_versions (user_id, current_version) values (new.id, 0);
    return new;
end;
$$;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- 12. Realtime通知（通知専用。実データはpull_sync_batchで取得する、ADR-008）
alter publication supabase_realtime add table public.tasks;
