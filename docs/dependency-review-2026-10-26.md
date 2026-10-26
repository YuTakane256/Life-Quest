# 依存更新の確認（2026-10-26 / #837・#838）

main `0d531b2b`を基準に、Web・Mobile・共有処理・Native依存の解決を確認。
DB/RLS/API、保存データ、認証・報酬の仕様は変更しない。GitHub上のマージは行わない。

## #837：修正して確認

直接更新はLucideのWeb/Mobile 1.57.0→1.61.0、Zustand 5.0.15→5.0.16、
Expo 57.0.30→57.0.31、Notifications 57.0.23→57.0.24、Router 57.0.28→57.0.29。
SVG 15.15.4→15.15.5の単独更新は外す。

### 元の問題

- Expo 57.0.31の`bundledNativeModules.json`はSVG **15.15.4**を指定している。
  Mobile manifestは15.15.5、root overrideは15.15.4、lock上のworkspace指定は`^15.15.5`で不整合だった。
  CIのNative依存テスト3件が失敗しており、期待値だけを新しい版へ書き換えて通す対応はしない。
- 間接peer解決でReanimatedが4.5.1→4.7.1へ進んでいた。
  4.7.1はWorklets `0.13.x`を要求するが、このSDK/lockは0.10.1で、`npm ls`もinvalidと判定した。
- Gesture Handlerも既存3.0.2から3.4.0へ進んでいた。Native部品の更新なので、通常のアイコン/SDKパッチ更新へ混ぜない。

### 修正と境界

- SVGをSDK推奨15.15.4へ戻し、manifest/lock/override/実解決を一致させた。
- ReanimatedをSDK推奨4.5.1へ、Gesture Handlerを既存3.0.2へoverrideで固定した。
  WorkletsはSDK推奨0.10.1のまま。再解決後の`npm ci`と`npm ls`が成功し、重複やpeer不整合はない。
- Gesture HandlerのSDK推奨は`~2.32.0`だが、既存lockとローカルのPodfile.lockは3.0.2。
  今回は既存Native構成を維持し、推奨版へのダウングレードや新しい3.4系への移行は行わない。
- SVGの単独patchもDependabotの一括更新から外し、SDK推奨が変わった際に連動更新する。
  新しいNative互換性テストは、Reanimated/Workletsの推奨版と、Gesture Handlerの既存固定版・単一解決を確認する。
- SDKのメジャー、React/React Native、認証・保存形式は変更しない。
  Lucideの両プラットフォームは同じリリース範囲を使い、Zustandは5系の保守更新を維持する。

ExpoモジュールのNativeコードにもパッチが含まれるため、更新後の端末確認では開発ビルドを再生成する。
既存Simulatorの古いインストールだけを新Native依存の合格証拠にせず、今回の型検査/バンドル生成と実機ビルドは区別する。
端末データの初期化や、インストール済みアプリの上書きは今回行わない。

## #838：開発ツール更新

対象HEAD `0a04dbb521099fcf6b2025facafea773dbf1ef7c`。
ESLint 10.12.0→10.13.0、typescript-eslint 8.71.2→8.72.0、Vite 8.3.4→8.3.5とその関連lock更新。

- ESLintはルールの検出改善、typescript-eslintはルール読込/型解析の保守更新。
  TypeScript ~6.0.3、Node 22.22.2の方針は維持し、設定や検査を緩める変更はない。
- Viteはbuildのimport-map/hash、CSS URL、開発サーバー/HMR等の修正。
  アプリのPWA/CSP/専用staging設定を維持する。SupabaseやMobileのruntime依存は変更しない。
- 当該HEADで既存のbuild-and-test / supabase / playwrightはすべて成功済み。
  依存更新の内容とアプリ構成から、現時点で必須の修正は見つかっていない。

## 検証

Native依存ガード16件、全単体3,363件成功/98件skipと、修正後のクリーンインストール/peer解決を確認。
Web/Mobileの型検査、lint（既存6警告のみ）、Web/PWAビルド・Android exportも成功。
修正した#837のCI3件、独立レビューを続けて確認する。
実アカウントでの操作、Apple/Google認証、通知の実機動作、Native実機ビルドは今回の対象外。

## 一次資料

- 各版の実際の公開packageとlock integrity、Expo 57.0.31内の`bundledNativeModules.json`/peerDependencies。
- [Zustand 5.0.16](https://github.com/pmndrs/zustand/releases/tag/v5.0.16)
- [ESLint 10.13.0](https://github.com/eslint/eslint/releases/tag/v10.13.0)
- [typescript-eslint 8.72.0](https://github.com/typescript-eslint/typescript-eslint/releases/tag/v8.72.0)
- [Vite 8.3.5](https://github.com/vitejs/vite/releases/tag/v8.3.5)
