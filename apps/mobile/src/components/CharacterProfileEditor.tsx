import { Image, Pressable, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { GAME_STATE_LIMITS, type AvatarId } from '@life-quest/core/gameState';
import { AVATAR_IMAGES } from '../assets/images';
import { characterOverviewStyles } from '../theme/characterOverviewStyles';
import { usePalette } from '../theme/usePalette';
import { Dialog, Field } from './DailyScreenUI';

export interface CharacterProfileEditorProps {
    name: string; avatar: AvatarId; error: string;
    onNameChange: (name: string) => void; onAvatarChange: (avatar: AvatarId) => void;
    onSave: () => void; onClose: () => void;
}

export function CharacterProfileEditor({ name, avatar, error, onNameChange, onAvatarChange, onSave, onClose }: CharacterProfileEditorProps) {
    const { palette: p } = usePalette();
    const s = characterOverviewStyles(p);
    return <Dialog title="プロフィール編集" onClose={onClose} closeLabel="プロフィール編集を閉じる" closeTargetSize={44}>
        <Text style={s.editorLabel}>名前</Text>
        <Field accessibilityLabel="キャラクター名" value={name} onChangeText={onNameChange}
            maxLength={GAME_STATE_LIMITS.maxCharacterNameLength} placeholder="名前を入力" style={s.editorInput} />
        <Text style={s.editorLabel}>アバター</Text>
        <View style={s.avatarOptions}>
            {(['female', 'male'] as const).map((value) => {
                const selected = avatar === value; const label = value === 'female' ? '女性' : '男性';
                return <Pressable key={value} accessibilityRole="button" accessibilityLabel={`アバターを${label}にする`} accessibilityState={{ selected }}
                    onPress={() => onAvatarChange(value)} style={[s.avatarOption, { borderColor: selected ? p.accent.primary : p.border.default, backgroundColor: selected ? p.bg.secondary : 'transparent' }]}>
                    <View style={[s.avatar, s.editorAvatar]}><Image source={AVATAR_IMAGES[value]} style={s.avatarImage} accessible={false} /></View>
                    <Text style={s.countLabel}>{label}</Text>
                    {selected && <Check size={14} color={p.accent.primary} style={{ position: 'absolute', top: 8, right: 8 }} accessible={false} />}
                </Pressable>;
            })}
        </View>
        {error ? <Text accessibilityRole="alert" style={{ color: p.text.danger, fontSize: 14 }}>{error}</Text> : null}
        <View style={s.editorActions}>
            <Pressable accessibilityRole="button" accessibilityLabel="保存する" onPress={onSave} style={s.editorSave}><Text style={s.editorSaveText}>保存する</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="キャンセル" onPress={onClose} style={[s.editorSave, { backgroundColor: p.bg.secondary }]}><Text style={[s.editorSaveText, { color: p.text.secondary }]}>キャンセル</Text></Pressable>
        </View>
    </Dialog>;
}
