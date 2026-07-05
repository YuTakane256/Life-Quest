-- #502 ゲーム状態スキーマ第2弾＋サーバー権威RPC
-- characters / inventory_items / chests / battle_attempts、pull_sync_batchへの追記、
-- 価値を増減させる全操作のDB適用関数（ルール計算はEdge Functionが@life-quest/coreで行い、
-- 本ファイルの関数はトランザクション・冪等性・所有者検証・ADR-003/010ゲートのみを担う）。

-- 1. characters（1ユーザー1行。level/基礎ステータスはtotal_xpからcoreが導出する）
create table public.characters (
    user_id uuid primary key references auth.users (id) on delete cascade,
    name text not null default 'あなた' check (char_length(name) <= 30),
    avatar text not null default 'female' check (avatar in ('male', 'female')),
    total_xp bigint not null default 0 check (total_xp >= 0),
    gacha_count bigint not null default 0 check (gacha_count >= 0),
    battle_unlocked boolean not null default false,
    current_stage integer not null default 1,
    max_cleared_stage integer not null default 0,
    debuff_active boolean not null default false,
    debuff_expires_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 0
);

create index characters_user_version_idx on public.characters (user_id, version);

alter table public.characters enable row level security;
create policy characters_select on public.characters for select using ((select auth.uid()) = user_id);
grant select on public.characters to authenticated;
revoke insert, update, delete on public.characters from anon, authenticated;

-- 2. inventory_items（装備。実体はtemplate_idで、名前・ステータスはcore EQUIPMENT_POOLが持つ）
create table public.inventory_items (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    template_id text not null check (char_length(template_id) <= 100),
    equipped boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    version bigint not null,
    unique (id, user_id)
);

create index inventory_items_user_version_idx on public.inventory_items (user_id, version);

alter table public.inventory_items enable row level security;
create policy inventory_items_select on public.inventory_items for select using ((select auth.uid()) = user_id);
grant select on public.inventory_items to authenticated;
revoke insert, update, delete on public.inventory_items from anon, authenticated;

-- 3. chests（未開封の宝箱キュー＋開封履歴）
create table public.chests (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    chest_type text not null check (chest_type in ('blue', 'wood', 'silver', 'gold', 'red_gold', 'rainbow')),
    label text not null default '' check (char_length(label) <= 100),
    is_starter_character boolean not null default false,
    opened boolean not null default false,
    opened_item_id uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    version bigint not null,
    unique (id, user_id)
);

create index chests_user_version_idx on public.chests (user_id, version);

alter table public.chests enable row level security;
create policy chests_select on public.chests for select using ((select auth.uid()) = user_id);
grant select on public.chests to authenticated;
revoke insert, update, delete on public.chests from anon, authenticated;

