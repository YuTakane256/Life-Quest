# Life Quest Mobile

Expo SDK 57 / React Native 0.86 と Expo Router を使うモバイルアプリです。Webと同じnpm workspaceに置き、`@life-quest/core`のタスク・習慣・成長・装備・バトル・同期ロジックを共有します。未ログイン時は端末内保存、設定済みのログイン環境ではSupabaseと同期します。

## iOS Simulatorでの初回起動

macOSにXcodeとiOS Simulatorを導入し、シミュレーターを起動します。以下はリポジトリのルートで実行します。

```bash
npm ci
npm run mobile:ios
```

`mobile:ios`はparity variant（`com.yutakane.lifequest.parity`）のネイティブdevelopment buildを作成・起動します。初回はビルドに時間がかかります。ネイティブ設定・依存を変更した場合も再ビルドが必要です。

導入済みのparityアプリをクラウド未設定で使う場合は、前のMetroを停止してから`npm run mobile:start:anonymous`を起動し、その案内から同じアプリを開きます。これは保存データを初期化しません。通常版の開発ビルド（`com.yutakane.lifequest`）向けMetroは`npm run mobile:start`です。ネイティブモジュールを使用するため、ここではExpo Goを前提にしません。

## 型検査・Android出力・配布準備

```bash
npm run mobile:typecheck
npm run mobile:export
npm run mobile:validate-release
```

`mobile:export`はAndroid向けMetroバンドルの生成・依存解決を確認するコマンドで、端末へのインストールではありません。Android/実機の開発ビルド、署名済みpreviewと認証・通知・退会の確認は[リリースチェックリスト](../../docs/mobile-release-checklist.md)を参照してください。

## 画面比較と永続化の確認

最新の代表画面は[README用ギャラリー](../../docs/screenshots/readme-20261027/README.md)に掲載しています。

- **見た目の比較**：`mobile:reference:dark` / `:light`と`mobile:parity:reference`を使用します。開発/parity・クラウド未設定を検査したうえで、共有fixtureをメモリ上にだけ読み込みます。撮影時の書き込みは実保存領域へ到達しません。[同条件撮影手順](../../docs/mobile-visual-reference.md)を参照してください。
- **匿名の操作・永続化**：`mobile:start:anonymous`で起動し、`mobile:parity:smoke`等を使用します。専用parityの保存領域を初期化するため、残したいデータやサインイン済み環境では実行しません。[チェックリスト](../../docs/mobile-parity-checklist.md)を参照してください。
- **実アカウントの同期**：専用stagingの別Simulator/保存領域で行います。fixtureや初期化フローを混ぜず、[staging受け入れ手順](../../docs/staging-sync-acceptance.md)に従います。
