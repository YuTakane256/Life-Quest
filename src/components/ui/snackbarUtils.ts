export const MAX_SNACKBARS = 3;
export const MAX_SNACKBAR_MESSAGE_LENGTH = 120;

export interface SnackbarItem {
    id: string;
    message: string;
    onUndo?: () => void;
    expiresAt: number;
}

export function clampSnackbarMessage(message: string): string {
    if (message.length <= MAX_SNACKBAR_MESSAGE_LENGTH) return message;
    return `${message.slice(0, MAX_SNACKBAR_MESSAGE_LENGTH - 3)}...`;
}

export function appendSnackbar(
    current: readonly SnackbarItem[],
    item: SnackbarItem,
): { next: SnackbarItem[]; removedIds: string[] } {
    const next = [...current, { ...item, message: clampSnackbarMessage(item.message) }].slice(-MAX_SNACKBARS);
    const nextIds = new Set(next.map((snackbar) => snackbar.id));
    return {
        next,
        removedIds: current.filter((snackbar) => !nextIds.has(snackbar.id)).map((snackbar) => snackbar.id),
    };
}
