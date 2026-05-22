import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { BottomNav } from './components/layout/BottomNav';
import { TasksPage } from './pages/TasksPage';
import { HabitsPage } from './pages/HabitsPage';
import { CharacterPage, InventoryPage } from './pages/CharacterPage';
import { MapBattlePage } from './pages/MapBattlePage';
import { StatsPage } from './pages/StatsPage';
import { SettingsPage } from './pages/SettingsPage';
import { SnackbarProvider } from './components/ui/SnackbarProvider';
import { LevelUpOverlay } from './components/ui/LevelUpOverlay';
import { LoginBonusOverlay } from './components/ui/LoginBonusOverlay';
import { ThemeController } from './components/ui/ThemeController';
import { useLoginBonusStore } from './stores/useLoginBonusStore';
import { runNotificationChecks } from './utils/notifications';
import { NOTIFICATION_CONFIG } from './config/gameConfig';
import './App.css';

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
                        </Routes>
                    </main>
                    <BottomNav />
                    <LevelUpOverlay />
                    <LoginBonusOverlay />
                </div>
            </SnackbarProvider>
        </BrowserRouter>
    );
}

export default App;
