-- user_settingsへの書き込み同期（設定：テーマ・モーション・通知有効/リマインダー時刻）
--
-- 背景: user_settingsテーブルはpull_sync_batchで取得されキャッシュされるが、
-- クライアントからの書き込みRPC/Edge Functionが一つも存在せず（insert/update/
-- deleteはclient roleからrevoke済み）、Web/Mobileどちらの設定変更もクラウドへ
-- 一切反映されない「片肺」状態だった。update_character_profile
-- （20260720000001）と同じ絶対値書き込み＋楽観的並行性制御のRPCを新設する。
--
-- settingsはjsonbバケットだが、同期対象はthemeMode/motionMode/
-- notificationsEnabled/habitReminderHourの4項目に限定する（クライアント側の
-- allowlist設計。notifiedTaskIds/lastHabitReminderDateはデバイスローカルの
-- 重複通知防止状態のため同期しない）。サーバー側はjsonbの中身を検証せず
-- 絶対値として保存する（キーの意味論はクライアント側の責務）。

create function public.upsert_user_settings(
    p_settings jsonb,
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
    v_current public.user_settings;
begin
    if v_user_id is null then raise exception 'unauthenticated'; end if;
    if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
        raise exception 'invalid settings payload';
    end if;
    -- 想定外の肥大化・悪用を防ぐサイズ上限（4項目程度なら数百バイトで足りる）
    if pg_column_size(p_settings) > 8192 then
        raise exception 'settings payload too large';
    end if;

    v_replay := public.reserve_idempotency_key(v_user_id, p_key, 'upsert_user_settings');
    if v_replay is not null then return v_replay; end if;

    -- 直列化: 状態検証の前にユーザーロックを取得（lock → 再検証 → 条件付き更新）
    perform public.lock_user_sync(v_user_id);

    select * into v_current from public.user_settings where user_id = v_user_id;
    if not found then raise exception 'user_settings row missing for user %', v_user_id; end if;

    if p_base_version is not null and v_current.version <> p_base_version then
        -- 楽観的競合: 適用せず現在値を返す（クライアントは再取得して再送する）
        v_replay := jsonb_build_object('conflict', true, 'current', to_jsonb(v_current));
        perform public.finish_idempotency_key(v_user_id, p_key, v_replay);
        return v_replay;
    end if;

    v_version := public.next_sync_version(v_user_id);

    update public.user_settings
       set settings = p_settings,
           version = v_version
     where user_id = v_user_id;

    perform public.finish_idempotency_key(v_user_id, p_key, jsonb_build_object('version', v_version));
    return jsonb_build_object('version', v_version);
end;
$$;

revoke all on function public.upsert_user_settings(jsonb, bigint, text) from public, anon;
grant execute on function public.upsert_user_settings(jsonb, bigint, text) to authenticated;
