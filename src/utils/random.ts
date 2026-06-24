/**
 * 配列からランダムに1要素を返す。空配列なら undefined。
 */
const UINT32_RANGE = 0x100000000;

function getCryptoRandomIndex(length: number): number | null {
    const cryptoApi = globalThis.crypto;
    if (!cryptoApi?.getRandomValues) return null;

    const limit = UINT32_RANGE - (UINT32_RANGE % length);
    const value = new Uint32Array(1);

    do {
        cryptoApi.getRandomValues(value);
    } while (value[0] >= limit);

    return value[0] % length;
}

function getMathRandomIndex(length: number): number {
    const index = Math.floor(Math.random() * length);
    return Math.min(length - 1, Math.max(0, index));
}

export function pickRandom<T>(arr: readonly T[]): T | undefined {
    if (arr.length === 0) return undefined;
    const index = getCryptoRandomIndex(arr.length) ?? getMathRandomIndex(arr.length);
    return arr[index];
}
