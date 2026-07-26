/**
 * オフライン操作のoutbox（#505、ADR-004/009）。
 *
 * - 操作をFIFOで永続キューへ積み、送信できる状態になったら順に再送する
 * - opId がそのまま冪等キー（p_key / idempotencyKey）になり、二重送信しても
 *   サーバー側のidempotency_keysが1回分に抑える
 * - dependsOn で順序を保証する（例: サブタスク追加は親タスク作成の後）
 * - 恒久エラーは failed とし、依存する後続opも連鎖して failed にする
 * - stop()（ログアウト等）は進行中のopを pending へ戻して中断する。
 *   キューはディスクに残り、同一ユーザーの再ログインで再開される
 * - namespaceキーの解決は呼び出し側（プラットフォーム層）の責務。
 *   本モジュールはストレージアダプタとキーを受け取るだけで、user_idを知らない
 */
import type { RepositoryStorage } from './syncRepository.ts';

export type OutboxOpStatus = 'pending' | 'inflight' | 'failed' | 'conflict';

/** UIへ公開してよい、同期失敗の分類。 */
export type SyncFailureKind =
    | 'network' | 'server' | 'auth-required' | 'validation' | 'forbidden'
    | 'not-found' | 'conflict' | 'unsupported' | 'dependency' | 'unknown';

export interface OutboxFailure {
    kind: SyncFailureKind;
    occurredAt: string;
}

export interface OutboxOp {
    opId: string;
    /** 送信先の操作名（DB RPC名またはEdge Function名） */
    operation: string;
    payload: Record<string, unknown>;
    /** 先に完了していなければならないopId */
    dependsOn: string[];
    baseVersion: number | null;
    status: OutboxOpStatus;
    enqueuedAt: string;
    /** 楽観更新の巻き戻しに使うスナップショット（プラットフォーム側が解釈する） */
    optimisticSnapshot: unknown;
    /** 原文・payloadを含まない、再起動後も利用できる安全な失敗情報。 */
    failure?: OutboxFailure;
}

export type OutboxSendResult =
    | { ok: true }
    | { ok: false; permanent: boolean; error: string; failureKind?: SyncFailureKind };

export interface OutboxDrainResult {
    /** 一時失敗など、次回の接続回復で再送すべき操作が残っているか。 */
    retryablePending: boolean;
}

export interface OutboxPublicState {
    pending: number;
    inflight: number;
    failed: number;
    conflict: number;
    oldestPendingAt: string | null;
    lastPushSuccessAt: string | null;
    failureKinds: readonly SyncFailureKind[];
}

export interface OutboxDeps {
    storage: RepositoryStorage;
    /** user_id別namespaceの保存キー（cloudOutboxKey(userId)） */
    storageKey: string;
    /** 1opを送信する。ネットワーク断は permanent:false、4xx系は permanent:true */
    send: (op: OutboxOp) => Promise<OutboxSendResult>;
    /** 恒久失敗したopの楽観更新を巻き戻す（任意） */
    onPermanentFailure?: (op: OutboxOp) => void | Promise<void>;
    now?: () => string;
    generateId?: () => string;
}

export interface EnqueueInput {
    operation: string;
    payload: Record<string, unknown>;
    opId?: string;
    dependsOn?: string[];
    baseVersion?: number | null;
    optimisticSnapshot?: unknown;
}

export interface SyncOutbox {
    /** 永続化済みキューを読み込む。start前に一度呼ぶ */
    load: () => Promise<void>;
    /** 操作を積む（同一opIdの二重enqueueは無視）。積んだ後に自動でdrainを要求する */
    enqueue: (input: EnqueueInput) => Promise<OutboxOp | null>;
    /** 送信ループを1周実行する。実行中の再要求はコアレスされる */
    requestDrain: () => void;
    /**
     * 再送を要求し、その要求を含むdrainが完了するまで待つ。
     * 接続復帰時は、古いクラウド状態をpullする前にローカルの保留操作を
     * サーバーへ反映するために使う。
     */
    drainAndWait: () => Promise<OutboxDrainResult>;
    /** 実行中のdrainが終わるまで待つ（テスト・明示フラッシュ用） */
    flush: () => Promise<void>;
    /** 中断: 進行中opをpendingへ戻し、以後のdrainを止める（ログアウト時） */
    stop: () => Promise<void>;
    /** 認証回復後に、auth-requiredで停止した保留操作だけを同じopIdで再開する。 */
    resumeAfterAuth: () => Promise<void>;
    /** 現在のキュー内容（テスト・UI表示用のコピー） */
    snapshot: () => OutboxOp[];
    /** payloadやIDを露出しないUI用状態。 */
    getState: () => OutboxPublicState;
    subscribe: (listener: (state: OutboxPublicState) => void) => () => void;
}

