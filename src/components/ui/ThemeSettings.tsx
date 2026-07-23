import { Monitor, Moon, Sun } from 'lucide-react';
import { useThemeStore, type ThemeMode } from '../../stores/useThemeStore';

const THEME_OPTIONS: { mode: ThemeMode; label: string; icon: React.ReactNode }[] = [
    { mode: 'light', label: 'ライト', icon: <Sun size={15} /> },
    { mode: 'dark', label: 'ダーク', icon: <Moon size={15} /> },
    { mode: 'system', label: 'システム', icon: <Monitor size={15} /> },
];

export function ThemeSettings() {
    const { mode, setMode } = useThemeStore();

    return (
        <section className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
            <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                    <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>テーマ</h2>
                    <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>表示モードを切り替えます</p>
                </div>
            </div>
            <div className="grid grid-cols-3 gap-1 rounded-xl p-1" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                {THEME_OPTIONS.map((option) => {
                    const isActive = mode === option.mode;
                    return (
                        <button
                            key={option.mode}
                            type="button"
                            onClick={() => setMode(option.mode)}
                            aria-pressed={isActive}
                            className="min-h-10 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all"
                            style={{
                                backgroundColor: isActive ? 'var(--color-accent-primary)' : 'transparent',
                                color: isActive ? 'white' : 'var(--color-text-muted)',
                            }}
                        >
                            {option.icon}
                            <span>{option.label}</span>
                        </button>
                    );
                })}
            </div>
        </section>
    );
}
