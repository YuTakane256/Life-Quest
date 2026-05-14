# 🌟 Life Quest — Gamified Productivity App

> **タスク管理 × RPGゲーム** をかけ合わせた、モチベーション継続型の生産性向上アプリ

[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/TailwindCSS-4-38B2AC?logo=tailwind-css)](https://tailwindcss.com/)
[![Zustand](https://img.shields.io/badge/Zustand-5-orange)](https://zustand-demo.pmnd.rs/)

---

## 📖 概要

**Life Quest** は、日常のタスクや習慣管理をRPGゲームの要素と組み合わせることで、タスク完了へのモチベーションを継続的に高めるWebアプリです。

タスクを消化するたびにキャラクターが成長し、宝箱から装備品を獲得。レベルアップしながらステージを攻略していくゲーム体験を通じて、**「やらなきゃいけない」を「やりたい」に変える**ことを目指しています。

---

## ✨ 主な機能

### 🗒️ タスク管理
- タスクの追加 / 編集 / 削除
- 優先度設定（高 / 中 / 低）と期限管理
- タグによるフィルタリング
- 完了時のアンドゥ機能（誤操作防止）

### 🔁 ハビット（習慣）管理
- 毎日・毎週単位のルーティン管理
- 連続達成ストリーク記録
- 週次サマリー表示

### ⚔️ キャラクター & バトルシステム
- タスク完了でXP獲得 → レベルアップ（上限なし、Lv.999まで成長）
- 武器・防具・アクセサリーの装備システム
- ガチャシステム（タスク消化数に応じて宝箱を獲得）
- アイテム売却・合成機能
- **3エリア × 30ステージ**（草原 / 古城 / 天界）のマップバトル

### 📊 統計
- XP推移グラフ
- タスク完了率の可視化

---

## 🏗️ 技術スタック

| カテゴリ | 技術 |
|---|---|
| フレームワーク | React 19 |
| 言語 | TypeScript 5.7 |
| ビルドツール | Vite 6 |
| スタイリング | Tailwind CSS 4 |
| 状態管理 | Zustand 5 |
| ルーティング | React Router DOM 7 |
| アイコン | Lucide React |

---

## 🗂️ ディレクトリ構成

```
src/
├── assets/         # 画像アセット（キャラクター・敵・背景・装備品）
├── components/     # 再利用可能なUIコンポーネント
│   ├── layout/    # BottomNav など
│   └── ui/        # SnackbarProvider など
├── config/         # ゲームの各種パラメータ設定（XP・ステージ・ガチャなど）
├── pages/          # 各画面
│   ├── TasksPage.tsx
│   ├── HabitsPage.tsx
│   ├── CharacterPage.tsx
│   ├── MapBattlePage.tsx
│   └── StatsPage.tsx
├── stores/         # Zustand によるグローバル状態管理
│   ├── useGameStore.ts   # キャラクター・バトル・インベントリ
│   ├── useTaskStore.ts   # タスク管理
│   └── useHabitStore.ts  # ハビット管理
├── types/          # TypeScript 型定義
└── utils/          # 日付処理などのユーティリティ
```

---

## 🚀 ローカル起動方法

```bash
# リポジトリのクローン
git clone https://github.com/YuTakane256/Life-Quest.git
cd Life-Quest

# 依存パッケージのインストール
npm install

# 開発サーバーの起動
npm run dev
```

ブラウザで `http://localhost:5173` を開いてください。
---

## Github周り

```bash
# メインブランチに切り替え
git checkout main

# リモートのリポジトリから最新の変更を取り込む
git pull origin main

# 新しい機能ブランチを作成して切り替え
# ブランチ名は「feat/issue-number-description」のようにすると分かりやすいです
git checkout -b feat/2-deep-sea-map

# 変更

# 追加された画像ファイルなどを確認
git status

# 全ての変更をステージング（または個別にファイルを指定）
git add .

# コミットメッセージを作成（Issue番号を含めるとGitHub上で紐付きます）
git commit -m "feat: マップ4「深海エリア」の背景と敵キャラ画像を追加 #2"

# 作成したブランチをリモートにプッシュ
git push origin feat/2-deep-sea-map

```

---

### コミットメッセージの規則

| プレフィックス | 意味 |
|---|---|
| `feat:` | 新機能の追加 |
| `fix:` | バグ修正 |
| `docs:` | ドキュメントの変更 |
| `style:` | UIやコードスタイルの調整 |
| `refactor:` | リファクタリング |
| `chore:` | 設定ファイルや依存関係の更新 |
