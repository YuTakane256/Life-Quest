import { mergeConfig } from 'vite';
import baseConfig from './vite.config.ts';

// The dedicated launcher supplies verified settings. Never merge normal .env files into this session.
export default mergeConfig(baseConfig, {
    envDir: false,
    server: {
        host: '127.0.0.1', port: 4175, strictPort: true,
        fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.staging-sync.local'] },
    },
});