interface PersistedOutbox {
    ops: OutboxOp[];
}

function sanitizeOps(raw: unknown): OutboxOp[] {
    if (typeof raw !== 'object' || raw === null) return [];
    const ops = (raw as PersistedOutbox).ops;
    if (!Array.isArray(ops)) return [];
    return ops
        .filter((op): op is OutboxOp =>
            typeof op === 'object' && op !== null
            && typeof (op as OutboxOp).opId === 'string'
            && typeof (op as OutboxOp).operation === 'string')
        .map((op) => ({
            ...op,
            dependsOn: Array.isArray(op.dependsOn) ? op.dependsOn : [],
            // 前回セッションの中断でinflightのまま残った操作はpendingへ戻す
            status: op.status === 'inflight' ? 'pending' : op.status,
        }));
}

export function createSyncOutbox(deps: OutboxDeps): SyncOutbox {
    const now = deps.now ?? (() => new Date().toISOString());
    const generateId = deps.generateId ?? (() => crypto.randomUUID());

    let ops: OutboxOp[] = [];
    let stopped = false;
    let running: Promise<void> | null = null;
    let dirty = false;
    let lastPushSuccessAt: string | null = null;
    const listeners = new Set<(state: OutboxPublicState) => void>();

    const getState = (): OutboxPublicState => {
        const counts = { pending: 0, inflight: 0, failed: 0, conflict: 0 };
        let oldestPendingAt: string | null = null;
        const failureKinds = new Set<SyncFailureKind>();
        for (const op of ops) {
            counts[op.status] += 1;
            if ((op.status === 'pending' || op.status === 'inflight')
                && (oldestPendingAt === null || op.enqueuedAt < oldestPendingAt)) {
                oldestPendingAt = op.enqueuedAt;
            }
            if (op.failure) failureKinds.add(op.failure.kind);
        }
        return { ...counts, oldestPendingAt, lastPushSuccessAt, failureKinds: [...failureKinds] };
    };

    const notify = (): void => {
        const state = getState();
        listeners.forEach((listener) => listener(state));
    };

    const persist = async (): Promise<void> => {
        await deps.storage.setItem(deps.storageKey, JSON.stringify({ ops } satisfies PersistedOutbox));
    };

    const setStatus = (opId: string, status: OutboxOpStatus, failure?: OutboxFailure): void => {
        ops = ops.map((op) => (op.opId === opId
            ? { ...op, status, ...(failure ? { failure } : status === 'inflight' ? { failure: undefined } : {}) }
            : op));
        notify();
    };

    /** 依存が全て完了している（=キューに残っていない）pendingの先頭opを返す */
    const nextSendable = (): OutboxOp | null => {
        const queuedIds = new Set(ops.map((op) => op.opId));
        for (const op of ops) {
            if (op.status !== 'pending') continue;
            // 401後の操作は、再ログインが成功するまで同じopIdのまま停止する。
            if (op.failure?.kind === 'auth-required') continue;
            const blocked = op.dependsOn.some((dependency) => queuedIds.has(dependency));
            if (!blocked) return op;
        }
        return null;
    };

    /** opの恒久失敗を、それに依存する後続へ連鎖させる */
    const cascadeFailure = async (failedId: string): Promise<void> => {
        const dependents = ops.filter((op) =>
            op.status === 'pending' && op.dependsOn.includes(failedId));
        for (const dependent of dependents) {
            setStatus(dependent.opId, 'failed', { kind: 'dependency', occurredAt: now() });
            await deps.onPermanentFailure?.(ops.find((op) => op.opId === dependent.opId)!);
            await cascadeFailure(dependent.opId);
        }
    };

    const drainLoop = async (): Promise<void> => {
        for (;;) {
            if (stopped) return;
            const op = nextSendable();
            if (!op) return;

            setStatus(op.opId, 'inflight');
            await persist();

            let result: OutboxSendResult;
            try {
                result = await deps.send(op);
            } catch (error) {
                result = { ok: false, permanent: false, failureKind: 'network', error: error instanceof Error ? error.message : 'send failed' };
            }

            if (stopped) {
                // ログアウト等による中断: inflightのまま放置せずpendingへ戻す
                setStatus(op.opId, 'pending');
                await persist();
                return;
            }

            if (result.ok) {
                ops = ops.filter((candidate) => candidate.opId !== op.opId);
                lastPushSuccessAt = now();
                notify();
                await persist();
                continue;
            }

            if (result.permanent) {
                setStatus(
                    op.opId,
                    result.failureKind === 'conflict' ? 'conflict' : 'failed',
                    { kind: result.failureKind ?? 'unknown', occurredAt: now() },
                );
                await deps.onPermanentFailure?.(ops.find((candidate) => candidate.opId === op.opId)!);
                await cascadeFailure(op.opId);
                await persist();
                continue; // 依存しない後続は送り続ける
            }

            // 一時エラー: pendingへ戻して中断。401だけは再ログインまで送らない。
            setStatus(op.opId, 'pending', result.failureKind
                ? { kind: result.failureKind, occurredAt: now() }
                : undefined);
            await persist();
            return;
        }
    };

    const run = (): Promise<void> => {
        if (running) return running;
        running = (async () => {
            try {
                do {
                    dirty = false;
                    await drainLoop();
                } while (dirty && !stopped);
            } finally {
                running = null;
            }
        })();
        return running;
    };

    const requestDrainInternal = (): void => {
        if (stopped) return;
        if (running) {
            dirty = true; // 実行中のdrainが終わったらもう1周する（enqueue取りこぼし防止）
            return;
        }
        void run();
    };

    return {
        load: async () => {
            const raw = await deps.storage.getItem(deps.storageKey);
            if (!raw) {
                ops = [];
                notify();
                return;
            }
            try {
                ops = sanitizeOps(JSON.parse(raw));
            } catch {
                ops = [];
            }
            notify();
        },
        enqueue: async (input) => {
            const opId = input.opId ?? generateId();
            if (ops.some((op) => op.opId === opId)) return null; // 二重enqueue無視
            const op: OutboxOp = {
                opId,
                operation: input.operation,
                payload: input.payload,
                dependsOn: input.dependsOn ?? [],
                baseVersion: input.baseVersion ?? null,
                status: 'pending',
                enqueuedAt: now(),
                optimisticSnapshot: input.optimisticSnapshot ?? null,
            };
            ops = [...ops, op];
            notify();
            await persist();
            requestDrainInternal();
            return op;
        },
        requestDrain: requestDrainInternal,
        drainAndWait: async () => {
            requestDrainInternal();
            await (running ?? Promise.resolve());
            return { retryablePending: ops.some((op) => op.status === 'pending') };
        },
        /** 実行中のdrainがあれば完了を待つ。新たなdrainは起動しない */
        flush: () => running ?? Promise.resolve(),
        stop: async () => {
            stopped = true;
            await (running ?? Promise.resolve());
        },
        resumeAfterAuth: async () => {
            if (stopped) return;
            let changed = false;
            ops = ops.map((op) => {
                if (op.status === 'pending' && op.failure?.kind === 'auth-required') {
                    changed = true;
                    return { ...op, failure: undefined };
                }
                return op;
            });
            if (!changed) return;
            notify();
            await persist();
            requestDrainInternal();
            await (running ?? Promise.resolve());
        },
        snapshot: () => ops.map((op) => ({ ...op })),
        getState,
        subscribe: (listener) => {
            listeners.add(listener);
            listener(getState());
            return () => listeners.delete(listener);
        },
    };
}
