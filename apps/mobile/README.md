# Life Quest Mobile

Expo SDK 57 と Expo Router を使うモバイルアプリです。Web版と同じnpm workspaceに置き、`@life-quest/core`のタスク・習慣モデルを共有します。データはAsyncStorageへ端末内保存されます。

```bash
npm install
npm run mobile:typecheck
npm run mobile:export
npm run mobile:start
```

起動後、Expo GoでQRコードを読み取るか、`i` / `a`キーでシミュレータを開きます。
`mobile:export` はAndroid向けのMetroバンドルを生成し、CIでも同じコマンドを使って依存解決を検証します。

Web版との主要画面比較用に、macOSローカルでMaestroの匿名スクリーンショットを撮影できます。通常の設定と `ios` scriptは `com.yutakane.lifequest` を使い、`npm run mobile:ios` だけがparity variantとして `com.yutakane.lifequest.parity` のdevelopment buildを起動します。起動後に別ターミナルで `npm run mobile:parity:screenshots` を実行します。詳細は [`docs/mobile-parity-checklist.md`](../../docs/mobile-parity-checklist.md) を参照してください。
