/**
 * pull_sync_batch を消化するクライアント側の共有ロジック（ADR-008、#511）。
 *
 * - `has_more == false` になるまで繰り返し呼び、各バッチ適用後に
 *   カーソルを `next_cursor` にのみ前進させる（テーブル別の独立消化はしない）
 * - カーソルの保存はストレージ注入（user_id別namespace、ADR-009）
 * - 同時実行はコアレスされ、実行中の再要求は完了後にもう1周する
 */

export interface PullBatch {
    next_cursor: number;
    has_more: boolean;
    [table: string]: unknown;
}

export interface CloudPullDeps {
    /** pull_sync_batch(after_version, max_versions) の呼び出し */
    fetchBatch: (afterVersion: number, maxVersions: number) => Promise<PullBatch>;
    /** バッチをストアへ適用する（テーブルごとの行配列を受ける） */
    applyBatch: (batch: PullBatch) => void | Promise<void>;
    /** カーソルの読み書き（user_id別namespaceキーに対して） */
    readCursor: () => Promise<number>;
    writeCursor: (cursor: number) => Promise<void>;
    maxVersionsPerBatch?: number;
}

export interface CloudPullRunner {
    /** 差分プルを1周（has_moreが尽きるまで）実行する。多重要求はコアレスされる。 */
    requestPull: () => void;
    /** 実行中のプルが終わるまで待つ（テスト・明示フラッシュ用） */
    flush: () => Promise<void>;
}

export function createCloudPullRunner(deps: CloudPullDeps): CloudPullRunner {
    const maxVersions = deps.maxVersionsPerBatch ?? 200;
    let running: Promise<void> | null = null;
    let dirty = false;

    const pullLoop = async (): Promise<void> => {
        let cursor = await deps.readCursor();
        for (;;) {
            const batch = await deps.fetchBatch(cursor, maxVersions);
            await deps.applyBatch(batch);
            // カーソルは「実際に返って適用したバッチのnext_cursor」にのみ前進させる
            //（ADR-005: 独立クエリでの前進は取りこぼしの温床になるため禁止）
            if (batch.next_cursor > cursor) {
                cursor = batch.next_cursor;
                await deps.writeCursor(cursor);
            }
            if (!batch.has_more) break;
        }
    };

    const run = (): Promise<void> => {
        if (running) {
            dirty = true;
            return running;
        }
        running = (async () => {
            try {
                do {
                    dirty = false;
                    await pullLoop();
                } while (dirty);
            } finally {
                running = null;
            }
        })();
        return running;
    };

    return {
        requestPull: () => { void run(); },
        flush: () => run(),
    };
}

/** user_id別namespaceのキー（ADR-009） */
export function cloudCursorKey(userId: string): string {
    return `life-quest:cloud:${userId}:cursor:v1`;
}

export function cloudOutboxKey(userId: string): string {
    return `life-quest:cloud:${userId}:outbox:v1`;
}
