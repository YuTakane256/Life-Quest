export const PWA_APP_SHELL_GLOB_PATTERNS = ['**/*.{js,css,html,woff2}'] as const

export const PWA_IMAGE_CACHE_BUDGET = {
    cacheName: 'image-assets',
    maxEntries: 200,
    maxAgeSeconds: 60 * 60 * 24 * 30,
} as const

export function isSameOriginImageRequest({ request, url }: { request: Request; url: URL }): boolean {
    const appOrigin = globalThis.location?.origin
    return typeof appOrigin === 'string'
        && request.destination === 'image'
        && url.origin === appOrigin
}
