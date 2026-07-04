# Architecture Decision Records

Life Quest の Web/Mobile 統合（クラウド同期・サーバー権威・データ移行）に関する技術決定の記録。
各実装Issue（#498〜#516）はここに記録された決定を共通の根拠とする。

| ADR | タイトル | 状態 |
|-----|---------|------|
| [001](./001-backend-supabase.md) | バックエンドにSupabaseを採用する | 承認済み |
| [002](./002-server-authority-edge-functions.md) | サーバー権威境界とEdge Function実行方式 | 承認済み |
| [003](./003-lifetime-once-task-rewards.md) | タスク報酬は生涯1回、全副作用を含む | 承認済み（人間決定） |
| [004](./004-idempotency-keys.md) | idempotency_keysによる操作全体の冪等性 | 承認済み |
| [005](./005-sync-versioning.md) | 同期バージョニングとカーソルの取りこぼし特性 | 承認済み |
| [006](./006-shared-assets.md) | 画像資産は共有assetsパッケージ＋ビルド時配布 | 承認済み |
| [007](./007-edge-function-authorization.md) | Edge Function内の認可設計 | 承認済み |
| [008](./008-pull-sync-batch.md) | pull_sync_batchによる全テーブル一括差分プル | 承認済み |
| [009](./009-multi-account-local-state.md) | マルチアカウント・ローカル状態の分離とライフサイクル | 承認済み |
| [010](./010-battle-attempt-rewards.md) | バトル報酬はbattle_attempt_id単位・再攻略で毎回獲得可 | 承認済み（人間決定） |
| [011](./011-web-first-migration.md) | 初回クラウド移行はWeb基準、Mobileはバックアップ後置換 | 承認済み（人間決定） |

## 未決事項

- **匿名サインインの採用可否**（#516の前提）: 未決定。決定後にADR-009へ追記する。
- **3台目以降の端末の扱い**: ADR-011はWeb→Mobileの初回接続を主眼に決定された。初回移行完了後の追加端末は既にSupabaseが唯一の正であるため通常ログインとして扱う想定だが、明示確認が必要になれば別途決定する。
