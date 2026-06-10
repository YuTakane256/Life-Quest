import { createContext, useContext } from 'react';

export interface SnackbarContextType {
    showUndo: (message: string, onUndo: () => void) => void;
}

export const SnackbarContext = createContext<SnackbarContextType | null>(null);

export function useSnackbar() {
    const ctx = useContext(SnackbarContext);
    if (!ctx) throw new Error('useSnackbar must be used within SnackbarProvider');
    return ctx;
}
