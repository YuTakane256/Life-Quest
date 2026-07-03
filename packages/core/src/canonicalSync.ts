/**
 * ストアの現在状態を canonical Repository へ書き戻す（write-through）ための
 * 共有ヘルパー。プラットフォーム側のブリッジ（Web / Mobile）が、ストア変更の
 * たびに変換済みスナップショットを渡して呼び出す。
 *
 * 安全方針:
 * - 内容が変わっていなければ書かない（unchanged）。ストアの無関係な更新で
 *   revision が無限に進んだり、ストレージが摩耗したりしない。
 * - 書き込みは常に expectedRevision 付き。割り込み書き込みがあれば conflict に
 *   なるので、再読込して1回だけ再試行する（それでも競合するなら失敗として報告）。
 * - canonical 側が corrupt / unsupported / storage-error のときは書き戻さない
 *   （#482 の移行サービスと同じ保護方針）。
 */
import type { RepositoryStorage, SnapshotRepository, VersionedSnapshot } from './syncRepository';

export type CanonicalWriteStatus =
    /** canonical が空だったので新規作成した */
    | 'created'
    /** 内容が変わっていたので更新した */
    | 'updated'
    /** 内容が同一なので書き込みを省略した */
    | 'unchanged'
    /** canonical が corrupt / unsupported / storage-error のため書き戻さなかった */
    | 'skipped-unsafe'
    /** 書き込みに失敗した（再試行後の競合・storage-error など） */
    | 'failed';

export interface CanonicalWriteResult {
    status: CanonicalWriteStatus;
    /** created / updated / unchanged のときの canonical revision */
    revision?: number;
    /** skipped-unsafe / failed の詳細 */
    reason?: string;
}

const MAX_CONFLICT_RETRIES = 1;

/**
 * 変換済みスナップショットを canonical Repository へ書き戻す。
 * `snapshot` は converter（sanitize済み）を通した canonical 形式であること。
 */
export async function writeCanonicalSnapshot<TSnapshot extends VersionedSnapshot>(
    repository: SnapshotRepository<TSnapshot>,
    snapshot: unknown,
): Promise<CanonicalWriteResult> {
    for (let attempt = 0; attempt <= MAX_CONFLICT_RETRIES; attempt++) {
        const current = await repository.load();

        if (current.status === 'corrupt' || current.status === 'unsupported' || current.status === 'storage-error') {
            return { status: 'skipped-unsafe', reason: `canonical-${current.status}` };
        }

        const currentRevision = current.status === 'ready' ? current.value.revision : null;
        if (current.status === 'ready'
            && JSON.stringify(current.value.data) === JSON.stringify(snapshot)) {
            return { status: 'unchanged', revision: current.value.revision };
        }

        const result = await repository.save(snapshot, currentRevision);
        if (result.ok) {
            return {
                status: currentRevision === null ? 'created' : 'updated',
                revision: result.value.revision,
            };
        }
        if (result.reason === 'conflict' && attempt < MAX_CONFLICT_RETRIES) {
            continue; // 再読込して1回だけ再試行する
        }
        return { status: 'failed', reason: result.reason };
    }
    return { status: 'failed', reason: 'conflict' };
}

// ─── 同期カーソル ─────────────────────────────────────────────

export const SYNC_CURSOR_KEY = 'life-quest:sync:seen:v1';

/**
 * このデバイスが最後に確認した canonical revision の記録。
 *
 * 起動時シードは「canonical の revision がこのカーソルと異なるとき」だけ行う。
 * 自分が書いた（または確認済みの）revision のままなら canonical に新情報はなく、
 * ローカルの方が新しい可能性がある（canonical への書き戻しだけが失敗した
 * クラッシュ窓）ため、シードでローカル変更を巻き戻さない。
 */
export interface SyncCursor {
    readSeenRevision: (section: string) => Promise<number | null>;
    recordSeenRevision: (section: string, revision: number) => Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createSyncCursor(
    storage: RepositoryStorage,
    key: string = SYNC_CURSOR_KEY,
): SyncCursor {
    const readAll = async (): Promise<Record<string, number>> => {
        try {
            const raw = await storage.getItem(key);
            if (raw === null) return {};
            const parsed: unknown = JSON.parse(raw);
            if (!isRecord(parsed)) return {};
            return Object.fromEntries(
                Object.entries(parsed).filter((entry): entry is [string, number] =>
                    typeof entry[1] === 'number' && Number.isInteger(entry[1]) && entry[1] >= 1)
            );
        } catch {
            return {};
        }
    };

    return {
        readSeenRevision: async (section) => {
            const all = await readAll();
            return all[section] ?? null;
        },
        recordSeenRevision: async (section, revision) => {
            try {
                const all = await readAll();
                await storage.setItem(key, JSON.stringify({ ...all, [section]: revision }));
            } catch {
                // カーソルの書き込み失敗は致命的ではない。次回起動で余分にシードされる
                // だけで、canonicalはsanitize済みの正なので安全側に倒れる。
            }
        },
    };
}
