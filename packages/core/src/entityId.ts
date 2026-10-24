let fallbackCounter = 0;

/** Database entity IDs are UUIDs. This is an identifier, never an authentication secret. */
export function createEntityId(): string {
    const cryptoApi = globalThis.crypto;
    try { if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID(); }
    catch { /* Older browser/native runtimes may expose an unavailable implementation. */ }
    const bytes = new Uint8Array(16);
    let filled = false;
    try {
        if (cryptoApi?.getRandomValues) { cryptoApi.getRandomValues(bytes); filled = true; }
    } catch { /* Preserve offline/local use without Web Crypto. */ }
    if (!filled) {
        // Timestamp + counter retain uniqueness within this runtime, including fixed random sources.
        let timestamp = Date.now();
        for (let index = 5; index >= 0; index--) { bytes[index] = timestamp % 256; timestamp = Math.floor(timestamp / 256); }
        for (let index = 6; index < 12; index++) {
            try { bytes[index] = Math.floor(Math.random() * 256); } catch { bytes[index] = 0; }
        }
        fallbackCounter = (fallbackCounter + 1) >>> 0;
        for (let index = 0; index < 4; index++) bytes[15 - index] = (fallbackCounter >>> (index * 8)) & 255;
    }
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
