# 検証用Supabaseの稼働確認と停止予告（2026-11-07）

計画④ / #699・#951。#950マージ後のmain `5461205e`を基準とする。実環境確認を始める前の準備であり、T01〜T08や実回線断/再起動の合格ではない。

## 停止予告の意味

Supabaseは、無料プランで十分な活動がないプロジェクトを一時停止する。停止中はその環境を使うログイン/同期等の検証ができないが、リポジトリのコード編集・通常CIのローカルDB検証とは独立している。最近のCI成功をstagingの利用実績とは扱わない。

停止予告を受けても、自動で課金プランを変更しない。停止した場合はSupabaseダッシュボードで対象プロジェクトを確認し、復帰可能期間内にResume projectを使う。2026-11-07に確認した[公式の停止説明](https://supabase.com/docs/guides/platform/free-project-pausing)は復帰可能期間を1年と記載している一方、今回の個別メールには90日とある。今回の運用では短い90日を基準にし、長期間放置せず、最新の個別通知/ダッシュボードの条件を確認する。コマンドには復帰期限や自動復帰を実装しない。

## 2種類の確認を区別する

| コマンド | 調べること | 通信 |
| --- | --- | --- |
| `npm run sync:staging:check` | 渡されたprocess.envの設定整合性 | なし（従来どおり） |
| `npm run sync:staging:health` | 専用設定のAuth healthがHTTP 200を返すか | 単発GET 1回、最大8秒 |

healthはリポジトリの`.staging-sync.local`だけを読み、既存stagingランチャーと同じ許可キー・接続先・公開キー・parity/fixture無効の検証を通す。継承したVITE/EXPO/SUPABASE環境変数や管理者トークンを設定に混ぜない。ファイルの作成/変更や、CLIアカウントへのログインは行わない。

```bash
npm run sync:staging:health
npm run sync:staging:health -- --json
npm run sync:staging:health -- --help
```

[Supabase公式のhealth endpoint説明](https://supabase.com/kb/troubleshooting/how-do-i-check-gotrueapi-version-of-a-supabase-project-lQAnOR)に基づき、`/auth/v1/health`へ公開apikeyを付けてGETする。Authorization/ユーザーセッション/Cookie/リクエスト本文は送らない。redirectを許可しない。DB/RPC/Edge業務操作、ユーザー作成/削除、停止解除、プラン変更、サーバー起動や定期keepaliveは行わない。

## 結果の読み方

- `auth-endpoint-reachable` / 終了0: HTTP 200を確認した時点のAuth endpointへの到達性だけが成功。
- `configuration-blocked` / 終了1: 専用ファイルの不足/不一致等。通信前に停止。
- `access-rejected` / 終了1: HTTP 401/403。公開キー/接続先を確認。
- `unavailable` / 終了1: その他のHTTPやDNS/TLS等の通信失敗。503だけで「プロジェクト停止」と断定しない。ダッシュボードと通信状態を確認。
- `timed-out` / 終了1: 8秒以内に応答しない。再試行は自動で行わない。

URL/ref/キー・レスポンス本文・生例外は出力しない。応答本文を読み取らず接続を解放する。HTTP 200でもDB/RLS/Edge・ログイン・双方向同期、停止理由/停止予定/復帰期限は未確認として返す。healthへの1回のアクセスが、無料プランの自動停止を防ぐ活動として十分だとも保証しない。

## 検証と今回の実測

[新コマンドの回帰27件](../scripts/check-staging-health.test.mjs)と既存の事前診断/起動60件、計87件が成功。接続前拒否・単発GET/redirect禁止・HTTP/生例外の秘匿・abortを無視する未応答でも8秒で終了・後着応答・本文cancelの待機防止・CLI終了コード/JSON/help・継承設定を混ぜないことを検証する。単体テストはfetchをスタブにし、実プロジェクトへ接続しない。

2026-11-07、既存の専用staging設定でこのコマンドを1回実行し、`auth-endpoint-reachable / HTTP 200`を確認した。公開キーだけを使うhealth確認であり、個人/テストアカウントへのログインや業務データ操作、停止予定の管理API照会の成功は含めない。通常のSupabase CLIの一覧照会は応答待ちとなったため取りやめており、その結果による管理状態の認定はしていない。

全体テスト・型検査・Lint・secrets・ビルド・PR後の独立レビュー/CI3件の確定結果はPR/Issueへ記録する。既存CIはローカルの一時DBを使い、新コマンドで実stagingを自動照会するようにはしない。

## 範囲

通常アプリの画面・DB/RLS/API・保存形式・報酬計算・依存を変更しない。承認済みA/B・利用データを変更せず、OS/Simulator/Dockerの起動/設定変更、停止解除/課金/デプロイ/配布/マージは行わない。④継続、⑤未開始。画面構成に変更がないため比較画像は追加しない。
