# クライアント診断ログの固定化（2026-10-31 / #883）

[#871](https://github.com/YuTakane256/Life-Quest/issues/871)のログ/診断を継続確認した。
[HTTP失敗本文の転記制限](client-http-error-privacy-20261031.md)後も、SDK/ネットワーク/保存処理等から投げられた例外やoutbox操作IDを、
アプリ側で直接consoleへ渡す箇所が残っていた。実際の漏洩が起きたと判定した記録ではない。

## 変更と情報量の選択

[共有診断](../packages/core/src/diagnostics.ts)の固定イベント・固定ラベル・標準例外分類だけをconsoleへ渡す。
生のError/object/文字列、message/stack/name/code/cause、ユーザーID・操作ID・payloadはログへ渡さない。

| 経路 | 対応 |
| --- | --- |
| Web/Mobile canonical同期初期化 | 固定eventと分類に置換 |
| Web初回移行/Mobile移行前backup | 同上。元の同一セッション判定と再試行を維持 |
| Web/Mobileログインボーナス | 同上。予期しない例外時のretryable-errorを維持 |
| Webの達成済み報酬の統計保存 | 同上。報酬確定後の統計失敗処理を維持 |
| Webの匿名セッション準備 | 同上。既存クラウドキャッシュの保護処理を維持 |
| Web/Mobile outbox恒久失敗 | 固定eventだけにし、操作名/操作IDを文字列へ埋め込まない |
| Web production render診断 | 任意のerror.nameを信用せず、共有の標準分類に限定 |

標準分類は同一realmのTypeError/RangeError/SyntaxError/ReferenceError/URIError/EvalError/Errorと、UnknownErrorだけ。
独自SDKエラー・他realmの例外は汎用分類となり得る。例外の診断フィールドやtoJSONを読まず、分類中にthrowするProxyはUnknownErrorへ戻す。
不正なruntimeイベントも固定のunknown_diagnosticへ戻し、渡された文字列をログへ反射しない。

背景処理の共通診断は開発/本番とも同じ秘匿形式。既存のWeb **開発時renderエラー**の詳細は、明示的なDEV分岐として維持する。
production renderのcomponentStackは内容ではなく有無だけを残す。固定文だけのMobile hydration待機警告は変更しない。

発生箇所と分類の把握は残すが、consoleだけで個別操作を追跡する情報は減る。
これは監視サービスの追加ではなく、アクセス制御/保存期間/監査証跡/アラート設計の代替ではない。
キューの本人データを匿名化・暗号化・削除する機能でもなく、既存の保持と復旧を変えない。

## 検証

- [production render](../src/utils/errorReporting.test.ts)・[Web移行](../src/platform/cloudMigrationSession.test.ts)・
  [両版ボーナス](../src/stores/loginBonusSession.test.ts)の追加6件は修正前にすべて失敗し、修正後成功。
- [共有診断21件](../packages/core/src/diagnostics.test.ts)で、任意name、診断フィールドgetter、循環object、Proxy/失効Proxy、不正イベントを確認。
  生オブジェクトを渡さず、固定情報だけが残ることを検証する。
- [Web](../src/platform/cloudOutboxTransport.test.ts)・[Mobile](../apps/mobile/src/platform/cloudOutbox.test.ts)の実outboxへ恒久失敗を与える2件を追加。
  consoleに操作ID/行ID/診断を出さず、failedの同じ操作IDとpayloadを保持する。
- Web移行は失敗後の元タスクと同じ送信内容の再試行、ボーナスはSDK例外後の再試行・ローカル二重報酬なしを確認。
- 新規29件、関連7ファイル79件、全体3,580成功/102skip。Web/Mobile型、Lintエラー0（既存警告6）、secrets、Web/PWA build成功。
- クライアントの直接console呼出しを確認。背景処理10箇所は共有診断、残りは既存renderガードと固定hydration警告。
  画面構成を変更しないため比較画像は追加しない。Mobile export・CI3件・独立レビューの最終結果はPRに記録する。

## 範囲と残確認

サーバー/DB/API/保存形式/認証・再送・報酬ルール/依存版は変更しない。
過去ログや保存済みの失敗データを消去せず、stagingのアカウント/データ/設定、実配信先も操作しない。
Web再配信/Mobileビルドを反映する段階では、実環境のSDK失敗やログ収集先も含めて再確認する。

React/Native/SDK/ブラウザ自体が出すログ、開発時render詳細、外部監視基盤、source map公開、
画面へ返す例外・直接DB診断・ネットワーク通信そのものの包括的な秘匿を確認したものではない。
既存ErrorBoundaryの独自ログを安全にしても、フレームワーク側の別のログまで制御できたという認定はしない。
残件は#871で継続し、計画④全体や⑤の完了にはしない。

参考: [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)。
処理判断・障害の発生箇所に必要な情報を残し、例外に含まれ得る個人データを無条件に転記しない考え方を参考にした。
