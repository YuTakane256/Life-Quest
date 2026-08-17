# メール認証のリダイレクト設定

ローカル Supabase は `supabase/config.toml` で次の URL だけを許可する。

- `http://localhost:5173/settings`
- `http://127.0.0.1:5173/settings`
- `lifequest://settings`

Web のメール確認は `?auth=verify`、パスワード再設定は `?auth=recovery` に戻る。Mobile のパスワード再設定は `lifequest://settings?auth=recovery&type=recovery&code=...` の PKCE コードだけを交換する。URL 内の access token / refresh token は受け入れない。

本番公開前には、登録する本番 Web URL を Supabase Auth の Redirect URLs に追加する。Mobile はカスタムスキームだけで公開しない。Universal Links（iOS）と Android App Links のドメイン所有検証を構成し、メールリンクが検証済みアプリへ直接届くことを確認してからストアへ提出する。
