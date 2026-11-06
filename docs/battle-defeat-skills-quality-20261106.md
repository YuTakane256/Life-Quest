# 敗北の受信確定とスキル行動の実DB検証（2026-11-06）

計画④ / #699・#937 / T07。#936マージ後のmain `7110e789`が基準。

## 敗北時の不具合と修正

`resolve_battle_attempt_apply`は勝利時にXP・進行とattemptを同じ版で更新する。一方、敗北ではattemptだけを更新し、charactersの版は変えない。

[Web](../src/platform/cloudSync.ts)と[Mobile](../apps/mobile/src/platform/cloudSeed.ts)の受信確定は、勝敗を問わず`character.version >= attempt.version`を要求していた。このため、敗北の成功応答を失いpullだけが届くと、確定済みattemptの送信待ちが残り、Webの敗北履歴も応答の再送まで記録されない。

敗北では同じ本人のキャラクター・同じattempt/stage/勝敗・resolved・正の安全な整数の版を確認し、キャラクターの版が古くても追加XPなしに確定する。勝利の版比較は維持する。認証スコープ、seed中に新しい戦闘へ入れ替わった場合のオブジェクト照合、別ステージ/別所有者/未確定結果の拒否も変えない。通常のseedが反映するキャラクター値やDB/RLS/API・報酬計算は変更しない。

## 回帰と実DBの18ケース

[Web](../src/platform/battleResultSeed.test.ts)・[Mobile](../apps/mobile/src/platform/battleResultSeed.test.ts)に、敗北のattemptよりキャラクターの版が古い回帰を1件ずつ追加。修正前は新しい2件が失敗（既存28件は成功）、修正後は全30件成功。HP0・XP不変・進行/画面内runtimeの保持と、遅い応答/反復pullでの重複確定・Web履歴の重複がないことを確認する。

[既存の実DB/Edge統合](../supabase/integration/battle-seed-race.test.ts)を通常攻撃勝利6件から18件へ拡張する。

- Web/Mobile × 通常攻撃の勝利・スキルの勝利・スキルの敗北 × 応答先行・同期先行・確定後の成功応答喪失。
- 実サーバーの開始snapshotから両ストアの操作で防御→回復→強撃→通常攻撃を記録する。HP・ログ・クールダウン・防御状態と共有replayの結果を照合し、同じ行動列を実Edgeが独立に再計算する。
- 未知スキルとクールダウン中の再使用では両クライアントの状態/行動列が変わらない。さらにクールダウン違反を含む行動列を実Edgeへ送り、422とattemptのstatus/outcome/version不変を確認してから正規の列を送る。
- 実SQLで勝利のcharacter/attempt版一致・報酬1件と、敗北のcharacter版が古いまま・報酬0件・XP/進行不変を確認。同期先行/応答喪失では、成功応答を適用する前に送信待ちが解消することを確認する。
- 各応答直後（再seed前）・同キー/別キー再送・反復pullで結果/HP/履歴/XPを照合。無効行動に対するサーバーの判定を緩めない。

ローカルで接続情報がない実DBケースのskipを成功とは数えない。最終HEADのSupabase CIで18件がskipなく実行されたことと、通常CI3件・独立レビューの確定結果をPR/Issueへ記録する。

## 範囲と残り

既存のloopback限定ガードを接続/アカウント作成前に実行し、各ケースのCI専用一時アカウントとfixtureだけを作成/削除する。敗北のfixtureはこの本人だけの解放済みステージ20と弱いキャラクターを使い、実ユーザーの進行を変更しない。

Nativeのディスクと応答喪失だけをスタブにし、実JWT/HTTP/SQL・本人RLSのpull/cache/canonical・両ゲームストアを使用する。実staging/承認済みA・B・利用データ・OS/Simulator/Dockerへの操作なし。DB/RLS/API・スキル/報酬計算・保存形式・依存・画面構成は変更しない。UI素材/配置変更がないため比較画像は追加しない。実機のスキルボタン/自動攻撃との併用、全ステージ・実staging・OS終了後の永続復旧は残確認。④継続、⑤未開始。マージ・配布・デプロイは行わない。
