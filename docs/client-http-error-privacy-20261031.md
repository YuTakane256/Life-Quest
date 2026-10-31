# クライアントHTTPエラーの本文秘匿（2026-10-31 / #881）

[#871](https://github.com/YuTakane256/Life-Quest/issues/871)のログ/診断の確認を継続した。
[サーバー側の詳細非公開化](edge-error-privacy-20261031.md)後も、ゲートウェイや旧サーバーは任意のエラー本文を返し得る。
共有クライアントはその本文をそのままError.messageへ埋め込んでいたため、画面・console・後続エラー処理へ広がる経路を制限する。
実際の漏洩が発生したと判定した記録ではない。

## 変更

[共有invoker](../packages/core/src/edgeFunctions.ts)と[固定コード方針](../packages/core/src/edgeErrorPolicy.ts)で、
失敗したHTTP応答のステータスと、完全一致の既知コードだけをエラーへ再構成する。

- 本文が4,096文字以内のJSON objectで、status/codeの組が許可された場合だけ`{error: 固定コード}`を再生成する。
- details/hint/token/HTML、未知コード、既知コードに診断が付いた文字列、長い本文、別ステータスのコードをError.messageへ転記しない。
- `code='http-error'`・数値statusを維持する。宝箱の409/chest_already_opened、Web移行409/web_migration_required、退会・Apple失効など、既存の分岐に必要な小さな固定応答は従来の形式で残す。
- 413は本文の内容にかかわらず「送信データが大きすぎるため、処理できません。内容を確認してください。」と案内する。
  ゲートウェイの上限はアプリ側と異なり得るため、この文言で固定サイズを断定しない。
- エラー本文の読取完了/失敗後にも、呼出元のセッションスコープを再検査する。切替後はstale-sessionを返す。
- 401で1回だけrefreshする処理、認証/所有者/再送キー・HTTP statusによる一時/恒久分類・成功結果は変えない。

新しいAPI固定コードを追加する際は、公開してよい文字列とstatusの組をここにも追加する。
未登録コードでもHTTP statusによる判定は保ち、任意の診断文字列を復元するフォールバックは置かない。

## 検証

- [追加の共有回帰](../packages/core/src/edgeFunctionErrorPrivacy.test.ts)の最初19件は変更前18失敗/1成功。
  固定コード以外の本文・追加フィールドの秘匿、別status/未知/非object/長文、413、読取失敗、読取中のスコープ失効を確認した。
- 同ファイルで実invoker→controller→outboxも接続し、500はpending、413はfailedとして同じopId/payloadを保持することを確認。
  キュー自体は元から生の本文を保存しない設計で、過去に保存していたと主張するものではない。送信結果のerrorも安全な内容へ変わる。
- [Web宝箱](../src/hooks/useCloudChestOpen.test.ts)・[Mobile宝箱](../apps/mobile/src/hooks/useCloudChestOpen.test.ts)で、実invokerの安全な409を使い、開封済みだけをdiscardしキー衝突で抽選/適用しないことを確認。
- [Mobile手動統合](../apps/mobile/src/platform/manualContentImport.test.ts)で、413後の候補/backup/元データ/同じ送信本文とキーの保持、HTML中の単語を移行案内と取り違えないことを確認。
  後続の成功はHTTPスタブであり、同じ大容量データを再送すればサイズ問題が自動解消する実証ではない。
- 新規27件、関連5ファイル86件成功。全体3,551成功/102skip、Web/Mobile型・Lintエラー0（既存警告6）・secrets・Web/PWA build、匿名parityのiOS bundle export成功。
- 画面構成の変更はなく、413時のエラーメッセージのみ改善する。比較画像は追加しない。CI3件・独立レビューの最終結果はPRに記録する。

## 範囲と残確認

サーバー/DB/API成功形式/保存形式/報酬ルール/依存版は変更しない。過去のログ・失敗データを消去せず、stagingのデータ/アカウント/設定やデプロイ先も操作しない。
クライアントをビルド・配布する段階で、実ゲートウェイ応答とWeb/Nativeの表示・ゲーム/移行の通常操作を再確認する必要がある。

本対応は共有invokerが受けた**HTTP失敗応答**のErrorへの転記を対象とする。
React Nativeとの互換性のためresponse.text()で読む既存方式を維持し、4,096文字はJSON解析の上限であって、受信量や読取待ち時間の上限ではない。
fetch自体の例外・SDK/直接DB RPC・成功応答のJSON読取失敗・アプリ全体のconsoleや外部監視の包括的秘匿は未完了。
[前回の5MiB制約](edge-request-limits-20261031.md)の緩和/分割移行や自動再送も追加しない。残件は#871、計画④を継続する。

参考: [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)。
外部の診断を無条件に転記せず、処理判定に必要な固定情報に絞る方針を参考にした。
