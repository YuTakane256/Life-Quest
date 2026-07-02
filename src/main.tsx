import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { startWebCanonicalSync } from './platform/canonicalSync';

// 旧quest-board-*データのcanonical移行と、以降のストア変更の書き戻しを開始する。
// UIをブロックしない（初期化の失敗はブリッジ内で握りつぶして警告する）。
startWebCanonicalSync();

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
