# 習慣達成の遅延処理とアカウント境界

対象: [#727](https://github.com/YuTakane256/Life-Quest/issues/727)、品質確認 #699 / #507。

同期pullの[#725](https://github.com/YuTakane256/Life-Quest/issues/725)とは別に、
習慣達成側にも待機中にセッションが変わる経路がありました。
画面や報酬量を変えず、認証ライフサイクル通知後に旧処理が次の副作用を開始しないようにします。

## 修正範囲

| 経路 | 待機箇所 | 失効後に行わないこと |
| --- | --- | --- |
| Web | 0msタイマー | 新セッションの習慣データの集計 |
| Web | 統計storeのimport | 統計の記録 |
| Web | game storeのimport | 日次報酬日付の消費、XP/消化数/宝箱処理 |
| Web/Mobile | 日次記録のenqueue | 続くボーナスclaimの新規enqueue |

`captureAuthSessionGuard()`は通知済みのユーザー境界を比較するためだけの関数です。
資格情報の確認、ログイン状態判定、認可、サーバー検証の代用にはしません。
`notifyLogin`のユーザーIDが変わる場合と、ログイン中から`notifyLogout`へ移る場合に失効。
同じユーザーの重複通知や、匿名状態での重複ログアウトでは処理を維持します。
A→B→Aと戻っても古いAの処理は復活させません。既存の通知フックの順序・例外処理は維持します。

退会成功後の後始末など、SDKのログアウト通知より先にストアを直接クリアする経路では、
`clearWebCloudStores` / `clearMobileCloudStores`が保留した習慣処理も失効させます。
Webの日次報酬日付はgame module読込後に再確認してから消費します。

## 検証

```bash
npx vitest run src/stores/useHabitStore.session.test.ts apps/mobile/src/stores/useMobileHabitStore.session.test.ts packages/core/src/authLifecycle.test.ts src/platform/authStores.test.ts
```

修正前は、Webのタイマー前・各module待機中・log enqueue待機中、Mobileのlog enqueue待機中に
ログアウト/アカウント切替を挟む7ケースが失敗しました。
import/送信境界をテスト内で遅延させ、実際の習慣storeと認証ライフサイクルを実行しています。
Webの遅延効果テストでは統計/gameの呼出先を記録用の差替えにし、既存の実store報酬テストも維持します。
直接クリアのWeb回帰では実game/stats storeを、Mobileでは実game/habit/stats storeを使用します。

同じユーザーの重複通知、匿名、日次1回の報酬、記録→claimの依存順、直接クリア、A→B→A、
未付与の日次報酬日付を中断だけで消費しないことも確認します。

## 保証しないこと

開始済みの記録保存や送信、切替前に完了した統計/報酬は取り消しません。
破棄した保留claimをアカウント復帰時に自動再開する変更でもありません。
バックアップ置換、全ゲーム非同期経路、通知されていない認証変更まで網羅するものではありません。
DB・API・保存キー/形式・報酬量・画面構成は不変のため、新しい画像比較の対象はありません。

単体テストを実Supabaseの報酬付与成功や実機同期の証拠にはしません。
署名済み実機の認証・オフライン復帰・アカウント切替は#699/#700の確認事項です。
