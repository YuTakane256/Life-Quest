-- #506 ローカルデータのクラウド取り込み（ADR-011: Web基準の初回移行）
--
-- フローA: Webの初回移行 import_snapshot_apply（platform='web'をサーバーが強制）
-- フローB: Mobile固有コンテンツの承認制統合 import_mobile_content_apply
--
-- ローカルID（Web: `${Date.now()}-乱数`、Mobile: UUIDまたは時刻+乱数）はuuid型の
-- id列に入らないため、取り込み時にサーバーがUUIDを新規採番し、元のIDは
-- client_id 列へ保存する。参照整合（サブタスク→タスク、ログ→習慣、報酬台帳）は
-- client_id 経由で解決し、再統合の重複防止は unique(user_id, client_id) が担う。

-- 1. profiles: 移行メタデータ
alter table public.profiles
    add column imported_at timestamptz,
    add column migrated_from text check (migrated_from in ('web', 'mobile'));

-- 2. client_id（取り込み元のローカルID）
alter table public.tasks add column client_id text check (char_length(client_id) <= 100);
alter table public.subtasks add column client_id text check (char_length(client_id) <= 100);
alter table public.habits add column client_id text check (char_length(client_id) <= 100);

create unique index tasks_user_client_id_idx on public.tasks (user_id, client_id) where client_id is not null;
create unique index subtasks_user_client_id_idx on public.subtasks (user_id, client_id) where client_id is not null;
create unique index habits_user_client_id_idx on public.habits (user_id, client_id) where client_id is not null;

