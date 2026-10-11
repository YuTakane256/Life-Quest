# 2026-10-09：画面統一前の同条件比較

#689 / #688。架空匿名データ、2026-08-10 21:00 JST、Web402×874 CSS px / iPhone 18 Pro402×874 pt、動き低減。Mobile PNGは3倍解像度。OSステータスバー・safe area・フォント描画の微差は一致対象外。

これは**差分の棚卸し**であり、見た目の一致に合格した画像ではない。Webの余白上書き不具合 #701 は別PRで先行修正する。タスクはWebで完了一覧展開、Mobileで未完了が既定。インベントリはWebで未装備4件の独立route、Mobileでは装備中も含む7件の埋め込み。これらは#691/#695の解消対象で、fixtureの中身の差ではない。

| 画面 | Webライト | Mobileライト | Webダーク | Mobileダーク |
| --- | --- | --- | --- | --- |
| タスク | ![](web-light-tasks.png) | ![](mobile-light-tasks.png) | ![](web-dark-tasks.png) | ![](mobile-dark-tasks.png) |
| 習慣 | ![](web-light-habits.png) | ![](mobile-light-habits.png) | ![](web-dark-habits.png) | ![](mobile-dark-habits.png) |
| 統計 | ![](web-light-stats.png) | ![](mobile-light-stats.png) | ![](web-dark-stats.png) | ![](mobile-dark-stats.png) |
| キャラ | ![](web-light-character.png) | ![](mobile-light-character.png) | ![](web-dark-character.png) | ![](mobile-dark-character.png) |
| インベントリ | ![](web-light-inventory.png) | ![](mobile-light-inventory.png) | ![](web-dark-inventory.png) | ![](mobile-dark-inventory.png) |
| 設定 | ![](web-light-settings.png) | ![](mobile-light-settings.png) | ![](web-dark-settings.png) | ![](mobile-dark-settings.png) |

再現手順は[比較手順](../../mobile-visual-reference.md)。画像用メモリ状態を同期/永続化/報酬検証には使用しない。
