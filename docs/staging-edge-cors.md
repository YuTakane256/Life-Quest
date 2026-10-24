# stagingへの反映とWeb通信の事前確認（#821）

計画④ / #699。2026-10-24に、新規作成した専用の `life-quest-staging` に現行mainの
DB変更17件とEdge Functions14件を反映した。反映前のpublicテーブル数は0件だった。
DB reset、seed投入、既存データの一括削除、Auth設定・有料プランの変更はしていない。

## 見つかった問題と修正

反映直後の `complete_task` は、ブラウザのOPTIONSに405を返し、CORSヘッダーがなかった。
WebはJSON・Authorization・apikeyを付けて別originへPOSTするため、本送信前の確認が失敗する。

共通ハンドラでOPTIONSに204を返し、POSTとクライアントで使う4ヘッダーを許可する。
成功・認証失敗・JSON不正・DB競合・内部エラーのJSON応答にも同じCORSヘッダーを付ける。
Cookie認証やcredentialsは許可しない。POSTのJWT検証と、JWTからの所有者導出は維持する。
RLS・RPC・報酬計算・クライアントの送信内容は変更しない。

[Supabase公式のCORS手順](https://supabase.com/docs/guides/functions/cors)に沿って、
既存の共通ハンドラへ手動でヘッダーとOPTIONS処理を追加する。

## 確認結果（2026-10-24）

| 対象 | 確認した結果 |
| --- | --- |
| DB適用履歴 | 17件 |
| publicテーブル | 15件すべてRLS有効。anonのSELECT権限・authenticatedの直接INSERT権限があるテーブルは0件 |
| Edge Functions | 共通ハンドラを使う14件すべてACTIVE、version 2、gatewayのJWT検証有効 |
| stagingへのHTTP OPTIONS | 14件すべて204。origin、POST、authorization / apikey / content-type / x-client-infoの許可を確認 |
| stagingへの認証なしPOST | 14件すべて401。業務操作は実行しない |
| Chromiumからのクロスオリジンfetch | ローカルoriginから無効なテスト用JWT・キーで送信し、401とJSONの認証エラーをブラウザで読み取れた |
| 単体回帰 | `supabase/integration/edge-cors.test.ts` の14件。事前確認が認証・service client・業務処理を呼ばないことと、各成功/失敗応答を確認 |

HTTP確認の対象：`claim_habit_bonus`、`claim_login_bonus`、`complete_subtask`、`complete_task`、
`delete_account`、`import_mobile_content`、`import_snapshot`、`open_chest`、
`record_apple_authorization`、`record_apple_refresh_token`、`resolve_battle_attempt`、
`sell_item`、`start_battle_attempt`、`synthesize_items`。

このPRの修正版は専用stagingへ先行反映した。アプリの本番環境への反映やPRのマージはしていない。

## 次に確認すること

ここまでの結果は、DB・サーバー処理の配置、アクセス制限、ブラウザの通信経路の確認である。
有効なユーザーJWTでの業務処理成功、Web/Mobileへの接続設定、二アカウントでの双方向同期、
オフライン復帰・再起動・アカウント切替の実操作は未確認。テストアカウントは作成していない。
Apple用Secretsと実機での認可失効・再同意も未確認のまま残す。

ローカルDockerは停止中だったため、この作業ではローカルpgTAP・実DB/Edge統合を実行していない。
それらはPRの既存CI `supabase` で別に確認し、クラウドの限定的なHTTP確認と混同しない。
実際の利用条件を満たすまで計画④完了とは扱わない。