-- 3. 取り込み本体（フローA/B共通のコレクション挿入。呼び出し元関数から使う内部関数）
--    payloadの各行はEdge Functionがcoreルールでサニタイズ済み。
--    ledger（完了証跡のバックフィル対象）は client_id で指定され、
--    挿入後の実IDへ解決して xp_delta=0 の行を作る（ADR-003の枠取り）。
create function public.import_collections(
    p_user_id uuid,
    p_payload jsonb,
    p_version bigint
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.tasks (user_id, client_id, name, due_date, priority, recurrence, tags, completed, completed_at, created_at, version)
    select p_user_id, r.client_id, r.name, r.due_date, coalesce(r.priority, 'medium'), coalesce(r.recurrence, 'none'),
           coalesce(r.tags, '{}'), coalesce(r.completed, false), r.completed_at, coalesce(r.created_at, now()), p_version
      from jsonb_to_recordset(coalesce(p_payload->'tasks', '[]')) as r(
           client_id text, name text, due_date date, priority text, recurrence text,
           tags text[], completed boolean, completed_at timestamptz, created_at timestamptz)
     where r.client_id is not null and r.name is not null
    on conflict (user_id, client_id) where client_id is not null do nothing;

    insert into public.subtasks (task_id, user_id, client_id, name, completed, completed_at, created_at, version)
    select t.id, p_user_id, r.client_id, r.name, coalesce(r.completed, false), r.completed_at, coalesce(r.created_at, now()), p_version
      from jsonb_to_recordset(coalesce(p_payload->'subtasks', '[]')) as r(
           client_id text, task_client_id text, name text, completed boolean, completed_at timestamptz, created_at timestamptz)
      join public.tasks t on t.user_id = p_user_id and t.client_id = r.task_client_id
     where r.client_id is not null and r.name is not null
    on conflict (user_id, client_id) where client_id is not null do nothing;

    insert into public.habits (user_id, client_id, name, category_id, created_at, version)
    select p_user_id, r.client_id, r.name, coalesce(r.category_id, 'general'), coalesce(r.created_at, now()), p_version
      from jsonb_to_recordset(coalesce(p_payload->'habits', '[]')) as r(
           client_id text, name text, category_id text, created_at timestamptz)
     where r.client_id is not null and r.name is not null
    on conflict (user_id, client_id) where client_id is not null do nothing;

    insert into public.habit_logs (habit_id, user_id, date, completed, memo, version)
    select h.id, p_user_id, r.date, coalesce(r.completed, false), coalesce(r.memo, ''), p_version
      from jsonb_to_recordset(coalesce(p_payload->'habit_logs', '[]')) as r(
           habit_client_id text, date date, completed boolean, memo text)
      join public.habits h on h.user_id = p_user_id and h.client_id = r.habit_client_id
     where r.date is not null
    on conflict (user_id, habit_id, date) do nothing;

    insert into public.rest_days (user_id, date, is_rest, version)
    select p_user_id, r.date, coalesce(r.is_rest, true), p_version
      from jsonb_to_recordset(coalesce(p_payload->'rest_days', '[]')) as r(date date, is_rest boolean)
     where r.date is not null
    on conflict (user_id, date) do nothing;

    insert into public.stats_daily (user_id, date, all_habits_complete, task_xp, habit_count, version)
    select p_user_id, r.date, coalesce(r.all_habits_complete, false),
           greatest(coalesce(r.task_xp, 0), 0), greatest(coalesce(r.habit_count, 0), 0), p_version
      from jsonb_to_recordset(coalesce(p_payload->'stats_daily', '[]')) as r(
           date date, all_habits_complete boolean, task_xp integer, habit_count integer)
     where r.date is not null
    on conflict (user_id, date) do nothing;

    -- 証跡バックフィル: client_idを実IDへ解決してxp_delta=0で枠取り（ADR-003）
    insert into public.reward_transactions (user_id, kind, source_id, xp_delta)
    select p_user_id, 'task_complete', t.id::text, 0
      from jsonb_array_elements_text(coalesce(p_payload->'ledger'->'task_client_ids', '[]')) as l(client_id)
      join public.tasks t on t.user_id = p_user_id and t.client_id = l.client_id
    on conflict (user_id, kind, source_id) do nothing;

    insert into public.reward_transactions (user_id, kind, source_id, xp_delta)
    select p_user_id, 'subtask_complete', s.id::text, 0
      from jsonb_array_elements_text(coalesce(p_payload->'ledger'->'subtask_client_ids', '[]')) as l(client_id)
      join public.subtasks s on s.user_id = p_user_id and s.client_id = l.client_id
    on conflict (user_id, kind, source_id) do nothing;

    insert into public.reward_transactions (user_id, kind, source_id, xp_delta)
    select p_user_id, 'habit_all_complete', value, 0
      from jsonb_array_elements_text(coalesce(p_payload->'ledger'->'habit_bonus_dates', '[]'))
    on conflict (user_id, kind, source_id) do nothing;
end;
$$;

revoke all on function public.import_collections(uuid, jsonb, bigint) from public, anon, authenticated;

-- 4. ペイロードの構造上限（DoS防止。詳細サニタイズはEdge Function側）
create function public.assert_import_payload_size(p_payload jsonb) returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
    if p_payload is null then raise exception 'missing payload'; end if;
    if jsonb_array_length(coalesce(p_payload->'tasks', '[]')) > 2000
       or jsonb_array_length(coalesce(p_payload->'subtasks', '[]')) > 20000
       or jsonb_array_length(coalesce(p_payload->'habits', '[]')) > 500
       or jsonb_array_length(coalesce(p_payload->'habit_logs', '[]')) > 50000
       or jsonb_array_length(coalesce(p_payload->'rest_days', '[]')) > 4000
       or jsonb_array_length(coalesce(p_payload->'stats_daily', '[]')) > 4000
       or jsonb_array_length(coalesce(p_payload->'inventory_items', '[]')) > 2000
       or jsonb_array_length(coalesce(p_payload->'chests', '[]')) > 500 then
        raise exception 'payload too large';
    end if;
end;
$$;

revoke all on function public.assert_import_payload_size(jsonb) from public, anon, authenticated;

-- 5. フローA: Webによる初回クラウド移行（1トランザクション・1version）
create function public.import_snapshot_apply(
    p_user_id uuid,
    p_platform text,
    p_payload jsonb,
    p_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_replay jsonb;
    v_version bigint;
    v_imported_at timestamptz;
    v_character jsonb := p_payload->'character';
    v_total_xp bigint := 0;
    v_result jsonb;
begin
    if p_user_id is null then raise exception 'missing user'; end if;
    perform public.assert_import_payload_size(p_payload);

    v_replay := public.reserve_idempotency_key(p_user_id, p_key, 'import_snapshot');
    if v_replay is not null then return v_replay; end if;

    perform public.lock_user_sync(p_user_id);

    select imported_at into v_imported_at from public.profiles where user_id = p_user_id;
    if not found then raise exception 'profile row missing'; end if;
    if v_imported_at is not null then
        -- 二重取り込み防止: 既に移行済みなら副作用なし（冪等）
        v_result := jsonb_build_object('already_imported', true);
        perform public.finish_idempotency_key(p_user_id, p_key, v_result);
        return v_result;
    end if;

    -- ADR-011: 初回クラウド移行は必ずWebから（Mobile先行はサーバーが拒否）
    if p_platform is distinct from 'web' then
        raise exception 'web_migration_required';
    end if;

    v_version := public.next_sync_version(p_user_id);

    perform public.import_collections(p_user_id, p_payload, v_version);

    insert into public.inventory_items (user_id, template_id, equipped, version)
    select p_user_id, r.template_id, coalesce(r.equipped, false), v_version
      from jsonb_to_recordset(coalesce(p_payload->'inventory_items', '[]')) as r(
           template_id text, equipped boolean)
     where r.template_id is not null;

    insert into public.chests (user_id, chest_type, label, is_starter_character, opened, version)
    select p_user_id, r.chest_type, coalesce(r.label, ''), coalesce(r.is_starter_character, false),
           coalesce(r.opened, false), v_version
      from jsonb_to_recordset(coalesce(p_payload->'chests', '[]')) as r(
           chest_type text, label text, is_starter_character boolean, opened boolean)
     where r.chest_type is not null;

    if v_character is not null then
        v_total_xp := greatest(coalesce((v_character->>'total_xp')::bigint, 0), 0);
        update public.characters
           set name = coalesce(v_character->>'name', name),
               avatar = coalesce(v_character->>'avatar', avatar),
               total_xp = v_total_xp,
               gacha_count = greatest(coalesce((v_character->>'gacha_count')::bigint, 0), 0),
               battle_unlocked = coalesce((v_character->>'battle_unlocked')::boolean, false),
               current_stage = greatest(coalesce((v_character->>'current_stage')::integer, 1), 1),
               max_cleared_stage = greatest(coalesce((v_character->>'max_cleared_stage')::integer, 0), 0),
               debuff_active = coalesce((v_character->>'debuff_active')::boolean, false),
               debuff_expires_at = (v_character->>'debuff_expires_at')::timestamptz,
               version = v_version
         where user_id = p_user_id;
    end if;

    if p_payload->'settings' is not null then
        update public.user_settings
           set settings = p_payload->'settings', version = v_version
         where user_id = p_user_id;
    end if;

    -- 監査用の基準値: 移行時点のtotal_xp（受け入れ条件: 実行直前のローカル値と一致）
    insert into public.reward_transactions (user_id, kind, source_id, xp_delta)
    values (p_user_id, 'migration_baseline', p_platform, v_total_xp::integer)
    on conflict (user_id, kind, source_id) do nothing;

    update public.profiles
       set imported_at = now(),
           migrated_from = p_platform,
           active_title = coalesce(p_payload->>'active_title', active_title),
           version = v_version
     where user_id = p_user_id;

    v_result := jsonb_build_object('imported', true, 'version', v_version);
    perform public.finish_idempotency_key(p_user_id, p_key, v_result);
    return v_result;
end;
$$;

revoke all on function public.import_snapshot_apply(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.import_snapshot_apply(uuid, text, jsonb, text) to service_role;

-- 6. フローB: Mobile固有コンテンツの承認制統合
--    Web初回移行（imported_at）の完了後にのみ許可。承認された項目のみ挿入し、
--    unique(user_id, client_id) により複数回の統合試行でも重複しない。
create function public.import_mobile_content_apply(
    p_user_id uuid,
    p_payload jsonb,
    p_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_replay jsonb;
    v_version bigint;
    v_imported_at timestamptz;
    v_result jsonb;
begin
    if p_user_id is null then raise exception 'missing user'; end if;
    perform public.assert_import_payload_size(p_payload);

    v_replay := public.reserve_idempotency_key(p_user_id, p_key, 'import_mobile_content');
    if v_replay is not null then return v_replay; end if;

    perform public.lock_user_sync(p_user_id);

    select imported_at into v_imported_at from public.profiles where user_id = p_user_id;
    if not found then raise exception 'profile row missing'; end if;
    if v_imported_at is null then
        -- ADR-011: Webの初回移行が先
        raise exception 'web_migration_required';
    end if;

    v_version := public.next_sync_version(p_user_id);
    perform public.import_collections(p_user_id, p_payload, v_version);

    v_result := jsonb_build_object('imported', true, 'version', v_version);
    perform public.finish_idempotency_key(p_user_id, p_key, v_result);
    return v_result;
end;
$$;

revoke all on function public.import_mobile_content_apply(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.import_mobile_content_apply(uuid, jsonb, text) to service_role;
