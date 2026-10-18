# ログインボーナスの閉じる位置とMobile宝箱演出（#755）

## 原因と変更

Web/Mobileとも「タップして閉じる」はカード内の文字であり、カードが背景への
イベント伝播を止めていた。文字の下のカード外を押すと閉じるため、当たり判定が
下にずれたように見えていた。文字そのものを44px/pt以上の実ボタンに変更した。
Webの右上の閉じるボタンも44px以上にした。
宝箱の待機表示は両テーマとも固定の黒い背景なので、Web/Mobileの宝箱名と案内文を
テーマに依存しない明るい文字色にし、ライトテーマでも読めるようにした。

Mobileには宝箱の獲得確定後にテキスト通知しかなかったため、共通画像を使う
開封待機→900msの開封演出→キャラクター/装備結果を追加した。
結果表示後の閉じる操作にはWebと同じ1500msの誤操作防止期間を設ける。
キャラクター解放結果からマップへ移動でき、装備結果では画像・レア度・種類・能力値を表示する。
青い宝箱は既存仕様どおりキャラクター/バトル解放用であり、装備の抽選を追加しない。
アイテム表示は利用者が確認済みのため、インベントリの再構成は含めない。

## 報酬と認証の境界

- 演出は既存ローカル/クラウド開封の確定結果だけを参照する。演出中のタップ、閉じる、
  「インベントリに追加」は報酬を再抽選・再付与しない。
- 通信失敗時は表示せず、既存の同じ冪等キーでの再送が成功した場合にも表示する。
- 既開封・重複適用・サーバー既開封の調整では新しい演出を発生させない。
- 新通知・unmount・認証切替で古いタイマーを破棄し、古いボタンで新通知を消さない。
- 演出イベントは保存しない。保存データに混入しても復元せず、認証切替でも破棄する。
- DB、同期API、ドロップ率、保存形式/バージョンは変更しない。
- アプリ内/OSの動きを減らす設定では装飾の動きを止め、結果と操作は維持する。

## 再現条件と比較画像

Web/Mobileの専用`rewards`プロファイルを使い、匿名・同じ人物/装備/宝箱/前日ログイン・
固定日付・テーマ・402×874相当で比較する。
Mobileはparityビルドかつクラウド未設定、明示的なcapture設定時だけメモリ内の架空データを使う。
通常版・preview・サインイン済みデータや既存AsyncStorageを初期化しない。

通常確認のMetro 8081と区別し、検証専用8082を使う。

```sh
LIFE_QUEST_PARITY_PROFILE=rewards npm run start:reference:dark --workspace @life-quest/mobile -- --port 8082
npm run mobile:parity:screenshots -- rewards
# lightも同様にstart:reference:lightで実行
RUN_WEB_PARITY=1 npx playwright test e2e/visual-parity/rewards-reference-web.spec.ts --project=web-reference-402x874
```

画像は[reward-ui](screenshots/reward-ui/)に保存する。Webは402×874、iOSはiPhone 18 Proの
402×874pt（画像は3倍）。OSのステータスバー、下部セーフエリア、背景のスクロール位置、
文字描画・装飾アニメーションはピクセル一致対象外。共通画像・情報順序・配色・操作を比較する。
装備画像はNativeの実際のランダム抽選結果の例であり、Webと同一抽選の比較証拠ではない。

| 状態 | Web light / dark | Mobile light / dark |
| --- | --- | --- |
| 閉じるボタン | [light](screenshots/reward-ui/web-light-login.png) / [dark](screenshots/reward-ui/web-dark-login.png) | [light](screenshots/reward-ui/mobile-light-login.png) / [dark](screenshots/reward-ui/mobile-dark-login.png) |
| 宝箱の待機 | [light](screenshots/reward-ui/web-light-chest.png) / [dark](screenshots/reward-ui/web-dark-chest.png) | [light](screenshots/reward-ui/mobile-light-chest.png) / [dark](screenshots/reward-ui/mobile-dark-chest.png) |
| キャラクター解放 | [light](screenshots/reward-ui/web-light-starter.png) / [dark](screenshots/reward-ui/web-dark-starter.png) | [light](screenshots/reward-ui/mobile-light-starter.png) / [dark](screenshots/reward-ui/mobile-dark-starter.png) |
| 装備獲得例 | — | [light](screenshots/reward-ui/mobile-light-equipment.png) / [dark](screenshots/reward-ui/mobile-dark-equipment.png) |

## 検証範囲

- Web DOM/StrictMode: 実コンポーネント/ストアの閉じる操作、旧通知・タイマー・認証境界。
- Native DOMアダプター: 実コンポーネント/ストア/開封フック。900/1500ms、再送、装備1個だけ、
  システムmotion変更、unmount、古い結果の画面移動抑止。Native描画そのものの証明ではない。
- Webブラウザー: ライト/ダーク×PC/スマホで閉じる文字をクリックする4ケース。
- iOS Simulator: メモリ内fixtureで閉じる→青宝箱→木宝箱→装備7→8の流れ。
  誤操作防止中のボタンは自動テストでもenabledになるまで待つ。

Android/物理端末、staging認証・実サーバーの再送、通常AsyncStorageからの継続利用、
標準motionの実機での見え方はこの画像・DOMテストの合格とは別の確認事項。
匿名progressionフローは新しい開封画面に追従させるが、既存データを消すため今回の端末では再実行しない。
報酬イベントを全件順番に再生するキュー、独立インベントリ画面、レベルアップ演出全体は対象外。
