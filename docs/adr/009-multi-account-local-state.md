# ADR-009: マルチアカウント・ローカル状態の分離とライフサイクル

- 状態: 承認済み
- 関連Issue: #503・#504・#505・#516

## 文脈

既存の `CANONICAL_STORAGE_KEYS`（packages/core/src/syncRepository.ts、`life-quest:canonical:*:v1`）はグローバルスコープで単一ユーザー前提。同一端末で複数アカウントがログイン/ログアウトを繰り返す運用では、前ユーザーのデータが後ユーザーのセッションへ漏れる。

## 決定

1. **namespace分離**: 認証済みユーザーのローカルキャッシュ・カーソル・outboxは `user_id` 別namespaceに置く。
   ```
   life-quest:cloud:{userId}:cursor:v1
   life-quest:cloud:{userId}:cache:<section>:v1
   life-quest:cloud:{userId}:outbox:v1
   life-quest:cloud:{userId}:pre-migration-backup:v1
   ```
   未認証時の既存 `quest-board-*`・`life-quest:canonical:*:v1` は変更しない（後方互換・既存移行フロー #482 を保護）。
2. **ログアウト**: 同期停止に加え、クラウド同期対象の全Zustandストアを**メモリ上で即座に初期状態へクリアする**（次のログインのシードを待たない）。別アカウントへの切り替えで前ユーザーのデータが画面・送信内容に残留してはならない。namespaceされたディスク上のキャッシュ・outboxは残す（同一ユーザー再ログイン時の再利用のため）。outboxのdrain中だったopは `pending` に戻す。
3. **退会**: サーバー側cascade削除に加え、クライアントは対象ユーザーのnamespaceローカルキャッシュ・outbox・カーソルを削除する（#516）。
4. **認証の段階分割**: #503（メール認証のみ、独立PR）→ #511（スパイク）→ #516（ソーシャル・匿名・退会）。循環依存を作らない。
5. ログイン/ログアウトのフックは `AuthLifecycleHooks`（`onLogin(userId)` / `onLogout()`）として共有契約化し、同期ブリッジ・outboxがこれを実装する。

## 未決事項

- 匿名サインインの採用可否（#516の前提。人間決定待ち）
