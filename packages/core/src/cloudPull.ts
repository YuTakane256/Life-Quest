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

export interface InsurancePullScheduler {
    /** 定期タイマーを開始する（既に開始済みなら何もしない） */
    start: () => void;
    /** 定期タイマーを停止する（バックグラウンド移行時など） */
    stop: () => void;
    /** トリガ発火（起動・フォアグラウンド復帰・再接続・定期）。短時間の重複は1回にまとめる */
    trigger: (reason: string) => void;
}

export interface InsurancePullOptions {
    requestPull: () => void;
    /** 定期間隔（既定5分） */
    intervalMs?: number;
    /** この時間内の重複トリガは無視する（既定3秒） */
    debounceMs?: number;
    now?: () => number;
    setIntervalFn?: (handler: () => void, ms: number) => unknown;
    clearIntervalFn?: (handle: unknown) => void;
}

/**
 * 保険プルの発火管理（#504、レビュー指摘#10）。
 * Realtime通知だけに依存せず、起動・フォアグラウンド復帰・再接続・定期の
 * 4トリガでプルを起動する。トリガの購読（イベント登録）はプラットフォーム側が行い、
 * ここはデバウンスと定期タイマーだけを持つ。
 */
export function createInsurancePullScheduler(options: InsurancePullOptions): InsurancePullScheduler {
    const intervalMs = options.intervalMs ?? 5 * 60_000;
    const debounceMs = options.debounceMs ?? 3_000;
    const now = options.now ?? (() => Date.now());
    const setIntervalFn = options.setIntervalFn ?? ((handler, ms) => setInterval(handler, ms));
    const clearIntervalFn = options.clearIntervalFn ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));

    let timer: unknown = null;
    let lastFiredAt = -Infinity;

    const trigger = (): void => {
        const at = now();
        if (at - lastFiredAt < debounceMs) return;
        lastFiredAt = at;
        options.requestPull();
    };

    return {
        start: () => {
            if (timer !== null) return;
            timer = setIntervalFn(trigger, intervalMs);
        },
        stop: () => {
            if (timer === null) return;
            clearIntervalFn(timer);
            timer = null;
        },
        trigger,
    };
}

/** user_id別namespaceのキー（ADR-009） */
export function cloudCursorKey(userId: string): string {
    return `life-quest:cloud:${userId}:cursor:v1`;
}

export function cloudOutboxKey(userId: string): string {
    return `life-quest:cloud:${userId}:outbox:v1`;
}
