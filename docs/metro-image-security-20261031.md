# Metroの画像解析依存の除去（2026-10-31 / #873）

セキュリティ残件 [#871](https://github.com/YuTakane256/Life-Quest/issues/871) のうち、
`image-size@1.2.1`のHigh警告を解消する。計画④は継続し、本番公開の安全性全体を認定するものではない。

## 変更

前回はimage-sizeの2系への強制差替えを保留していたが、Metro本体に公式の対策があることを確認した。
[Metro 0.84.5](https://github.com/react/metro/releases/tag/v0.84.5)で脆弱な外部依存を内蔵パーサーへ置換し、
[0.84.6](https://github.com/react/metro/releases/tag/v0.84.6)に同じ対策と型の修正が含まれる。

- React Native 0.86.3のCLI/configが要求する`^0.84.3`の範囲内で、Metro関連15パッケージを0.84.4→0.84.6へ更新。
- `@react-native/community-cli-plugin@0.86.3`と`@react-native/metro-config@0.86.3`配下だけにoverrideを限定。
  Expoの`@expo/metro@56.0.2`が固定するMetro 0.84.5は維持する。Metro全体を一律にoverrideしない。
- `image-size`と、その専用依存`queue`をlockfileから除去。SDK・React Native本体・React・他の依存要求は変更しない。
- 旧版がlockfileに残るため、公式0.84.6の依存情報を一時環境でnpmから生成し、対応する旧Metro項目だけ反映。
  **クリーンな`npm ci`からRN 0.84.6 / Expo 0.84.5を再現し、実解決先でも確認した。**

React Nativeを更新するときは、バージョンを限定したoverrideの要否・Metroの解決先を見直す。
アプリ機能・DB/API/RLS・保存形式・画像の内容・実stagingデータは変更していない。

## 画像処理の回帰

[実際の両CLIの依存先を使う8ケース](../scripts/metro-image-security.test.mjs)を追加した。
既存のサポート形式へのfallbackを維持し、共有PNG全71枚についてSharpが読む寸法と一致することを両経路で確認する。

| 条件（RN/Expo各4ケース） | 確認内容 |
| --- | --- |
| 共有PNG全71枚 | 幅・高さが既存ファイルのmetadataと一致（計142照合） |
| ゼロ寸法のPNG | 有効な画像として受け入れず拒否 |
| JPEG拡張子の既存PNG | 対応形式間のfallbackと寸法を維持 |
| 切断/空入力と未対応形式 | PNGの不正入力を拒否、HEIF/JXLは未対応のため解析対象外 |

更新前の8ケースではRN側のゼロ寸法拒否だけが失敗し、更新後は8件成功。
これは画像読込の境界・互換性の回帰であり、実CVEのDoS入力や任意の悪意ある画像全体を検証したという意味ではない。
画像は読み取りのみで、加工・差替え・保存データの初期化は行っていない。

## 依存監査

同日のnpm応答。警告数は親パッケージへの波及を含むため、独立した脆弱性や漏洩の件数とは異なる。

| 対象 | 変更前 Critical / High / Moderate / Low | 変更後 |
| --- | --- | --- |
| 全依存 `npm audit --json` | 0 / 7 / 0 / 8（計15） | 0 / 6 / 0 / 8（計14） |
| prod分類 `npm audit --package-lock-only --omit=dev --json` | 0 / 7 / 0 / 5（計12） | 0 / 6 / 0 / 5（計11） |

`npm ls metro --all`は不正な解決なし。Expoの経路は0.84.5、React Nativeの経路は0.84.6。
image-sizeは監査・lockfileの双方から外れた。開発用ツールの画像解析経路に関する対策であり、
利用者間の情報漏洩を発見・解消したという報告ではない。

残るHighの直接原因はZodとdecode-uri-component、Lowはdeepmergeと親依存への波及。
週次のprod High監査はまだ失敗する。除外や監査条件の緩和は行わない。
実環境の権限・管理者保護・配信HTTPヘッダー・監視/復旧等も#871の残項目。
Android/iOSのexportは署名済みビルドや実機確認ではなく、今回Device Hub・OS回線・アカウント操作は行わない。
