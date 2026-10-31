# セキュリティの確認範囲と残課題（2026-10-30）

2026-10-31追記: [同期カーソル保存の成功確認](cloud-cursor-save-acknowledgement-20261031.md)で、両版とも保存成功応答後に再開位置を更新し、失敗時は確認済み位置から再試行する。実端末のストレージ障害/クラッシュ確認とは区別する。

2026-10-31追記: [受信同期のカーソル制御情報検証](cloud-pull-envelope-validation-20261031.md)で、不正なカーソル/継続フラグや無進捗ページを適用前に拒否する。行データの全項目検証や実環境の確認とは区別する。

2026-10-31追記: [Mobile起動時の認証イベント保持](mobile-auth-startup-events-20261031.md)で、保存読込中の初期通知・復旧意図と、リスナー置換後の認証境界を保護する。SDK/保存スタブによる回帰と実端末での確認は区別する。

2026-10-31追記: [Expo公開環境変数の秘密値ガード](expo-public-environment-guard-20261031.md)で、通常のExpo設定評価でも既知の管理者キー・秘密鍵の誤設定を値を伏せて拒否する。公開キー・匿名利用を維持し、実配布環境/既存成果物の確認は残す。

2026-10-31追記: [受信同期の認証待ちと復帰](cloud-pull-auth-recovery-20261031.md)で、受信だけのHTTP401にも既存の再ログイン案内を適用し、同じ所有者の再認証後に同期を再開する。以下は各対応時点の記録。

2026-10-31追記: [受信同期のアカウント固定](cloud-pull-account-binding-20261031.md)で、SDKの切替通知が遅れた場合も送信前後の所有者を確認し、捕捉したトークンで受信する。DB/RLS/保存形式は維持し、実環境や認証回復UI等の確認は残す。

2026-10-31追記: [クライアント診断ログの固定化](client-diagnostics-privacy-20261031.md)で、背景処理の生例外とoutbox操作IDをconsoleへ渡さない。production renderの任意nameも固定分類へ限定。開発時render/SDK・runtime独自ログ/実監視の全体確認は残す。

2026-10-31追記: [クライアントHTTPエラーの本文秘匿](client-http-error-privacy-20261031.md)で、任意本文のError転記を制限し、固定コードのゲーム/移行判定を維持。HTTP以外の例外と実環境ログ/監視全体は残課題。

2026-10-31追記: [Edge API本文の実バイト数・root検査](edge-request-limits-20261031.md)を追加。認証後の本文に5MiBの転送上限を設け、上限内の通常移行と超過時の拒否を区別する。実配信・レート制限等の確認は残す。

2026-10-31追記: [Edge Functionの内部エラー詳細の非公開化](edge-error-privacy-20261031.md)で、DB診断・未分類例外を固定エラーへ置き換える。実配信へのデプロイ/確認とログ・監視全体は残課題。

2026-10-31追記: [WebのHTTPレスポンス保護](web-response-security-20261031.md)で、埋め込み防止・機能制限を開発/previewへ適用し、静的配信用設定も出力する。
実配信先への設定・確認は引き続き未完了。以下のmetaの制限に関する記述は初回確認時点のもの。

2026-10-31追記: [Metroの画像解析依存の除去](metro-image-security-20261031.md)でimage-sizeのHigh警告を解消。
以下の監査表は10月30日時点の記録で、最新は全依存Critical 0 / High 6 / Low 8。残課題は#871で継続する。

