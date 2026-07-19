-- 宝箱開封・装備合成のレスポンスへtemplate_idを追加する
--
-- クライアントは開封演出（pendingChestReveal）・合成結果表示に排出装備の
-- テンプレート情報が必要だが、既存のopen_chest_apply/synthesize_items_apply
-- はitem_id/result_idしか返しておらず、Edge Function側で別途保持している
-- template（p_item->>'template_id'として既に引数で渡している値）を
-- レスポンスへ含めていなかった。
--
-- 冪等キー再送（reserve_idempotency_key）時はDB関数が最初の呼び出しの
-- v_resultをそのまま返すため、Edge Function側でレスポンスへ後付けで
-- template_idをマージする方式だと、再送時にEFが「今回新たに」ロールした
-- テンプレート（実際には挿入されていない、破棄される値）を誤って返して
-- しまう。DB関数のv_result自体にtemplate_idを含めることで、再送時も
-- 実際に挿入された（＝最初の呼び出しでinsertされた）template_idが
-- 正しく返るようにする。

create or replace function public.open_chest_apply(
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

    v_result := jsonb_build_object(
        'item_id', p_item->>'id',
        'template_id', p_item->>'template_id',
        'version', v_version,
        'starter_character', v_starter
    );
    perform public.finish_idempotency_key(p_user_id, p_key, v_result);
    return v_result;
end;
$$;

revoke all on function public.open_chest_apply(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.open_chest_apply(uuid, uuid, jsonb, text) to service_role;

create or replace function public.synthesize_items_apply(
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

    v_result := jsonb_build_object(
        'result_id', p_result_item->>'id',
        'template_id', p_result_item->>'template_id',
        'version', v_version
    );
    perform public.finish_idempotency_key(p_user_id, p_key, v_result);
    return v_result;
end;
$$;

revoke all on function public.synthesize_items_apply(uuid, uuid[], jsonb, text) from public, anon, authenticated;
grant execute on function public.synthesize_items_apply(uuid, uuid[], jsonb, text) to service_role;
