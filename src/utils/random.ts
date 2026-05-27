/**
 * 配列からランダムに1要素を選ぶ。
 * 空配列の場合は undefined を返す（呼び出し側で長さチェックを省ける）。
 */
export function pickRandom<T>(arr: readonly T[]): T | undefined {
    if (arr.length === 0) return undefined;
    return arr[Math.floor(Math.random() * arr.length)];
}
