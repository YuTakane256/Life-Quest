# Mobileの戦闘結果送信と画面移動（2026-11-05）

計画④ / #699・#921 / T07。#920マージ後のmain `63e39e96`が基準。

## 問題と変更

[MapScreen](../apps/mobile/src/screens/MapScreen.tsx)が結果送信フックを保持していたため、画面の再作成で送信済みattemptの冪等キー・行動列・失敗状態・排他を失い、戻った際に別キーで再送していた。離脱中の本人応答も破棄する。画面が保持されるタブでは、逆に非表示中の新しい結果を自動送信していた。

[BattleResultProvider](../apps/mobile/src/components/BattleResultProvider.tsx)を[RootLayout](../apps/mobile/app/_layout.tsx)のStackと開始providerの外へ置き、[context](../apps/mobile/src/hooks/useBattleResult.ts)経由でMapScreenが同じ結果送信を使う。Webの#908と同様、開始済みのattempt/actions/key・失敗状態・排他をRoot内で保持する。失敗してもマップへ戻っただけでは再送せず、既存の「再送」を使う。同じattemptの表示用行動列が変わっても、最初に捕捉した行動列と同じキーで再試行する。

[結果送信フック](../apps/mobile/src/hooks/useCloudBattleResolve.ts)に新しい自動送信だけの許可条件を追加する。Expo Routerの正規化されたpathnameが`/map`のときだけ新規自動送信を始め、保持された非表示タブでも送信を増やさない。開始済み要求は離脱で中止せず、本人の結果を実ストアへ一度反映する。画面の強制移動や次戦闘の自動開始は行わない。結果の待機中は「次へ」「マップへ」「リトライ」を引き続き保護する。

認証世代・attemptの結び付け、operation scopeの排他、旧finallyの保護、source変更や同期先行での適用拒否は既存処理を維持する。勝利/敗北・granted=false・匿名/同期済み結果の扱い、開始フックと自動攻撃の制御も維持する。

## 検証

[新規20件](../apps/mobile/src/screens/battleResultNavigation.test.ts)は実RootLayout・MapScreen・MapOverview/BattleOverview・Mobileゲームストア・認証ストア登録・開始/結果/自動攻撃フックを使用する。Stackはmount/unmountまたは保持タブを表すナビゲーションスタブ、RNの表示/FlatList/focus/AppStateはDOM/JSスタブとする。認証SDK/通信・保存・Rootの無関係な同期/通知/演出初期化もスタブ。StrictMode・fake timer・遅延応答でタイミングを制御する。

修正前11失敗/9成功→新規20件成功。開始の画面移動、既存の結果処理・認証境界・Web画面移動も含む5ファイル88件が成功した。

- 失敗/離脱中失敗を保持し、明示再試行だけで同じattempt/actions/keyを送る。
- 再作成後も処理中は二重送信せず、離脱中の応答を一度反映し、画面を移動しない。
- 勝利/敗北、granted=false、local/同期済み結果、保持されたタブの既存再送を維持する。
- 未表示/再表示前の新しい結果、保持された非表示タブでは自動送信を待ち、`/map`へ戻って開始する。
- Aの旧応答/旧finallyをBの送信へ混ぜず、非同期の認証清掃前にも旧attemptをBへ結び直さない。A再ログインでも旧結果を適用しない。
- Root終了・別attemptへの置換・同期先行では古い結果を適用しない。同一所有者通知では継続する。
- 通常の自動攻撃→cloud勝利→結果送信を一回分に保ち、確定応答の前にはXPを加えない。

同期品質のunit対象へ追加する。既存の開始回帰にはpathnameのRouterスタブだけを追加する。全体・型検査・Lint・secrets・Web/PWAビルド・匿名Android出力・独立レビュー・最終HEADの通常CI3件の結果はPR/Issueへ記録する。

## 範囲と残り

同じRoot起動中の保持であり、OS終了・再起動後の永続再送や所有者付き同一attempt復旧を追加しない。新しい自動送信は選択された経路で制御し、OS背景状態/実Expo Routerの全遷移・実端末/実stagingの新しい合格とは区別する。

DB/RLS/API・保存形式・報酬計算・依存は変更しない。実ユーザー/staging・秘密値・利用中データ・DB・OS/Simulator操作なし。画面構成/素材変更なし、比較画像追加なし。④継続、⑤未開始。マージ・配布・デプロイは行わない。
