import { createContext, useContext, useState, useCallback, useRef } from 'react';
import { X, Undo2 } from 'lucide-react';
import { UI_CONFIG } from '../../config/gameConfig';
import { generateId } from '../../utils/dateUtils';

interface SnackbarItem { id: string; message: string; onUndo?: () => void; expiresAt: number; }
interface SnackbarContextType { showUndo: (message: string, onUndo: () => void) => void; }
const SnackbarContext = createContext<SnackbarContextType | null>(null);
// eslint-disable-next-line react-refresh/only-export-components
export const useSnackbar = () => { const ctx = useContext(SnackbarContext); if (!ctx) throw new Error('error'); return ctx; };

export function SnackbarProvider({ children }: { children: React.ReactNode }) {
    const [snackbars, setSnackbars] = useState<SnackbarItem[]>([]); const timersRef = useRef<Map<string, number>>(new Map());
    const removeSnackbar = useCallback((id: string) => { const timer = timersRef.current.get(id); if (timer) { window.clearTimeout(timer); timersRef.current.delete(id); } setSnackbars((prev) => prev.filter((s) => s.id !== id)); }, []);
    const showUndo = useCallback((message: string, onUndo: () => void) => {
        // generateId() は内部で Date.now() + Math.random() を組み合わせるため、
        // 同一 ms で複数呼び出されても衝突しない（旧実装は Date.now() のみで衝突していた）
        const id = `snack-${generateId()}`; const expiresAt = Date.now() + UI_CONFIG.UNDO_DURATION_MS;
        setSnackbars((prev) => [...prev, { id, message, onUndo, expiresAt }]);
        const timer = window.setTimeout(() => removeSnackbar(id), UI_CONFIG.UNDO_DURATION_MS); timersRef.current.set(id, timer);
    }, [removeSnackbar]);

    return (
        <SnackbarContext.Provider value={{ showUndo }}>
            {children}
            <div
                className="fixed bottom-20 left-0 right-0 z-[100] flex flex-col items-center gap-2 px-4 pointer-events-none"
                role="status"
                aria-live="polite"
                aria-atomic="true"
            >
                {snackbars.map((s) => (
                    <div key={s.id} className="animate-slide-up pointer-events-auto w-full max-w-md rounded-xl px-4 py-3 flex items-center justify-between gap-3 shadow-2xl" style={{ backgroundColor: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border-default)' }}>
                        <span className="text-sm flex-1" style={{ color: 'var(--color-text-primary)' }}>{s.message}</span>
                        <div className="flex items-center gap-2">
                            <button onClick={() => { s.onUndo?.(); removeSnackbar(s.id); }} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors hover:opacity-80" style={{ backgroundColor: 'var(--color-accent-primary)', color: 'white' }}><Undo2 size={14} />元に戻す</button>
                            <button onClick={() => removeSnackbar(s.id)} aria-label="閉じる" className="p-1 rounded-full transition-colors hover:opacity-70" style={{ color: 'var(--color-text-muted)' }}><X size={16} /></button>
                        </div>
                    </div>
                ))}
            </div>
        </SnackbarContext.Provider>
    );
}
