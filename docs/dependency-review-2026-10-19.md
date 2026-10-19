# 2026-10-19：依存更新6件の判断

基準：mainのPR #762まで、Expo SDK 57 / React Native 0.86.3。
アプリの保存・同期・報酬ロジックは変更しない。CI成功と、SDK/ネイティブ互換性の判断を分ける。

| PR | 内容 | 判断 |
| --- | --- | --- |
| [#763](https://github.com/YuTakane256/Life-Quest/pull/763) | Supabase JS 2.118.0、Lucide Web/Native 1.57.0、React/DOM 19.3.1、SVG 15.16.0 | SVGをSDK推奨15.15.4に戻し、peerにも同じ版を強制するoverrideとlock再生成で修正。ほかの更新は維持し、CI3件の再確認対象 |
| [#764](https://github.com/YuTakane256/Life-Quest/pull/764) | Playwright 1.64.1、Vitest/UI 5.0.5、jsdom 30.1.3、Supabase CLI 2.121.0、typescript-eslint 8.71.2 | 開発用更新。Vitest/UIの版は揃っており、元のCI3件成功。最新mainと再同期して改めて確認 |
| [#765](https://github.com/YuTakane256/Life-Quest/pull/765) | expo-dev-client 58.0.13 | SDK 57への単独導入は見送り |
| [#766](https://github.com/YuTakane256/Life-Quest/pull/766) | expo-auth-session 58.0.12 | 同上。認証経路のネイティブ依存もSDK移行時にまとめて確認 |
| [#767](https://github.com/YuTakane256/Life-Quest/pull/767) | expo-notifications 58.1.4 | 同上。通知・権限の端末確認も必要 |
| [#768](https://github.com/YuTakane256/Life-Quest/pull/768) | Expo本体のみ58.0.11 | 他のExpoモジュール・React Native等を57向けのままにするため見送り |

## CIの失敗原因

- #763：SVGがSDK推奨外。さらにmanifestの固定値とlockの`^`付き範囲が不一致。
- #765〜#767：manifestの`~`/固定値とlockの`^`が不一致。
  ただし、この記述だけ直してもSDK 58用モジュールを混在させる問題は解消しない。
- #768：上記に加え、SVG推奨版の相違と`expo/tsconfig.base`の解決失敗で多数のテストが失敗。
  Web/DBのCIが成功していても、Nativeの移行完了とは判断できない。
- SVGはアプリの直接依存だけを戻しても、Lucideのpeerに15.16.0が残りうる。
  #763ではoverride＋再解決により、実際の解決先も15.15.4へ統一する。

## 再発を減らす設定と検査

- Dependabotは`expo`/`expo-*`のメジャー更新を単独提案せず、SDK移行として扱う。
  同一メジャーのpatch/minorは引き続き候補にする。
- `react-native-svg`のminor/majorは、他のSDK管理Native依存と同じく手動で判断する。
- CIはMobile側から実際のExpoを解決し、その推奨module majorと導入版を比較する。
  SDK本体だけ・モジュールだけの更新を、それぞれ検出する。
- root/Mobileのmanifestとlock、Reactの単一インスタンスとDOM版、
  SVGの実際の解決先、Web/NativeのLucide範囲も検査する。
- この検査はすべてのNative ABIやExpo Doctorの全項目への適合を証明しない。
  SDK 58移行は関連依存・ネイティブ再生成・開発ビルド・端末動作を別途まとめて確認する。

Expo公式も、SDK更新後に関連依存を揃え、native projectとリリースノートを確認する
[移行手順](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/)を案内している。
React 19.3.1は[公式リリース](https://github.com/facebook/react/releases/tag/v19.3.1)を確認。
今回はWeb/Mobileを同じReactに更新し、別インスタンスを作らないことを検査する。

```bash
npm ci --no-audit --no-fund
npx vitest run scripts/mobile-native-dependencies.test.mjs
npm run typecheck
npm run mobile:typecheck
npm test -- --run
npm run build
npm run mobile:export
```

最終HEADのCI・独立レビュー結果は各PR本文に記録する。mainへのマージや、
見送りPRのcloseは行わない。起動中の通常parityアプリとそのデータは変更しない。
