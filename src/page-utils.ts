import type { Page } from '@playwright/test';

export async function settlePage(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  await page.waitForLoadState('load', { timeout: 3_000 }).catch(() => undefined);
}
