import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { networkCollector } from '../../src/collectors';
import { createCollectorContext, MockPage } from '../helpers/mock-page';

async function makeCheckpointDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'playwright-checkpoint-network-'));
}

describe('networkCollector', () => {
  it('tracks failed requests incrementally between checkpoints', async () => {
    const firstDir = await makeCheckpointDir();
    const secondDir = await makeCheckpointDir();
    const page = new MockPage();

    await networkCollector.setup?.({ page: page.asPage(), testInfo: {} as never });

    page.emit('requestfailed', {
      url: () => 'https://example.com/api/fail',
      method: () => 'GET',
      failure: () => ({ errorText: 'net::ERR_FAILED' }),
    });
    page.emit('response', {
      status: () => 404,
      url: () => 'https://example.com/missing',
      request: () => ({ method: () => 'POST' }),
      statusText: () => 'Not Found',
    });
    page.emit('response', {
      status: () => 200,
      url: () => 'https://example.com/ok',
      request: () => ({ method: () => 'GET' }),
      statusText: () => 'OK',
    });

    const first = await networkCollector.collect(createCollectorContext({ page, checkpointDir: firstDir }));

    page.emit('response', {
      status: () => 500,
      url: () => 'https://example.com/error',
      request: () => ({ method: () => 'GET' }),
      statusText: () => 'Internal Server Error',
    });

    const second = await networkCollector.collect(createCollectorContext({ page, checkpointDir: secondDir }));
    await networkCollector.teardown?.({ page: page.asPage(), testInfo: {} as never });

    expect(first.summary).toEqual({ failedRequestCount: 2 });
    expect(first.data).toMatchObject([
      { kind: 'requestfailed', url: 'https://example.com/api/fail' },
      { kind: 'http-error', url: 'https://example.com/missing', status: 404 },
    ]);
    expect(second.summary).toEqual({ failedRequestCount: 1 });
    expect(second.data).toMatchObject([{ kind: 'http-error', url: 'https://example.com/error', status: 500 }]);
    expect(await fs.readFile(path.join(firstDir, 'failed-requests.json'), 'utf8')).toContain('ERR_FAILED');
    expect(page.listenerCount('requestfailed')).toBe(0);
    expect(page.listenerCount('response')).toBe(0);
  });
});
