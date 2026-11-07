-- Classify stable-key opens within the same transaction that reserves the key.
-- A blue chest returns no item ID, so Edge cannot infer the winner from the item.
-- Keep old clients and existing receipts compatible with the previous function.
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
    -- Keep this prefix in sync with CHEST_OPEN_RETRY_KEY_PREFIX in shared core.
    v_stable_key constant boolean := pg_catalog.starts_with(p_key, 'open_chest:v1:');
begin
    if p_user_id is null then raise exception 'missing user'; end if;
    -- p_item は null 許容（blue=スターター宝箱は装備を排出しない、core共有ルール）

    v_replay := public.reserve_idempotency_key(p_user_id, p_key, 'open_chest');
    if v_replay is not null then
        if v_stable_key then return v_replay || jsonb_build_object('replayed', true); end if;
        return v_replay;
    end if;

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
    -- The marker belongs to this response, not to the stored receipt.
    perform public.finish_idempotency_key(p_user_id, p_key, v_result);
    if v_stable_key then return v_result || jsonb_build_object('replayed', false); end if;
    return v_result;
end;
$$;

revoke all on function public.open_chest_apply(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.open_chest_apply(uuid, uuid, jsonb, text) to service_role;
