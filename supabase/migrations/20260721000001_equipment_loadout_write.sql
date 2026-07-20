-- 装備装着状態（inventory_items.equipped）のクラウド書き込み配線
--
-- 背景: equippedはpull側（packages/core/src/cloudCache.tsのbuildCanonicalGameSnapshot）
-- では既にクラウド権威（毎pullでサーバー値で上書き）だが、書き込み側の
-- RPC/Edge Function/outbox操作が一つも存在しなかった。equip/unequip/
-- autoEquipBestは全て純ローカル更新のため、クラウド有効ユーザーが装備を
-- 変更しても次回pullで未装備状態へ巻き戻る実害バグだった
-- （sell_item_applyのcannot_sell_equipped_itemガードも、サーバー側equipped
-- が常にfalseのため実質機能していなかった）。
--
-- 装着中アイテムID集合を絶対状態として送るset_equipped_items RPCを新設
-- する（set_rest_day/set_habit_logと同じ「絶対状態upsert」の思想。
-- equip/unequip/autoEquipBestの3操作を1つの操作型で表現でき、
-- 順序問題も起きない）。
--
-- p_item_idsはjsonb配列で受け取り、非uuid・本人所有外・削除済み・未知の
-- IDは黙って無視する（エラーにしない）。ローカル生成ID（ガチャマイル
-- ストーンの404フォールバック産の装備等）が混ざり得るため、そのような
-- 値でoutboxを恒久失敗させないための設計。
create function public.set_equipped_items(p_item_ids jsonb, p_key text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := (select auth.uid());
    v_replay jsonb;
    v_version bigint;
    v_ids uuid[] := array[]::uuid[];
    v_raw jsonb;
    v_parsed uuid;
begin
    if v_user_id is null then raise exception 'unauthenticated'; end if;
    if p_item_ids is null or jsonb_typeof(p_item_ids) <> 'array' then
        raise exception 'invalid item_ids';
    end if;
    if jsonb_array_length(p_item_ids) > 10 then
        raise exception 'too many item_ids';
    end if;

    v_replay := public.reserve_idempotency_key(v_user_id, p_key, 'set_equipped_items');
    if v_replay is not null then return v_replay; end if;

    perform public.lock_user_sync(v_user_id);

    for v_raw in select * from jsonb_array_elements(p_item_ids) loop
        begin
            v_parsed := (v_raw #>> '{}')::uuid;
            v_ids := array_append(v_ids, v_parsed);
        exception when others then
            -- 非uuid値は黙って無視する（フォールバック生成の非uuid ID等）
            null;
        end;
    end loop;

    v_version := public.next_sync_version(v_user_id);

    update public.inventory_items
       set equipped = (id = any(v_ids)),
           version = v_version
     where user_id = v_user_id
       and deleted_at is null
       and equipped <> (id = any(v_ids));

    perform public.finish_idempotency_key(v_user_id, p_key, jsonb_build_object('version', v_version));
    return jsonb_build_object('version', v_version);
end;
$$;

revoke all on function public.set_equipped_items(jsonb, text) from public, anon;
grant execute on function public.set_equipped_items(jsonb, text) to authenticated;
