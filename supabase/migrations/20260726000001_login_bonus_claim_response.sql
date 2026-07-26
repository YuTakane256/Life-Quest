-- ログインボーナスの既受領をエラーではなく正規の確定状態として返す。
-- idempotency replayでも同じ契約を守るため、RPCの返却値にclaim_dateと
-- already_claimedを含める。Edge FunctionはJWT主体の照合を担う。

create or replace function public.claim_login_bonus_apply(
    p_user_id uuid,
    p_date date,
    p_xp integer,
    p_streak integer,
    p_chest jsonb,
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
    v_current_streak integer;
    v_current_date date;
    v_result jsonb;
begin
    if p_user_id is null then raise exception 'missing user'; end if;
    if p_xp is null or p_xp < 0 or p_xp > 1000 then raise exception 'invalid xp'; end if;
    if p_date is null then raise exception 'missing date'; end if;
    if p_streak is null or p_streak < 1 then raise exception 'invalid streak'; end if;

    v_replay := public.reserve_idempotency_key(p_user_id, p_key, 'claim_login_bonus');
    if v_replay is not null then return v_replay; end if;

    perform public.lock_user_sync(p_user_id);
    v_version := public.next_sync_version(p_user_id);

    insert into public.reward_transactions (user_id, kind, source_id, xp_delta)
    values (p_user_id, 'login_bonus', p_date::text, p_xp)
    on conflict (user_id, kind, source_id) do nothing;
    get diagnostics v_granted = row_count;

    if v_granted = 1 then
        update public.characters
           set total_xp = total_xp + p_xp,
               login_streak = p_streak,
               last_login_bonus_date = p_date,
               version = v_version
         where user_id = p_user_id;

        if p_chest is not null then
            insert into public.chests (id, user_id, chest_type, label, version)
            values ((p_chest->>'id')::uuid, p_user_id, p_chest->>'chest_type', coalesce(p_chest->>'label', ''), v_version);
        end if;
    end if;

    select login_streak, last_login_bonus_date
      into v_current_streak, v_current_date
      from public.characters
     where user_id = p_user_id;

    v_result := jsonb_build_object(
        'granted', v_granted = 1,
        'already_claimed', v_granted <> 1,
        'claim_date', v_current_date,
        'streak', v_current_streak,
        'xp', case when v_granted = 1 then p_xp else 0 end,
        'chest_label', case when v_granted = 1 and p_chest is not null then p_chest->>'label' else null end,
        'version', v_version
    );
    perform public.finish_idempotency_key(p_user_id, p_key, v_result);
    return v_result;
end;
$$;

revoke all on function public.claim_login_bonus_apply(uuid, date, integer, integer, jsonb, text) from public, anon, authenticated;
grant execute on function public.claim_login_bonus_apply(uuid, date, integer, integer, jsonb, text) to service_role;
