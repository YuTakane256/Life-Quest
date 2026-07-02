import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Vitest 専用設定。本番ビルド用の vite.config.ts は PWA プラグインを含んで
// テストには不要なので、ここで最小構成だけ用意する。
export default defineConfig({
    plugins: [react()],
    test: {
        // ストアテストで localStorage / window が必要になるので jsdom を既定にする
        environment: 'jsdom',
        globals: false,
        include: [
            'src/**/*.test.ts',
            'src/**/*.test.tsx',
            'packages/**/*.test.ts',
            'apps/mobile/**/*.test.ts',
        ],
        // 各テストで同じ store インスタンスを共有しないよう isolate を有効化
        isolate: true,
    },
});
