import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CheckSquare, Repeat, User, Map, BarChart3, Settings, Shield, LockKeyhole } from 'lucide-react';
import { useGameStore } from '../../stores/useGameStore';
import { useTaskStore } from '../../stores/useTaskStore';

const NAV_ITEMS = [
    { path: '/tasks', label: 'タスク', icon: <CheckSquare size={22} /> },
    { path: '/habits', label: '習慣', icon: <Repeat size={22} /> },
    { path: '/stats', label: '統計', icon: <BarChart3 size={22} /> },
    { path: '/character', label: 'キャラ', icon: <User size={22} /> },
    { path: '/map', label: 'マップ', icon: <Map size={22} />, requiresBattle: true },
    { path: '/settings', label: '設定', icon: <Settings size={22} /> },
];

function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function BottomNav() {
    const location = useLocation(); const navigate = useNavigate(); const battleUnlocked = useGameStore((s) => s.battle.battleUnlocked);
    const pendingTaskCount = useTaskStore((s) => s.tasks.filter((t) => !t.completed).length);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey || isEditableTarget(event.target)) return;

            const navIndex = Number(event.key) - 1;
            const item = NAV_ITEMS[navIndex];
            if (!item) return;
            if (item.requiresBattle && !battleUnlocked) return;

            event.preventDefault();
            navigate(item.path);
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [battleUnlocked, navigate]);

    return (
        <nav
            className="app-navigation fixed bottom-0 left-0 right-0 z-50 border-t"
            style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-default)' }}
            aria-label="メインナビゲーション"
        >
            <div className="app-navigation-inner flex justify-around items-center h-16 max-w-lg mx-auto px-2">
                <div className="app-navigation-brand" aria-hidden="true">
                    <span className="app-navigation-brand-icon"><Shield size={22} /></span>
                    <span>
                        <strong>Life Quest</strong>
                        <small>冒険メニュー</small>
                    </span>
                </div>
                {NAV_ITEMS.map((item) => {
                    const isActive = location.pathname === item.path || location.pathname.startsWith(`${item.path}/`); const isLocked = item.requiresBattle && !battleUnlocked;
                    const showTaskBadge = item.path === '/tasks' && pendingTaskCount > 0;
                    return (
                        <button
                            key={item.path}
                            onClick={() => !isLocked && navigate(item.path)}
                            disabled={isLocked}
                            aria-label={isLocked ? `${item.label}（未解放）` : item.label}
                            aria-current={isActive ? 'page' : undefined}
                            title={item.label}
                            className={`app-navigation-item flex flex-col items-center justify-center gap-0.5 flex-1 py-2 rounded-lg transition-all duration-200 relative ${isLocked ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                            style={{ color: isActive ? 'var(--color-accent-primary)' : 'var(--color-text-muted)' }}
                        >
                            <div className={`app-navigation-icon relative transition-transform duration-200 ${isActive ? 'scale-110' : ''}`}>
                                {item.icon}
                                {showTaskBadge && (
                                    <span
                                        className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold flex items-center justify-center"
                                        style={{ backgroundColor: 'var(--color-text-danger)', color: 'white', lineHeight: 1 }}
                                        aria-label={`未完了タスク${pendingTaskCount}件`}
                                    >
                                        {pendingTaskCount > 99 ? '99+' : pendingTaskCount}
                                    </span>
                                )}
                            </div>
                            <span className="app-navigation-label text-[10px] font-medium">{item.label}</span>
                            {isActive && <div className="app-navigation-active absolute -top-0.5 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full" style={{ backgroundColor: 'var(--color-accent-primary)' }} />}
                            {isLocked && <LockKeyhole className="app-navigation-lock" size={12} aria-hidden="true" />}
                        </button>
                    );
                })}
            </div>
        </nav>
    );
}
