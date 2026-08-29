import { describe, expect, it } from 'vitest';
import dependabotConfig from '../../.github/dependabot.yml?raw';
import auditWorkflow from '../../.github/workflows/dependency-audit.yml?raw';

describe('dependency automation policy', () => {
    it('monitors npm and GitHub Actions dependencies every week', () => {
        expect(dependabotConfig).toContain('package-ecosystem: npm');
        expect(dependabotConfig).toContain('package-ecosystem: github-actions');
        expect(dependabotConfig.match(/interval: weekly/g)).toHaveLength(2);
        expect(dependabotConfig).toContain('dependency-type: production');
        expect(dependabotConfig).toContain('dependency-type: development');
    });

    it('groups routine updates but leaves major upgrades isolated', () => {
        expect(dependabotConfig.match(/- minor/g)).toHaveLength(2);
        expect(dependabotConfig.match(/- patch/g)).toHaveLength(2);
        expect(dependabotConfig).not.toContain('- major');
    });

    it('keeps Expo-coupled native packages on their current minor versions', () => {
        for (const dependency of [
            'react-native',
            'react-native-safe-area-context',
            'react-native-screens',
        ]) {
            const block = dependabotConfig
                .split(`dependency-name: ${dependency}`)[1]
                ?.split('- dependency-name:')[0];

            expect(block).toContain('version-update:semver-minor');
            expect(block).toContain('version-update:semver-major');
            expect(block).not.toContain('version-update:semver-patch');
        }
    });

    it('excludes typescript major upgrades until typescript-eslint supports them (#553)', () => {
        expect(dependabotConfig).toContain('dependency-name: typescript');
        expect(dependabotConfig).toContain('version-update:semver-major');
    });

    it('runs a least-privilege production audit on a schedule and on demand', () => {
        expect(auditWorkflow).toContain("cron: '0 0 * * 1'");
        expect(auditWorkflow).toContain('workflow_dispatch:');
        expect(auditWorkflow).toContain('permissions:\n  contents: read');
        expect(auditWorkflow).toContain('npm audit --package-lock-only --omit=dev --audit-level=high');
    });

    it('pins every third-party action to a full commit SHA', () => {
        const actionReferences = [...auditWorkflow.matchAll(/uses:\s+([^\s]+)/g)].map((match) => match[1]);
        expect(actionReferences.length).toBeGreaterThan(0);
        for (const reference of actionReferences) {
            expect(reference).toMatch(/^[^@]+@[a-f0-9]{40}$/);
        }
        expect(auditWorkflow).toContain('persist-credentials: false');
    });
});
