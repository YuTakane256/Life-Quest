import { Activity, Monitor, PauseCircle } from 'lucide-react';
import { useMotionStore, type MotionMode } from '../../stores/useMotionStore';

const MOTION_OPTIONS: { mode: MotionMode; label: string; icon: React.ReactNode }[] = [
    { mode: 'standard', label: '標準', icon: <Activity size={15} /> },
    { mode: 'reduced', label: '減らす', icon: <PauseCircle size={15} /> },
    { mode: 'system', label: 'システム', icon: <Monitor size={15} /> },
];

export function MotionSettings() {
    const { mode, setMode } = useMotionStore();

    return (
        <section className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
            <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                    <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>動きの量</h2>
                    <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>アニメーションや画面遷移の動きを調整します</p>
                </div>
            </div>
            <div className="grid grid-cols-3 gap-1 rounded-xl p-1" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                {MOTION_OPTIONS.map((option) => {
                    const isActive = mode === option.mode;
                    return (
                        <button
                            key={option.mode}
                            type="button"
                            onClick={() => setMode(option.mode)}
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
