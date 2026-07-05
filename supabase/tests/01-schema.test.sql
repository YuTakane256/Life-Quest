-- #501 コアスキーマのpgTAPテスト
-- 検証対象: テーブル存在、RLS有効化、直接書き込みrevoke、複合FK違反拒否、EXECUTE権限
begin;

create extension if not exists pgtap with schema extensions;

select plan(56);

-- 1. テーブル存在
select has_table('public', 'sync_versions',  'sync_versions exists');
select has_table('public', 'profiles',       'profiles exists');
select has_table('public', 'tasks',          'tasks exists');
select has_table('public', 'subtasks',       'subtasks exists');
select has_table('public', 'habits',         'habits exists');
select has_table('public', 'habit_logs',     'habit_logs exists');
select has_table('public', 'rest_days',      'rest_days exists');
select has_table('public', 'user_settings',  'user_settings exists');
select has_table('public', 'stats_daily',    'stats_daily exists');
select has_table('public', 'idempotency_keys',     'idempotency_keys exists');
select has_table('public', 'reward_transactions',  'reward_transactions exists');

-- 1b. stats_daily: Web統計が使う列（レビュー指摘対応）
select has_column('public', 'stats_daily', 'task_xp',     'stats_daily.task_xp exists');
select has_column('public', 'stats_daily', 'habit_count', 'stats_daily.habit_count exists');

-- 2. RLS有効化（全コンテンツテーブル＋sync_versions）
select ok(relrowsecurity, 'RLS enabled: ' || relname)
  from pg_class
 where oid in (
    'public.sync_versions'::regclass, 'public.profiles'::regclass,
    'public.tasks'::regclass, 'public.subtasks'::regclass,
    'public.habits'::regclass, 'public.habit_logs'::regclass,
    'public.rest_days'::regclass, 'public.user_settings'::regclass,
    'public.stats_daily'::regclass, 'public.idempotency_keys'::regclass,
    'public.reward_transactions'::regclass
 );

-- 3. authenticated: SELECTのみ許可、直接書き込みは全面禁止
select ok(has_table_privilege('authenticated', t, 'select'), 'authenticated can SELECT ' || t)
  from unnest(array[
    'public.profiles', 'public.tasks', 'public.subtasks', 'public.habits',
    'public.habit_logs', 'public.rest_days', 'public.user_settings',
    'public.stats_daily', 'public.sync_versions'
  ]) as t;

select ok(
    not has_table_privilege('authenticated', t, 'insert')
    and not has_table_privilege('authenticated', t, 'update')
    and not has_table_privilege('authenticated', t, 'delete'),
    'authenticated cannot write ' || t
)
  from unnest(array[
    'public.profiles', 'public.tasks', 'public.subtasks', 'public.habits',
    'public.habit_logs', 'public.rest_days', 'public.user_settings',
    'public.stats_daily', 'public.sync_versions'
  ]) as t;

-- 4. idempotency_keys は内部台帳: SELECTすら不可
select ok(
    not has_table_privilege('authenticated', 'public.idempotency_keys', 'select'),
    'authenticated cannot SELECT idempotency_keys'
);

-- 5. EXECUTE権限
select ok(has_function_privilege('authenticated', 'public.upsert_task(uuid, text, text)', 'execute'),
    'authenticated can execute upsert_task');
select ok(has_function_privilege('authenticated', 'public.delete_task(uuid, text)', 'execute'),
    'authenticated can execute delete_task');
select ok(has_function_privilege('authenticated', 'public.upsert_profile(text, text, text, bigint, text)', 'execute'),
    'authenticated can execute upsert_profile');
select ok(has_function_privilege('authenticated', 'public.pull_sync_batch(bigint, integer)', 'execute'),
    'authenticated can execute pull_sync_batch');
select ok(not has_function_privilege('authenticated', 'public.next_sync_version(uuid)', 'execute'),
    'authenticated cannot execute next_sync_version');
select ok(not has_function_privilege('authenticated', 'public.complete_task_apply(uuid, uuid, integer, jsonb, jsonb, text)', 'execute'),
    'authenticated cannot execute complete_task_apply');
select ok(has_function_privilege('service_role', 'public.complete_task_apply(uuid, uuid, integer, jsonb, jsonb, text)', 'execute'),
    'service_role can execute complete_task_apply');

-- 6. 複合FK違反の拒否（親と異なるユーザーの子行は作れない）
--    2ユーザーと親行をsuperuserとして直接用意する。
insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-a@example.com'),
       ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pgtap-b@example.com');

insert into public.tasks (id, user_id, name, version)
values ('00000000-0000-4000-8000-0000000a0001', '00000000-0000-4000-8000-0000000000a1', 'FK親タスク', 1);

insert into public.habits (id, user_id, name, version)
values ('00000000-0000-4000-8000-0000000b0001', '00000000-0000-4000-8000-0000000000a1', 'FK親習慣', 2);

select throws_ok(
    $$ insert into public.subtasks (task_id, user_id, name, version)
       values ('00000000-0000-4000-8000-0000000a0001', '00000000-0000-4000-8000-0000000000b2', '他人の親への子', 3) $$,
    '23503',
    null,
    'subtasks: 親タスクと異なるユーザーの子行は複合FK違反で拒否される'
);

select throws_ok(
    $$ insert into public.habit_logs (habit_id, user_id, date, version)
       values ('00000000-0000-4000-8000-0000000b0001', '00000000-0000-4000-8000-0000000000b2', '2026-07-05', 3) $$,
    '23503',
    null,
    'habit_logs: 親習慣と異なるユーザーの子行は複合FK違反で拒否される'
);

-- 正しいユーザーなら通る
insert into public.subtasks (task_id, user_id, name, version)
values ('00000000-0000-4000-8000-0000000a0001', '00000000-0000-4000-8000-0000000000a1', '正当な子', 3);
select ok(true, 'subtasks: 同一ユーザーの子行は挿入できる');

-- 7. handle_new_userがprofiles/sync_versions/user_settingsを生成している
select is(
    (select count(*)::int from public.profiles where user_id = '00000000-0000-4000-8000-0000000000a1'),
    1, 'handle_new_user creates profiles row');
select is(
    (select count(*)::int from public.sync_versions where user_id = '00000000-0000-4000-8000-0000000000a1'),
    1, 'handle_new_user creates sync_versions row');
select is(
    (select count(*)::int from public.user_settings where user_id = '00000000-0000-4000-8000-0000000000a1'),
    1, 'handle_new_user creates user_settings row');

select * from finish();

rollback;
