import { expect, test } from '@playwright/test';

for (const theme of ['light', 'dark'] as const) for (const width of [320, 402, 1280]) {
    test(`${theme} ${width}px: past failure keeps offline waiting visible and the sync button readable`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 874 });
        // Isolate the platform input. The real component, shared message rules and CSS render normally.
        // No Supabase configuration, test-account session or production storage is loaded.
        const state = {
            availability: 'offline', attention: 'required',
            push: { availability: 'ready', pending: 4, inflight: 1, failed: 1, conflict: 0,
                oldestPendingAt: null, lastPushSuccessAt: null, failureKinds: [] },
            pull: { phase: 'failed', lastSuccessAt: null },
        };
        await page.route('**/src/platform/cloudSync.ts*', (route) => route.fulfill({
            contentType: 'application/javascript',
            body: `const state=${JSON.stringify(state)};
                export const getWebCloudSyncState=()=>state;
                export const subscribeWebCloudSyncState=(listener)=>{listener(state);return ()=>{};};
                export const syncWebNow=async()=>{};`,
        }));
        await page.goto(`/e2e/fixtures/cloud-sync-feedback.html?theme=${theme}`);
        const region = page.getByRole('region', { name: '同期', exact: true });
        await expect(region.getByRole('alert')).toContainText('自動再送しません。オフラインです。接続後に同期する変更: 5件');
        const button = region.getByRole('button', { name: '今すぐ同期', exact: true });
        await expect(button).toBeDisabled();
        const layout = await button.evaluate((element) => {
            const text = Array.from(element.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim() === '今すぐ同期');
            if (!text) throw new Error('Sync button label is missing');
            const range = document.createRange(); range.selectNode(text);
            const bounds = element.getBoundingClientRect();
            const card = element.closest('section')!.getBoundingClientRect();
            return { labelLines: range.getClientRects().length, insideCard: bounds.left >= card.left && bounds.right <= card.right,
                noOverflow: document.documentElement.scrollWidth <= innerWidth };
        });
        expect(layout).toEqual({ labelLines: 1, insideCard: true, noOverflow: true });
        await region.screenshot({ path: testInfo.outputPath(`sync-feedback-${theme}-${width}.png`) });
    });
}
