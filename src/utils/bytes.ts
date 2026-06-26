/**
 * 文字列のバイト長計測ユーティリティ。
 * localStorage の容量見積もりやセーブデータ健全性チェックで利用する。
 */

// TextEncoder はインスタンス生成コストがあるため、初回のみ生成して使い回す。
let sharedEncoder: TextEncoder | null = null;

function getSharedEncoder(): TextEncoder {
    if (!sharedEncoder) {
        sharedEncoder = new TextEncoder();
    }
    return sharedEncoder;
}

/**
 * 文字列を UTF-8 エンコードしたときのバイト数を返す。
 * TextEncoder が利用できない環境では UTF-16 のコードユニット数 × 2 で近似する。
 * TextEncoder の有無は呼び出しのたびに判定するため、実行時の欠落にも追従する。
 */
export function utf8ByteLength(value: string): number {
    if (typeof TextEncoder !== 'undefined') {
        return getSharedEncoder().encode(value).length;
    }
    return value.length * 2;
}
