# Life Quest Mobile

Expo SDK 56 と Expo Router を使うモバイルアプリです。Web版と同じnpm workspaceに置き、`@life-quest/core`のタスクモデルを共有します。タスクはAsyncStorageへ端末内保存されます。

```bash
npm install
npm run mobile:typecheck
npm run mobile:start
```

起動後、Expo GoでQRコードを読み取るか、`i` / `a`キーでシミュレータを開きます。
