# WebのHTTPレスポンス保護（2026-10-31 / #875）

セキュリティ残件 [#871](https://github.com/YuTakane256/Life-Quest/issues/871) のうち、
ブラウザに効かないHTML内の指定だけになっていた埋め込み防止・機能制限をHTTPヘッダーへ移す。
ローカル開発/previewと出力物を確認した記録で、実配信先への設定・公開は行っていない。

## 問題と変更

`frame-ancestors`はHTMLのCSP meta内では無効で、`Permissions-Policy`もHTTPレスポンスの指定が必要。
文字列がHTMLに存在するテストだけでは保護が有効だと確認できなかった。

[共通の方針](../src/config/webSecurityPolicy.ts)と[Viteプラグイン](../scripts/web-security-headers.ts)で、
開発・preview・継承するstaging設定に次のヘッダーを返す。

| HTTPヘッダー | 設定・目的 |
| --- | --- |
| Content-Security-Policy | `frame-ancestors 'none'`。他サイト・同一サイトのiframe等への埋め込みを拒否 |
| X-Frame-Options | `DENY`。旧ブラウザ向けにも埋め込みを拒否 |
| Permissions-Policy | カメラ・マイク・位置情報・決済・USB・clipboard-readを拒否。clipboard-writeは同一originに限定 |
| X-Content-Type-Options | `nosniff`。応答のMIME typeをブラウザが別用途へ推測しないよう指定 |
| Referrer-Policy | `strict-origin-when-cross-origin`。従来のmetaと同じ方針 |

script/connect-src等の既存CSPはHTMLに維持し、設定されたSupabaseのHTTPS/WSS originだけを許可する。
追加のHTTP CSPはframe-ancestorsだけを担当する。HTMLとHTTPのCSPは両方適用されるため、既存の制約を広げない。
HTMLからは無効なframe-ancestors・Permissions-Policy指定を除き、テストもHTTPでの有効性と区別した。
OAuthのpopupや通常のURL移動を禁止する指定は追加しない。アプリをiframeに埋め込む利用は拒否し、通常のURLで開く。

ビルドは同じ方針を`dist/_headers`へ出力する。内容は固定の制限だけで、接続先・環境値・秘密値を含めない。
Service Workerのプリキャッシュ対象は既存の拡張子のままなので、この配信用設定はプリキャッシュしない。

## 検証

- 修正前は、実際のHTTP応答のヘッダー検査が失敗した。
- [7ケースの自動回帰](../scripts/web-security-headers.test.mjs)で、実Vite dev/previewのHTTP応答とSPAルート、
  静的ホスト用ファイル、標準/staging設定の両サーバーへの適用を確認。
- [ブラウザ回帰](../e2e/security-headers.spec.ts)はDesktop/Mobile Chromiumで開発4件、
  実ビルドのpreview4件が成功。通常のタスク表示と設定URLのヘッダー、ブラウザのカメラ/マイク/位置情報拒否・同一originコピー許可を確認。
  実際の権限要求・機器起動・クリップボード読書きは行わない。
- 埋め込みは別ポートのloopbackサーバーを親とし、ヘッダーなしの対照ページが表示されることを先に確認。
  対照を外した実アプリ応答ではブラウザが拒否し、アプリのDOMが表示されない。
  外部DNS・サイトへアクセスせず、Private Network Accessによる拒否と混同しない。
- 全体3,464成功 / 98 skip、Web/Mobile型検査、Lintエラー0（既存警告6）、secrets、Web/PWAビルド成功。

画面構成を変更しないため比較画像は追加しない。DB/API/RLS・認証処理・保存形式・画像素材・
stagingのアカウント/データ/設定・MobileのOS権限は変更していない。

## 実配信先に残る確認

`_headers`に対応する静的ホストでは、ファイルをビルド出力の直下へ含めて配信する。
対応しないホスト、Functions/SSR等で独自に応答する経路では、管理画面やWebサーバー側へ同じヘッダーを設定する必要がある。
ファイルの存在だけで実配信が保護されたとはしない。Vite previewは製品ビルドのローカル確認に使い、本番配信サーバーとして採用しない。

公開前には実URLのタスク・設定等のSPAルート、アセット、再読込/Service Workerからの応答も含め、
ヘッダーと通常操作・iframe拒否を確認する。ホスト側の既存CSPやヘッダーも合わせて確認する。
今回の実ブラウザ確認はChromiumで、Safari/Firefox・本番CDNでの合格ではない。ブラウザによってPermissions-Policyの対応範囲も異なる。

依存のHigh 6件・Low等の警告は今回の変更では減っていない。管理者MFA・Supabase実設定・監視/復旧等も#871の残項目。
通常CI成功を安全性全体の認定とはせず、計画④を継続する。

一次資料:
[MDN frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors)、
[Permissions-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy)、
[Vite server headers](https://vite.dev/config/server-options#server-headers)、[preview headers](https://vite.dev/config/preview-options#preview-headers)、
[Cloudflare Pages headers](https://developers.cloudflare.com/pages/configuration/headers/)、
[Netlify custom headers](https://docs.netlify.com/manage/routing/headers/)。
