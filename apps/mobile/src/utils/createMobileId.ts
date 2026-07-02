/** crypto.randomUUID が使える環境ではUUIDを、無ければ時刻+乱数のIDを返す。 */
export function createMobileId(): string {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
