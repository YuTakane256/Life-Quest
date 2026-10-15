import { Pressable, StyleSheet, View } from 'react-native';
import { Plus } from 'lucide-react-native';
import { usePalette } from '../theme/usePalette';
import { TASK_ACTION_LAYOUT } from '../theme/layout';
import { UndoToast } from './UndoToast';

interface TaskBottomActionsProps {
    formOpen: boolean;
    onToggleForm: () => void;
    toast: { message: string; onUndo: () => void } | null;
    onHeightChange: (height: number) => void;
}

/** Normal flow stacks the FAB above the measured toast, including scaled text. */
export function TaskBottomActions({ formOpen, onToggleForm, toast, onHeightChange }: TaskBottomActionsProps) {
    const { palette } = usePalette();
    return (
        <View pointerEvents="box-none" style={styles.container}
            onLayout={(event) => onHeightChange(event.nativeEvent.layout.height)}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={formOpen ? 'タスク追加フォームを閉じる' : '新しいタスクを追加'}
                onPress={onToggleForm}
                style={[styles.add, { backgroundColor: palette.accent.primary }]}>
                <Plus size={22} color="#fff" />
            </Pressable>
            {toast && <UndoToast message={toast.message} onAction={toast.onUndo} />}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        position: 'absolute', left: 16, right: 16,
        bottom: TASK_ACTION_LAYOUT.bottom, gap: TASK_ACTION_LAYOUT.gap,
    },
    add: {
        alignSelf: 'flex-end', width: TASK_ACTION_LAYOUT.size, height: TASK_ACTION_LAYOUT.size,
        borderRadius: 22, alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px #0005',
    },
});
