import React from 'react';
import { createRoot } from 'react-dom/client';
import { CloudSyncSettings } from '../../src/components/ui/CloudSyncSettings';
import '../../src/index.css';

const theme = new URL(location.href).searchParams.get('theme');
document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
createRoot(document.getElementById('fixture')!).render(React.createElement(CloudSyncSettings));
