-- #504: アカウント作成時の初期行に version 1 を付与する
--
-- pull_sync_batch は「version > cursor（初期値0）」の行だけを返すため、
-- version 0 のまま作成された初期行（profiles / user_settings / characters）は
-- 一度も更新されない限りクライアントへ永久にプルされなかった。
-- 初期行の生成を1つの業務操作とみなし、version 1（sync_versions.current_version=1）を
-- 付与して初回プルで届くようにする。

create or replace function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    -- アカウント作成 = version 1 の変更グループ（1操作1version）
    insert into public.sync_versions (user_id, current_version) values (new.id, 1);
    insert into public.profiles (user_id, version) values (new.id, 1);
    insert into public.user_settings (user_id, version) values (new.id, 1);
    insert into public.characters (user_id, version) values (new.id, 1);
    return new;
end;
$$;

-- 既存ユーザーのversion 0初期行を1へ引き上げる（初回プルに乗せる）
update public.profiles set version = 1 where version = 0;
update public.user_settings set version = 1 where version = 0;
update public.characters set version = 1 where version = 0;
update public.sync_versions set current_version = 1 where current_version = 0;
