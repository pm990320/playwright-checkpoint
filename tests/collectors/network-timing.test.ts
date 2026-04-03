import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { networkTimingCollector } from '../../src/collectors';
import { createCollectorContext, MockPage } from '../helpers/mock-page';

async function makeCheckpointDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'playwright-checkpoint-network-timing-'));
}

describe('networkTimingCollector', () => {
  it('tracks response timing incrementally between checkpoints', async () => {
    const firstDir = await makeCheckpointDir();
    const secondDir = await makeCheckpointDir();
    const page = new MockPage();

    await networkTimingCollector.setup?.({ page: page.asPage(), testInfo: {} as never });

    page.emit('response', {
      url: () => 'https://example.com/app.js',
      status: () => 200,
      statusText: () => 'OK',
      request: () => ({
        resourceType: () => 'script',
      }),
    });
    page.emit('response', {
      url: () => 'https://example.com/api/items',
      status: () => 201,
      statusText: () => 'Created',
      request: () => ({
        resourceType: () => 'xhr',
      }),
    });

    page.evaluateImpl.mockResolvedValue([
      {
        name: 'https://example.com/app.js',
        duration: 42.5,
        transferSize: 1024,
        encodedBodySize: 800,
        decodedBodySize: 2048,
        nextHopProtocol: 'h2',
        startTime: 1,
        redirectStart: 0,
        redirectEnd: 0,
        domainLookupStart: 1,
        domainLookupEnd: 2,
        connectStart: 2,
        connectEnd: 4,
        secureConnectionStart: 3,
        requestStart: 5,
        responseStart: 20,
        responseEnd: 43,
      },
      {
        name: 'https://example.com/api/items',
        duration: 10,
        transferSize: 256,
        encodedBodySize: 200,
        decodedBodySize: 300,
        nextHopProtocol: 'h2',
        startTime: 50,
        redirectStart: 0,
        redirectEnd: 0,
        domainLookupStart: 51,
        domainLookupEnd: 52,
        connectStart: 52,
        connectEnd: 53,
        secureConnectionStart: 52.2,
        requestStart: 54,
        responseStart: 56,
        responseEnd: 60,
      },
    ]);

    const first = await networkTimingCollector.collect(createCollectorContext({ page, checkpointDir: firstDir }));

    page.emit('response', {
      url: () => 'https://example.com/style.css',
      status: () => 200,
      statusText: () => 'OK',
      request: () => ({
        resourceType: () => 'stylesheet',
      }),
    });

    page.evaluateImpl.mockResolvedValue([
      {
        name: 'https://example.com/app.js',
        duration: 42.5,
        transferSize: 1024,
        encodedBodySize: 800,
        decodedBodySize: 2048,
        nextHopProtocol: 'h2',
        startTime: 1,
        redirectStart: 0,
        redirectEnd: 0,
        domainLookupStart: 1,
        domainLookupEnd: 2,
        connectStart: 2,
        connectEnd: 4,
        secureConnectionStart: 3,
        requestStart: 5,
        responseStart: 20,
        responseEnd: 43,
      },
      {
        name: 'https://example.com/api/items',
        duration: 10,
        transferSize: 256,
        encodedBodySize: 200,
        decodedBodySize: 300,
        nextHopProtocol: 'h2',
        startTime: 50,
        redirectStart: 0,
        redirectEnd: 0,
        domainLookupStart: 51,
        domainLookupEnd: 52,
        connectStart: 52,
        connectEnd: 53,
        secureConnectionStart: 52.2,
        requestStart: 54,
        responseStart: 56,
        responseEnd: 60,
      },
      {
        name: 'https://example.com/style.css',
        duration: 8,
        transferSize: 512,
        encodedBodySize: 500,
        decodedBodySize: 700,
        nextHopProtocol: 'h2',
        startTime: 70,
        redirectStart: 0,
        redirectEnd: 0,
        domainLookupStart: 70,
        domainLookupEnd: 70.5,
        connectStart: 70.5,
        connectEnd: 71,
        secureConnectionStart: 70.7,
        requestStart: 71.2,
        responseStart: 74,
        responseEnd: 78,
      },
    ]);

    const second = await networkTimingCollector.collect(createCollectorContext({ page, checkpointDir: secondDir }));
    await networkTimingCollector.teardown?.({ page: page.asPage(), testInfo: {} as never });

    expect(first.summary).toEqual({
      requestCount: 2,
      totalBytes: 1280,
      slowestRequestMs: 42.5,
    });
    expect(first.data).toMatchObject({
      requests: [
        {
          url: 'https://example.com/app.js',
          resourceType: 'script',
          durationMs: 42.5,
          transferSize: 1024,
        },
        {
          url: 'https://example.com/api/items',
          resourceType: 'xhr',
          durationMs: 10,
          transferSize: 256,
        },
      ],
    });

    expect(second.summary).toEqual({
      requestCount: 1,
      totalBytes: 512,
      slowestRequestMs: 8,
    });
    expect(second.data).toMatchObject({
      requests: [
        {
          url: 'https://example.com/style.css',
          resourceType: 'stylesheet',
          durationMs: 8,
          transferSize: 512,
        },
      ],
    });

    expect(await fs.readFile(path.join(firstDir, 'network-timing.json'), 'utf8')).toContain('app.js');
    expect(page.listenerCount('response')).toBe(0);
  });
});
