# Edge Functionのエラー詳細の非公開化（2026-10-31 / #877）

[#871](https://github.com/YuTakane256/Life-Quest/issues/871)の継続確認で、DB/RPCの`message`や未分類例外をそのままHTTP本文へ返す経路を確認した。
内部のテーブル名・入力値・診断文等をレスポンスへ含める可能性を減らす修正で、実際の情報漏洩が起きていたと判定したものではない。

## 変更

- [共通ハンドラー](../supabase/functions/_shared/handler.ts)で、未分類のDBエラー・例外を`500 / { error: 'internal_error' }`へ置き換える。
- DBの業務エラーは部分一致をやめ、固定文字列の完全一致だけを許可する。開封済み、ステージ/バトルのロック、装備中の売却拒否、素材不備、移行案内、サイズ上限、所有者不明を従来の400/404/409で返す。
  既知の単語の前後にDB診断が付いた場合は本文を公開せず500とする。将来SQLで新しい業務エラーを追加する際は、ここにも公開可の固定コードを追加する。
- 宝箱/合成の再送台帳、合成素材、ログインボーナス、習慣ボーナス、バトル装備の読取失敗も固定500へ置き換える。
- `json()`自体も5xxを固定コードに制限し、余分なdetails/hint等を除く。`auth_failure`、`account_deletion_failed`、`apple_authorization_record_failed`、`apple_revocation_failed`は維持する。既存の`idempotency_key_operation_mismatch`も固定500として維持する。Apple失効失敗の503と退会停止を変えない。
- JWT認可、CORS、成功レスポンス、制御された入力エラー、所有者フィルター、DBトランザクション/報酬/冪等性キーは変えない。元のエラー文を新たにログへ出す処理も追加しない。

## 検証

- [共通ハンドラーの回帰](../supabase/integration/edge-cors.test.ts)を追加。変更前は42件中16件が失敗し、診断文の返却や部分一致を再現した。変更後は全件成功。
- [実際のハンドラーと共通応答の8経路](../supabase/integration/edge-error-responses.test.ts)へDB読取失敗を与え、固定500・CORS維持・報酬RPCへ進まないことを確認。
  認証・DBはスタブで、実クラウドや実JWTの試験ではない。
- [宝箱](../supabase/integration/chest-handler.test.ts)・[合成](../supabase/integration/synthesis-handler.test.ts)の確定結果再生/並行確定と、[共有クライアント呼出し](../packages/core/src/edgeFunctions.test.ts)を含め関連85件成功。
- 全体3,503成功 / 98 skip。Web/Mobile型検査、Lintエラー0（既存警告6）、secrets、Web/PWAビルドを確認する。
- 画面構成を変更しないため比較画像は追加しない。DB migration・依存更新・保存形式変更はない。

実DB CIの初回実行では、再送キーを別操作へ使った際の固定500コードを汎用化したため既存回帰1件が失敗した。
固定`idempotency_key_operation_mismatch`を完全一致で維持し、同じコードの前後に診断文が付いた場合は非公開にする回帰を追加した。
DBでの拒否・HTTP 500は維持し、チェックを緩和せず修正する。

## 適用と残確認

今回はコードと回帰をPRにまとめる。stagingのアカウント/データ/設定、デプロイ先を操作していない。
ローカルDockerデーモンは利用できず、実DB/pgTAP/Edge runtimeの統合結果はGitHubのSupabase CIで確認する。
既存のCI3件と独立レビューの最終結果はPRに記録する。

本対応は、共通ハンドラーを通るEdge Functionの応答が対象。Supabaseゲートウェイ・Auth・直接のDB REST/RPCや将来別ハンドラーの応答、
過去の失敗キューやログ、監視の設計、実配信の設定全体を秘匿できたという認定ではない。保存済みの失敗データは消さない。
本番/検証環境へ適用する段階では通常のデプロイと実URLでの再確認が必要。今回のPRのマージだけでクラウドへ配備されるとはしない。
依存の警告・実環境RLS/Auth/MFA・配信HTTPヘッダー・監視/復旧は引き続き#871で追跡し、計画④を継続する。

方針の参考: [OWASP Error Handling Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html)。
未分類エラーの内部診断をクライアントへ返さない考え方を参考にし、ゲーム操作で必要な固定エラーは区別して維持する。
