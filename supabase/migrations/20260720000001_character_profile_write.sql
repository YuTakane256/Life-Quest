-- キャラ名・アバター変更をクラウドへ同期する新規RPC（プロフィール系書き込み配線の一部）
--
-- 背景: profiles.display_name/avatarという類似カラムが既に存在し、
-- upsert_profileで更新可能だが、pull側（packages/core/src/cloudCache.ts の
-- buildCanonicalGameSnapshot）はキャラ名・アバターをcharacters.name/avatarから
-- 読んでいる。upsert_profileだけを配線してもcharacters側は更新されず
-- 同期されない。
--
-- pull側の読み取り元をprofilesへ切り替える案も検討したが、初回移行
-- （import_snapshot_apply）はprofiles.display_name/avatarを一度も書かない
-- ため、upsert_profileを一度も呼んでいない既存ユーザー全員の名前・
-- アバターがデフォルト値へ後退するリスクがあり不採用とした。
-- characters側を更新する専用RPCを新設し、最小差分で解消する。
-- profiles/charactersの名前・アバター重複自体は別issueでの正本統一を
-- 推奨する（このRPCはその際deprecate対象）。
create function public.update_character_profile(
    p_name text,
    p_avatar text,
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
    v_current public.characters;
begin
    if v_user_id is null then raise exception 'unauthenticated'; end if;

    v_replay := public.reserve_idempotency_key(v_user_id, p_key, 'update_character_profile');
    if v_replay is not null then return v_replay; end if;

    -- 直列化: 状態検証の前にユーザーロックを取得（lock → 再検証 → 条件付き更新）
    perform public.lock_user_sync(v_user_id);

    select * into v_current from public.characters where user_id = v_user_id;
    if not found then raise exception 'character row missing for user %', v_user_id; end if;

    if p_base_version is not null and v_current.version <> p_base_version then
        -- 楽観的競合: 適用せず現在値を返す（クライアントは再取得して再送する）
        v_replay := jsonb_build_object('conflict', true, 'current', to_jsonb(v_current));
        perform public.finish_idempotency_key(v_user_id, p_key, v_replay);
        return v_replay;
    end if;

    v_version := public.next_sync_version(v_user_id);

    -- name/avatarの妥当性はcharactersテーブルのCHECK制約（name<=30文字、
    -- avatar in ('male','female')）が担保する（upsert_profileと同じ方針）
    update public.characters
       set name = p_name,
           avatar = p_avatar,
           version = v_version
     where user_id = v_user_id;

    perform public.finish_idempotency_key(v_user_id, p_key, jsonb_build_object('version', v_version));
    return jsonb_build_object('version', v_version);
end;
$$;

revoke all on function public.update_character_profile(text, text, bigint, text) from public, anon;
grant execute on function public.update_character_profile(text, text, bigint, text) to authenticated;
