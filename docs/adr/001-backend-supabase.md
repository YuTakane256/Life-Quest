# ADR-001: バックエンドにSupabaseを採用する

- 状態: 承認済み
- 関連Issue: #473（Epic）、#500・#501・#502

## 文脈

Life QuestをWebとMobileで同一アカウント・同一データのサービスへ統合するにあたり、認証・データベース・リアルタイム同期・サーバー側処理を提供するバックエンドが必要になった。要件は以下。

- タスク/サブタスク/報酬台帳というリレーショナルな構造（複合FK・部分一意インデックス・トランザクション）
- 報酬・インベントリ操作のサーバー権威化（改ざん・二重報酬の防止をDB制約で保証したい）
- 行レベルの認可（ユーザーは自分の行しか読めない）
- 変更のリアルタイム通知
- TypeScript型生成・ローカル開発環境（既存はvitest中心のTS monorepo）
- 個人開発規模の運用コスト

## 比較

| 観点 | Supabase | Firebase | 自前API（Node+PG） |
|---|---|---|---|
| 報酬のトランザクション権威 | ◎ SQL関数+unique制約 | △ NoSQLで台帳制約が弱い | ◎ だが全部自作 |
| 行レベル認可 | ◎ RLS | ○ Security Rules（表現力で劣る） | 自作 |
| リレーショナルモデル | ◎ | △ 非正規化が必須 | ◎ |
| Realtime | ○ postgres_changes | ◎ | 自作 |
| 型生成/ローカル開発 | ◎ CLI + gen types | △ | — |
| 運用コスト | ○ 無料枠→従量 | ○ | ✕ |

## 決定

Supabaseを採用する。Auth / PostgreSQL + RLS / Realtime / Edge Functions を利用し、Storageは当面利用しない（画像はADR-006参照）。

## 帰結

- 報酬の二重付与防止をDBの一意制約（`reward_transactions`）として表現できる（#502）
- RealtimeのRLS連携には細かい制約があるため、Realtimeは通知専用とし実データはRPCで取得する（ADR-008）
- Edge Functions（Deno）のローカルデバッグ体験は劣るが、本件の規模では許容する（実証は#511）
