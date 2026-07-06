-- #505: タスク書き込みの情報量をWeb仕様と一致させる
--
-- 旧 upsert_task(p_id, p_name, p_key) は名前しか受け取れず、Mobileのdual-writeで
-- priority / due_date / tags / recurrence が失われていた。全項目を受け取る版へ
-- 置き換える（既存呼び出しは名前付き引数＋デフォルト値でそのまま動く）。
-- 併せてサブタスク削除の delete_subtask を新設する。

drop function public.upsert_task(uuid, text, text);

create function public.upsert_task(
    p_id uuid,
    p_name text,
    p_key text,
    p_due_date date default null,
    p_priority text default 'medium',
    p_recurrence text default 'none',
    p_tags text[] default '{}'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_replay jsonb;
    v_version bigint;
begin
    if v_user_id is null then
        raise exception 'unauthenticated';
    end if;

    v_replay := public.reserve_idempotency_key(v_user_id, p_key, 'upsert_task');
    if v_replay is not null then return v_replay; end if;

    perform public.lock_user_sync(v_user_id);

    v_version := public.next_sync_version(v_user_id);

    insert into public.tasks (id, user_id, name, due_date, priority, recurrence, tags, version)
    values (p_id, v_user_id, p_name, p_due_date, p_priority, p_recurrence, coalesce(p_tags, '{}'), v_version)
    on conflict (id) do update
        set name = excluded.name,
            due_date = excluded.due_date,
            priority = excluded.priority,
            recurrence = excluded.recurrence,
            tags = excluded.tags,
            version = excluded.version
        where public.tasks.user_id = v_user_id; -- 他人の行は更新しない（PK衝突攻撃対策）

    perform public.finish_idempotency_key(v_user_id, p_key,
        jsonb_build_object('id', p_id, 'version', v_version));
    return jsonb_build_object('id', p_id, 'version', v_version);
end;
$$;

revoke all on function public.upsert_task(uuid, text, text, date, text, text, text[]) from public, anon;
grant execute on function public.upsert_task(uuid, text, text, date, text, text, text[]) to authenticated;

-- サブタスクの論理削除
create function public.delete_subtask(p_id uuid, p_key text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_replay jsonb;
    v_version bigint;
begin
    if v_user_id is null then
        raise exception 'unauthenticated';
    end if;

    v_replay := public.reserve_idempotency_key(v_user_id, p_key, 'delete_subtask');
    if v_replay is not null then return v_replay; end if;

    perform public.lock_user_sync(v_user_id);

    v_version := public.next_sync_version(v_user_id);

    update public.subtasks
       set deleted_at = now(), version = v_version
     where id = p_id and user_id = v_user_id and deleted_at is null;
    if not found then raise exception 'not_found_or_forbidden'; end if;

    perform public.finish_idempotency_key(v_user_id, p_key,
        jsonb_build_object('id', p_id, 'version', v_version));
    return jsonb_build_object('id', p_id, 'version', v_version);
end;
$$;

revoke all on function public.delete_subtask(uuid, text) from public, anon;
grant execute on function public.delete_subtask(uuid, text) to authenticated;