計画④ [#699](https://github.com/YuTakane256/Life-Quest/issues/699) の途中で、認証・権限・秘密値・依存を確認した。
今回の修正は [#870](https://github.com/YuTakane256/Life-Quest/issues/870)、残る依存/実環境設定は [#871](https://github.com/YuTakane256/Life-Quest/issues/871) で追跡する。
**基本的な防御はあるが、本番運用の安全性を保証する監査ではない。漏洩履歴や実運用の侵害有無を調査した記録でもない。**

## コードで確認した防御

| 観点 | 確認した実装・検証 | 限界 |
| --- | --- | --- |
| ユーザーの分離 | publicのユーザーテーブルにRLS。JWTの所有者にSELECTを限定し、直接書込を禁止。実DBの[RLS侵入テスト](../supabase/integration/rls-intrusion.test.ts)がCIにある | この確認で実Supabaseプロジェクトの全権限・設定差分を取得したわけではない |
| サーバー側の認可 | [Edge共通認証](../supabase/functions/_shared/auth.ts)が`getUser(token)`で本人確認。リクエストのuser IDを採用せず、検証済みIDを使う。service roleはRLSを迂回するため所有者も確認する | 全APIの包括的な侵入試験ではない。レート制限・DoSの実運用確認も別途必要 |
| DB関数 | 移行SQLの現行関数定義でsearch_pathを固定。クライアント向けとservice role向けの実行権限を分離。SQLにビュー定義はない | SQLの確認は実環境との完全一致証明ではない |
| トークン | MobileのSupabaseセッションはSecureStore、WebはlocalStorage。Webの永続セッションから外部プロバイダーのtokenを除外。Apple失効用tokenはprivate schema・サーバー限定権限・AES-GCMで保管 | Webの同一originで実行できる悪意あるJSや、端末侵害まで防げるという意味ではない |
| アカウント切替 | [所有者別キャッシュ/outbox](adr/009-multi-account-local-state.md)、旧処理の失効、再設定セッションの分離と既存回帰 | キャッシュのnamespaceはアクセス制御や暗号化ではない。タスク等のlocalStorage/AsyncStorageとエクスポートJSONはアプリ独自には暗号化していない |
| Web | インラインscript/evalを許さないCSP、設定したSupabaseのHTTPS/WSS originだけ通信許可。PWAのランタイムキャッシュは同一origin画像だけ | HTML metaの`frame-ancestors`と`Permissions-Policy`はHTTPヘッダーの代替にならない。実配信先のヘッダーを確認する必要がある |

Supabaseのpublishable/anon keyは公開クライアント用で、公開されたこと自体を漏洩とは扱わない。
管理者のsecret/service role keyはRLSを迂回するため別扱いとする。
根拠: [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)、[APIの保護](https://supabase.com/docs/guides/api/securing-your-api)。

## 今回直した点

1. 互換範囲の間接依存を更新し、既存overrideを`js-yaml 4.3.2`・`undici 7.30.1`へ更新。
   `shell-quote 1.9.0 → 1.12.0`でCriticalのコマンド注入警告を解消した。
   `brace-expansion`、`browserslist`、`fast-uri`、`node-forge`等も修正版へ更新。
   Workboxの`serialize-javascript`も7.1.4へ更新し、既知のXSS警告を解消した。
   Expo SDK 57・React Native・React等の主要版とアプリ機能は維持する。
2. `check:secrets`は検出したソース行そのものをログへ出していたため、ファイル・行番号だけへ変更。
   既存の秘密値参照チェックに加え、埋込`sb_secret_*`、service role JWT、private keyとExpo設定も対象にした。
3. WebのVite設定解決時、公開Supabase keyに管理者資格情報があれば値を伏せてビルドを拒否。
   anon JWT・publishable keyは許可する。この検査はJWTの署名/有効性を保証する認証処理ではない。
4. `.env`・`.env.*`をGit対象外に追加し、例示テンプレートは維持。
   既にGit履歴へ入った秘密値を削除・失効する機能ではない。履歴全体や画像中の秘密情報の網羅スキャンも実施していない。

資格情報の分類・出力非表示・Web設定フック・実ファイル走査・環境ファイルの扱いは、
[偽の資格情報を使う13ケース](../scripts/check-service-role.test.mjs)で確認する。
秘密値ガードは検出できる形式に限り、文字列分割・任意の暗号化・全ベンダーの鍵を網羅するsecret scannerではない。
DB/RLS/API・ユーザーデータ・stagingの設定変更、アカウント操作、公開・配布は行っていない。

## npm auditの結果と残り

同日のnpmレジストリ応答。件数は推移依存の親への波及を含む「パッケージ警告数」で、独立した脆弱性・攻撃・漏洩の件数ではない。

| 対象・コマンド | 修正前 Critical / High / Moderate / Low | 修正後 |
| --- | --- | --- |
| 全依存 `npm audit --json` | 1 / 13 / 2 / 9（計25） | 0 / 7 / 0 / 8（計15） |
| prod分類 `npm audit --package-lock-only --omit=dev --json` | 1 / 12 / 1 / 5（計19） | 0 / 7 / 0 / 5（計12） |

prod分類にはExpoのCLI・Metro等の開発/ビルド用モジュールも含まれる。一方で、RouterのURL解析に到達し得るものもあり、
全てを「開発時だけだから無関係」として除外しない。今回の確認で全警告の攻撃到達性を実証したわけではない。

- Highの直接原因は`zod 3.25.76`、`image-size 1.2.1`、`decode-uri-component 0.2.2`。親パッケージにも波及して7件となる。
  修正版はそれぞれ4系、2系、ESMの0.5系で、Expo CLI・Metro・query-stringが現在要求するAPI/形式と異なる。
  強制overrideやExpoのメジャーダウングレード/アップグレードで警告だけを消す対応はしない。
- Lowには`deepmerge`のprototype poisoningと親パッケージへの波及が残る。残件と対応条件は#871を参照。
- 週次の`npm audit --package-lock-only --omit=dev --audit-level=high`は維持する。残件があるためこの監査はまだ失敗する。
  PRの通常CI 3件が成功しても、依存監査がゼロという意味ではない。

参考: [shell-quoteの修正条件](https://github.com/ljharb/shell-quote/security/advisories/GHSA-pqg4-j6r4-53mv)、
[undiciの漏洩条件と修正版](https://github.com/nodejs/undici/security/advisories/GHSA-4w7w-5xrc-9h26)、
[Zodの残警告](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)。undiciは当リポジトリではjsdom経由で、
アドバイザリ記載の共有キャッシュ条件によるアプリ利用者間の漏洩を実証したものではない。

## 公開前に実環境で確認すること

残る依存警告の解消/到達性評価、Supabase実環境のRLS・権限・Auth redirect設定、管理者MFA、
メール認証・濫用対策、配信HTTPヘッダー、監視・ログ秘匿、バックアップ/復旧を確認する。
`frame-ancestors`はmetaでは無効であることを[MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors)で確認した。
Apple認可失効/再同意を含む署名済み実機フローも既存の残項目。計画④全体や⑤の公開準備の完了とはしない。