-- 4. battle_attempts（ADR-010: 挑戦1回=1行。冪等性はattempt_id単位）
create table public.battle_attempts (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    stage integer not null check (stage >= 1),
    status text not null default 'in_progress' check (status in ('in_progress', 'resolved', 'expired')),
    enemy_snapshot jsonb not null,
    player_snapshot jsonb not null,
    outcome text check (outcome in ('victory', 'defeat')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    resolved_at timestamptz,
    version bigint not null,
    unique (id, user_id)
);

create index battle_attempts_user_idx on public.battle_attempts (user_id, created_at);
create index battle_attempts_user_version_idx on public.battle_attempts (user_id, version);

alter table public.battle_attempts enable row level security;
create policy battle_attempts_select on public.battle_attempts for select using ((select auth.uid()) = user_id);
grant select on public.battle_attempts to authenticated;
revoke insert, update, delete on public.battle_attempts from anon, authenticated;

-- 5. updated_atトリガ
create trigger set_updated_at before update on public.characters for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.inventory_items for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.chests for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.battle_attempts for each row execute function public.set_updated_at();

-- 6. handle_new_user: charactersも生成
create or replace function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.profiles (user_id) values (new.id);
    insert into public.sync_versions (user_id, current_version) values (new.id, 0);
    insert into public.user_settings (user_id) values (new.id);
    insert into public.characters (user_id) values (new.id);
    return new;
end;
$$;

-- 7. pull_sync_batch: ゲームテーブル4種を追加（12テーブル一括）
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
            union select version from public.characters   where user_id = v_user_id and version > p_after_version
            union select version from public.inventory_items where user_id = v_user_id and version > p_after_version
            union select version from public.chests       where user_id = v_user_id and version > p_after_version
            union select version from public.battle_attempts where user_id = v_user_id and version > p_after_version
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
        union select version from public.characters   where user_id = v_user_id and version > p_after_version and (v_ceiling is null or version < v_ceiling)
        union select version from public.inventory_items where user_id = v_user_id and version > p_after_version and (v_ceiling is null or version < v_ceiling)
        union select version from public.chests       where user_id = v_user_id and version > p_after_version and (v_ceiling is null or version < v_ceiling)
        union select version from public.battle_attempts where user_id = v_user_id and version > p_after_version and (v_ceiling is null or version < v_ceiling)
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
        ),
        'characters', (
            select coalesce(jsonb_agg(to_jsonb(t) order by t.version, t.user_id), '[]'::jsonb)
              from public.characters t
             where t.user_id = v_user_id and t.version > p_after_version and (v_ceiling is null or t.version < v_ceiling)
        ),
        'inventory_items', (
            select coalesce(jsonb_agg(to_jsonb(t) order by t.version, t.id), '[]'::jsonb)
              from public.inventory_items t
             where t.user_id = v_user_id and t.version > p_after_version and (v_ceiling is null or t.version < v_ceiling)
        ),
        'chests', (
            select coalesce(jsonb_agg(to_jsonb(t) order by t.version, t.id), '[]'::jsonb)
              from public.chests t
             where t.user_id = v_user_id and t.version > p_after_version and (v_ceiling is null or t.version < v_ceiling)
        ),
        'battle_attempts', (
            select coalesce(jsonb_agg(to_jsonb(t) order by t.version, t.id), '[]'::jsonb)
              from public.battle_attempts t
             where t.user_id = v_user_id and t.version > p_after_version and (v_ceiling is null or t.version < v_ceiling)
        )
    );
end;
$$;

