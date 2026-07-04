# ADR-007: Edge Function内の認可設計

- 状態: 承認済み
- 関連Issue: #502・#503・#511

## 決定

1. **Edge Functionはリクエストボディの `user_id` を一切信用しない。** `Authorization` ヘッダーのJWTを検証し、`sub` クレームから導出した `user_id` のみを内部処理で使用する。ボディに `user_id` が含まれていても無視する。
2. **Edge Functionはservice roleキーで接続するためRLSが適用されない（RLSを迂回する前提で設計する）。** したがって全クエリに明示的な `where user_id = $verifiedUserId` を書き、所有者検証をアプリケーションコードの責務とする。「RLSがあるから安全」という前提を持ち込まない。
3. service roleキーはEdge Function実行環境・CIのシークレットにのみ置き、クライアントバンドルには一切含めない（ビルド成果物の検査を#500で導入）。
4. Web/Expo双方は、Edge Function呼び出し時にセッションの `access_token` を `Authorization: Bearer` で転送する薄いラッパーを経由する（#503）。トークン失効時はリフレッシュ後に再試行する。

## テスト方針

- ボディに他人の `user_id` を混入させてもJWT由来のuser_idのみが使われることの直接テスト
- **RLSを意図的に無効化した状態でも、Edge Function内の所有者検証だけで他人リソースへのアクセスが拒否される**ことを確認する変種テスト（「RLSが効いているから緑」という誤った合格を防ぐ）
