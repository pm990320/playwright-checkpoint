import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page, Request, Response } from '@playwright/test';
import type { CheckpointCollector, FailedRequestRecord } from '../types';

type NetworkCollectorState = {
  entries: FailedRequestRecord[];
  offset: number;
  recordRequestFailure: (request: Request) => void;
  recordHttpError: (response: Response) => void;
};

const networkStates = new WeakMap<Page, NetworkCollectorState>();

export const networkCollector: CheckpointCollector = {
  name: 'network',
  defaultEnabled: true,

  async setup({ page }) {
    if (networkStates.has(page)) {
      return;
    }

    const entries: FailedRequestRecord[] = [];

    const recordRequestFailure = (request: Request): void => {
      entries.push({
        kind: 'requestfailed',
        url: request.url(),
        method: request.method(),
        status: null,
        statusText: null,
        failureText: request.failure()?.errorText ?? null,
        timestamp: new Date().toISOString(),
      });
    };

    const recordHttpError = (response: Response): void => {
      if (response.status() < 400) {
        return;
      }

      entries.push({
        kind: 'http-error',
        url: response.url(),
        method: response.request().method(),
        status: response.status(),
        statusText: response.statusText(),
        failureText: null,
        timestamp: new Date().toISOString(),
      });
    };

    page.on('requestfailed', recordRequestFailure);
    page.on('response', recordHttpError);

    networkStates.set(page, {
      entries,
      offset: 0,
      recordRequestFailure,
      recordHttpError,
    });
  },

  async collect(ctx) {
    const state = networkStates.get(ctx.page);
    const checkpointEntries = state ? state.entries.slice(state.offset) : [];

    if (state) {
      state.offset = state.entries.length;
    }

    const outputPath = path.join(ctx.checkpointDir, 'failed-requests.json');
    await fs.writeFile(outputPath, `${JSON.stringify(checkpointEntries, null, 2)}\n`, 'utf8');

    return {
      data: checkpointEntries,
      artifacts: [
        {
          name: 'failed-requests',
          path: outputPath,
          contentType: 'application/json',
        },
      ],
      summary: {
        failedRequestCount: checkpointEntries.length,
      },
    };
  },

  async teardown({ page }) {
    const state = networkStates.get(page);
    if (!state) {
      return;
    }

    page.off('requestfailed', state.recordRequestFailure);
    page.off('response', state.recordHttpError);
    networkStates.delete(page);
  },
};
