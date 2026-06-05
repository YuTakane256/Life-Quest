/**
 * 配列からランダムに1要素を返す。空配列なら undefined。
 */
export function pickRandom<T>(arr: readonly T[]): T | undefined {
    if (arr.length === 0) return undefined;
    return arr[Math.floor(Math.random() * arr.length)];
}
