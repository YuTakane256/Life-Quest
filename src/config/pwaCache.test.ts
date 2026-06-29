import { describe, expect, it } from 'vitest'
import { isSameOriginImageRequest } from './pwaCache'

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
