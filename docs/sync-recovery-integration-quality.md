# 双方向同期・オフライン復帰・再起動相当の統合確認（#747）

## この変更の位置づけ

計画④ / #699 / #507。認証境界の単体回帰に加え、本番共有のoutbox controller・
所有者固定RPC adapter・Edge invoker・pull runner・cache変換/保存/復元を
ローカルSupabaseの実HTTP・DB・Edge Functionにつなぐ。アプリの挙動・DB・
報酬量・保存形式・画面は変更しない。既存保存データの初期化はしない。

テスト上の「Web/Mobile」は別のSupabase SDKインスタンス・別保存領域を持つクライアント。
パスワードログインはfixtureごとに1回だけ行い、その一時的なセッションを各SDKへsetSessionする。
復元時に追加ログインを連打せず、既存統合試験と合わせても認証レート制限を圧迫しない。
JWT/refresh tokenはテストのメモリ内のみで保持し、保存キューへは入れない。
ネイティブUI/ブラウザ画面そのもの、localStorage/AsyncStorageの実保存ではない。
ネットワーク断/応答喪失はfetch境界で注入し、保存領域は同じMapを新しいクライアントへ渡して
プロセス再起動相当のloadを検証する。実端末の強制終了成功の証拠とは区別する。

## 新しい実DB回帰

`supabase/integration/sync-recovery.test.ts`：

1. Webのオフライン作成→Mobile、Mobileのオフライン編集→Web。
   タスクの期限/優先度/繰り返し/タグ/サブタスクを含めて収束する。
2. 習慣・達成記録・メモ・休息日・設定をオフライン作成し、復帰後に別クライアントへ反映。
   逆方向の記録/メモの修正も反映する。
3. cache/cursor/削除待ちqueueを保存した状態から別インスタンスを作る。
   通信前のcache表示、同一opId、保存済みcursorからの差分取得、削除墓標を確認する。
4. complete_taskのサーバー成功後、応答だけを破棄する。
   5回目の達成で実際にスターター宝箱が生成された後、保存キュー復元後も同じopIdで送信し、
   XP/消化数/宝箱/統計/報酬台帳が増えない。

各テスト専用のユーザーだけを作成・削除する。DB reset/truncateや既存アカウントの削除はしない。
接続先をloopbackに限定し、staging/productionへはこのテストを実行しない。

## 実行と結果の読み分け

```bash
# Docker・認証情報不要。同期/再送/アカウント境界/状態表示をまとめて実行
npm run test:sync:unit

# ローカルSupabase/Edgeと5つの環境変数が必要。境界回帰→全既存DB統合を実行
npm run test:sync

# ローカル実DB統合だけ。CIのsupabaseジョブもこれを使用
npm run test:sync -- --integration
```

必要な変数は `SUPABASE_DB_URL`、`SUPABASE_URL`、`SUPABASE_ANON_KEY`、
`SUPABASE_SERVICE_ROLE_KEY`、`SUPABASE_FUNCTIONS_URL`。
DockerでローカルSupabaseとEdgeを起動し、CLIのローカル環境情報から設定する。
CIでは既存の起動・準備手順から設定する。キーをREADME・ログ・公開環境変数へ貼らない。

runnerは不足した変数名だけを表示し、秘密値/接続文字列は表示しない。
DB/API/FunctionsのloopbackとAPI origin/経路の一致を検査し、外部URL・
DBの接続先を上書きしうるqueryを拒否する。設定不足をskip成功扱いにしない。
通常の`npm test`は従来どおりDB未設定なら統合試験をskipするため、
DBを含む合格判定には専用コマンドまたはsupabase CIの結果を見る。

既存のRLS侵入、版数、LWW、core/Edge整合、退会等の統合テストを削らず全件実行する。
CIは既存のbuild-and-test / supabase / playwrightの3ジョブを維持する。

## 残る確認

成功してもstaging二アカウントでの実Web/Mobile操作・実SDKの認証復帰、
OSによる停止/起動、実機オフライン切替、Android UI、通知/Apple等の認証確認は未完了。
ローカルでDocker未起動の場合は未実行と明記し、CIの実DB検証結果と分けて記録する。
ここで保存するテスト用Mapの復元を、端末ファイルシステムの耐障害性の証明にはしない。
