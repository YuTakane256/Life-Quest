-- ローカルSupabaseスタックとpgTAPの疎通を確認するスモークテスト。
-- 実スキーマのテストは #501 / #511 のマイグレーションと共に追加する。
begin;

create extension if not exists pgtap with schema extensions;

select plan(2);

select ok(true, 'database is reachable');
select has_schema('auth', 'auth schema exists (GoTrue is wired)');

select * from finish();

rollback;
