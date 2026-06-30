import { describe, expect, it } from 'vitest'
import {
    isSameOriginImageRequest,
    PWA_APP_SHELL_GLOB_PATTERNS,
    PWA_IMAGE_CACHE_BUDGET,
} from './pwaCache'

function request(destination: RequestDestination): Request {
    return { destination } as Request
}

describe('isSameOriginImageRequest', () => {
    it('同一オリジンの画像だけをキャッシュ対象にする', () => {
        const origin = globalThis.location.origin

        expect(isSameOriginImageRequest({
            request: request('image'),
            url: new URL('/assets/item.png', origin),
        })).toBe(true)
        expect(isSameOriginImageRequest({
            request: request('image'),
            url: new URL('https://cdn.example.com/item.png'),
        })).toBe(false)
    })

    it('同一オリジンでも画像以外は対象にしない', () => {
        expect(isSameOriginImageRequest({
            request: request('script'),
            url: new URL('/assets/app.js', globalThis.location.origin),
        })).toBe(false)
    })
})

describe('PWA cache budgets', () => {
    it('keeps large image files out of the app-shell precache', () => {
        expect(PWA_APP_SHELL_GLOB_PATTERNS).toEqual(['**/*.{js,css,html,woff2}'])
        expect(PWA_APP_SHELL_GLOB_PATTERNS.join(',')).not.toMatch(/png|jpe?g|webp|gif|svg/)
    })

    it('keeps runtime image cache bounded', () => {
        expect(PWA_IMAGE_CACHE_BUDGET).toEqual({
            cacheName: 'image-assets',
            maxEntries: 200,
            maxAgeSeconds: 2_592_000,
        })
        expect(PWA_IMAGE_CACHE_BUDGET.maxEntries).toBeLessThanOrEqual(200)
        expect(PWA_IMAGE_CACHE_BUDGET.maxAgeSeconds).toBeLessThanOrEqual(60 * 60 * 24 * 30)
    })
})
