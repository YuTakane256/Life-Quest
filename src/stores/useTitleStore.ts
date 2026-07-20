import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createWebPersistStorage } from '../platform/storage';
import { createSafePersistMerge } from '../utils/persistMerge';
import { enqueueCloudOperation } from '../platform/cloudOutbox';

const MAX_TITLE_LENGTH = 40;

export function sanitizeActiveTitle(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') return null;
    const title = value.trim();
    if (title.length === 0) return null;
    return title.slice(0, MAX_TITLE_LENGTH);
}

interface TitleStoreState {
    activeTitle: string | null;
    setActiveTitle: (title: string | null) => void;
}

export const useTitleStore = create<TitleStoreState>()(
    persist(
        (set) => ({
            activeTitle: null,
            setActiveTitle: (title) => {
                const sanitized = sanitizeActiveTitle(title);
                set({ activeTitle: sanitized });
                // display_name/avatarはprofilesテーブルの未使用カラム（キャラ名・
                // アバターの正本はcharacters側、update_character_profile経由で同期）
                // のためnullのまま送る。
                void enqueueCloudOperation('upsert_profile', {
                    p_display_name: null,
                    p_avatar: null,
                    p_active_title: sanitized,
                    p_base_version: null,
                });
            },
        }),
        {
            name: 'quest-board-title',
            storage: createWebPersistStorage(),
            version: 1,
            merge: createSafePersistMerge<TitleStoreState>((persisted) => ({
                activeTitle: sanitizeActiveTitle(persisted.activeTitle),
            })),
        }
    )
);
