# 同条件Web/Mobile画像の取得

この手順は**見た目の比較専用**。メモリ上の架空データのため、再起動後の永続化、同期、認証、報酬の正常性の証明には使わない。操作/永続化は通常の`mobile:parity:smoke`、staging品質確認は#699/#700で別途行う。

## 条件

- iPhone 18 Pro：402×874 pt（PNGは1206×2622 px）。Web：402×874 CSS px。端末のsafe area/ステータスバーは比較対象外。
- 壁時計：2026-08-10 21:00 JST。タイマー/アニメーション時計は止めない。動きは低減。
- ライト/ダークを明示選択。通常起動の初期設定systemは変更しない。
- 架空のタスク3件・サブタスク2件・習慣2件・キャラクター星見ユウ/330XP・装備3件/未装備4件・統計ログ。
- 純粋な共有fixture：`packages/core/src/parityFixture.ts`。Mobileの既存保存envelopeにだけ変換し、報酬台帳にも完了済みの証拠を含める。

## Web

```bash
npm run e2e:parity:reference
npm run e2e:parity
```

最初のコマンドは6画面×両テーマの12画像をPlaywrightの`test-results`へ保存・reportへ添付する。後者は既存390×844のdark回帰。Webは独立ブラウザーでクラウド設定を空にし、通常ブラウザーのデータを読み書きしない。

## Mobile（最初に専用アプリをインストール済みであること）

1. `npm run mobile:ios`でparity開発アプリをビルド/インストールする。起動後、そのMetroをCtrl+Cで停止する。
2. iPhone 18 Proシミュレーターを開き、別のMetroが8081を使っていないことを確認。
3. 次のいずれかを実行し、Metroを起動したままにする。

```bash
npm run mobile:reference:dark
# ダーク撮影後はCtrl+Cで停止して切り替える
npm run mobile:reference:light
```

4. 別ターミナルで同じリポジトリへ移動し、`npm run mobile:parity:reference`を実行。
5. Maestroの出力にある`reference-{theme}-{screen}.png`を同テーマのWeb画像と並べてPRへ添付。画像の画素サイズではなくpt/CSS pxで比較する。

reference flowは実際のlocalhost Expo manifestからテーマを確認してから実行し、`clearState:false`で起動する。開発モード・実際のnative application ID・parity variant・クラウド設定なしをJSエントリーで検査し、router/storeのhydration前にAsyncStorage singletonをメモリ専用へ切り替える。read/write/remove/bulk/clearは実DBに一切到達せず、SecureStoreにも比較データを書かない。条件不一致はエラーで停止する。

capture用Metroを停止し、フラグなしの`npm run mobile:ios`等で再起動すると、本来の保存データへ戻る。撮影モードでバックアップ/復元/ログインや永続化smokeを行わない。公開用/previewのビルドにcaptureフラグを設定しない。

## 現在の差分（#689の棚卸し）

比較基盤で発見したWeb余白不具合 #701 の修正後は、[修正後の両テーマ画像](screenshots/web-spacing-fix/README.md)をMobileの基準にする。修正前の画像は履歴として残し、潰れた余白をMobileへ再現しない。

| 領域 | Mobileの現状 | 次のIssue |
| --- | --- | --- |
| 共通 | 見出し/基本余白/主要カード/6タブの素材・選択・未解放表示は第一段で対応。画面内ボタン/小アイコン/詳細状態比較は継続 | #690（[最新比較](screenshots/mobile-shared-layout/README.md)） |
| タスク | 常時入力フォーム、独自の状態絞り込み、Webは完了一覧展開 | #691 |
| 習慣 | 常時追加フォーム、達成/カテゴリ/履歴の配置違い | #692 |
| 設定・ヘルプ | カード見出し/順序/バックアップの配置違い | #693 |
| キャラクター | プロフィール/装備/成長の順序と画像サイズ違い | #694 |
| インベントリ | キャラ画面に埋め込み・装備中も含む7件。Webは独立route・未装備4件 | #695 |
| 統計 | 集計カード/グラフ/実績の順序違い | #696 |
| マップ/バトル/演出 | 機能実装はあるがこの6画面比較だけでは合格にしない | #697/#698 |
| Web前提 | CSSのunlayered resetが余白utilitiesを上書き。潰れた余白をMobileへ移植しない | #701を先行 |

ネイティブで維持する差：ステータスバー、safe area、キーボード、日付入力、権限ダイアログ、フォント描画の微差。情報順序・導線・素材の違いはOS差として免除しない。