-- 8. 冪等キーの共通予約ヘルパー（内部専用）
--    予約できたらnull、既存キーなら保存済みresult（無ければ{'replayed':true}）を返す。
create function public.reserve_idempotency_key(p_user_id uuid, p_key text, p_operation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_reserved integer;
    v_existing public.idempotency_keys;
begin
    insert into public.idempotency_keys (user_id, key, operation)
    values (p_user_id, p_key, p_operation)
    on conflict (user_id, key) do nothing;
    get diagnostics v_reserved = row_count;
    if v_reserved = 1 then
        return null;
    end if;
    select * into v_existing from public.idempotency_keys
     where user_id = p_user_id and key = p_key;
    -- 同一キーの別操作への再利用は拒否する（結果の取り違え防止）
    if v_existing.operation is distinct from p_operation then
        raise exception 'idempotency_key_operation_mismatch';
    end if;
    return coalesce(v_existing.result, jsonb_build_object('replayed', true));
end;
$$;

revoke all on function public.reserve_idempotency_key(uuid, text, text) from public, anon, authenticated;

create function public.finish_idempotency_key(p_user_id uuid, p_key text, p_result jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.idempotency_keys
       set status = 'completed', result = p_result
     where user_id = p_user_id and key = p_key;
end;
$$;

revoke all on function public.finish_idempotency_key(uuid, text, jsonb) from public, anon, authenticated;

-- 8b. ユーザー直列化ロック（versionを消費せずに取得する）
--     next_sync_versionと同じsync_versions行ロックを先に取ることで、
--     「状態検証 → 更新」の間に他トランザクションが割り込む競合を防ぐ。
--     呼び出し規約: 冪等キー予約の直後・状態検証の前に必ず呼ぶ。
--     早期return（already_resolved等）でもversionを浪費しない。
create function public.lock_user_sync(p_user_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform 1 from public.sync_versions where user_id = p_user_id for update;
    if not found then
        raise exception 'sync_versions row missing for user %', p_user_id;
    end if;
end;
$$;

revoke all on function public.lock_user_sync(uuid) from public, anon, authenticated;

-- 9. 旧スパイク関数を撤去（complete_task_applyへ置き換え）
drop function public.complete_task_authoritative(uuid, uuid, integer, text);

-- 10. complete_task_apply（ADR-003: 全副作用をreward_transactions挿入成否でゲート）
--     XP額・宝箱定義・繰り返し次回タスクはEdge Functionがcoreルールで算出して渡す。
--     p_chest: {id, chest_type, label, is_starter_character, milestone_count} | null
--       挿入は「加算後のgacha_countがmilestone_countに一致する場合」のみ
--      （EF読み取りと本トランザクションの間の並行更新レースでは挿入しない）。
--     p_next_task: {id, name, due_date, priority, recurrence, tags} | null
--       同名・同期限・未完了の未削除タスクが既にあれば挿入しない（重複防止）。
create function public.complete_task_apply(
    p_user_id uuid,
    p_task_id uuid,
    p_xp integer,
    p_chest jsonb,
    p_next_task jsonb,
    p_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_replay jsonb;
    v_version bigint;
    v_granted integer;
    v_gacha_count bigint;
    v_result jsonb;
begin
    if p_user_id is null then raise exception 'missing user'; end if;
    if p_xp is null or p_xp < 0 or p_xp > 1000 then raise exception 'invalid xp'; end if;

    v_replay := public.reserve_idempotency_key(p_user_id, p_key, 'complete_task');
    if v_replay is not null then return v_replay; end if;

    -- 直列化: 状態検証の前にユーザーロックを取得（lock → 再検証 → 条件付き更新）
    perform public.lock_user_sync(p_user_id);

    perform 1 from public.tasks where id = p_task_id and user_id = p_user_id and deleted_at is null;
    if not found then raise exception 'not_found_or_forbidden'; end if;

    v_version := public.next_sync_version(p_user_id);

    -- 完了フラグは表示状態なので毎回更新してよい（トグル可能）
    update public.tasks
       set completed = true, completed_at = now(), version = v_version
     where id = p_task_id;

    -- ADR-003ゲート: 報酬と全副作用は台帳へ新規挿入できた初回のみ
    insert into public.reward_transactions (user_id, kind, source_id, xp_delta)
    values (p_user_id, 'task_complete', p_task_id::text, p_xp)
    on conflict (user_id, kind, source_id) do nothing;
    get diagnostics v_granted = row_count;

    if v_granted = 1 then
        update public.characters
           set total_xp = total_xp + p_xp,
               gacha_count = gacha_count + 1,
               version = v_version
         where user_id = p_user_id
        returning gacha_count into v_gacha_count;

        if p_chest is not null and v_gacha_count = (p_chest->>'milestone_count')::bigint then
            insert into public.chests (id, user_id, chest_type, label, is_starter_character, version)
            values (
                (p_chest->>'id')::uuid,
                p_user_id,
                p_chest->>'chest_type',
                coalesce(p_chest->>'label', ''),
                coalesce((p_chest->>'is_starter_character')::boolean, false),
                v_version
            );
        end if;

        if p_next_task is not null and not exists (
            select 1 from public.tasks
             where user_id = p_user_id
               and name = p_next_task->>'name'
               and due_date is not distinct from (p_next_task->>'due_date')::date
               and completed = false
               and deleted_at is null
        ) then
            insert into public.tasks (id, user_id, name, due_date, priority, recurrence, tags, version)
            values (
                (p_next_task->>'id')::uuid,
                p_user_id,
                p_next_task->>'name',
                (p_next_task->>'due_date')::date,
                coalesce(p_next_task->>'priority', 'medium'),
                coalesce(p_next_task->>'recurrence', 'none'),
                coalesce((select array_agg(value) from jsonb_array_elements_text(p_next_task->'tags')), '{}'),
                v_version
            );
        end if;
    end if;

    v_result := jsonb_build_object('granted', v_granted = 1, 'version', v_version);
    perform public.finish_idempotency_key(p_user_id, p_key, v_result);
    return v_result;
end;
$$;

revoke all on function public.complete_task_apply(uuid, uuid, integer, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.complete_task_apply(uuid, uuid, integer, jsonb, jsonb, text) to service_role;

-- 11. complete_subtask_apply（サブタスクもgacha_count加算・マイルストーン対象。Web現行と同一）
--     全サブタスク完了で親タスクを自動完了し、親の報酬（p_parent_xp）も
--     同一トランザクション・同一version・ADR-003ゲートで連鎖させる。
--     p_chest はサブタスク分（gacha+1）、p_parent_chest は親分（gacha+2）の
--     マイルストーン候補。いずれも「加算後のgacha_count一致」でDBが最終判定する。
create function public.complete_subtask_apply(
    p_user_id uuid,
    p_subtask_id uuid,
    p_xp integer,
    p_chest jsonb,
    p_parent_xp integer,
    p_parent_chest jsonb,
    p_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_replay jsonb;
    v_version bigint;
    v_granted integer;
    v_parent_granted integer := 0;
    v_gacha_count bigint;
    v_task_id uuid;
    v_parent_completed boolean;
    v_all_done boolean;
    v_result jsonb;
begin
    if p_user_id is null then raise exception 'missing user'; end if;
    if p_xp is null or p_xp < 0 or p_xp > 1000 then raise exception 'invalid xp'; end if;
    if p_parent_xp is not null and (p_parent_xp < 0 or p_parent_xp > 1000) then
        raise exception 'invalid parent xp';
    end if;

    v_replay := public.reserve_idempotency_key(p_user_id, p_key, 'complete_subtask');
    if v_replay is not null then return v_replay; end if;

    -- 直列化: 状態検証の前にユーザーロックを取得（lock → 再検証 → 条件付き更新）
    perform public.lock_user_sync(p_user_id);

    select task_id into v_task_id from public.subtasks
     where id = p_subtask_id and user_id = p_user_id and deleted_at is null;
    if not found then raise exception 'not_found_or_forbidden'; end if;

    v_version := public.next_sync_version(p_user_id);

    update public.subtasks
       set completed = true, completed_at = now(), version = v_version
     where id = p_subtask_id;

    insert into public.reward_transactions (user_id, kind, source_id, xp_delta)
    values (p_user_id, 'subtask_complete', p_subtask_id::text, p_xp)
    on conflict (user_id, kind, source_id) do nothing;
    get diagnostics v_granted = row_count;

    if v_granted = 1 then
        update public.characters
           set total_xp = total_xp + p_xp,
               gacha_count = gacha_count + 1,
               version = v_version
         where user_id = p_user_id
        returning gacha_count into v_gacha_count;

        if p_chest is not null and v_gacha_count = (p_chest->>'milestone_count')::bigint then
            insert into public.chests (id, user_id, chest_type, label, is_starter_character, version)
            values (
                (p_chest->>'id')::uuid,
                p_user_id,
                p_chest->>'chest_type',
                coalesce(p_chest->>'label', ''),
                coalesce((p_chest->>'is_starter_character')::boolean, false),
                v_version
            );
        end if;
    end if;

    -- 親タスク自動完了: 未削除の全サブタスクが完了していれば親も完了させる
    select completed into v_parent_completed from public.tasks
     where id = v_task_id and user_id = p_user_id and deleted_at is null;
    if found and not v_parent_completed then
        select not exists (
            select 1 from public.subtasks
             where task_id = v_task_id and user_id = p_user_id
               and deleted_at is null and completed = false
        ) into v_all_done;

        if v_all_done then
            update public.tasks
               set completed = true, completed_at = now(), version = v_version
             where id = v_task_id;

            -- 親タスクの報酬も連鎖（ADR-003: 親のsource_idで生涯1回）
            if p_parent_xp is not null then
                insert into public.reward_transactions (user_id, kind, source_id, xp_delta)
                values (p_user_id, 'task_complete', v_task_id::text, p_parent_xp)
                on conflict (user_id, kind, source_id) do nothing;
                get diagnostics v_parent_granted = row_count;

                if v_parent_granted = 1 then
                    update public.characters
                       set total_xp = total_xp + p_parent_xp,
                           gacha_count = gacha_count + 1,
                           version = v_version
                     where user_id = p_user_id
                    returning gacha_count into v_gacha_count;

                    if p_parent_chest is not null
                       and v_gacha_count = (p_parent_chest->>'milestone_count')::bigint then
                        insert into public.chests (id, user_id, chest_type, label, is_starter_character, version)
                        values (
                            (p_parent_chest->>'id')::uuid,
                            p_user_id,
                            p_parent_chest->>'chest_type',
                            coalesce(p_parent_chest->>'label', ''),
                            coalesce((p_parent_chest->>'is_starter_character')::boolean, false),
                            v_version
                        );
                    end if;
                end if;
            end if;
        end if;
    end if;

    v_result := jsonb_build_object(
        'granted', v_granted = 1,
        'parent_completed', coalesce(v_all_done, false),
        'parent_granted', v_parent_granted = 1,
        'version', v_version
    );
    perform public.finish_idempotency_key(p_user_id, p_key, v_result);
    return v_result;
end;
$$;

revoke all on function public.complete_subtask_apply(uuid, uuid, integer, jsonb, integer, jsonb, text) from public, anon, authenticated;
grant execute on function public.complete_subtask_apply(uuid, uuid, integer, jsonb, integer, jsonb, text) to service_role;

-- 12. claim_habit_bonus_apply（習慣全達成ボーナス。日付単位で生涯1回）
create function public.claim_habit_bonus_apply(
    p_user_id uuid,
    p_date date,
    p_xp integer,
    p_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_replay jsonb;
    v_version bigint;
    v_granted integer;
    v_result jsonb;
begin
    if p_user_id is null then raise exception 'missing user'; end if;
    if p_xp is null or p_xp < 0 or p_xp > 1000 then raise exception 'invalid xp'; end if;
    if p_date is null then raise exception 'missing date'; end if;

    v_replay := public.reserve_idempotency_key(p_user_id, p_key, 'claim_habit_bonus');
    if v_replay is not null then return v_replay; end if;

    -- 直列化: 状態検証の前にユーザーロックを取得（lock → 再検証 → 条件付き更新）
    perform public.lock_user_sync(p_user_id);

    v_version := public.next_sync_version(p_user_id);

    insert into public.reward_transactions (user_id, kind, source_id, xp_delta)
    values (p_user_id, 'habit_all_complete', p_date::text, p_xp)
    on conflict (user_id, kind, source_id) do nothing;
    get diagnostics v_granted = row_count;

    if v_granted = 1 then
        update public.characters
           set total_xp = total_xp + p_xp, version = v_version
         where user_id = p_user_id;

        insert into public.stats_daily (user_id, date, all_habits_complete, version)
        values (p_user_id, p_date, true, v_version)
        on conflict (user_id, date) do update
            set all_habits_complete = true, version = excluded.version;
    end if;

    v_result := jsonb_build_object('granted', v_granted = 1, 'version', v_version);
    perform public.finish_idempotency_key(p_user_id, p_key, v_result);
    return v_result;
end;
$$;

revoke all on function public.claim_habit_bonus_apply(uuid, date, integer, text) from public, anon, authenticated;
grant execute on function public.claim_habit_bonus_apply(uuid, date, integer, text) to service_role;

-- 13. uncomplete_task / uncomplete_subtask（クライアント直接RPC。ルール計算なし。
--     reward_transactionsは削除しない = 生涯1回の維持、ADR-003）
create function public.uncomplete_task(p_id uuid, p_key text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_replay jsonb;
    v_version bigint;
    v_result jsonb;
begin
    if v_user_id is null then raise exception 'unauthenticated'; end if;

    v_replay := public.reserve_idempotency_key(v_user_id, p_key, 'uncomplete_task');
    if v_replay is not null then return v_replay; end if;

    v_version := public.next_sync_version(v_user_id);

    update public.tasks
       set completed = false, completed_at = null, version = v_version
     where id = p_id and user_id = v_user_id and deleted_at is null;
    if not found then raise exception 'not_found_or_forbidden'; end if;

    v_result := jsonb_build_object('version', v_version);
    perform public.finish_idempotency_key(v_user_id, p_key, v_result);
    return v_result;
end;
$$;

revoke all on function public.uncomplete_task(uuid, text) from public, anon;
grant execute on function public.uncomplete_task(uuid, text) to authenticated;

create function public.uncomplete_subtask(p_id uuid, p_key text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_replay jsonb;
    v_version bigint;
    v_result jsonb;
begin
    if v_user_id is null then raise exception 'unauthenticated'; end if;

    v_replay := public.reserve_idempotency_key(v_user_id, p_key, 'uncomplete_subtask');
    if v_replay is not null then return v_replay; end if;

    v_version := public.next_sync_version(v_user_id);

    update public.subtasks
       set completed = false, completed_at = null, version = v_version
     where id = p_id and user_id = v_user_id and deleted_at is null;
    if not found then raise exception 'not_found_or_forbidden'; end if;

    v_result := jsonb_build_object('version', v_version);
    perform public.finish_idempotency_key(v_user_id, p_key, v_result);
    return v_result;
end;
$$;

revoke all on function public.uncomplete_subtask(uuid, text) from public, anon;
grant execute on function public.uncomplete_subtask(uuid, text) to authenticated;

-- 14. sell_item_apply（装備中は売却不可。売却XPはEFがcore SELL_XP_BY_RARITYで算出）
create function public.sell_item_apply(
    p_user_id uuid,
    p_item_id uuid,
    p_xp integer,
    p_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_replay jsonb;
    v_version bigint;
    v_granted integer;
    v_equipped boolean;
    v_result jsonb;
begin
    if p_user_id is null then raise exception 'missing user'; end if;
    if p_xp is null or p_xp < 0 or p_xp > 10000 then raise exception 'invalid xp'; end if;

    v_replay := public.reserve_idempotency_key(p_user_id, p_key, 'sell_item');
    if v_replay is not null then return v_replay; end if;

    -- 直列化: 状態検証の前にユーザーロックを取得（lock → 再検証 → 条件付き更新）
    perform public.lock_user_sync(p_user_id);

    select equipped into v_equipped from public.inventory_items
     where id = p_item_id and user_id = p_user_id and deleted_at is null;
    if not found then raise exception 'not_found_or_forbidden'; end if;
    if v_equipped then raise exception 'cannot_sell_equipped_item'; end if;

    v_version := public.next_sync_version(p_user_id);

    update public.inventory_items
       set deleted_at = now(), version = v_version
     where id = p_item_id;

    insert into public.reward_transactions (user_id, kind, source_id, xp_delta)
    values (p_user_id, 'sell_item', p_item_id::text, p_xp)
    on conflict (user_id, kind, source_id) do nothing;
    get diagnostics v_granted = row_count;

    if v_granted = 1 then
        update public.characters
           set total_xp = total_xp + p_xp, version = v_version
         where user_id = p_user_id;
    end if;

    v_result := jsonb_build_object('granted', v_granted = 1, 'xp', p_xp, 'version', v_version);
    perform public.finish_idempotency_key(p_user_id, p_key, v_result);
    return v_result;
end;
$$;

revoke all on function public.sell_item_apply(uuid, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.sell_item_apply(uuid, uuid, integer, text) to service_role;

-- 15. synthesize_items_apply（素材5点を墓標化し、結果1点を生成。
--     同一レアリティ検証・結果ロールはEFがcoreルールで行う。DBは所有・非装備・未削除を検証）
create function public.synthesize_items_apply(
    p_user_id uuid,
    p_ingredient_ids uuid[],
    p_result_item jsonb,
    p_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_replay jsonb;
    v_version bigint;
    v_valid_count integer;
    v_result jsonb;
begin
    if p_user_id is null then raise exception 'missing user'; end if;
    -- 素材数の正解はcoreルール（SYNTHESIS_CONFIG.REQUIRED_COUNT）でEFが検証する。
    -- DBは構造的な健全性（1〜10点・重複なし）のみを確認する。
    if p_ingredient_ids is null
       or array_length(p_ingredient_ids, 1) is null
       or array_length(p_ingredient_ids, 1) < 1
       or array_length(p_ingredient_ids, 1) > 10 then
        raise exception 'invalid ingredients: bad count';
    end if;
    if (select count(distinct id) from unnest(p_ingredient_ids) as id) <> array_length(p_ingredient_ids, 1) then
        raise exception 'invalid ingredients: duplicates';
    end if;
    if p_result_item is null then raise exception 'missing result item'; end if;

    v_replay := public.reserve_idempotency_key(p_user_id, p_key, 'synthesize_items');
    if v_replay is not null then return v_replay; end if;

    -- 直列化: 状態検証の前にユーザーロックを取得（lock → 再検証 → 条件付き更新）
    perform public.lock_user_sync(p_user_id);

    select count(*) into v_valid_count from public.inventory_items
     where id = any(p_ingredient_ids) and user_id = p_user_id
       and deleted_at is null and equipped = false;
    if v_valid_count <> array_length(p_ingredient_ids, 1) then
        raise exception 'not_found_or_forbidden';
    end if;

    v_version := public.next_sync_version(p_user_id);

    update public.inventory_items
       set deleted_at = now(), version = v_version
     where id = any(p_ingredient_ids);

    insert into public.inventory_items (id, user_id, template_id, version)
    values ((p_result_item->>'id')::uuid, p_user_id, p_result_item->>'template_id', v_version);

    v_result := jsonb_build_object('result_id', p_result_item->>'id', 'version', v_version);
    perform public.finish_idempotency_key(p_user_id, p_key, v_result);
    return v_result;
end;
$$;

revoke all on function public.synthesize_items_apply(uuid, uuid[], jsonb, text) from public, anon, authenticated;
grant execute on function public.synthesize_items_apply(uuid, uuid[], jsonb, text) to service_role;

-- 16. open_chest_apply（開封結果の装備はEFがcore rollEquipmentTemplateでロール。
--     スターター宝箱の開封でバトル解放）
create function public.open_chest_apply(
    p_user_id uuid,
    p_chest_id uuid,
    p_item jsonb,
    p_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_replay jsonb;
    v_version bigint;
    v_starter boolean;
    v_opened boolean;
    v_result jsonb;
begin
    if p_user_id is null then raise exception 'missing user'; end if;
    -- p_item は null 許容（blue=スターター宝箱は装備を排出しない、core共有ルール）

    v_replay := public.reserve_idempotency_key(p_user_id, p_key, 'open_chest');
    if v_replay is not null then return v_replay; end if;

    -- 直列化: 状態検証の前にユーザーロックを取得（lock → 再検証 → 条件付き更新）
    perform public.lock_user_sync(p_user_id);

    select is_starter_character, opened into v_starter, v_opened from public.chests
     where id = p_chest_id and user_id = p_user_id and deleted_at is null;
    if not found then raise exception 'not_found_or_forbidden'; end if;
    if v_opened then raise exception 'chest_already_opened'; end if;

    v_version := public.next_sync_version(p_user_id);

    if p_item is not null then
        insert into public.inventory_items (id, user_id, template_id, version)
        values ((p_item->>'id')::uuid, p_user_id, p_item->>'template_id', v_version);
    end if;

    update public.chests
       set opened = true, opened_item_id = (p_item->>'id')::uuid, version = v_version
     where id = p_chest_id;

    if v_starter then
        update public.characters
           set battle_unlocked = true, version = v_version
         where user_id = p_user_id;
    end if;

    v_result := jsonb_build_object('item_id', p_item->>'id', 'version', v_version, 'starter_character', v_starter);
    perform public.finish_idempotency_key(p_user_id, p_key, v_result);
    return v_result;
end;
$$;

revoke all on function public.open_chest_apply(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.open_chest_apply(uuid, uuid, jsonb, text) to service_role;

-- 17. start_battle_attempt_apply（ADR-010: 進行ロックをDB側でも権威検証）
create function public.start_battle_attempt_apply(
    p_user_id uuid,
    p_attempt_id uuid,
    p_stage integer,
    p_enemy jsonb,
    p_player jsonb,
    p_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_replay jsonb;
    v_version bigint;
    v_character public.characters;
    v_result jsonb;
begin
    if p_user_id is null then raise exception 'missing user'; end if;
    if p_enemy is null or p_player is null then raise exception 'missing snapshot'; end if;

    v_replay := public.reserve_idempotency_key(p_user_id, p_key, 'start_battle_attempt');
    if v_replay is not null then return v_replay; end if;

    -- 直列化: 状態検証の前にユーザーロックを取得（lock → 再検証 → 条件付き更新）
    perform public.lock_user_sync(p_user_id);

    select * into v_character from public.characters where user_id = p_user_id;
    if not found then raise exception 'character row missing'; end if;
    if not v_character.battle_unlocked then raise exception 'battle_locked'; end if;
    if p_stage is null or p_stage < 1 or p_stage > v_character.max_cleared_stage + 1 then
        raise exception 'stage_locked';
    end if;

    v_version := public.next_sync_version(p_user_id);

    insert into public.battle_attempts (id, user_id, stage, status, enemy_snapshot, player_snapshot, version)
    values (p_attempt_id, p_user_id, p_stage, 'in_progress', p_enemy, p_player, v_version);

    v_result := jsonb_build_object(
        'battle_attempt_id', p_attempt_id,
        'enemy_snapshot', p_enemy,
        'player_snapshot', p_player,
        'version', v_version
    );
    perform public.finish_idempotency_key(p_user_id, p_key, v_result);
    return v_result;
end;
$$;

revoke all on function public.start_battle_attempt_apply(uuid, uuid, integer, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.start_battle_attempt_apply(uuid, uuid, integer, jsonb, jsonb, text) to service_role;

-- 18. resolve_battle_attempt_apply（ADR-010の核心:
--     attempt単位の冪等性。resolved済みなら既存outcomeを返し、二重付与しない。
--     再攻略は新しいattempt_id（=新しいsource_id）なので毎回報酬機会になる）
create function public.resolve_battle_attempt_apply(
    p_user_id uuid,
    p_attempt_id uuid,
    p_outcome text,
    p_xp integer,
    p_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_replay jsonb;
    v_version bigint;
    v_attempt public.battle_attempts;
    v_granted integer := 0;
    v_result jsonb;
begin
    if p_user_id is null then raise exception 'missing user'; end if;
    if p_outcome not in ('victory', 'defeat') then raise exception 'invalid outcome'; end if;
    if p_xp is null or p_xp < 0 or p_xp > 100000 then raise exception 'invalid xp'; end if;

    v_replay := public.reserve_idempotency_key(p_user_id, p_key, 'resolve_battle_attempt');
    if v_replay is not null then return v_replay; end if;

    -- 直列化: 状態検証の前にユーザーロックを取得（lock → 再検証 → 条件付き更新）
    perform public.lock_user_sync(p_user_id);

    select * into v_attempt from public.battle_attempts
     where id = p_attempt_id and user_id = p_user_id;
    if not found then raise exception 'not_found_or_forbidden'; end if;

    if v_attempt.status <> 'in_progress' then
        -- 同一attemptの結果二重送信: 既存の確定結果をそのまま返す（副作用なし）
        v_result := jsonb_build_object(
            'outcome', v_attempt.outcome,
            'granted', false,
            'already_resolved', true
        );
        perform public.finish_idempotency_key(p_user_id, p_key, v_result);
        return v_result;
    end if;

    v_version := public.next_sync_version(p_user_id);

    update public.battle_attempts
       set status = 'resolved', outcome = p_outcome, resolved_at = now(), version = v_version
     where id = p_attempt_id;

    if p_outcome = 'victory' then
        insert into public.reward_transactions (user_id, kind, source_id, xp_delta)
        values (p_user_id, 'battle_reward', p_attempt_id::text, p_xp)
        on conflict (user_id, kind, source_id) do nothing;
        get diagnostics v_granted = row_count;

        if v_granted = 1 then
            update public.characters
               set total_xp = total_xp + p_xp,
                   max_cleared_stage = greatest(max_cleared_stage, v_attempt.stage),
                   version = v_version
             where user_id = p_user_id;
        end if;
    end if;

    v_result := jsonb_build_object(
        'outcome', p_outcome,
        'granted', v_granted = 1,
        'version', v_version
    );
    perform public.finish_idempotency_key(p_user_id, p_key, v_result);
    return v_result;
end;
$$;

revoke all on function public.resolve_battle_attempt_apply(uuid, uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.resolve_battle_attempt_apply(uuid, uuid, text, integer, text) to service_role;

-- 19. service_roleへのテーブル権限の明示付与
--     このローカルCLI環境（およびそれに合わせたCI）ではテーブルへのデフォルトgrantが
--     付与されないため、Edge Function（service roleクライアント）の読み取りに必要な
--     権限を明示する。service_roleはRLSを迂回するため、EF側の全クエリで
--     user_id明示検証を行う（ADR-007）。
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;

-- 20. 既存ユーザーへのcharactersバックフィル
insert into public.characters (user_id)
select id from auth.users u
 where not exists (select 1 from public.characters c where c.user_id = u.id);

-- 21. upsert_profile: lock → 再検証 → 条件付き更新 の順へ修正（#501関数の差し替え）
--     旧実装は base_version 検証がロック取得前だったため、検証と更新の間に
--     並行更新が割り込む余地があった。
create or replace function public.upsert_profile(
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
    v_replay jsonb;
    v_current public.profiles;
begin
    if v_user_id is null then
        raise exception 'unauthenticated';
    end if;

    v_replay := public.reserve_idempotency_key(v_user_id, p_key, 'upsert_profile');
    if v_replay is not null then return v_replay; end if;

    perform public.lock_user_sync(v_user_id);

    select * into v_current from public.profiles where user_id = v_user_id;
    if not found then
        raise exception 'profile row missing for user %', v_user_id;
    end if;

    if p_base_version is not null and v_current.version <> p_base_version then
        v_replay := jsonb_build_object('conflict', true, 'current', to_jsonb(v_current));
        perform public.finish_idempotency_key(v_user_id, p_key, v_replay);
        return v_replay;
    end if;

    v_version := public.next_sync_version(v_user_id);

    update public.profiles
       set display_name = p_display_name,
           avatar = p_avatar,
           active_title = p_active_title,
           version = v_version
     where user_id = v_user_id;

    perform public.finish_idempotency_key(v_user_id, p_key, jsonb_build_object('version', v_version));
    return jsonb_build_object('version', v_version);
end;
$$;
