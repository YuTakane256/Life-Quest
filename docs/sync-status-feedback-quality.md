# 同期状態の表示と手動再試行（#749）

## 問題と変更

Web/Mobileの設定には同期カードがあるが、前回pullが成功していれば、
次のpull中でも「同期済み」と出る場合があった。接続状態も公開availabilityへ
反映されず、オフラインや認証待ちのまま手動同期を勧めていた。

- coreの共通判定で、確認中/送信中、オフライン、認証待ち、競合/恒久失敗を区別する。
- Webは起動時のnavigator.onLineとonline/offlineイベント、MobileはNetInfo通知を反映する。
  Mobileのunknown通知は接続回復の証拠とせず、直前に確定したofflineを保持する。
  接続が不明の初期状態はofflineと決めつけない。
- OSがonlineでも通信成功とは限らない。成功時刻は実pull成功でのみ更新し、
  確認中は以前の成功時刻があっても同期済みと表示しない。
- offline/auth-required中は手動同期を開始しない。認証待ちは再ログインを案内する。
- 同一ハンドルで同時に届いたsyncNowを同じPromiseに集約する。
  retry処理の拒否も公開失敗状態に変換し、UIへ未処理のPromiseを返さず再試行可能にする。
- retry待機中にoffline/認証切替になった場合は後続pullへ進まない。
  旧要求の失敗/終了で新ハンドルや新UIのbusy状態を解除しない。
- 自動pull/送信中のボタンもbusy/disabledを一致させ、アクセシビリティ状態へ反映する。

画面のカード構成・配置・デザイントークンは維持し、文言と状態/可否のみ変更する。
DB・キュー/保存形式・報酬量の変更やデータ初期化はない。
offline検出で既存の自動復帰/保険pullを停止する変更ではない。
実ネットワークで失敗した操作は従来どおりキューに保持する。

## 表示と操作

| 状態 | 表示 | 今すぐ同期 |
| --- | --- | --- |
| 未ログイン/未設定 | ログインすると確認可能 | 無効 |
| 確認中・送信中 | 確認中/同期中、保留件数 | 無効 |
| 確定offline | オフライン、接続後に同期する件数 | 無効 |
| 認証回復待ち | 再ログインの案内 | 無効 |
| 一時的な失敗 | 接続確認と再試行の案内 | 有効 |
| 競合・恒久失敗 | 単純な再送では解決しない旨 | 他のpendingのみ再試行可 |
| pull成功後のidle、未送信なし | 同期済み、最終確認日時 | 有効 |

競合/恒久失敗とofflineが同時に存在する場合は、解決が必要な問題の説明を優先する。
手動同期は恒久失敗/競合をリセットしない。アカウントや操作の内容・raw errorは表示しない。

## 回帰と残確認

- `packages/core/src/cloudSyncState.test.ts`：共通文言/優先度・availability・busy/可否。
- `src/platform/cloudSyncSession.test.ts`：実Web/Mobile同期ハンドル。OS通知や通信/保存はモック。
  接続切替/unknown、同時要求集約、retry拒否、認証待ちと回復、旧要求の失敗を検証。
- `src/components/ui/CloudSyncSettings.test.tsx`：Web実コンポーネントをStrictModeで操作。
  文言、ボタン/aria状態、旧finally、unmount後の購読解除を確認する。
- `apps/mobile/src/platform/networkRecovery.test.ts`：NetInfoのnullを誤ってofflineにしない。
  接続/到達可否の明示falseとunknownを区別する。

これらも`npm run test:sync:unit`に含める。

カードの新規レイアウト変更ではないため比較画像の追加はしない。
Mobileのネイティブ描画・OSのネットワーク検知精度・機内モード/復帰・実機認証は未確認。
DOM/モック回帰をstaging二アカウント・実Web/Mobile操作の合格とは扱わない。
同期の実送信/DB整合は[#747の統合回帰](sync-recovery-integration-quality.md)も維持する。
