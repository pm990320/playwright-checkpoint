import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { domStatsCollector } from '../../src/collectors';
import { createCollectorContext, MockPage } from '../helpers/mock-page';

async function makeCheckpointDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'playwright-checkpoint-dom-stats-'));
}

describe('domStatsCollector', () => {
  it('captures DOM metrics and writes dom-stats.json', async () => {
    const checkpointDir = await makeCheckpointDir();
    const page = new MockPage();

    page.evaluateImpl.mockResolvedValue({
      nodeCount: 128,
      maxDepth: 9,
      formCount: 2,
      imageCount: 11,
      scriptCount: 7,
      stylesheetCount: 3,
      eventListenerCount: null,
    });

    const result = await domStatsCollector.collect(createCollectorContext({ page, checkpointDir }));

    expect(result.summary).toEqual({
      nodeCount: 128,
      maxDepth: 9,
      formCount: 2,
      imageCount: 11,
    });
    expect(result.data).toMatchObject({
      scriptCount: 7,
      stylesheetCount: 3,
      eventListenerCount: null,
    });
    expect(await fs.readFile(path.join(checkpointDir, 'dom-stats.json'), 'utf8')).toContain('"maxDepth": 9');
  });
});
