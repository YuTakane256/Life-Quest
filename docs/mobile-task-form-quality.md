# Mobile：タスク繰り返し編集と入力品質（#761）

Webでは作成後も変更できる繰り返し設定が、Mobileでは「作成時の設定」として
読み取り専用になっていました。編集時も「なし／毎日／毎週／毎月」を選択・保存できます。

## 変更と境界

- 共有の編集型に既存の`recurrence`を含め、Nativeの実フォームから保存します。
- DB・API・保存形式・報酬量は変更せず、既存の`upsert_task.p_recurrence`を使います。
- 編集だけでは報酬や次回分を発行しません。以降の完了確定時に変更後の周期を使います。
- すでに作成された別IDの次回タスクを一括変更する「シリーズ編集」ではありません。
  Web同様に選択したタスク1件の設定を変更します。
- 完了済みの編集だけでは再報酬・次回分の追加発行を行いません。
- フォーム全般のアカウント切替保護や、実アカウントの同期確認を完了した扱いにはしません。

## 自動回帰

```bash
npx vitest run src/hooks/mobileTaskRecurrence.test.tsx \
  apps/mobile/src/stores/useMobileTaskStore.test.ts \
  apps/mobile/src/stores/useMobileTaskStore.cloud.test.ts \
  packages/core/src/tasks.test.ts scripts/run-mobile-parity-screenshots.test.mjs
npx playwright test e2e/task-recurrence.spec.ts \
  --project=desktop-chromium --project=mobile-chromium
```

Native実フォームの4周期の保存・再編集・キャンセルと送信値、保存データ、
匿名の次回分・報酬、認証済みの場合のサーバー権限を検査します。
Webは両テーマ・PC/402pxで編集・キャンセル・実際の保存からの再読み込みを検査します。

## iOS画面操作の再実行

通常の確認用Metro8081を止めず、メモリ専用比較環境を8082で起動します。

```bash
npm run start:reference:light --workspace @life-quest/mobile -- --port 8082
# 別ターミナル
node scripts/run-mobile-parity-screenshots.mjs taskForm
```

ダークは8082のMetroだけを止め、`start:reference:dark`に切り替えます。
起動済みSimulatorは1台にし、Device Hubの
`Device > Keyboard > Toggle Software Keyboard`でソフトウェアキーボードを表示してください。
フローはキーボードの`Done`キーを検査するため、入力欄のフォーカスだけでは合格しません。
文字サイズの変更前の値を控え、検証後に元へ戻してください。

runnerはparity・クラウド未設定・dailyメモリfixture・両テーマの条件を検査します。
`clearState:false`で通常データは初期化しません。メモリfixtureは永続化の証拠ではありません。
検証後は通常の8081へ戻します。

```bash
xcrun simctl openurl booted 'lifequest-parity://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081&disableOnboarding=1&disableAutoLaunch=1&disableFab=1'
```

## 残る確認

本PRのタスクフォーム確認と、全画面のアクセシビリティ合格は別です。
Android・実機認証/通知権限・staging双方向同期は引き続き計画④/⑤で確認します。
