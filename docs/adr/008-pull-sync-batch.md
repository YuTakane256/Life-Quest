# ADR-008: pull_sync_batchによる全テーブル一括差分プル

- 状態: 承認済み
- 関連Issue: #501・#502・#504・#511

## 文脈

versionはユーザーごと・全テーブル共通の単一タイムライン（ADR-005）だが、初期案の「各テーブルを独立に `version > cursor LIMIT N` でページングする」方式には欠陥があった: 1つのversion値に複数テーブルの変更が属する場合や、1テーブルだけLIMITで打ち切られた場合、「どのテーブルまでどのversionを消化したか」を単一カーソルで表現できず、カーソル前進の瞬間に未消化テーブルの同version帯が取りこぼされる。

## 決定

単一のサーバー関数 `pull_sync_batch(p_after_version bigint, p_max_versions int)`（SECURITY DEFINER・`search_path=''`固定・`auth.uid()`使用・authenticatedのみEXECUTE可）で、`after_version` より大きい次のversion群に属する**全テーブルの変更行を一括で返す**。

- **境界の原子性**: あるversion値 V を返すなら、全テーブルにまたがる V の行を漏れなく全部返す。バッチの切れ目は必ずversion値の境界で行い、同一version値の行が複数バッチに割れることを禁止する。`next_cursor` は「このバッチで完全に消化しきったversionの最大値」
- **範囲検証**: `p_max_versions` は 1〜500 の範囲外で例外。`p_after_version` は負数で例外
- **返却順の固定**: 各テーブルの行は `(version, id)` 順（複合PKのテーブルはPK列）で決定的に返す
- **対象テーブル**: profiles / tasks / subtasks / habits / habit_logs / rest_days / user_settings / stats_daily（#501）＋ characters / inventory_items / chests / battle_attempts（#502）。reward_transactions / idempotency_keys は内部台帳のため配らない
- **クライアントの消化**: `has_more == false` になるまで繰り返し呼び、各バッチ適用後に `cursor = next_cursor` へ前進する。テーブル別の独立ページングは行わない
- **Realtimeの役割**: 通知専用。ペイロードは適用せず「差分プルをトリガする合図」としてのみ使う。保険プルは起動・フォアグラウンド復帰・ネットワーク再接続・定期間隔の4トリガ（#504）

## 帰結

- クライアントの同期ロジックは「1つのカーソル＋1つのプル関数」に単純化される
- 全テーブルをUNIONするversion帯決定クエリのコストは `(user_id, version)` インデックスで抑える
