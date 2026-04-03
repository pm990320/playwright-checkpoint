import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ariaSnapshotCollector } from '../../src/collectors';
import { createCollectorContext, MockPage } from '../helpers/mock-page';

async function makeCheckpointDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'playwright-checkpoint-aria-snapshot-'));
}

describe('ariaSnapshotCollector', () => {
  it('captures ARIA snapshot data and writes the expected artifact', async () => {
    const checkpointDir = await makeCheckpointDir();
    const page = new MockPage();

    page.locatorAriaSnapshotImpl.mockResolvedValue({
      role: 'document',
      name: 'Example',
      children: [
        { role: 'heading', name: 'Welcome' },
        { role: 'button', name: 'Continue' },
      ],
    });

    const result = await ariaSnapshotCollector.collect(createCollectorContext({ page, checkpointDir }));

    expect(result.summary).toEqual({ nodeCount: 3 });
    expect(result.data).toMatchObject({
      nodeCount: 3,
      snapshot: {
        role: 'document',
      },
    });
    expect(await fs.readFile(path.join(checkpointDir, 'aria-snapshot.json'), 'utf8')).toContain('Continue');
  });
});
