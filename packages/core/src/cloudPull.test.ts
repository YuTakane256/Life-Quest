import { describe, expect, it, vi } from 'vitest';
import {
    cloudCursorKey,
    cloudOutboxKey,
    createCloudPullRunner,
    createInsurancePullScheduler,
    type PullBatch,
} from './cloudPull.ts';

function makeDeps(batches: PullBatch[]) {
    let cursor = 0;
    const applied: PullBatch[] = [];
    const cursorWrites: number[] = [];
    let call = 0;
    return {
        deps: {
            fetchBatch: vi.fn(async () => batches[Math.min(call++, batches.length - 1)]),
            applyBatch: (batch: PullBatch) => { applied.push(batch); },
            readCursor: async () => cursor,
            writeCursor: async (next: number) => { cursor = next; cursorWrites.push(next); },
        },
        applied,
        cursorWrites,
        getCursor: () => cursor,
    };
}

describe('createCloudPullRunner', () => {
    it('has_moreが尽きるまで繰り返し、next_cursorへのみ前進する', async () => {
        const { deps, applied, cursorWrites, getCursor } = makeDeps([
            { next_cursor: 3, has_more: true, tasks: [1, 2, 3] },
            { next_cursor: 5, has_more: false, tasks: [4, 5] },
        ]);
        const runner = createCloudPullRunner(deps);

        await runner.flush();

        expect(applied).toHaveLength(2);
        expect(cursorWrites).toEqual([3, 5]);
        expect(getCursor()).toBe(5);
        expect(deps.fetchBatch).toHaveBeenNthCalledWith(1, 0, 200);
        expect(deps.fetchBatch).toHaveBeenNthCalledWith(2, 3, 200);
    });

    it('空バッチ（next_cursorが進まない）ではカーソルを書き込まない', async () => {
        const { deps, cursorWrites } = makeDeps([
            { next_cursor: 0, has_more: false, tasks: [] },
        ]);
        const runner = createCloudPullRunner(deps);

        await runner.flush();

        expect(cursorWrites).toEqual([]);
    });

    it('実行中の再要求はコアレスされ、完了後にもう1周する', async () => {
        let resolveFirst: (() => void) | undefined;
        const gate = new Promise<void>((resolve) => { resolveFirst = resolve; });
        let call = 0;
        let cursor = 0;
        const fetchBatch = vi.fn(async () => {
            call++;
            if (call === 1) await gate;
            return { next_cursor: call, has_more: false } satisfies PullBatch;
        });
        const runner = createCloudPullRunner({
            fetchBatch,
            applyBatch: () => {},
            readCursor: async () => cursor,
            writeCursor: async (next) => { cursor = next; },
        });

        runner.requestPull();
        runner.requestPull(); // 実行中の再要求
        resolveFirst?.();
        await runner.flush();

        expect(fetchBatch).toHaveBeenCalledTimes(2); // 1周目 + dirtyでもう1周
    });

    it('namespaceキーはuser_idごとに分離される（ADR-009）', () => {
        expect(cloudCursorKey('user-a')).toBe('life-quest:cloud:user-a:cursor:v1');
        expect(cloudOutboxKey('user-b')).toBe('life-quest:cloud:user-b:outbox:v1');
        expect(cloudCursorKey('user-a')).not.toBe(cloudCursorKey('user-b'));
    });
});

describe('createInsurancePullScheduler（#504 保険プル4トリガ）', () => {
    it('デバウンス窓内の重複トリガは1回にまとめられる', () => {
        let now = 0;
        const requestPull = vi.fn();
        const scheduler = createInsurancePullScheduler({
            requestPull,
            debounceMs: 3000,
            now: () => now,
            setIntervalFn: () => 0,
            clearIntervalFn: () => {},
        });

        scheduler.trigger('startup');
        now = 1000;
        scheduler.trigger('foreground'); // 窓内 → 無視
        now = 4000;
        scheduler.trigger('online');     // 窓外 → 発火

        expect(requestPull).toHaveBeenCalledTimes(2);
    });

    it('startで定期タイマーが張られ、stopで解除される。startは冪等', () => {
        const requestPull = vi.fn();
        const handlers: (() => void)[] = [];
        let cleared = 0;
        const scheduler = createInsurancePullScheduler({
            requestPull,
            intervalMs: 300_000,
            debounceMs: 0,
            setIntervalFn: (handler) => { handlers.push(handler); return handlers.length; },
            clearIntervalFn: () => { cleared++; },
        });

        scheduler.start();
        scheduler.start(); // 冪等
        expect(handlers).toHaveLength(1);

        handlers[0]?.(); // 定期発火 → プル
        expect(requestPull).toHaveBeenCalledTimes(1);

        scheduler.stop();
        scheduler.stop();
        expect(cleared).toBe(1);
    });

    it('起動・フォアグラウンド復帰・再接続・定期の4トリガが独立してプルを発火させる', () => {
        let now = 0;
        const requestPull = vi.fn();
        const handlers: (() => void)[] = [];
        const scheduler = createInsurancePullScheduler({
            requestPull,
            debounceMs: 3000,
            now: () => now,
            setIntervalFn: (handler) => { handlers.push(handler); return 1; },
            clearIntervalFn: () => {},
        });
        scheduler.start();

        scheduler.trigger('startup');
        now += 10_000;
        scheduler.trigger('foreground');
        now += 10_000;
        scheduler.trigger('online');
        now += 10_000;
        handlers[0]?.(); // 定期

        expect(requestPull).toHaveBeenCalledTimes(4);
    });
});
