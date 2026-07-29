-- タスク/サブタスクのマイルストーン宝箱をDB権威へ統一する。
--
-- Edge Functionがロック前にgacha_countを読んで宝箱候補を渡す方式では、異なる
-- 操作が同時に到着したときに節目を取りこぼし得る。ここではカウント更新後の
-- 値からDB自身が判定し、idもテーブルのdefault（gen_random_uuid）で生成する。

create or replace function public.create_milestone_chest(
    p_user_id uuid,
    p_gacha_count bigint,
    p_version bigint
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_cycle_count integer;
    v_chest_type text;
    v_label text;
    v_starter boolean := false;
begin
    if p_gacha_count = 1000 then
        v_chest_type := 'rainbow';
        v_label := '虹色の宝箱';
    elsif p_gacha_count = 500 then
        v_chest_type := 'red_gold';
        v_label := '赤と金の宝箱';
    else
        v_cycle_count := p_gacha_count % 100;
        case v_cycle_count
            when 5 then
                v_chest_type := 'blue';
                v_label := '青色の宝箱';
                -- 青箱は100周ごとに出るが、バトル解放のスターター属性は最初の5個目だけ。
                v_starter := p_gacha_count = 5;
            when 10, 25 then
                v_chest_type := 'wood';
                v_label := '木の宝箱';
            when 50 then
                v_chest_type := 'silver';
                v_label := '銀の宝箱';
            when 0 then
                v_chest_type := 'gold';
                v_label := '金の宝箱';
            else
                return;
        end case;
    end if;

    insert into public.chests (user_id, chest_type, label, is_starter_character, version)
    values (p_user_id, v_chest_type, v_label, v_starter, p_version);
end;
$$;

revoke all on function public.create_milestone_chest(uuid, bigint, bigint) from public, anon, authenticated;
grant execute on function public.create_milestone_chest(uuid, bigint, bigint) to service_role;

drop function if exists public.complete_task_apply(uuid, uuid, integer, date, jsonb, jsonb, text);
drop function if exists public.complete_subtask_apply(uuid, uuid, integer, date, jsonb, integer, jsonb, text);

create function public.complete_task_apply(
    p_user_id uuid,
    p_task_id uuid,
    p_xp integer,
    p_date date,
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

    perform public.lock_user_sync(p_user_id);

    perform 1 from public.tasks where id = p_task_id and user_id = p_user_id and deleted_at is null;
    if not found then raise exception 'not_found_or_forbidden'; end if;

    v_version := public.next_sync_version(p_user_id);
    update public.tasks
       set completed = true, completed_at = now(), version = v_version
     where id = p_task_id;

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

        perform public.create_milestone_chest(p_user_id, v_gacha_count, v_version);

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

revoke all on function public.complete_task_apply(uuid, uuid, integer, date, jsonb, text) from public, anon, authenticated;
grant execute on function public.complete_task_apply(uuid, uuid, integer, date, jsonb, text) to service_role;

create function public.complete_subtask_apply(
    p_user_id uuid,
    p_subtask_id uuid,
    p_xp integer,
    p_date date,
    p_parent_xp integer,
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
    if p_parent_xp is not null and (p_parent_xp < 0 or p_parent_xp > 1000) then raise exception 'invalid parent xp'; end if;
    if p_date is null then raise exception 'missing date'; end if;

    v_replay := public.reserve_idempotency_key(p_user_id, p_key, 'complete_subtask');
    if v_replay is not null then return v_replay; end if;

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

        perform public.create_milestone_chest(p_user_id, v_gacha_count, v_version);
    end if;

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

                    perform public.create_milestone_chest(p_user_id, v_gacha_count, v_version);
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

revoke all on function public.complete_subtask_apply(uuid, uuid, integer, date, integer, text) from public, anon, authenticated;
grant execute on function public.complete_subtask_apply(uuid, uuid, integer, date, integer, text) to service_role;
