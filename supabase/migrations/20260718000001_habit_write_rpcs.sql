-- 習慣（habit）操作のクラウド書き込みRPC新設
--
-- タスクには upsert_task/delete_task があるのに対し、習慣関連テーブル
-- （habits/habit_logs/rest_days）は authenticated へ select 権限しか
-- 付与されておらず、初回クラウド移行後は習慣の変更が一切クラウドへ
-- 同期されていなかった（既知のギャップ、Epic #473）。
-- upsert_task/delete_task/complete_task_apply と同じRPCパターン
-- （reserve_idempotency_key → lock_user_sync → next_sync_version）で
-- 習慣のCRUDを新設する。
--
-- set_habit_log は「completed/memoの絶対状態」をupsertする（トグルの
-- delta送信ではない）。これは再送・順序入替に対して安全であり、
-- クライアントの appendHabitActivity（上書き）運用とも一致する。
--
-- stats_daily.habit_count はここで初めて継続更新の対象になる。ただし
-- 「トグルのたびに+1」のような加算upsertは、mergeHabitLogs（count=max）の
-- 「その日一度でも到達した最大値」という単調マージ意味論を壊す
-- （on→off→on で真の最大値を超えてインフレする）。そのためhabit_logsの
-- 現状から都度re-countし、単調（greatest）マージでstats_dailyへ反映する。

-- 1. upsert_habit
create function public.upsert_habit(
    p_id uuid,
    p_name text,
    p_key text,
    p_category_id text default 'general'
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

    v_replay := public.reserve_idempotency_key(v_user_id, p_key, 'upsert_habit');
    if v_replay is not null then return v_replay; end if;

    perform public.lock_user_sync(v_user_id);

    v_version := public.next_sync_version(v_user_id);

    insert into public.habits (id, user_id, name, category_id, version)
    values (p_id, v_user_id, p_name, coalesce(p_category_id, 'general'), v_version)
    on conflict (id) do update
        set name = excluded.name,
            category_id = excluded.category_id,
            version = excluded.version
        where public.habits.user_id = v_user_id; -- 他人の行は更新しない（PK衝突攻撃対策）

    perform public.finish_idempotency_key(v_user_id, p_key,
        jsonb_build_object('id', p_id, 'version', v_version));
    return jsonb_build_object('id', p_id, 'version', v_version);
end;
$$;

revoke all on function public.upsert_habit(uuid, text, text, text) from public, anon;
grant execute on function public.upsert_habit(uuid, text, text, text) to authenticated;

-- 2. delete_habit（論理削除。関連するhabit_logsも同一versionでカスケード墓標化する。
--    物理FKのon delete cascadeは物理DELETEにしか効かないため、明示的に行う必要がある）
create function public.delete_habit(p_id uuid, p_key text) returns jsonb
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

    v_replay := public.reserve_idempotency_key(v_user_id, p_key, 'delete_habit');
    if v_replay is not null then return v_replay; end if;

    perform public.lock_user_sync(v_user_id);

    v_version := public.next_sync_version(v_user_id);

    update public.habits
       set deleted_at = now(), version = v_version
     where id = p_id and user_id = v_user_id and deleted_at is null;
    if not found then raise exception 'not_found_or_forbidden'; end if;

    update public.habit_logs
       set deleted_at = now(), version = v_version
     where habit_id = p_id and user_id = v_user_id and deleted_at is null;

    perform public.finish_idempotency_key(v_user_id, p_key,
        jsonb_build_object('id', p_id, 'version', v_version));
    return jsonb_build_object('id', p_id, 'version', v_version);
end;
$$;

revoke all on function public.delete_habit(uuid, text) from public, anon;
grant execute on function public.delete_habit(uuid, text) to authenticated;

-- 3. set_rest_day（休養日は「その日を休養にする」宣言のみ。core側にunmarkが
--    無いためp_activeは常にtrue想定だが、将来のunmark用に引数は残す）
create function public.set_rest_day(p_date date, p_active boolean, p_key text) returns jsonb
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
    if p_date is null then raise exception 'missing date'; end if;

    v_replay := public.reserve_idempotency_key(v_user_id, p_key, 'set_rest_day');
    if v_replay is not null then return v_replay; end if;

    perform public.lock_user_sync(v_user_id);

    v_version := public.next_sync_version(v_user_id);

    insert into public.rest_days (user_id, date, is_rest, version)
    values (v_user_id, p_date, coalesce(p_active, true), v_version)
    on conflict (user_id, date) do update
        set is_rest = excluded.is_rest,
            version = excluded.version;

    perform public.finish_idempotency_key(v_user_id, p_key,
        jsonb_build_object('date', p_date, 'version', v_version));
    return jsonb_build_object('date', p_date, 'version', v_version);
end;
$$;

revoke all on function public.set_rest_day(date, boolean, text) from public, anon;
grant execute on function public.set_rest_day(date, boolean, text) to authenticated;

-- 4. set_habit_log（(habit_id, date)単位の絶対状態upsert。トグル安全）＋
--    stats_daily.habit_count の単調再集計更新
create function public.set_habit_log(
    p_habit_id uuid,
    p_date date,
    p_completed boolean,
    p_memo text,
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
    v_count integer;
begin
    if v_user_id is null then
        raise exception 'unauthenticated';
    end if;
    if p_date is null then raise exception 'missing date'; end if;

    v_replay := public.reserve_idempotency_key(v_user_id, p_key, 'set_habit_log');
    if v_replay is not null then return v_replay; end if;

    perform public.lock_user_sync(v_user_id);

    perform 1 from public.habits where id = p_habit_id and user_id = v_user_id and deleted_at is null;
    if not found then raise exception 'not_found_or_forbidden'; end if;

    v_version := public.next_sync_version(v_user_id);

    insert into public.habit_logs (user_id, habit_id, date, completed, memo, version)
    values (v_user_id, p_habit_id, p_date, coalesce(p_completed, false), coalesce(p_memo, ''), v_version)
    on conflict (user_id, habit_id, date) do update
        set completed = excluded.completed,
            memo = excluded.memo,
            deleted_at = null,
            version = excluded.version;

    -- habit_countは「その日完了している未削除habitの現在件数」を都度re-countし、
    -- 単調（greatest）でstats_dailyへ反映する。トグルのたびに+1する加算方式だと
    -- on/offの繰り返しで真の同時達成数を超えてインフレし、クライアント側の
    -- mergeHabitLogs（count=max、「その日一度でも到達した最大値」の意味論）を壊すため。
    select count(*) into v_count
      from public.habit_logs l
      join public.habits h on h.id = l.habit_id and h.user_id = l.user_id
     where l.user_id = v_user_id and l.date = p_date
       and l.completed and l.deleted_at is null and h.deleted_at is null;

    insert into public.stats_daily (user_id, date, habit_count, version)
    values (v_user_id, p_date, v_count, v_version)
    on conflict (user_id, date) do update
        set habit_count = greatest(public.stats_daily.habit_count, excluded.habit_count),
            deleted_at = null,
            version = excluded.version;

    perform public.finish_idempotency_key(v_user_id, p_key,
        jsonb_build_object('habit_id', p_habit_id, 'date', p_date, 'version', v_version));
    return jsonb_build_object('habit_id', p_habit_id, 'date', p_date, 'version', v_version);
end;
$$;

revoke all on function public.set_habit_log(uuid, date, boolean, text, text) from public, anon;
grant execute on function public.set_habit_log(uuid, date, boolean, text, text) to authenticated;
