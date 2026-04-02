import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screenshotCollector } from '../../src/collectors';
import { createCollectorContext, MockPage } from '../helpers/mock-page';

async function makeCheckpointDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'playwright-checkpoint-screenshot-'));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('screenshotCollector', () => {
  it('captures a screenshot and records optional highlight bounds', async () => {
    const checkpointDir = await makeCheckpointDir();
    const page = new MockPage();
    page.locatorBoundingBoxImpl.mockResolvedValue({ x: 10, y: 20, width: 30, height: 40 });
    page.screenshotImpl.mockImplementation(async (options?: unknown) => {
      const screenshotPath = (options as { path: string }).path;
      await fs.writeFile(screenshotPath, 'png');
    });

    const result = await screenshotCollector.collect(
      createCollectorContext({
        page,
        checkpointDir,
        checkpointOptions: {
          fullPage: false,
          highlightSelector: '#hero',
        },
      }),
    );

    expect(page.screenshotImpl).toHaveBeenCalledWith({ path: path.join(checkpointDir, 'page.png'), fullPage: false });
    expect(result.data).toEqual({
      fullPage: false,
      highlightBounds: { x: 10, y: 20, width: 30, height: 40 },
    });
    expect(result.artifacts).toEqual([
      {
        name: 'screenshot',
        path: path.join(checkpointDir, 'page.png'),
        contentType: 'image/png',
      },
    ]);
    expect(result.summary).toEqual({ screenshotPath: 'page.png' });
    expect(await fs.readFile(path.join(checkpointDir, 'page.png'), 'utf8')).toBe('png');
  });
});
