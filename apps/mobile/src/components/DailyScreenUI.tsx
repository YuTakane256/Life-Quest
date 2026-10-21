import { useState, type ReactNode } from 'react';
import {
    Keyboard,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    Text,
    TextInput,
    View,
    type TextInputProps,
} from 'react-native';
import { ChevronDown, X, type LucideIcon } from 'lucide-react-native';
import { ui } from '../theme/dailyScreenStyles';
import { usePalette } from '../theme/usePalette';

export function IconButton({
    icon: Icon,
    label,
    onPress,
    color,
    round = false,
    filled = false,
    disabled = false,
    size,
}: {
    icon: LucideIcon;
    label: string;
    onPress: () => void;
    color?: string;
    round?: boolean;
    filled?: boolean;
    disabled?: boolean;
    size?: number;
}) {
    const { palette: p } = usePalette();
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            disabled={disabled}
            onPress={onPress}
            hitSlop={4}
            style={({ pressed }) => ({
                width: size ?? (round ? 40 : 24),
                height: size ?? (round ? 40 : 28),
                borderRadius: round ? 20 : 6,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed || disabled ? 0.45 : 1,
                backgroundColor: round
                    ? filled
                        ? p.accent.primary
                        : p.bg.card
                    : 'transparent',
                borderWidth: round && !filled ? 1 : 0,
                borderColor: p.border.default,
            })}
        >
            <Icon
                size={round ? 20 : 14}
                color={filled ? '#fff' : (color ?? p.text.muted)}
                accessible={false}
            />
        </Pressable>
    );
}

export function Chip({
    label,
    selected,
    onPress,
    color,
    accessibilityLabel,
}: {
    label: string;
    selected: boolean;
    onPress: () => void;
    color?: string;
    accessibilityLabel?: string;
}) {
    const { palette: p } = usePalette();
    const active = color ?? p.accent.primary;
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel ?? label}
            accessibilityState={{ selected }}
            onPress={onPress}
            style={({ pressed }) => ({
                paddingHorizontal: 12,
                paddingVertical: 4,
                borderRadius: 20,
                borderWidth: 1,
                borderColor: selected ? active : p.border.default,
                backgroundColor: selected ? active : p.bg.secondary,
                opacity: pressed ? 0.65 : 1,
            })}
        >
            <Text
                style={{
                    fontSize: 12,
                    lineHeight: 16,
                    fontWeight: '500',
                    color: selected ? '#fff' : p.text.secondary,
                }}
            >
                {label}
            </Text>
        </Pressable>
    );
}

export function Choice<T extends string>({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: T;
    options: readonly (readonly [T, string])[];
    onChange: (value: T) => void;
}) {
    const { palette: p } = usePalette();
    const [choosing, setChoosing] = useState(false);
    return (
        <>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={label}
                onPress={() => {
                    Keyboard.dismiss();
                    setChoosing(true);
                }}
                style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: p.border.default,
                    backgroundColor: p.bg.secondary,
                }}
            >
                <Text
                    style={{
                        color: p.text.secondary,
                        fontSize: 12,
                        lineHeight: 16,
                    }}
                >
                    {options.find(([key]) => key === value)?.[1]}
                </Text>
                <ChevronDown
                    size={12}
                    color={p.text.secondary}
                    accessible={false}
                />
            </Pressable>
            {choosing && (
                <Dialog title={label} onClose={() => setChoosing(false)}>
                    {/* Android's system Alert has a button limit; keep every option reachable. */}
                    {options.map(([key, title]) => (
                        <Pressable
                            key={key}
                            accessibilityRole="button"
                            accessibilityState={{ selected: key === value }}
                            onPress={() => {
                                onChange(key);
                                setChoosing(false);
                            }}
                            style={{
                                padding: 12,
                                borderRadius: 8,
                                backgroundColor:
                                    key === value
                                        ? p.bg.cardHover
                                        : p.bg.secondary,
                            }}
                        >
                            <Text
                                style={{
                                    color:
                                        key === value
                                            ? p.accent.primary
                                            : p.text.primary,
                                    fontSize: 14,
                                }}
                            >
                                {title}
                            </Text>
                        </Pressable>
                    ))}
                </Dialog>
            )}
        </>
    );
}

