# ADR-004: idempotency_keysによる操作全体の冪等性

- 状態: 承認済み
- 関連Issue: #502・#505・#511

## 文脈

`reward_transactions` の一意制約 `unique(user_id, kind, source_id)` は「同一の実世界イベント（同じタスクの完了等）への二重報酬」を防ぐが、複数の副作用を持つ操作（タスク完了→XP付与→ガチャ進行→繰り返し次回生成）のうち**報酬以外の副作用の重複**は防げない。オフライン再送（#505）では同一操作が複数回サーバーに届くことが前提であり、操作全体の冪等性が別途必要になる。

## 決定

全RPC/Edge Functionの入口に共通の `idempotency_keys (user_id, key, operation, status, result jsonb, created_at)` テーブル（複合PK `(user_id, key)`）を設ける。

- キー予約は `insert ... on conflict do nothing` の戻り件数で判定する（「確認してから処理」の2ステップは同時リクエストが両方通過する競合があるため不採用）
- 予約に失敗した（既存キーの）再送は、最初の実行の `result` をそのまま返し、**一切の副作用を再実行しない**
- キー予約・全副作用・結果確定は**単一DBトランザクション**で行う。途中失敗時は予約ごとロールバックされ、部分更新が残らない（実証は#511）
- `reward_transactions` の一意制約は多層防御として並存させる（役割が異なる: idempotency_keys=「同一クライアント操作の再送」防止、reward_transactions=「同一実世界イベントへの二重報酬」防止）

## 帰結

- クライアントは操作ごとに冪等キー（UUID）を生成し、再送時に同じキーを使う（outboxの `opId` と1:1。#505）
- `idempotency_keys` はクライアントへ公開しない（SELECTも不可の内部台帳）
