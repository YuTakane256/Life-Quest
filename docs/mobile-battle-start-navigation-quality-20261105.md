# Mobileの戦闘開始と画面再作成（2026-11-05）

計画④ / #699・#919 / T07。#918マージ後のmain `99b17f46`が基準。

## 問題と変更

[MapScreen](../apps/mobile/src/screens/MapScreen.tsx)自身が開始フックを保持していたため、画面の再作成で失敗したstage/key・再試行案内・処理中の排他を失う。離脱中の開始応答もアンマウント済みとして破棄する。通常のタブ切替では画面が保持されることもあり、すべての移動で必ず再現するという意味ではない。

[BattleStartProvider](../apps/mobile/src/components/BattleStartProvider.tsx)を[RootLayout](../apps/mobile/app/_layout.tsx)のStack外に配置し、[context](../apps/mobile/src/hooks/useBattleStart.ts)経由でMapScreenが同じ開始処理を利用する。Webの#910と同様、同じRoot/authセッション内でstage・冪等キー・失敗案内・排他を維持する。画面へ戻っただけでは自動再送せず、既存の「再試行」を使う。

離脱中に本人の成功応答が届けば実ストアへ反映し、失敗なら同じキーでの再試行を残す。画面遷移は発火させない。自動攻撃は既存のfocus/AppState対応を維持し、マップへ戻ってから新しい間隔で開始する。開始時のスクロールcallbackを画面から渡すこともやめ、既存FlatListのmap/battle・stage/outcomeキー切替で表示位置を初期化する。消えた画面のrefを再試行情報へ保持しない。

認証切替、A→logout→A、source戦闘/進行の変更、Root終了での旧応答拒否と旧finallyの保護は、既存の開始フックとoperation scopeを利用する。同一所有者通知では処理を破棄しない。匿名開始・次ステージ・進行/報酬の既存仕様を維持する。

## 検証

[新規11件](../apps/mobile/src/screens/battleStartNavigation.test.ts)は実RootLayout・MapScreen・MapOverview/BattleOverview・Mobileゲームストアと開始/自動攻撃フックを使用する。StackはMapScreenのmount/unmountを切り替えるナビゲーションスタブ、React Nativeの表示/FlatList/focus/AppStateはDOM/JSスタブとする。認証/通信・保存・Rootの無関係な同期/通知/演出初期化もスタブで、StrictMode・fake timerと遅延応答を使う。

修正前7失敗/4成功→新規11件成功。既存の開始/認証セッション・Mobile通常攻撃・Web画面移動も含む4ファイル91件が成功した。

- 画面再作成後も失敗したstage/keyと再試行案内を保持し、明示操作だけで再送する。
- 離脱中の失敗応答も同じキーで再試行できる。
- 開始中の画面復帰でも二重開始せず、離脱中の成功で画面を動かさない。復帰前は攻撃しない。
- 次ステージ失敗/再試行で到達進行や報酬を重ねない。
- 認証切替後のA遅延応答/旧finallyが、Bの戦闘や排他へ作用しない。A再ログインでも旧要求を復活させない。
- 同一所有者通知では要求を維持し、source戦闘の置換とRoot終了では旧結果を適用しない。
- 匿名開始ではサーバーを呼ばず、開始だけでXPを与えない。認証確認中の排他も画面再作成をまたいで保持する。

同期品質のunit対象に追加する。全体・型検査・Lint・secrets・Web/PWAビルド・匿名Android出力・独立レビュー・最終HEADの通常CI3件の結果はPR/Issueへ記録する。

## 範囲と残り

Root起動中の保持であり、OS終了・再起動後の永続再試行や所有者付きの同一attempt復旧を追加しない。実Expo Routerの全移動/端末操作・実stagingでの開始再送の新しい合格とは区別する。結果送信フックの寿命や送信方針は変更しない。

DB/RLS/API・保存形式・報酬計算・依存・開始ポリシーは変更しない。実ユーザー/staging・秘密値・利用中データ・DB・OS/Simulator操作なし。画面構成/素材変更なし、比較画像追加なし。④継続、⑤未開始。マージ・配布・デプロイは行わない。
