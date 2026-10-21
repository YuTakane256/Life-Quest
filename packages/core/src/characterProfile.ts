import { GAME_STATE_LIMITS, type AvatarId } from './gameState.ts';
import { clampString } from './validation.ts';

export interface CharacterProfile { name: string; avatar: AvatarId }
export const PROFILE_CHANGED_MESSAGE = 'プロフィールが変更されています。入力内容を確認し、閉じてから編集し直してください。';

/** Only editable fields belong to this draft; XP/equipment changes must not invalidate it. */
export function captureCharacterProfile(profile: CharacterProfile): (current: CharacterProfile) => boolean {
    const { name, avatar } = profile;
    return (current) => current.name === name && current.avatar === avatar;
}

export function buildCharacterProfileUpdate(name: string, avatar: AvatarId): CharacterProfile {
    return { name: clampString(name.trim() || '名無し', GAME_STATE_LIMITS.maxCharacterNameLength), avatar };
}
