-- #505: サブタスクのクライアント書き込みRPC（outboxの依存順序テスト対象）
-- upsert_task / delete_task と同じ規約:
-- 冪等キー予約 → ユーザーロック → 最新状態の再検証 → 1操作1version で適用。
create function public.upsert_subtask(
    p_id uuid,
    p_task_id uuid,
    p_name text,
    p_key text
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

    v_replay := public.reserve_idempotency_key(v_user_id, p_key, 'upsert_subtask');
    if v_replay is not null then return v_replay; end if;

    perform public.lock_user_sync(v_user_id);

    -- 親タスクの所有検証（複合FKでも守られるが、明確なエラーで返す）
    perform 1 from public.tasks
     where id = p_task_id and user_id = v_user_id and deleted_at is null;
    if not found then raise exception 'not_found_or_forbidden'; end if;

    v_version := public.next_sync_version(v_user_id);

    insert into public.subtasks (id, task_id, user_id, name, version)
    values (p_id, p_task_id, v_user_id, p_name, v_version)
    on conflict (id) do update
        set name = excluded.name,
            version = excluded.version
        where public.subtasks.user_id = v_user_id;

    perform public.finish_idempotency_key(v_user_id, p_key,
        jsonb_build_object('id', p_id, 'version', v_version));
    return jsonb_build_object('id', p_id, 'version', v_version);
end;
$$;

revoke all on function public.upsert_subtask(uuid, uuid, text, text) from public, anon;
grant execute on function public.upsert_subtask(uuid, uuid, text, text) to authenticated;
