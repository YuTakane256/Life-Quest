-- #502 ゲーム状態スキーマのpgTAPテスト
begin;

create extension if not exists pgtap with schema extensions;

select plan(25);

-- 1. テーブル存在
select has_table('public', 'characters',      'characters exists');
select has_table('public', 'inventory_items', 'inventory_items exists');
select has_table('public', 'chests',          'chests exists');
select has_table('public', 'battle_attempts', 'battle_attempts exists');

-- 2. RLS有効化
select ok(relrowsecurity, 'RLS enabled: ' || relname)
  from pg_class
 where oid in (
    'public.characters'::regclass, 'public.inventory_items'::regclass,
    'public.chests'::regclass, 'public.battle_attempts'::regclass
 );

-- 3. authenticated: SELECTのみ、書き込み禁止
select ok(
    has_table_privilege('authenticated', t, 'select')
    and not has_table_privilege('authenticated', t, 'insert')
    and not has_table_privilege('authenticated', t, 'update')
    and not has_table_privilege('authenticated', t, 'delete'),
    'authenticated: select-only on ' || t
)
  from unnest(array[
    'public.characters', 'public.inventory_items', 'public.chests', 'public.battle_attempts'
  ]) as t;

-- 4. apply系関数はservice_role専用、uncompleteはauthenticated可
select ok(not has_function_privilege('authenticated', fn, 'execute'), 'authenticated cannot execute ' || fn)
  from unnest(array[
    'public.complete_subtask_apply(uuid, uuid, integer, date, integer, text)',
    'public.claim_habit_bonus_apply(uuid, date, integer, text)',
    'public.sell_item_apply(uuid, uuid, integer, text)',
    'public.synthesize_items_apply(uuid, uuid[], jsonb, text)',
    'public.open_chest_apply(uuid, uuid, jsonb, text)',
    'public.start_battle_attempt_apply(uuid, uuid, integer, jsonb, jsonb, text)',
    'public.resolve_battle_attempt_apply(uuid, uuid, text, integer, text)'
  ]) as fn;

select ok(has_function_privilege('service_role', 'public.complete_subtask_apply(uuid, uuid, integer, date, integer, text)', 'execute'),
    'service_role can execute complete_subtask_apply');
select ok(has_function_privilege('authenticated', 'public.uncomplete_task(uuid, text)', 'execute'),
    'authenticated can execute uncomplete_task');
select ok(has_function_privilege('authenticated', 'public.uncomplete_subtask(uuid, text)', 'execute'),
    'authenticated can execute uncomplete_subtask');

-- 5. handle_new_userがcharacters行も生成する
insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-c@example.com');

select is(
    (select count(*)::int from public.characters where user_id = '00000000-0000-4000-8000-0000000000c3'),
    1, 'handle_new_user creates characters row');

-- 6. battle_attemptsのstatus/outcome制約
select throws_ok(
    $$ insert into public.battle_attempts (user_id, stage, status, enemy_snapshot, player_snapshot, version)
       values ('00000000-0000-4000-8000-0000000000c3', 1, 'bogus', '{}', '{}', 1) $$,
    '23514', null, 'battle_attempts: 不正なstatusはcheck制約で拒否');

select throws_ok(
    $$ insert into public.chests (user_id, chest_type, version)
       values ('00000000-0000-4000-8000-0000000000c3', 'diamond', 1) $$,
    '23514', null, 'chests: 不正なchest_typeはcheck制約で拒否');

select * from finish();

rollback;
