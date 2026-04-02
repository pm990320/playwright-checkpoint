import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { webVitalsCollector } from '../../src/collectors';
import { createCollectorContext, MockPage } from '../helpers/mock-page';

async function makeCheckpointDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'playwright-checkpoint-web-vitals-'));
}

describe('webVitalsCollector', () => {
  it('installs observers once and captures a rated snapshot', async () => {
    const checkpointDir = await makeCheckpointDir();
    const page = new MockPage();
    page.evaluateImpl.mockResolvedValue({
      cls: 0.05,
      fcp: 1100,
      lcp: 2400,
      inp: 180,
      ttfb: 700,
      domContentLoaded: 900,
      loadEvent: 1300,
      url: 'https://example.com/product',
    });

    await webVitalsCollector.setup?.({ page: page.asPage(), testInfo: {} as never });
    await webVitalsCollector.setup?.({ page: page.asPage(), testInfo: {} as never });
    const result = await webVitalsCollector.collect(createCollectorContext({ page, checkpointDir }));
    await webVitalsCollector.teardown?.({ page: page.asPage(), testInfo: {} as never });

    expect(page.addInitScriptImpl).toHaveBeenCalledTimes(1);
    expect(result.summary).toEqual({
      cls: { value: 0.05, rating: 'good' },
      fcp: { value: 1100, rating: 'good' },
      lcp: { value: 2400, rating: 'good' },
      inp: { value: 180, rating: 'good' },
      ttfb: { value: 700, rating: 'good' },
    });
    expect(await fs.readFile(path.join(checkpointDir, 'web-vitals.json'), 'utf8')).toContain('domContentLoadedMs');
  });
});
