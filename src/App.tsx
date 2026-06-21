import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { HelpCircle } from 'lucide-react';
import { BottomNav } from './components/layout/BottomNav';
import { TasksPage } from './pages/TasksPage';
import { HabitsPage } from './pages/HabitsPage';
import { CharacterPage, InventoryPage } from './pages/CharacterPage';
import { MapBattlePage } from './pages/MapBattlePage';
import { StatsPage } from './pages/StatsPage';
import { SettingsPage } from './pages/SettingsPage';
import { HelpPage } from './pages/HelpPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { SnackbarProvider } from './components/ui/SnackbarProvider';
import { LevelUpOverlay } from './components/ui/LevelUpOverlay';
import { LoginBonusOverlay } from './components/ui/LoginBonusOverlay';
import { ChestOpeningOverlay } from './components/ui/ChestOpeningOverlay';
import { ThemeController } from './components/ui/ThemeController';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { useLoginBonusStore } from './stores/useLoginBonusStore';
import { runNotificationChecks } from './utils/notifications';
import { NOTIFICATION_CONFIG } from './config/gameConfig';
import './App.css';

/** 各画面の右下に表示する使い方ボタン。ヘルプ導線がある画面では非表示。 */
function HelpFloatingButton() {
    const navigate = useNavigate();
    const location = useLocation();
    if (location.pathname === '/help' || location.pathname === '/settings' || location.pathname === '/tasks') return null;
    return (
        <button
            onClick={() => navigate('/help')}
            className="fixed right-4 z-40 w-11 h-11 rounded-full flex items-center justify-center transition-all hover:scale-110"
            style={{
                bottom: 'calc(64px + env(safe-area-inset-bottom, 0px) + 12px)',
                backgroundColor: 'var(--color-bg-card)',
                color: 'var(--color-accent-primary)',
                border: '1px solid var(--color-border-default)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            }}
            aria-label="使い方"
            title="使い方"
        >
            <HelpCircle size={20} />
        </button>
    );
}

function App() {
    // アプリ起動時にデイリーログインボーナスの判定を行う
    useEffect(() => {
        useLoginBonusStore.getState().checkDailyLogin();
    }, []);

    // 通知条件を起動時および一定間隔でチェックする
    useEffect(() => {
        void runNotificationChecks();
        const intervalId = window.setInterval(() => {
            void runNotificationChecks();
        }, NOTIFICATION_CONFIG.CHECK_INTERVAL_MS);
        return () => window.clearInterval(intervalId);
    }, []);

    return (
        <ErrorBoundary>
            <BrowserRouter>
                <SnackbarProvider>
                    <ThemeController />
                    <div className="flex flex-col relative" style={{ minHeight: '100dvh' }}>
                        <main className="flex-1 pb-20">
                            <Routes>
                                <Route path="/" element={<Navigate to="/tasks" replace />} />
                                <Route path="/tasks" element={<TasksPage />} />
                                <Route path="/habits" element={<HabitsPage />} />
                                <Route path="/character" element={<CharacterPage />} />
                                <Route path="/character/inventory" element={<InventoryPage />} />
                                <Route path="/map" element={<MapBattlePage />} />
                                <Route path="/stats" element={<StatsPage />} />
                                <Route path="/settings" element={<SettingsPage />} />
                                <Route path="/help" element={<HelpPage />} />
                                <Route path="*" element={<NotFoundPage />} />
                            </Routes>
                        </main>
                        <HelpFloatingButton />
                        <BottomNav />
                        <LevelUpOverlay />
                        <LoginBonusOverlay />
                        <ChestOpeningOverlay />
                    </div>
                </SnackbarProvider>
            </BrowserRouter>
        </ErrorBoundary>
    );
}

export default App;
