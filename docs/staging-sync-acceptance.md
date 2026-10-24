# 計画④：実Web↔Mobile同期の受け入れ確認

Issue [#819](https://github.com/YuTakane256/Life-Quest/issues/819) / 親 [#699](https://github.com/YuTakane256/Life-Quest/issues/699)。
匿名の画面比較・モック回帰・ローカルDB統合を、実アプリの同期成功と取り違えないための確認表。
この文書と事前診断だけで④完了とはしない。⑤の署名済み内部配布・ストア提出とは別の段階。

## 現在の状態（2026-10-24）

**実操作確認は環境確認待ち。成功ではない。**

- 作業用環境にはWeb/Mobileの接続設定がない。事前診断は`blocked`、終了コード1となった。
- Supabase CLIは未ログイン。管理画面もサインイン画面へ遷移したため、プロジェクト一覧は取得できなかった。
  検証用プロジェクトが存在しないと断定したものではない。
- プロジェクト/アカウント作成、ログイン、デプロイ、実データの投入/消去は行っていない。
- 今回のPRの単体テスト・CI成功は診断実装/既存機能の回帰結果であり、下記T01〜T08の合格ではない。

## G0：実操作を始めてよい条件

次の条件を管理者と確認する。不明なまま既存のプロジェクトを流用しない。

- [ ] 本番と別の検証専用Supabaseプロジェクトを識別し、project refを管理画面で確認した。
  名前にstagingが含まれるだけでは判断しない。用途・所有者・課金への影響も確認する。
- [ ] 対象mainのmigration、RLS、RPC、Edge Functionsがその環境へ適用されている。
  このPRは適用しない。新規作成や`db push`/Functions deployは別途確認して行う。
- [ ] 使い捨て可能な検証専用アカウントA/Bを用意し、通常利用アカウントは使わない。
  パスワード・トークン・管理者キーをチャット/Issue/PRに貼らない。
- [ ] Webは専用ブラウザプロファイル、iOSは専用Simulatorとparityアプリを使う。
  既存ブラウザのログイン状態や既存parityの保存領域を流用しない。新規環境の作成は別途行う。
- [ ] 固定メモリfixtureなし。通常利用/preview/releaseのデータは初期化しない。
  実アカウントでは`mobile:parity:smoke`/`progression`等の初期化フローを実行しない。
- [ ] 手動確認の対象、担当、使用アカウントの匿名ラベルA/B、対象SHA、端末/OSを記録した。

いずれか不明ならG0は`blocked`。本番データの複製やアカウント削除を代わりに実行しない。
ローカル専用の`npm run test:sync`はユーザー/行を作成するため、stagingには実行しない。

## 通信しない事前診断

新コマンドは**渡されたprocess.envだけ**を照合する。ファイル探索、Supabase通信、認証、
サーバー起動、DB書込み/データ削除はしない。出力にURL/ref/キーの値は含めない。

```bash
# 既に環境変数を設定したシェルから実行
npm run sync:staging:check
npm run sync:staging:check -- --json
```

専用ファイルで管理する場合、repoルートに`.staging-sync.local`を**新規**作成し、
[空欄の見本](examples/staging-sync.env.example)を参考に設定する。既存ファイルを上書きしない。
`*.local`はgitignore対象。空欄のままの見本は診断に失敗する。

```bash
# Node 22.22.2。コマンド引数にキーを書かず、ファイルを明示して診断
node --env-file=.staging-sync.local scripts/check-staging-sync.mjs
```

- `LIFE_QUEST_SYNC_TARGET=staging`と`LIFE_QUEST_STAGING_PROJECT_REF`は、管理者がG0を確認してから設定する。
  **宣言の内容が本当にstagingかを、このスクリプトが管理APIで認定するわけではない。**
- URLは指定refの`https://<ref>.supabase.co`に限定する。ローカル/独自ドメイン/他ref/認証情報や
  query付きURLは対象外。本番と分離した管理Supabaseを使うこの手順専用の制約である。
- Web/Mobileへ同じ公開publishableキー、または指定ref/role=anonの旧JWTを設定する。
  公開キーが異なっても同じ環境を指す構成はあり得るが、この手順ではコピー違いを減らすため同じ値に限定する。
  形式/未署名のpayload確認だけであり、有効性/署名/新publishableキーの所属は証明しない。
- parity、capture/profile無効、`EXPO_NO_DOTENV=1`、クライアント環境変数の組込み有効を要求する。
  追加の`VITE_*`/`EXPO_PUBLIC_*`に既知形式の管理者キー/秘密鍵があれば拒否するが、
  任意の秘密値すべてを見分けるDLP機能ではない。
- 一致時は`configuration-consistent`/終了コード0。不足/不一致は`blocked`/終了コード1。
  0は「設定の整合性のみ」であり、接続・ログイン・同期成功ではない。

Nodeの`--env-file`より既存のシェル環境変数が優先される点に注意する。意図しない設定があれば、
**対象変数だけ**を整理して再診断する。環境全体や既存`.env`を消さない。
診断はVite/Expo/EASの全ファイルや実バンドルを解析しない。起動後の実接続先確認も必須。

## G1：起動と実接続先の確認

G0を完了し、事前診断が通ってから、担当者が専用環境を起動する。
以下は準備用の手順であり、このPRでは起動/接続を実行していない。
Web4175/Mobile8083を専用に使い、通常の5173/8081と比較用4174/8082を止めない。

Web（repoルート、別ターミナル）:

```bash
node --env-file=.staging-sync.local scripts/check-staging-sync.mjs &&
node --env-file=.staging-sync.local node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4175 --strictPort
```

Mobile（repoルート、さらに別ターミナル）:

```bash
node --env-file=.staging-sync.local scripts/check-staging-sync.mjs &&
(cd apps/mobile && node --env-file=../../.staging-sync.local ../../node_modules/expo/bin/cli start --dev-client --localhost --port 8083)
```

Mobileのポートが使用中なら別ポートへ自動変更せず、起動を中止して調整する。
専用Simulatorに入れた既存parity開発ビルドから8083を選び、アプリを完全再読み込みする。
ログイン前に、比較fixtureが表示されず、専用の保存領域であることを確認する。
ブラウザのNetwork等で**起動済みアプリ**のリクエスト先が指定プロジェクトであることを確認し、
Mobileも同じ環境を使い、Aのログインが同じSupabaseユーザーとして記録されることを管理者が確認する。
設定・キャッシュが曖昧なら中止し、既存保存領域の消去で対処しない。

Webの確認用リダイレクト（`http://127.0.0.1:4175/settings`）とparityのschemeを、必要な認証方式に
合わせて検証プロジェクトだけへ登録する。登録変更は別途確認する。
まず既存の検証用メール認証で同期を見る。Google/Apple・退会・通知権限の本格確認は⑤で別記録にする。
iOS実機/Androidではlocalhostの到達条件や署名も異なるため、このSimulator手順をそのまま流用しない。

## 有限の受け入れ確認 T01〜T08

各行を`未実行 / blocked / pass / fail`で記録する。テスト用の少数のタスク/習慣/装備だけを使い、
他アカウントのデータは操作しない。同期完了表示だけで判断せず、両端の実データを照合する。

| ID | 実操作 | 合格条件 |
| --- | --- | --- |
| T01 | AでWeb/Mobileへログインし、同一ユーザーであることを確認 | 初期移行の案内を確認してから進め、別ユーザーのデータを混ぜない |
| T02 | Webで期限/優先度/タグ/サブタスク付きタスクを作り、Mobileで編集してWebへ戻る | 双方向で値が一致。複製・欠落・古い値への巻戻りがない |
| T03 | Mobileで習慣作成/達成/メモ、Webでメモ修正/休息日操作 | 両端で当日記録・統計・休息日が一致し、通常操作が維持される |
| T04 | Webだけオフラインで追加/編集→復帰。次にMobileだけオフラインで同様に操作 | 待機/再試行表示が正しく、復帰後に相手へ一度ずつ反映される |
| T05 | 未送信操作を残して専用アプリを終了し再起動→ネットワーク復帰 | 未送信データが残り、元の所有者として送信・収束する。単なるメモリ再描画で代替しない |
| T06 | Aの未送信操作/開いた下書きがある状態でログアウト→B。再びAへ戻る | BへAの表示/編集/送信/報酬が混入しない。Aへ戻ると正しい対象で復帰する |
| T07 | タスク達成・宝箱開封・合成・戦闘を1回ずつ確認し、再起動/両端同期/提供された再試行を行う | XP・装備・宝箱・進行・統計が同じ操作で増殖しない。受信済み操作を新規作成して再送しない |
| T08 | 通常復帰、長めの切断、ログイン期限切れ/再ログインの案内から復帰 | 古い応答/別ユーザーの結果を適用せず、操作可能な状態へ戻る。期限切れを再現できなければ未実行のまま |

この8項目はまずiOS SimulatorとWebで行う。Android UI/実機、通知/Apple等の確認を含めた
全体の④/⑤完了条件ではない。T07でサーバー成功後の応答喪失を実環境で再現しなかった場合は、
「再起動/再試行の実操作のみ確認、応答喪失はローカルDB統合試験の範囲」と記す。

### 記録のひな形

```text
対象SHA / 日時 / 担当:
G0 管理者の環境確認: 未確認 / 確認済み（確認先は非公開記録）
事前診断: blocked / configuration-consistent
G1 実接続先・保存領域確認: 未確認 / 確認済み
Webのブラウザ / MobileのOS・端末・variant:
検証アカウント: A / B（実メール・パスワード・tokenは記録しない）
T01〜T08: 各IDに 未実行 / blocked / pass / fail
各結果の実測: 操作前後の値、両端の一致、再現手順、匿名化済み画像
実行できなかった条件:
不具合Issue:
総合判定: 未実行 / blocked / fail / pass（実行した範囲を必ず併記）
```

HAR/Networkログをそのまま添付しない。Authorization、cookie、APIキー、refresh token、
メールアドレス、ユーザーIDなどを除去する。確認済みテストデータの後片付けも、対象/担当を決め、
削除は別途承認を受けて行う。`db reset`/truncate/アカウント一括削除は使わない。

## 現在の確認結果と次の入口

G0: **blocked**（検証用環境の有無・用途・アクセスが未確認）。G1/T01〜T08: **未実行**。
次は管理者が[Supabase管理画面](https://supabase.com/dashboard)でログインし、
Life Questのプロジェクト一覧から「検証用があるか」を確認する。存在や用途が不明なら
作成/ログイン先を推測せず、ここで相談する。秘密値をチャットへ送る必要はない。

環境が確認できたらG0→事前診断→G1→T01〜T08の順で進め、不具合だけを別PRで修正する。
このPRではアプリUI/DB/API/報酬計算/既存保存形式を変更せず、比較画像も更新しない。

## この準備実装の検証

- 診断の単体37件と既存のローカル同期runner19件、計56件成功。
  不足/他ref/ローカルURL/秘密キー/fixture/通常版・preview/不正引数/出力の値非表示/CLI終了コードを確認。
- 全体3,265件成功/98件skip、core単独770件成功。Web/Mobile/core型検査とcheck:secrets成功。
- 未設定の作業環境は`blocked`/終了コード1。空欄の見本でも診断は通らない。
  `configuration-consistent`の成功経路は架空の値だけで単体検証し、実キーや実ユーザーを使用していない。
- アプリUI・通常の起動スクリプト・CIワークフロー・DB処理は変更しない。
  PR後は既存CI3ジョブとGPT-6.1 Sol・中の独立レビューを確認し、マージしない。

## 参照した一次資料

- [Viteの環境変数優先順位](https://vite.dev/guide/env-and-mode): 既存process.envが.envより優先。
- [Expoの環境変数](https://docs.expo.dev/guides/environment-variables/): `.env`自動読込停止とクライアント組込み停止は別の設定。
- [SupabaseのAPIキー](https://supabase.com/docs/guides/getting-started/api-keys): クライアントへは公開キーを使い、管理者キーは渡さない。
