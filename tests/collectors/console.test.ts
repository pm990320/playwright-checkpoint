import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { consoleCollector } from '../../src/collectors';
import { createCollectorContext, MockPage } from '../helpers/mock-page';

async function makeCheckpointDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'playwright-checkpoint-console-'));
}

describe('consoleCollector', () => {
  it('tracks console errors incrementally between checkpoints', async () => {
    const firstDir = await makeCheckpointDir();
    const secondDir = await makeCheckpointDir();
    const page = new MockPage();

    await consoleCollector.setup?.({ page: page.asPage(), testInfo: {} as never });

    page.emit('console', {
      type: () => 'error',
      text: () => 'first error',
      location: () => ({ url: 'https://example.com/app.js', lineNumber: 10, columnNumber: 3 }),
    });
    page.emit('console', {
      type: () => 'warning',
      text: () => 'ignore me',
      location: () => ({ url: 'https://example.com/app.js', lineNumber: 9, columnNumber: 1 }),
    });
    page.emit('pageerror', new Error('boom'));

    const first = await consoleCollector.collect(createCollectorContext({ page, checkpointDir: firstDir }));

    page.emit('console', {
      type: () => 'error',
      text: () => 'second error',
      location: () => ({ url: 'https://example.com/next.js', lineNumber: 1, columnNumber: 2 }),
    });

    const second = await consoleCollector.collect(createCollectorContext({ page, checkpointDir: secondDir }));
    await consoleCollector.teardown?.({ page: page.asPage(), testInfo: {} as never });

    expect(first.summary).toEqual({ consoleErrorCount: 2 });
    expect(first.data).toMatchObject([
      { type: 'error', text: 'first error' },
      { type: 'pageerror', text: 'boom' },
    ]);
    expect(second.summary).toEqual({ consoleErrorCount: 1 });
    expect(second.data).toMatchObject([{ type: 'error', text: 'second error' }]);
    expect(await fs.readFile(path.join(firstDir, 'console-errors.json'), 'utf8')).toContain('first error');
    expect(page.listenerCount('console')).toBe(0);
    expect(page.listenerCount('pageerror')).toBe(0);
  });
});
