# stagingへの接続・起動準備（#823 / 計画④ / #699）

## 変更

- `npm run sync:staging:web`：専用設定を検査し、127.0.0.1:4175でWebを起動。
- `npm run sync:staging:mobile`：同じ設定で、parityのMetroをlocalhost:8083で起動。
- 設定はrepoルートの`.staging-sync.local`だけ。見本は[こちら](examples/staging-sync.env.example)。
  公開URLと公開キー等の許可項目だけを受け付ける。アカウントのパスワード・管理者キーは書かない。
- 通常の.envと、親シェルに残った別環境の公開変数・Supabase管理者設定を子へ渡さない。
  ファイル/設定の不足やポート占有は終了コード1。既存設定の上書き・プロセス停止・データ初期化はしない。
  コマンド自体はアカウント/Simulatorの作成・デプロイ・保存領域の消去をしない。
- staging用Webでは専用設定ファイルのHTTP取得も403にする。設定値を案内やエラーへ表示しない。

## 実起動で見つかったCSPの不備

`index.html`の`connect-src 'self'`がSupabase Authへの接続を拒否し、SDKは
`AuthRetryableFetchError: Failed to fetch`を返した。これはCORS修正後でもブラウザ自身が止める問題だった。

Viteの解決済み`VITE_SUPABASE_URL`から、指定したHTTPS originと同じhost/portのWSSだけを
HTMLのCSPへ追加する。ローカルSupabaseはloopbackのHTTP/WSを許可する。
未設定時は従来のselfのみを維持し、不正なURLは値を表示せず起動/buildを失敗させる。
ワイルドカードや全HTTPSの許可は追加しない。script/object/frameなど他の制限も維持する。
devとproduction buildで同じプラグインを使う。

## 2026-10-24の実測範囲

アプリの基準はmain `e5d6bb24`（#822マージ後）。専用設定を新規作成し、権限0600で保存した。
通常利用の.env、既存ブラウザ/Simulatorのデータには触れていない。

| 対象 | 結果 |
| --- | --- |
| 非接続の設定診断 | configuration-consistent |
| Web | 新規Chromium contextで/settingsのログイン画面を表示。JSエラーなし |
| Webの実通信先 | アプリのSupabase clientから指定stagingのAuthへ無効な署名のJWTを送信し、403の認証エラーを読み取れた。CSPによる遮断は解消 |
| 専用設定ファイル | Webでの直接取得は403 |
| ポート競合 | 使用中の4175へ二重起動すると終了コード1。既存のWebは継続 |
| Mobile | 新規の `Life Quest Staging iPhone 18 Pro` / iOS 27.0へ既存parity開発ビルドを配置。Metro8083から起動し、メール・パスワード欄を表示 |
| Mobileの設定 | manifestはparity、parityLocalOnly=false、capture/profileなし。配信JSに指定の公開URL/公開キーが組み込まれていることを値非表示で確認 |

Nativeは起動・設定組込みまでの確認であり、認証後の実リクエスト先や同期成功の証明ではない。
Apple/Googleボタンが表示されても、プロバイダー設定や動作の確認済みを意味しない。
確認後、今回追加した専用Simulatorと2つのサーバーを停止した。既存のSimulatorは停止していない。

## 自動検証

- 起動境界16件、CSP21件、既存の診断37件とshell制限2件、計76件成功。
- 全体3,316件成功/98件skip（`npm test -- --run --maxWorkers=2`）。最初の並列実行では
  Simulator初期起動などと重なった状態で既存UIテスト11件がタイムアウトしたため、追加環境を停止して
  worker数を2に制限し再実行した。テスト内容・タイムアウト値・既存CI設定は変更していない。
- Web/Mobile型検査、通常build、指定staging設定を渡したproduction build、秘密値チェックが成功。
  production HTMLにも指定HTTPS/WSSだけが含まれ、script制限が維持されることを確認した。
- lintはエラー0、既存警告6件。ローカルDocker停止中のため実DB回帰はCIの別結果で確認する。

## 残る確認

検証用A/Bアカウントは未作成。作成承認後、専用stagingに確認済み扱いのテストアカウントを2件だけ作り、
メール通知やプロバイダー設定変更を伴わずにパスワードログインから確認する方針。
資格情報はローカルの非公開領域だけに保存し、チャット・Issue・PR・公開環境変数へは載せない。
これは確認メールの配送・本人のメール所有・OAuthの認証を検証するものではない。

G0のアカウント準備、G1の同一ユーザー確認、[T01〜T08](staging-sync-acceptance.md)は未完了。
DB/認証設定の変更、既存データ消去、ストア/EAS操作、PRマージはしない。

## 参照

- [Vite envDir](https://vite.dev/config/shared-options#envdir)：falseで.env自動読込を無効化。
- [Expo環境変数](https://docs.expo.dev/guides/environment-variables/)：dotenv読込と公開変数の組込みを区別。
- [Supabase admin createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser)：将来の検証専用ユーザー準備。起動コマンドからは呼ばない。
