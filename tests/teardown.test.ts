import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { globalTeardown } from '../src/teardown';

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
  delete process.env.PLAYWRIGHT_CHECKPOINT_RESULTS_DIR;
  delete process.env.PLAYWRIGHT_CHECKPOINT_REPORT_DIR;
  vi.restoreAllMocks();
});

describe('globalTeardown', () => {
  it('generates reports without throwing', async () => {
    const cwd = await makeTempDir('playwright-checkpoint-teardown-');
    const resultsDir = path.join(cwd, 'test-results');
    const reportDir = path.join(cwd, 'report');

    await fs.mkdir(resultsDir, { recursive: true });
    await fs.writeFile(
      path.join(resultsDir, 'checkpoint-manifest.json'),
      JSON.stringify({
        environment: 'test',
        project: 'desktop-light',
        testId: 'teardown-1',
        title: 'Teardown story',
        tags: [],
        startedAt: '2026-04-03T00:00:00.000Z',
        checkpoints: [
          {
            name: 'Landing',
            slug: 'landing',
            url: 'https://example.com',
            title: 'Landing',
            timestamp: '2026-04-03T00:00:01.000Z',
            collectors: {},
          },
        ],
      }),
      'utf8',
    );

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    process.chdir(cwd);
    await expect(globalTeardown()).resolves.toBeUndefined();

    await expect(fs.readFile(path.join(reportDir, 'index.html'), 'utf8')).resolves.toContain('Teardown story');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[playwright-checkpoint] Generated reports from '));
    expect(log).toHaveBeenCalledWith('- html: Generated HTML report for 1 story (1 run).');
    expect(error).not.toHaveBeenCalled();
  });

  it('swallows report generation failures and logs them', async () => {
    const cwd = await makeTempDir('playwright-checkpoint-teardown-error-');
    const badTarget = path.join(cwd, 'blocked-output');
    await fs.writeFile(badTarget, 'blocked', 'utf8');

    process.chdir(cwd);
    process.env.PLAYWRIGHT_CHECKPOINT_REPORT_DIR = badTarget;

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(globalTeardown()).resolves.toBeUndefined();

    expect(log).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('[playwright-checkpoint] Global teardown report generation failed.');
  });
});
