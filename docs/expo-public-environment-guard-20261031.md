# Expo公開環境変数の秘密値ガード（2026-10-31）

## 問題

`EXPO_PUBLIC_`の値はアプリ内へ埋め込まれるため、秘密鍵や管理者キーを設定しないことが[Expo公式](https://docs.expo.dev/guides/environment-variables/)で求められている。
従来のrelease設定検査は明示実行時の環境を調べていたが、通常のExpoコマンドはこの検査を必須にしていなかった。release/preview/parityの実`expo config`が、偽の管理者JWTを拒否しないことを修正前に再現した。
実際の鍵の混入や漏洩履歴を調査した記録ではない。

## 変更

- [Mobileのapp.config.ts](../apps/mobile/app.config.ts)の評価時に、全`EXPO_PUBLIC_`変数を検査する。Supabase用変数以外に誤設定した場合も対象とする。
- [build専用の共通ガード](../scripts/public-client-environment.cjs)で、`sb_secret_*`、`service_role`を持つJWT、PEM秘密鍵の既知形式を拒否する。エラーは固定文言で、変数名・値を転記しない。
- [release設定検査](../scripts/validate-mobile-release-config.mjs)にも同じガードを使用する。以前の大文字小文字を問わないsecret prefix/役割payload検査も維持する。
- [既存のソース走査](../scripts/check-service-role.mjs)とWebの設定ガードが使う資格情報分類器を同じbuild用モジュールへ移す。既存のWeb判定・ソース参照ポリシー・検査対象や除外は維持する。
- 通常のanon JWT/publishable keyと環境未設定を許容する。キーの正当性やJWT署名を検証した扱いにはしない。

Expo設定はNodeで評価するためCJSとして実装し、型宣言を付ける。アプリの実行コードへimportせず、公開manifestのextraへ値を入れない。
依存版、アプリ識別子・scheme・署名・ネイティブ設定・保存形式、DB/RLS/認証・報酬の処理は変更しない。

## 検証

[新規回帰](../scripts/expo-public-environment.test.mjs)15件と[既存の秘密値回帰](../scripts/check-service-role.test.mjs)13件を検証する。
最初の実Expo 3件は修正前に全失敗、修正後に拒否を確認した。

- 実`expo config`でrelease/preview/parityすべてを検証。安全な設定では同じ識別子・匿名parity判定を維持する。
- 実`expo export --platform ios`が、偽のPEM鍵で出力先を作る前に停止し、stdout/stderrへ値を出さない。
- 隔離した一時プロジェクトへ偽の.envを置き、実Expoのdotenv読込後も拒否されることを確認する。利用中プロジェクトの.envは編集しない。
- 通常の公開設定・未設定・非公開名前空間のサーバー変数は許容する。実際の鍵や認証APIは利用しない。

全体テスト、Web/Mobile/Core型、release設定検査、既存secret検査、Web/PWA buildと匿名parityのMobileバンドル出力も確認する。実クラウドのEAS Build/Update・署名済みビルドの作成/配布は行わない。
画面変更がないため比較画像は追加しない。

## 限界と残課題

既知の形式を判定する誤設定防止策で、全ベンダーの秘密値、分割/暗号化した値、既存成果物やGit履歴を網羅するsecret scannerではない。
既に配布した鍵の失効・ローテーション・履歴/ログの消去も行わない。プラグインや外部ビルド環境全体のログ秘匿を保証するものでもない。
Expoが設定を評価する時点の値が対象で、独自スクリプトが後から値を注入するなどガードを迂回する構成まで保証しない。

[ExpoのEAS環境変数](https://docs.expo.dev/eas/environment-variables/usage/)も、公開用値の埋込とサーバー変数の扱いを区別している。実環境の設定・権限・監視・依存の残件は[#871](https://github.com/YuTakane256/Life-Quest/issues/871)で継続する。
計画④の途中であり、⑤への移行やアプリ全体の安全性保証を意味しない。実ユーザー/staging・秘密値への操作、配布・デプロイ・自動マージは行わない。
