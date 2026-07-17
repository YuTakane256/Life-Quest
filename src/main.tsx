import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { startAuthSessionListener } from './platform/auth';
import { registerWebAuthStoreHooks } from './platform/authStores';
import { registerWebCloudMigrationHooks } from './platform/cloudMigration';
import { registerWebCloudSyncHooks } from './platform/cloudSync';
import { registerWebOutboxHooks } from './platform/cloudOutbox';
import { registerPendingCompletionFlush } from './platform/pendingCompletionFlush';
import { startWebCanonicalSync } from './platform/canonicalSync';

// 旧quest-board-*データのcanonical移行と、以降のストア変更の書き戻しを開始する。
// UIをブロックしない（初期化の失敗はブリッジ内で握りつぶして警告する）。
startWebCanonicalSync();

// 認証ライフサイクル: ログアウト時のストア即時クリア（ADR-009、クラウドシード後のみ作動）と
// 保存済みセッションの復元通知。Supabase未設定なら双方とも何もしない。
registerWebAuthStoreHooks();
registerWebCloudMigrationHooks(); // 初回移行はプル開始より先（#506）
registerWebCloudSyncHooks();
registerWebOutboxHooks();
registerPendingCompletionFlush(); // タブ非表示・離脱時の5秒Undo待機を即時確定（#512のMobile対策と対称）
startAuthSessionListener();

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
