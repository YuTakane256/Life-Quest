-- #501 コアスキーマ第1弾: #511スパイク（tasks縦切り）の上への差分追加
-- 対象: profiles拡張 / subtasks / habits / habit_logs / rest_days /
--        user_settings / stats_daily / pull_sync_batch全テーブル化 / upsert_profile
-- DDL適用順序は #501 の規約に従う。

-- 1. next_sync_version: 1操作1versionの規約ガード（レビュー指摘#9）
--    同一トランザクション内で2回呼ばれたら例外にする。
--    「1つの業務操作(1トランザクション) = 1回の採番 = 1つの完結した変更グループ」を
--    構造的に強制する（set_configのis_local=trueでトランザクション終了時に自動リセット）。
create or replace function public.next_sync_version(p_user_id uuid) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_version bigint;
begin
    if current_setting('lifequest.sync_version_issued', true) = 'true' then
        raise exception 'next_sync_version called twice in one transaction (1操作1versionの規約違反)';
    end if;
    perform set_config('lifequest.sync_version_issued', 'true', true);

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

-- 2. profiles拡張（同期対象化。レビュー指摘#7）
alter table public.profiles
    add column avatar text,
    add column active_title text check (char_length(active_title) <= 40),
    add column version bigint not null default 0;

alter table public.profiles
    add constraint profiles_display_name_len check (char_length(display_name) <= 50);

create index profiles_user_version_idx on public.profiles (user_id, version);

-- 3. tasksへドメイン列を追加（core Task型と同型）
alter table public.tasks
    add column due_date date,
    add column priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
    add column recurrence text not null default 'none' check (recurrence in ('none', 'daily', 'weekly', 'monthly')),
    add column tags text[] not null default '{}' check (cardinality(tags) <= 20);

-- 4. subtasks（tasksへの複合FK。親タスクと同一ユーザーであることをFKで保証）
create table public.subtasks (
    id uuid primary key default gen_random_uuid(),
    task_id uuid not null,
    user_id uuid not null references auth.users (id) on delete cascade,
    name text not null check (char_length(name) <= 200),
    completed boolean not null default false,
    completed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    version bigint not null,
    unique (id, user_id),
    foreign key (task_id, user_id) references public.tasks (id, user_id) on delete cascade
);

create index subtasks_user_version_idx on public.subtasks (user_id, version);
create index subtasks_task_idx on public.subtasks (task_id);

alter table public.subtasks enable row level security;
create policy subtasks_select on public.subtasks for select using ((select auth.uid()) = user_id);
grant select on public.subtasks to authenticated;
revoke insert, update, delete on public.subtasks from anon, authenticated;

-- 5. habits
create table public.habits (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    name text not null check (char_length(name) <= 200),
    category_id text not null default 'general' check (char_length(category_id) <= 50),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    version bigint not null,
    unique (id, user_id) -- habit_logsの複合FK参照先
);

create index habits_user_version_idx on public.habits (user_id, version);

alter table public.habits enable row level security;
create policy habits_select on public.habits for select using ((select auth.uid()) = user_id);
grant select on public.habits to authenticated;
revoke insert, update, delete on public.habits from anon, authenticated;

-- 6. habit_logs（習慣の日次記録。親習慣と同一ユーザーであることを複合FKで保証）
create table public.habit_logs (
    habit_id uuid not null,
    user_id uuid not null references auth.users (id) on delete cascade,
    date date not null,
    completed boolean not null default false,
    memo text not null default '' check (char_length(memo) <= 500),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    version bigint not null,
    primary key (user_id, habit_id, date),
    foreign key (habit_id, user_id) references public.habits (id, user_id) on delete cascade
);

create index habit_logs_user_version_idx on public.habit_logs (user_id, version);

alter table public.habit_logs enable row level security;
create policy habit_logs_select on public.habit_logs for select using ((select auth.uid()) = user_id);
grant select on public.habit_logs to authenticated;
revoke insert, update, delete on public.habit_logs from anon, authenticated;

-- 7. rest_days（休息日）
create table public.rest_days (
    user_id uuid not null references auth.users (id) on delete cascade,
    date date not null,
    is_rest boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    version bigint not null,
    primary key (user_id, date)
);

create index rest_days_user_version_idx on public.rest_days (user_id, version);

alter table public.rest_days enable row level security;
create policy rest_days_select on public.rest_days for select using ((select auth.uid()) = user_id);
grant select on public.rest_days to authenticated;
revoke insert, update, delete on public.rest_days from anon, authenticated;

-- 8. user_settings（ユーザー単位の設定バケット。1ユーザー1行、handle_new_userで生成）
create table public.user_settings (
    user_id uuid primary key references auth.users (id) on delete cascade,
    settings jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 0
);

create index user_settings_user_version_idx on public.user_settings (user_id, version);

alter table public.user_settings enable row level security;
create policy user_settings_select on public.user_settings for select using ((select auth.uid()) = user_id);
grant select on public.user_settings to authenticated;
revoke insert, update, delete on public.user_settings from anon, authenticated;

