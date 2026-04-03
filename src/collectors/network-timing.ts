import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page, Response } from '@playwright/test';
import type {
  CheckpointCollector,
  NetworkTimingCollectorData,
  NetworkTimingRecord,
} from '../types';

type ResponseEventRecord = {
  url: string;
  status: number | null;
  statusText: string | null;
  resourceType: string | null;
  timestamp: string;
};

type ResourceTimingRecord = {
  name: string;
  duration: number;
  transferSize: number;
  encodedBodySize: number;
  decodedBodySize: number;
  nextHopProtocol: string;
  startTime: number;
  redirectStart: number;
  redirectEnd: number;
  domainLookupStart: number;
  domainLookupEnd: number;
  connectStart: number;
  connectEnd: number;
  secureConnectionStart: number;
  requestStart: number;
  responseStart: number;
  responseEnd: number;
};

type NetworkTimingCollectorState = {
  responses: ResponseEventRecord[];
  responseOffset: number;
  resourceOffsetByUrl: Map<string, number>;
  recordResponse: (response: Response) => void;
};

const timingStates = new WeakMap<Page, NetworkTimingCollectorState>();

function maybeDuration(start: number, end: number): number | null {
  if (start <= 0 || end <= 0 || end < start) {
    return null;
  }

  return end - start;
}

function toNetworkRecord(response: ResponseEventRecord, timing: ResourceTimingRecord | null): NetworkTimingRecord {
  return {
    url: response.url,
    status: response.status,
    statusText: response.statusText,
    resourceType: response.resourceType,
    timestamp: response.timestamp,
    durationMs: timing ? timing.duration : null,
    transferSize: timing ? timing.transferSize : null,
    encodedBodySize: timing ? timing.encodedBodySize : null,
    decodedBodySize: timing ? timing.decodedBodySize : null,
    nextHopProtocol: timing ? timing.nextHopProtocol || null : null,
    timing: {
      startTimeMs: timing ? timing.startTime : null,
      redirectMs: timing ? maybeDuration(timing.redirectStart, timing.redirectEnd) : null,
      dnsMs: timing ? maybeDuration(timing.domainLookupStart, timing.domainLookupEnd) : null,
      connectMs: timing ? maybeDuration(timing.connectStart, timing.connectEnd) : null,
      tlsMs: timing ? maybeDuration(timing.secureConnectionStart, timing.connectEnd) : null,
      requestMs: timing ? maybeDuration(timing.requestStart, timing.responseStart) : null,
      responseMs: timing ? maybeDuration(timing.responseStart, timing.responseEnd) : null,
    },
  };
}

export const networkTimingCollector: CheckpointCollector = {
  name: 'network-timing',
  defaultEnabled: false,

  async setup({ page }) {
    if (timingStates.has(page)) {
      return;
    }

    const responses: ResponseEventRecord[] = [];

    const recordResponse = (response: Response): void => {
      responses.push({
        url: response.url(),
        status: response.status(),
        statusText: response.statusText(),
        resourceType: response.request().resourceType(),
        timestamp: new Date().toISOString(),
      });
    };

    page.on('response', recordResponse);

    timingStates.set(page, {
      responses,
      responseOffset: 0,
      resourceOffsetByUrl: new Map<string, number>(),
      recordResponse,
    });
  },

  async collect(ctx) {
    const state = timingStates.get(ctx.page);
    const recentResponses = state ? state.responses.slice(state.responseOffset) : [];

    if (state) {
      state.responseOffset = state.responses.length;
    }

    const resourceTimings = (await ctx.page.evaluate(() => {
      const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      return entries.map((entry) => ({
        name: entry.name,
        duration: entry.duration,
        transferSize: entry.transferSize,
        encodedBodySize: entry.encodedBodySize,
        decodedBodySize: entry.decodedBodySize,
        nextHopProtocol: entry.nextHopProtocol,
        startTime: entry.startTime,
        redirectStart: entry.redirectStart,
        redirectEnd: entry.redirectEnd,
        domainLookupStart: entry.domainLookupStart,
        domainLookupEnd: entry.domainLookupEnd,
        connectStart: entry.connectStart,
        connectEnd: entry.connectEnd,
        secureConnectionStart: entry.secureConnectionStart,
        requestStart: entry.requestStart,
        responseStart: entry.responseStart,
        responseEnd: entry.responseEnd,
      }));
    })) as ResourceTimingRecord[];

    const timingsByUrl = new Map<string, ResourceTimingRecord[]>();
    for (const timing of resourceTimings) {
      const list = timingsByUrl.get(timing.name);
      if (list) {
        list.push(timing);
      } else {
        timingsByUrl.set(timing.name, [timing]);
      }
    }

    const requests: NetworkTimingRecord[] = recentResponses.map((response) => {
      if (!state) {
        return toNetworkRecord(response, null);
      }

      const list = timingsByUrl.get(response.url) ?? [];
      const currentOffset = state.resourceOffsetByUrl.get(response.url) ?? 0;
      const match = list[currentOffset] ?? null;

      if (match) {
        state.resourceOffsetByUrl.set(response.url, currentOffset + 1);
      }

      return toNetworkRecord(response, match);
    });

    const totalBytes = requests.reduce((total, request) => {
      if (typeof request.transferSize !== 'number' || request.transferSize < 0) {
        return total;
      }

      return total + request.transferSize;
    }, 0);

    const slowestRequestMs = requests.reduce((slowest, request) => {
      if (typeof request.durationMs !== 'number') {
        return slowest;
      }

      return Math.max(slowest, request.durationMs);
    }, 0);

    const data: NetworkTimingCollectorData = {
      requestCount: requests.length,
      totalBytes,
      slowestRequestMs,
      requests,
    };

    const outputPath = path.join(ctx.checkpointDir, 'network-timing.json');
    await fs.writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');

    return {
      data,
      artifacts: [
        {
          name: 'network-timing',
          path: outputPath,
          contentType: 'application/json',
        },
      ],
      summary: {
        requestCount: data.requestCount,
        totalBytes: data.totalBytes,
        slowestRequestMs: data.slowestRequestMs,
      },
    };
  },

  async teardown({ page }) {
    const state = timingStates.get(page);
    if (!state) {
      return;
    }

    page.off('response', state.recordResponse);
    timingStates.delete(page);
  },
};
