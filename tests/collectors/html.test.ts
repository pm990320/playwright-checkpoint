import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { htmlCollector } from '../../src/collectors';
import { createCollectorContext, MockPage } from '../helpers/mock-page';

async function makeCheckpointDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'playwright-checkpoint-html-'));
}

describe('htmlCollector', () => {
  it('captures page HTML with settle-and-retry behavior', async () => {
    const checkpointDir = await makeCheckpointDir();
    const page = new MockPage();
    page.contentImpl
      .mockRejectedValueOnce(new Error('transient content failure'))
      .mockResolvedValueOnce('<html><body>ok</body></html>');

    const result = await htmlCollector.collect(createCollectorContext({ page, checkpointDir }));

    expect(page.waitForLoadStateImpl).toHaveBeenCalledTimes(4);
    expect(page.waitForTimeoutImpl).toHaveBeenCalledWith(500);
    expect(result.data).toEqual({ contentLength: '<html><body>ok</body></html>'.length });
    expect(result.summary).toEqual({ htmlPath: 'page.html' });
    expect(await fs.readFile(path.join(checkpointDir, 'page.html'), 'utf8')).toBe('<html><body>ok</body></html>');
  });
});
