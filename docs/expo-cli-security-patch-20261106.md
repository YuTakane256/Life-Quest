# SDK 57のCLI・依存パッチによる監査警告の低減（2026-11-06）

計画④ / #699・#871・#933。#932マージ後のmain `eef05208`が基準。

## 変更と根拠

package-lock.jsonだけを正規の`npm update @expo/cli zod --package-lock-only --ignore-scripts --no-audit --no-fund`で更新した。直接依存の指定・既存override・監査条件は変更しない。

- Expo 57.0.31が要求する`@expo/cli ^57.0.32`の範囲で、CLIを57.0.32→57.0.33へ更新。公開パッケージの依存定義では旧Zod依存を除去し、CLI/config/Metro設定のGlobを公式に`^14.0.3`へ移行している。
- eslint-plugin-react-hooks 7.1.1が`^3.25.0 || ^4.0.0`を許容するため、残るZodを3.25.76→4.6.7へ正規解決。Zod4を全依存へ強制するoverrideは使わない。
- これに必要なExpo config/config-plugins/schema-utils/Metro設定等のパッチも更新する。expo-constants 57.0.22→57.0.23、@expo/metro-runtime 57.0.17→57.0.18、expo-modules-autolinking 57.0.16→57.0.17等を含む。Expo本体57.0.31・Router57.0.29・React19.3.1・RN0.86.3は維持する。SDK 58へ移行しない。

[Zodの公開アドバイザリ](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)の修正版下限は4.6.6。[Globの中断後の探索継続](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)の修正版下限は14.0.2。採用した4.6.7/14.0.3はその範囲を満たす。公開manifestは`npm view @expo/cli@57.0.33 dependencies --json`で確認できる（[公開パッケージ](https://www.npmjs.com/package/@expo/cli/v/57.0.33)）。CLIは従来のZodをvendoringしたのではなく、@expo/schema-utilsのJSON Schema検証を使う。

## 監査結果

同じ2026-11-06のnpm registry応答。全依存は更新前/後の`npm audit --json`、prod分類は更新前mainの一時スナップショットと更新後の`npm audit --package-lock-only --omit=dev --json`を比較した。警告数は親依存への波及を含むパッケージ数であり、独立した脆弱性や漏洩の件数ではない。

| 対象 | Critical / High / Moderate / Low（更新前） | 更新後 |
| --- | --- | --- |
| 全依存 | 0 / 5 / 18 / 2（計25） | 0 / 3 / 15 / 2（計20） |
| prod分類 | 0 / 5 / 7 / 1（計13） | 0 / 3 / 4 / 0（計7） |

ZodとCLIのHigh警告を除去した。残るHighはdecode-uri-component/query-string/expo-routerの経路で、他のGlob/Minimatch等のModerate、deepmerge等のLowも全依存には残る。prod分類にはExpoの開発/ビルドツールも含む。到達性全体の評価や公開環境の安全認定ではなく、監査は引き続き非ゼロ/exit 1。週次High監査の除外・閾値緩和は行わない。

## 互換性と検証

- 新lockから`npm ci --no-audit --no-fund`成功、npm ls --allはexit 0。optional WASM 2項目のextraneous表示は更新前mainの同一条件でも存在し、lock内バージョンも同じ。新しいinvalid/missing依存はない。
- Expoのオンライン推奨版検査`expo install --check`は更新前/後ともexit 1。警告は10→9件で、今回更新したexpo-constantsの1件が消え、新規警告はない。残る9件はAsyncStorage、Expo本体/build-properties/dev-client/notifications/router、React、safe-area-context、React型。今回これらを一律ダウングレードしたり、検査対象から除外しない。オフライン判定でも既存の3件が出るため、成功扱いにはしない。
- 更新CLIでpublic設定解決、Web/Mobile/Core型検査、Lint（error 0/既存warning 7）、secrets、配布設定検査、Web/PWAビルド、全体3934成功/121 skipを確認。
- parity設定・クラウド接続空欄でiOS向け静的exportに成功。Simulator/Xcode起動・native prebuild/署名ビルド/配布は行っていない。Android exportと実DB/Edgeを含む最終HEADの通常CI3件、独立レビューの確定結果はPR/Issueへ記録する。

互換警告の9項目と残る監査/実環境設定は#871で追跡する。DB/RLS/API・ゲームの報酬/保存・画面・実利用データ・staging A/Bを変更しない。④継続、⑤未開始。マージ・公開・配布・デプロイは行わない。
