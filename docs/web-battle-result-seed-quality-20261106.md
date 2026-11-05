# Webの戦闘結果：受信先行時のXP・履歴とステージ保持（2026-11-06）

計画④ / #699・#923 / T07。#922マージ後のmain `cd271ec0`が基準。

## 問題と変更

Webでも、[受信seed](../src/platform/cloudSync.ts)がXPを先に取り込んだ後にgranted=trueの応答が届くと、同じ報酬を追加していた。実App/マップと実受信変換で5 XP→10 XPを再現した。以前の同期先行テストは結果適用を直接呼んでおり、実受信の挙動を確認できていなかった。

同じ所有者の確定attemptと、その版以上のcharacter行を受信済みなら、受信したXPを採用して未確定印を解除する。snapshot生成と同じ先頭character行を使い、id/stage/status/outcome/owner、正の安全整数版を確認する。SQLの勝利報酬とattemptは同一versionで確定する。seed後も認証世代・playerSnapshot/敵・id/stage/mode/outcomeが一致することを確認してから、既存の結果適用をgranted=falseで使う。XPを増やさず、正しいステージの履歴を一度記録する。保存は既存の明示的なcloud置換を利用する。古いcharacter・未確定/別attempt・owner/outcome/stage不一致なら解除せず、通常の応答/再試行へ任せる。敗北や既付与の結果で十分に新しいcharacterが無い場合も、保守的に応答を待つ。

[canonical反映](../src/platform/canonicalSync.ts)は、snapshot/敵があり戦闘/結果を表示中ならruntimeのcurrentStageを保持する。受信した別のcurrentStageで敵/ログとステージの対応を崩さず、進行度の最高到達・解放は受信する。idleでは受信側のcurrentStageを通常どおり使う。これにより、表示中の戦闘時計や結果履歴が違うステージへ切り替わるのを防ぐ。

[結果適用](../src/stores/useGameStore.ts)では、未確定印更新後とXP反映後にも認証世代を確認し、同期的なストア購読で別ユーザーへ切り替わった場合に旧履歴を追加しない。同一所有者通知や通常の結果送信は維持する。戦闘エンジン・報酬額・DB/RLS/API・保存形式・依存は変更しない。

## 検証

[実App/マップ回帰](../src/hooks/battleNavigation.test.tsx)の手動結果適用テストを実cloud cache/seedへ置換し、表示中/離脱中の両方を確認する。失敗後の受信確定、RPC先行→受信反復、敗北も追加する。既存10件から14件になり、純増4件。

[受信/履歴回帰18件](../src/platform/battleResultSeed.test.ts)は実Webゲーム/履歴/保存ストアと受信・canonical反映を使う。勝敗、受信反復・正しい履歴、古い版/不一致、local/進行中/idleのステージ、seed中の別戦闘/認証切替、未確定印更新中・XP適用中の認証切替、cloudの保存結果を確認する。

最終テストの修正前は13失敗/29成功（Webの2ファイルと、選択パターンに含まれる既存Native受信10件）。修正後はすべて成功する。App回帰のSDK/通信・無関係なUIはスタブ、実JS storeとjsdom/遅延応答を使う。既存の通信順序テストは引き続きtransport/sessionのスタブとし、追加されたストア依存を明示する。実ストアの正しさは上記の別回帰で確認する。

同期品質のunit対象へ追加する。全体・型検査・Lint・secrets・Web/PWAビルド・独立レビュー・最終HEADの通常CI3件（Android出力とローカルDB/Edgeを含む）の確定結果はPR/Issueへ記録する。

## 範囲と残り

同一App起動中の受信/応答の競合を対象とする。別キーの履歴保存との任意クラッシュ時の原子性や、OS終了後の所有者付きattempt永続復旧を保証する変更ではない。実staging/全実ブラウザー/端末・OS操作の新しい合格とは区別する。

実ユーザー/staging・秘密値・利用中データ・DB・OS/Simulator操作なし。画面構成/素材変更なし、比較画像追加なし。④継続、⑤未開始。マージ・配布・デプロイは行わない。
