import fs from 'node:fs/promises';
import path from 'node:path';
import type { ConsoleMessage, Page } from '@playwright/test';
import type { CheckpointCollector, ConsoleErrorRecord } from '../types';

type ConsoleCollectorState = {
  entries: ConsoleErrorRecord[];
  offset: number;
  recordConsoleMessage: (message: ConsoleMessage) => void | Promise<void>;
  recordPageError: (error: Error) => void;
};

const consoleStates = new WeakMap<Page, ConsoleCollectorState>();

function getLocation(message: ConsoleMessage): ConsoleErrorRecord['location'] {
  const location = message.location();
  if (!location.url && location.lineNumber == null && location.columnNumber == null) {
    return null;
  }

  return {
    ...(location.url ? { url: location.url } : {}),
    ...(location.lineNumber == null ? {} : { lineNumber: location.lineNumber }),
    ...(location.columnNumber == null ? {} : { columnNumber: location.columnNumber }),
  };
}

export const consoleCollector: CheckpointCollector = {
  name: 'console',
  defaultEnabled: true,

  async setup({ page }) {
    if (consoleStates.has(page)) {
      return;
    }

    const entries: ConsoleErrorRecord[] = [];

    const recordConsoleMessage = (message: ConsoleMessage): void => {
      if (message.type() !== 'error') {
        return;
      }

      entries.push({
        type: message.type(),
        text: message.text(),
        location: getLocation(message),
        timestamp: new Date().toISOString(),
      });
    };

    const recordPageError = (error: Error): void => {
      entries.push({
        type: 'pageerror',
        text: error.message,
        location: null,
        timestamp: new Date().toISOString(),
      });
    };

    page.on('console', recordConsoleMessage);
    page.on('pageerror', recordPageError);

    consoleStates.set(page, {
      entries,
      offset: 0,
      recordConsoleMessage,
      recordPageError,
    });
  },

  async collect(ctx) {
    const state = consoleStates.get(ctx.page);
    const checkpointEntries = state ? state.entries.slice(state.offset) : [];

    if (state) {
      state.offset = state.entries.length;
    }

    const outputPath = path.join(ctx.checkpointDir, 'console-errors.json');
    await fs.writeFile(outputPath, `${JSON.stringify(checkpointEntries, null, 2)}\n`, 'utf8');

    return {
      data: checkpointEntries,
      artifacts: [
        {
          name: 'console-errors',
          path: outputPath,
          contentType: 'application/json',
        },
      ],
      summary: {
        consoleErrorCount: checkpointEntries.length,
      },
    };
  },

  async teardown({ page }) {
    const state = consoleStates.get(page);
    if (!state) {
      return;
    }

    page.off('console', state.recordConsoleMessage);
    page.off('pageerror', state.recordPageError);
    consoleStates.delete(page);
  },
};
