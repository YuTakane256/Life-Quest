import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { isSameOriginImageRequest } from './src/config/pwaCache'

// https://vite.dev/config/
export default defineConfig({
    plugins: [
        react(),
        tailwindcss(),
        VitePWA({
            // 新しいService Workerを自動で適用する
            registerType: 'autoUpdate',
            includeAssets: ['favicon.png', 'apple-touch-icon.png'],
            manifest: {
                name: 'Life Quest - RPGタスク管理',
                short_name: 'Life Quest',
                description: 'タスクや習慣をこなしてキャラクターを育てるRPG風タスク管理アプリ',
                lang: 'ja',
                start_url: '/',
                scope: '/',
                display: 'standalone',
                orientation: 'portrait',
                theme_color: '#0f0f1a',
                background_color: '#0f0f1a',
                icons: [
                    { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
                    { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
                    { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
                ],
            },
            workbox: {
                cleanupOutdatedCaches: true,
                // アプリシェル（JS/CSS/HTML/フォント）をプリキャッシュしてオフライン起動を可能にする
                globPatterns: ['**/*.{js,css,html,woff2}'],
                // 大量の画像アセットは初回利用時にキャッシュする（プリキャッシュ肥大化を回避）
                runtimeCaching: [
                    {
                        urlPattern: isSameOriginImageRequest,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'image-assets',
                            cacheableResponse: {
                                statuses: [200],
                            },
                            expiration: {
                                maxEntries: 200,
                                maxAgeSeconds: 60 * 60 * 24 * 30, // 30日
                                purgeOnQuotaError: true,
                            },
                        },
                    },
                ],
            },
        }),
    ],
})