-- 9. stats_daily（日次集計。全習慣完了日 allCompleteDates の同期先）
create table public.stats_daily (
    user_id uuid not null references auth.users (id) on delete cascade,
    date date not null,
    all_habits_complete boolean not null default false,
    task_xp integer not null default 0 check (task_xp >= 0),
    habit_count integer not null default 0 check (habit_count >= 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    version bigint not null,
    primary key (user_id, date)
);

create index stats_daily_user_version_idx on public.stats_daily (user_id, version);

alter table public.stats_daily enable row level security;
create policy stats_daily_select on public.stats_daily for select using ((select auth.uid()) = user_id);
grant select on public.stats_daily to authenticated;
revoke insert, update, delete on public.stats_daily from anon, authenticated;

-- 10. updated_atトリガ（全コンテンツテーブル共通）
create function public.set_updated_at() returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.tasks for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.subtasks for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.habits for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.habit_logs for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.rest_days for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.user_settings for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.stats_daily for each row execute function public.set_updated_at();

-- 11. pull_sync_batch: 全テーブル一括版へ差し替え（ADR-008、レビュー指摘#7・#8）
--     - profilesを含む8テーブルを1バッチで返す
--     - version境界の原子性: 同一version値を複数バッチに割らない（ceiling方式）
--     - 返却順は (version, PK) で決定的
--     - #502がcharacters/inventory_items/chestsをこの関数に追記する
create or replace function public.pull_sync_batch(p_after_version bigint, p_max_versions integer)
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
    if p_after_version is null or p_after_version < 0 then
        raise exception 'invalid p_after_version';
    end if;
    if p_max_versions is null or p_max_versions < 1 or p_max_versions > 500 then
        raise exception 'invalid p_max_versions: must be between 1 and 500';
    end if;

    -- 対象version帯の上限（境界原子性）。全テーブルのversionをunionして数える。
    select v into v_ceiling from (
        select distinct v from (
            select version as v from public.profiles      where user_id = v_user_id and version > p_after_version
            union select version from public.tasks        where user_id = v_user_id and version > p_after_version
            union select version from public.subtasks     where user_id = v_user_id and version > p_after_version
            union select version from public.habits       where user_id = v_user_id and version > p_after_version
            union select version from public.habit_logs   where user_id = v_user_id and version > p_after_version
            union select version from public.rest_days    where user_id = v_user_id and version > p_after_version
            union select version from public.user_settings where user_id = v_user_id and version > p_after_version
            union select version from public.stats_daily  where user_id = v_user_id and version > p_after_version
        ) all_versions order by v offset p_max_versions limit 1
    ) capped;

    select coalesce(max(v), p_after_version) into v_next_cursor from (
        select version as v from public.profiles      where user_id = v_user_id and version > p_after_version and (v_ceiling is null or version < v_ceiling)
        union select version from public.tasks        where user_id = v_user_id and version > p_after_version and (v_ceiling is null or version < v_ceiling)
        union select version from public.subtasks     where user_id = v_user_id and version > p_after_version and (v_ceiling is null or version < v_ceiling)
        union select version from public.habits       where user_id = v_user_id and version > p_after_version and (v_ceiling is null or version < v_ceiling)
        union select version from public.habit_logs   where user_id = v_user_id and version > p_after_version and (v_ceiling is null or version < v_ceiling)
        union select version from public.rest_days    where user_id = v_user_id and version > p_after_version and (v_ceiling is null or version < v_ceiling)
        union select version from public.user_settings where user_id = v_user_id and version > p_after_version and (v_ceiling is null or version < v_ceiling)
        union select version from public.stats_daily  where user_id = v_user_id and version > p_after_version and (v_ceiling is null or version < v_ceiling)
    ) included;

    return jsonb_build_object(
        'next_cursor', v_next_cursor,
        'has_more', v_ceiling is not null,
        'profiles', (
            select coalesce(jsonb_agg(to_jsonb(t) order by t.version, t.user_id), '[]'::jsonb)
              from public.profiles t
             where t.user_id = v_user_id and t.version > p_after_version and (v_ceiling is null or t.version < v_ceiling)
        ),
        'tasks', (
            select coalesce(jsonb_agg(to_jsonb(t) order by t.version, t.id), '[]'::jsonb)
              from public.tasks t
             where t.user_id = v_user_id and t.version > p_after_version and (v_ceiling is null or t.version < v_ceiling)
        ),
        'subtasks', (
            select coalesce(jsonb_agg(to_jsonb(t) order by t.version, t.id), '[]'::jsonb)
              from public.subtasks t
             where t.user_id = v_user_id and t.version > p_after_version and (v_ceiling is null or t.version < v_ceiling)
        ),
        'habits', (
            select coalesce(jsonb_agg(to_jsonb(t) order by t.version, t.id), '[]'::jsonb)
              from public.habits t
             where t.user_id = v_user_id and t.version > p_after_version and (v_ceiling is null or t.version < v_ceiling)
        ),
        'habit_logs', (
            select coalesce(jsonb_agg(to_jsonb(t) order by t.version, t.habit_id, t.date), '[]'::jsonb)
              from public.habit_logs t
             where t.user_id = v_user_id and t.version > p_after_version and (v_ceiling is null or t.version < v_ceiling)
        ),
        'rest_days', (
            select coalesce(jsonb_agg(to_jsonb(t) order by t.version, t.date), '[]'::jsonb)
              from public.rest_days t
             where t.user_id = v_user_id and t.version > p_after_version and (v_ceiling is null or t.version < v_ceiling)
        ),
        'user_settings', (
            select coalesce(jsonb_agg(to_jsonb(t) order by t.version, t.user_id), '[]'::jsonb)
              from public.user_settings t
             where t.user_id = v_user_id and t.version > p_after_version and (v_ceiling is null or t.version < v_ceiling)
        ),
        'stats_daily', (
            select coalesce(jsonb_agg(to_jsonb(t) order by t.version, t.date), '[]'::jsonb)
              from public.stats_daily t
             where t.user_id = v_user_id and t.version > p_after_version and (v_ceiling is null or t.version < v_ceiling)
        )
    );
end;
$$;

-- 12. upsert_profile（プロフィールは本関数経由のみで更新。ADR-007）
--     p_base_versionが渡され、かつ現在のversionと不一致なら適用せず現在値を返す
--     （楽観的並行性制御。nullなら無条件LWW上書き）。
create function public.upsert_profile(
    p_display_name text,
    p_avatar text,
    p_active_title text,
    p_base_version bigint,
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
    v_current public.profiles;
begin
    if v_user_id is null then
        raise exception 'unauthenticated';
    end if;

    insert into public.idempotency_keys (user_id, key, operation)
    values (v_user_id, p_key, 'upsert_profile')
    on conflict (user_id, key) do nothing;
    get diagnostics v_reserved = row_count;
    if v_reserved = 0 then
        select result into v_existing from public.idempotency_keys
         where user_id = v_user_id and key = p_key;
        return coalesce(v_existing, jsonb_build_object('replayed', true));
    end if;

    select * into v_current from public.profiles where user_id = v_user_id;
    if not found then
        raise exception 'profile row missing for user %', v_user_id;
    end if;

    if p_base_version is not null and v_current.version <> p_base_version then
        -- 楽観的競合: 適用せず現在値を返す（クライアントは再取得して再送する）
        update public.idempotency_keys
           set status = 'completed',
               result = jsonb_build_object('conflict', true, 'current', to_jsonb(v_current))
         where user_id = v_user_id and key = p_key;
        return jsonb_build_object('conflict', true, 'current', to_jsonb(v_current));
    end if;

    v_version := public.next_sync_version(v_user_id);

    update public.profiles
       set display_name = p_display_name,
           avatar = p_avatar,
           active_title = p_active_title,
           version = v_version
     where user_id = v_user_id;

    update public.idempotency_keys
       set status = 'completed', result = jsonb_build_object('version', v_version)
     where user_id = v_user_id and key = p_key;

    return jsonb_build_object('version', v_version);
end;
$$;

revoke all on function public.upsert_profile(text, text, text, bigint, text) from public, anon;
grant execute on function public.upsert_profile(text, text, text, bigint, text) to authenticated;

-- 13. handle_new_user: user_settings行も生成する（1ユーザー1行の不変条件）
create or replace function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.profiles (user_id) values (new.id);
    insert into public.sync_versions (user_id, current_version) values (new.id, 0);
    insert into public.user_settings (user_id) values (new.id);
    return new;
end;
$$;

-- 13b. 既存ユーザーへのバックフィル
--     handle_new_userの生成対象行（profiles / sync_versions / user_settings）が
--     このマイグレーション以前に作成されたユーザーに欠けている場合に補完する。
insert into public.profiles (user_id)
select id from auth.users u
 where not exists (select 1 from public.profiles p where p.user_id = u.id);

insert into public.sync_versions (user_id, current_version)
select id, 0 from auth.users u
 where not exists (select 1 from public.sync_versions s where s.user_id = u.id);

insert into public.user_settings (user_id)
select id from auth.users u
 where not exists (select 1 from public.user_settings s where s.user_id = u.id);

-- 14. Realtime通知をsync_versions 1テーブルに集約（ADR-008: 通知専用）
--     全ての書き込み操作はnext_sync_versionでsync_versionsをUPDATEするため、
--     クライアントはsync_versions 1行の変更購読だけで全テーブルの変更を検知できる。
--     RealtimeはRLSで認可されるため、自分の行のSELECTポリシーが必要。
alter table public.sync_versions enable row level security;
create policy sync_versions_select on public.sync_versions for select using ((select auth.uid()) = user_id);
grant select on public.sync_versions to authenticated;
revoke insert, update, delete on public.sync_versions from anon, authenticated;

alter publication supabase_realtime add table public.sync_versions;
