# Edge APIの本文サイズ・JSON root検査（2026-10-31 / #879）

[#871](https://github.com/YuTakane256/Life-Quest/issues/871)の入力・濫用対策の継続確認。
認証後の`req.json()`は本文全体を制限なく保持し、rootも型assertだけだったため、業務検査より前の入力に上限を設ける。
実際の攻撃やサービス停止が発生したと判定した記録ではない。

## 新しい転送量の上限

[共通の読取](../supabase/functions/_shared/requestBody.ts)で、認証済みPOSTの本文を最大 **5MiB（5,242,880バイト）** に制限する。
[Webの手動JSONバックアップ](../src/utils/dataBackup.ts)と同じバイト量を選んだアプリ側の制限で、Supabase公式のリクエスト上限を転記したものではない。
DBの件数上限とは別の制約で、たとえば50,000件の長い習慣メモ等、件数が上限内でも本文が5MiBを超える移行は拒否される。
全件数上限を同時に満たす最大データが必ず入るという保証はしない。

- Content-Lengthが上限を超えていれば本文を読む前に固定`413 / payload_too_large`を返す。
- ヘッダーなし・過少申告・解釈不能の場合も、ストリームの実バイト数で制限する。
- 上限を超えるチャンクは保持せず読取を取り消す。取消の失敗で413を別のエラーへ変えない。
- 少数の可変バッファを使い、細かいチャンクすべてを配列に保持しない。バイト列バッファの容量は5MiB以下。
- 5MiBちょうどは許可し、読み終えてからUTF-8デコードとJSON.parseを行う。JSON rootはnull・配列・primitiveを除くobjectだけを許可する。
- root違反は固定`400 / invalid_body`、空/不正JSON・読取失敗は固定`400 / invalid_json`。入力内容・読取例外は返さない。

認証を先に行い、不正な入力ではservice client作成・業務ハンドラー・DB書込/報酬処理へ進まない。
OPTIONS/405、JWT所有者、CORS、正常な成功結果と既存の業務エラーは維持する。Content-Typeの新しい制約は加えない。
上限内の入力は切り詰めずに渡す。既存の[クラウド移行](../supabase/integration/cloudimport.test.ts)とゲームの実操作回帰で通常動作を確認する。

## 大きな移行データの扱い

413は移行成功ではなく、DB関数に到達しない拒否。今回、クライアントのローカル保存・移行前バックアップ・保留操作を削除したり、
分割して一部だけを成功扱いにする処理は追加しない。大きな移行はこの制約に該当するため、元データを保持して移行方法の別対応が必要。
既存の移行成功フラグ・取込済み判定を進めない。大量データの分割移行は本PRの機能に含めない。

## 検証

- [共通応答を通る追加回帰](../supabase/integration/edge-request-body.test.ts)は21件。最初の18件は変更前11失敗/7成功で、無制限の読取とroot違反を再現した。
  宣言超過・ヘッダー欠落/過少申告/不正値・単一巨大チャンク・日本語の実バイト数・境界・UTF-8分割・取消失敗・認証順序・読取失敗を確認する。
- [既存のAPI/CORS](../supabase/integration/edge-cors.test.ts)・[実ハンドラーの異常系](../supabase/integration/edge-error-responses.test.ts)と計74件が成功。
  認証・DBはスタブで、これを実JWT・実DBの合格に数えない。
- [実DB/Edge統合](../supabase/integration/game.test.ts)に4件を追加。非object rootの400、5MiB超過の413、拒否前後の報酬不変、境界本文が必須項目検査へ進むことをCIで確認する。
- 全体・Web/Mobile型・Lint/secrets・Web/PWAビルド、既存CI3件と独立レビューの結果はPRに記録する。
- 画面構成変更がないため比較画像は追加しない。DB migration・保存形式・報酬計算・依存版は変更しない。

## 範囲と残確認

stagingのデータ/アカウント/設定とデプロイ先は操作しない。ローカルDockerデーモンは利用できず、実DB/pgTAP/Edge runtimeの確認はGitHubのSupabase CIで行う。
マージだけでクラウドへ配備されたとはせず、デプロイ時には実URLで通常操作・移行・413/CORSを確認する。

これは共通ハンドラーで認証後に保持する入力の上限。ネットワークやゲートウェイが既に受信したバッファ、JSON展開後や他処理の総メモリ、
並行リクエスト数、送信待ち時間、レート制限、圧縮/ゲートウェイ独自の制限を包括的に検証したものではない。
小さな入力の大量送信・遅い送信等に対する実運用対策は#871へ残す。直接DB REST/RPC・Auth等の応答も対象外。
計画④を継続し、⑤への移行や安全性全体の認定とはしない。

参考: [OWASP REST Security](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)、
[MDN reader.cancel](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStreamDefaultReader/cancel)、
[Supabase Edgeの実行制限](https://supabase.com/docs/guides/functions/limits)。
