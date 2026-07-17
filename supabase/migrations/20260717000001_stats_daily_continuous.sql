-- stats_daily.task_xp の継続更新（統計ログクラウド復元の完成、#560/#561/#562の続き）
--
-- claim_habit_bonus_apply は初回移行済み。complete_task_apply / complete_subtask_apply は
-- p_date を受け取らずstats_dailyへ一切書き込んでいなかったため、初回クラウド移行以降の
-- タスク/サブタスク完了によるXP獲得がstats_dailyへ反映されず、他端末での実績（activeDays）
-- 復元が初回移行時点までしか効かない既知のギャップがあった。
--
-- 引数の追加（p_date）はPostgreSQLでは別シグネチャの関数として扱われるため、
-- create or replace ではなく旧シグネチャの drop → 新シグネチャでの create が必要。

drop function if exists public.complete_task_apply(uuid, uuid, integer, jsonb, jsonb, text);
drop function if exists public.complete_subtask_apply(uuid, uuid, integer, jsonb, integer, jsonb, text);

-- 10'. complete_task_apply（p_date追加: 初回付与時にstats_daily.task_xpへ加算）
create function public.complete_task_apply(
    p_user_id uuid,
    p_task_id uuid,
    p_xp integer,
    p_date date,
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
    if p_date is null then raise exception 'missing date'; end if;

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

        insert into public.stats_daily (user_id, date, task_xp, version)
        values (p_user_id, p_date, p_xp, v_version)
        on conflict (user_id, date) do update
            set task_xp = public.stats_daily.task_xp + excluded.task_xp,
                deleted_at = null,
                version = excluded.version;

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

revoke all on function public.complete_task_apply(uuid, uuid, integer, date, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.complete_task_apply(uuid, uuid, integer, date, jsonb, jsonb, text) to service_role;

-- 11'. complete_subtask_apply（p_date追加: サブタスク分・親タスク分それぞれのゲート内で
--      stats_daily.task_xpへ独立に加算する。同一トランザクション内の2回目のupsertは
--      1回目のinsertを見た上でのupdateパスに入るため正しく累積する）
create function public.complete_subtask_apply(
    p_user_id uuid,
    p_subtask_id uuid,
    p_xp integer,
    p_date date,
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
    if p_date is null then raise exception 'missing date'; end if;

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

        insert into public.stats_daily (user_id, date, task_xp, version)
        values (p_user_id, p_date, p_xp, v_version)
        on conflict (user_id, date) do update
            set task_xp = public.stats_daily.task_xp + excluded.task_xp,
                deleted_at = null,
                version = excluded.version;

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

                    insert into public.stats_daily (user_id, date, task_xp, version)
                    values (p_user_id, p_date, p_parent_xp, v_version)
                    on conflict (user_id, date) do update
                        set task_xp = public.stats_daily.task_xp + excluded.task_xp,
                            deleted_at = null,
                            version = excluded.version;

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

revoke all on function public.complete_subtask_apply(uuid, uuid, integer, date, jsonb, integer, jsonb, text) from public, anon, authenticated;
grant execute on function public.complete_subtask_apply(uuid, uuid, integer, date, jsonb, integer, jsonb, text) to service_role;

-- claim_habit_bonus_apply: 既存のstats_daily upsertにdeleted_at = nullを追加し、
-- 上記2関数のupsertと挙動を揃える（tombstone後の復活経路の一貫性）。
create or replace function public.claim_habit_bonus_apply(
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
            set all_habits_complete = true,
                deleted_at = null,
                version = excluded.version;
    end if;

    v_result := jsonb_build_object('granted', v_granted = 1, 'version', v_version);
    perform public.finish_idempotency_key(p_user_id, p_key, v_result);
    return v_result;
end;
$$;

revoke all on function public.claim_habit_bonus_apply(uuid, date, integer, text) from public, anon, authenticated;
grant execute on function public.claim_habit_bonus_apply(uuid, date, integer, text) to service_role;
