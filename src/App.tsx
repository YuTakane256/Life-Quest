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
import { ThemeController } from './components/ui/ThemeController';
import './App.css';

function App() {
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
                </div>
            </SnackbarProvider>
        </BrowserRouter>
    );
}

export default App;
