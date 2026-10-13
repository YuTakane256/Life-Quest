import { GAME_STATE_LIMITS, type AvatarId } from '@life-quest/core/gameState';
import { clampString } from '@life-quest/core/validation';

/** 編集ダイアログの保存時だけ適用する。下書き・閉じる操作ではストアを変更しない。 */
export function buildCharacterProfileUpdate(name: string, avatar: AvatarId) {
    return {
        name: clampString(
            name.trim() || '名無し',
            GAME_STATE_LIMITS.maxCharacterNameLength,
        ),
        avatar,
    };
}
