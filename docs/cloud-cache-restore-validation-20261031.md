# 保存済み同期キャッシュの復元検証（2026-10-31）

計画④ / #699・#871・#899。PR #898マージ後のmain `1c7a08e1`からの修正。

## 起きていたこと

[保存キャッシュの復元](../packages/core/src/cloudCache.ts)はJSONを読めればtable mapを採用していた。正常な受信ページを検証しても、保存済みの残留null行はsnapshot構築で例外になり、文字列versionは正常な行の上書きを抑止し、mapのキーと行PKの不一致は古い別名行を残す。キャッシュはサーバー由来であっても、破損した保存内容を型キャストだけで信用しない。

## 変更

受信時と保存復元時で、最小の行契約を共有する。行は非null・非配列object、versionは正の安全整数、テーブルに応じたPKはown data propertyの非空文字列を要求する。保存側ではセクションroot・table mapも非null・非配列objectとし、mapのキーが行から組み立てたPKに一致することを確認する。

セクション内の全tableを一時領域で検証してから復元する。後段tableが不正でも前段tableだけを残さず、そのセクションをメモリ上の空状態に留め、他の正常なセクションの復元を続ける。table省略・空map・未知の将来項目は既存互換として許容する。`__proto__`や`constructor`もown propertyとして安全に復元する。

旧版Mobileの所有者markerがない場合のID照合は、破損を空データと混同すると匿名/別所有者を許可するため、`rejectInvalidSections: true`を明示して破損時は固定エラーで停止する。[所有者確認](../apps/mobile/src/platform/cloudSessionRecovery.ts)は既存のstorage-error状態を維持し、共有表示・キュー・markerを変更せず、本人を推測して権限を付けない。markerが確定している場合はその本人だけを許可し、通常同期で再構築できる。markerなし＋破損では同じIDでログインしても自動受入しない。正常データに戻るか所有者を確定できるまで保護を継続する。

復元処理自体はsetItem/removeItemを呼ばない。壊れた保存内容や保存カーソルは通常同期が成功するまで書き換えない。ストレージ読込自体の失敗は破損扱いにせず、既存どおり呼出側へ伝える。Web/Mobileは既存のハンドル初回cursor 0から全取得する契約を使い、正常なページを既存経路で保存・表示して再構築する。新しい削除ボタン、データリセット、別形式への移行や自動再送は加えない。

## 検証

- [保存復元の境界](../packages/core/src/cloudCacheRestore.test.ts): 不正root/map/row/版/PK・キー不一致、後段table不正時の全section未復元、他section/保存内容維持、読込失敗の伝播、墓標/複合キー/特殊キー/省略のround trip。
- [実両版ハンドル](../src/platform/cloudSyncSession.test.ts): 残留null・文字列版番号・別名PKの3ケース×両版。保存marker 999でも初回0から取得し、HTTP障害時は旧保存/marker/他B/保留キューを保持、正常再試行後は正しい1行/marker 2へ戻る。SDK/保存はスタブ、キュー文字列は触らない証拠であり、送信処理の実測ではない。
- 最初の修正前20失敗/80成功を確認。初回独立レビューで旧版owner推定のP1回帰を検出。追加4件を修正前失敗として再現し、strict復元指定で修正。[旧版所有者回帰](../apps/mobile/src/platform/cloudSessionRecovery.test.ts)では匿名/別B/同Aへの未確認受入拒否と、確定markerの同A復旧許可を確認する。既存の「同じXPだけではownerを推定しない」fixtureには実際のcharacters行にあるuser_idを補い、期待した匿名許可条件は維持した。
-新規単体32件を追加し、`npm run test:sync:unit`にも含める。
- [実DB2クライアント統合](../supabase/integration/two-client-sync.test.ts): 実RPC由来の保存を試験側のメモリstorageで破損させ、他sectionを保持しながら通常全取得・再保存・再読込で参照cacheと一致する1件を追加。サーバー行を破損させず、既存のローカルCI用ユーザーを使用。環境なしのskipと成功は区別する。

最終の全体/型/Lint/ビルド・独立レビュー・同じHEADの通常CI3件はPRとIssueに記録する。画面変更がないため画像追加なし。

## 維持する内容と限界

DB/RLS/API、保存キー/形式、認証・所有者分離、outbox先行、キャッシュ受信の版比較、報酬・台帳、依存は維持する。実ユーザー/staging・秘密値・利用中データを操作せず、配布/デプロイはしない。

全行owner/refやUUID/日付・全表示項目、正しい型のままの意味的な破損、ネットワーク受信量、複数キーの原子的保存・任意クラッシュ・実ストレージ全障害への保証ではない。旧キャッシュの不正なsectionを復元しない変更であり、実環境で破損が発生したという調査結果ではない。計画④継続、⑤移行・全体の安全性認定は未宣言。
