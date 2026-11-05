# Mobileの宝箱開封：画面再作成後の再送と排他（2026-11-06）

計画④ / #699・#927 / T07。#926マージ後のmain `776fc4f9`が基準。

## 問題と変更

[CharacterScreen](../apps/mobile/src/screens/CharacterScreen.tsx)で開封フックを生成していたため、キャラ画面が再作成されると、失敗した宝箱ID・冪等キー・再送案内と処理中表示を失う。本人の開封結果が離脱中に届いても画面フックの無効化で適用せず、次の受信へ任せていた。

既にWebで採用している構成と同様に、[ChestOperationsProvider](../apps/mobile/src/components/ChestOperationsProvider.tsx)を[RootLayout](../apps/mobile/app/_layout.tsx)のStack外へ配置する。画面は[共有context hook](../apps/mobile/src/hooks/useChestOperations.ts)から同じ操作状態を取得し、同じアプリ起動・認証セッション内では画面再作成後も同じ宝箱・キーで明示再送できるようにする。戻っただけでは自動再送しない。

[CharacterOverview](../apps/mobile/src/components/CharacterOverview.tsx)は1件の開封中に全宝箱を無効化し、アクセシビリティのdisabled状態と薄い表示も揃える。選んだ宝箱にだけ「開封中…」を表示する。既存のref排他で再描画前の二重要求も防ぐ。

離脱中でも同じ本人の成功は既存ストアへ一度適用し、Rootにある既存の宝箱演出を表示する。画面移動は追加しない。演出自身の閉じる・タイマー・所有者保護は既存実装を使う。認証切替では既存useGameOperationScopeにより旧キー/再送/排他を破棄し、遅い旧応答/finallyが新しい所有者へ反映されない。同じ所有者の重複通知は保持し、App全体のunmountでは旧要求を無効にする。

## 検証

[画面再作成の回帰7件](../apps/mobile/src/screens/chestNavigation.test.ts)は実RootLayout・CharacterScreen・CharacterOverview・開封hook・ゲームストア・共通宝箱演出をReact StrictModeで使う。navigator/React Native描画・認証/通信・無関係な画面/背景処理はスタブにする。

修正前4失敗/3成功。修正後は7件すべて成功し、関連6ファイル99件も成功する。失敗→キャラ/在庫/タスクの再作成→同キーで再送、送信中再作成の全宝箱無効化と離脱中の反映/共通演出、同一所有者通知、A→B/A→logout→Aのキー更新、Aの遅い応答とBの排他、App unmountを確認する。同期品質unit対象にも追加する。既存の在庫単体回帰は、開封スタブの参照先だけを新context hookへ変更し、既存の選択/売却等のassertionは維持する。

全体テスト・Web/Mobile/Core型検査・Lint・secrets・Web/PWAビルド、PR作成後の独立レビューと最終HEADの通常CI3件の確定結果はPR/Issueへ記録する。

## 範囲と残り

DB/RLS/API・報酬/抽選・保存形式・依存・Webの実装を変更しない。通常の画面構成・素材に変更はなく、比較画像は追加しない。ボタン無効化の違いは操作回帰で確認する。

同じ起動中Appに限る保持であり、OS終了後の宝箱ID/キーの永続復旧は追加しない。実Expo Routerの全ライフサイクル、実staging・実機/Android UIの新しい合格とは数えない。実利用データ・承認済みstaging A/B・OS/Simulatorを操作せず、マージ・配布・デプロイを行わない。④継続、⑤未開始。
