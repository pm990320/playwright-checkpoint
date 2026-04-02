import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axeCollector, setAxeLoaderForTests } from '../../src/collectors';
import { createCollectorContext, createMockTestInfo, MockPage } from '../helpers/mock-page';

async function makeCheckpointDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'playwright-checkpoint-axe-'));
}

afterEach(() => {
  setAxeLoaderForTests(null);
  vi.restoreAllMocks();
});

describe('axeCollector', () => {
  it('writes axe results when the dependency is available', async () => {
    const checkpointDir = await makeCheckpointDir();
    const page = new MockPage();
    const testInfo = createMockTestInfo();

    class FakeAxeBuilder {
      constructor(options: { page: unknown }) {
        void options;
      }

      async analyze() {
        return {
          violations: [{ id: 'color-contrast' }, { id: 'label' }],
          passes: [],
        };
      }
    }

    setAxeLoaderForTests(async () => ({ default: FakeAxeBuilder }));

    const result = await axeCollector.collect(
      createCollectorContext({
        page,
        testInfo,
        checkpointDir,
        config: { timeoutMs: 1234 },
      }),
    );

    expect(testInfo.setTimeout).toHaveBeenCalledWith(31_234);
    expect(result.summary).toEqual({ violations: 2 });
    expect((result.data as { skipped: boolean; violations: number }).skipped).toBe(false);
    expect((result.data as { skipped: boolean; violations: number }).violations).toBe(2);
    expect(await fs.readFile(path.join(checkpointDir, 'axe.json'), 'utf8')).toContain('color-contrast');
  });

  it('gracefully skips when @axe-core/playwright is unavailable', async () => {
    const checkpointDir = await makeCheckpointDir();
    const page = new MockPage();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    setAxeLoaderForTests(async () => {
      throw new Error('Cannot find module');
    });

    const result = await axeCollector.collect(createCollectorContext({ page, checkpointDir }));

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(result.artifacts).toEqual([]);
    expect(result.summary).toEqual({ violations: 0 });
    expect(result.data).toEqual({
      skipped: true,
      reason: '@axe-core/playwright is unavailable',
      violations: 0,
      results: null,
    });
  });
});
