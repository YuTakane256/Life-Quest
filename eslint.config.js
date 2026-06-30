import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default tseslint.config(
    { ignores: ['dist', 'node_modules', 'dev-dist'] },
    {
        extends: [js.configs.recommended, ...tseslint.configs.recommended],
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
            ecmaVersion: 2022,
            globals: globals.browser,
        },
        plugins: {
            'react-hooks': reactHooks,
            'react-refresh': reactRefresh,
        },
        rules: {
            ...reactHooks.configs.recommended.rules,
            'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
            // 既存コードの noisy パターンを許容
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
        },
    },
    {
        files: ['packages/core/src/**/*.{ts,tsx}'],
        rules: {
            'no-restricted-imports': ['error', {
                paths: [
                    { name: 'react', message: 'Shared core must not depend on React.' },
                    { name: 'react-dom', message: 'Shared core must not depend on React DOM.' },
                    { name: 'react-router-dom', message: 'Shared core must not depend on Web routing.' },
                    { name: 'zustand', message: 'Shared core must not depend on client state stores.' },
                ],
                patterns: [
                    {
                        group: ['../*'],
                        message: 'Shared core may only import sibling core modules.',
                    },
                ],
            }],
            'no-restricted-globals': ['error',
                { name: 'window', message: 'Shared core must not use browser APIs.' },
                { name: 'document', message: 'Shared core must not use browser APIs.' },
                { name: 'navigator', message: 'Shared core must not use browser APIs.' },
                { name: 'localStorage', message: 'Use a platform storage adapter outside shared core.' },
                { name: 'sessionStorage', message: 'Use a platform storage adapter outside shared core.' },
            ],
        },
    },
);
