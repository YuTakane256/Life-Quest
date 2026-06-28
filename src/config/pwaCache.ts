export function isSameOriginImageRequest({ request, url }: { request: Request; url: URL }): boolean {
    const appOrigin = globalThis.location?.origin
    return typeof appOrigin === 'string'
        && request.destination === 'image'
        && url.origin === appOrigin
}
