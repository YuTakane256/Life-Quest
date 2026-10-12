import { StyleSheet } from 'react-native';
import {
    LAYOUT_TOKENS,
    type ThemePalette,
} from '@life-quest/core/designTokens';
import { PAGE_HEADING } from './layout';

export const ui = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    wrap: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        flexWrap: 'wrap',
    },
    primary: {
        flex: 1,
        borderRadius: 8,
        paddingVertical: 10,
        alignItems: 'center',
    },
    primaryText: {
        color: '#fff',
        fontSize: 14,
        lineHeight: 20,
        fontWeight: '500',
    },
    cancel: { borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10 },
    backdrop: {
        flex: 1,
        backgroundColor: '#0009',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
    },
    dialog: {
        width: '100%',
        maxWidth: LAYOUT_TOKENS.page.maxWidth,
        maxHeight: '90%',
        borderWidth: 1,
        borderRadius: 12,
        padding: 20,
    },
});

export function dailyStyles(p: ThemePalette) {
    return StyleSheet.create({
        safe: { flex: 1, backgroundColor: p.bg.primary },
        page: {
            width: '100%',
            maxWidth: LAYOUT_TOKENS.page.maxWidth,
            alignSelf: 'center',
            paddingHorizontal: LAYOUT_TOKENS.page.horizontal,
            paddingTop: LAYOUT_TOKENS.page.top,
            paddingBottom: 76,
        },
        header: {
            ...ui.row,
            justifyContent: 'space-between',
            marginBottom: 16,
        },
        title: { color: p.text.primary, ...PAGE_HEADING },
        summary: {
            color: p.text.muted,
            fontSize: 14,
            lineHeight: 20,
            marginTop: 4,
        },
        form: {
            padding: 16,
            gap: 12,
            borderWidth: 1,
            borderColor: p.border.default,
            borderRadius: 12,
            backgroundColor: p.bg.card,
            marginBottom: 16,
        },
        label: { color: p.text.muted, fontSize: 12, lineHeight: 16 },
        card: {
            borderWidth: 1,
            borderColor: p.border.default,
            borderRadius: 12,
            backgroundColor: p.bg.card,
        },
        checkbox: {
            width: 20,
            height: 20,
            borderRadius: 4,
            borderWidth: 2,
            justifyContent: 'center',
            alignItems: 'center',
        },
        name: {
            color: p.text.primary,
            fontSize: 14,
            lineHeight: 20,
            fontWeight: '500',
        },
        badge: {
            fontSize: 10,
            lineHeight: 14,
            paddingHorizontal: 6,
            paddingVertical: 2,
            borderRadius: 5,
        },
        error: { color: p.text.danger, fontSize: 12 },
    });
}