export function Field(props: TextInputProps) {
    const { palette: p } = usePalette();
    return (
        <TextInput
            returnKeyType="done"
            onSubmitEditing={() => Keyboard.dismiss()}
            placeholderTextColor={p.text.muted}
            {...props}
            style={[
                {
                    color: p.text.primary,
                    fontSize: 14,
                    lineHeight: 20,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: p.border.default,
                    backgroundColor: p.bg.secondary,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    minHeight: 42,
                },
                props.style,
            ]}
        />
    );
}

export function FormActions({
    onSave,
    onCancel,
    label = '追加',
    disabled = false,
}: {
    onSave: () => void;
    onCancel: () => void;
    label?: string;
    disabled?: boolean;
}) {
    const { palette: p } = usePalette();
    return (
        <View style={ui.row}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={label}
                disabled={disabled}
                onPress={onSave}
                style={[
                    ui.primary,
                    {
                        backgroundColor: p.accent.primary,
                        opacity: disabled ? 0.4 : 1,
                    },
                ]}
            >
                <Text style={ui.primaryText}>{label}</Text>
            </Pressable>
            <Pressable
                accessibilityRole="button"
                onPress={onCancel}
                style={[ui.cancel, { backgroundColor: p.bg.secondary }]}
            >
                <Text style={{ color: p.text.muted, fontSize: 14 }}>
                    キャンセル
                </Text>
            </Pressable>
        </View>
    );
}

export function Dialog({
    title,
    onClose,
    children,
    closeLabel = '閉じる',
    closeTargetSize,
}: {
    title: string;
    onClose: () => void;
    children: ReactNode;
    closeLabel?: string;
    closeTargetSize?: number;
}) {
    const { palette: p } = usePalette();
    return (
        <Modal transparent animationType="fade" onRequestClose={onClose}>
            <KeyboardAvoidingView
                style={ui.backdrop}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <View
                    accessibilityViewIsModal
                    style={[
                        ui.dialog,
                        {
                            backgroundColor: p.bg.card,
                            borderColor: p.border.default,
                        },
                    ]}
                >
                    <View
                        style={[
                            ui.row,
                            {
                                justifyContent: 'space-between',
                                marginBottom: 12,
                            },
                        ]}
                    >
                        <Text
                            accessibilityRole="header"
                            style={{
                                color: p.text.primary,
                                fontSize: 16,
                                fontWeight: '700',
                                flex: 1,
                            }}
                        >
                            {title}
                        </Text>
                        <IconButton icon={X} label={closeLabel} size={closeTargetSize} onPress={onClose} />
                    </View>
                    <ScrollView
                        keyboardShouldPersistTaps="handled"
                        contentContainerStyle={{ gap: 12 }}
                    >
                        {children}
                    </ScrollView>
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
}

export function EmptyDaily({
    text,
    icon: Icon,
}: {
    text: string;
    icon: LucideIcon;
}) {
    const { palette: p } = usePalette();
    return (
        <View
            style={{
                paddingVertical: 64,
                alignItems: 'center',
                gap: 16,
                opacity: 0.6,
            }}
        >
            <View
                style={{
                    width: 64,
                    height: 64,
                    borderRadius: 16,
                    backgroundColor: p.bg.card,
                    justifyContent: 'center',
                    alignItems: 'center',
                }}
            >
                <Icon size={32} color={p.text.muted} />
            </View>
            <Text
                style={{
                    color: p.text.muted,
                    fontSize: 14,
                    textAlign: 'center',
                }}
            >
                {text}
            </Text>
        </View>
    );
}
