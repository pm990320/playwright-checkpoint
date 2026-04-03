/**
 * CDP connection to the browser that the upstream Playwright MCP controls.
 *
 * Strategy (in priority order):
 *  1. Explicit `--cdp-endpoint` flag (highest priority)
 *  2. Parse CDP URL from upstream stderr — Chrome prints `DevTools listening on ws://...`
 *  3. Try well-known debug port 9222 as fallback
 *  4. Auto-inject `--remote-debugging-port=9222` into upstream passthrough args
 */

import type { Browser, Page } from 'playwright-core';
import type { ChildProcess } from 'node:child_process';

// CDP WebSocket URL regex — Chrome prints this to stderr when remote debugging is on
const CDP_WS_REGEX = /DevTools listening on (ws:\/\/[^\s]+)/;

let cachedConnection: { browser: Browser; page: Page } | null = null;

/**
 * Find the CDP WebSocket URL in the upstream process's stderr output.
 */
export function extractCdpUrlFromStderr(data: string): string | null {
  const match = CDP_WS_REGEX.exec(data);
  return match ? (match[1] ?? null) : null;
}

/**
 * Lazily connect to the upstream browser via CDP and return a shared Page handle.
 *
 * The connection is cached — subsequent calls return the same handle.
 */
export async function getUpstreamPage(
  upstreamProcess: ChildProcess | null,
  options: { cdpEndpoint?: string; debugPort?: number },
): Promise<{ browser: Browser; page: Page }> {
  if (cachedConnection) {
    return cachedConnection;
  }

  let cdpEndpoint = options.cdpEndpoint;

  // 1. Explicit endpoint from flags
  if (!cdpEndpoint) {
    // 2. Parse from upstream stderr if we have the process
    if (upstreamProcess?.stderr) {
      const stderrLines: string[] = [];
      upstreamProcess.stderr.on('data', (chunk: Buffer) => {
        stderrLines.push(chunk.toString());
      });

      // Give Chrome a moment to emit the listening message
      await new Promise<void>((resolve) => setTimeout(resolve, 500));

      for (const line of stderrLines) {
        const url = extractCdpUrlFromStderr(line);
        if (url) {
          cdpEndpoint = url;
          break;
        }
      }
    }
  }

  // 3. Fall back to well-known debug port
  if (!cdpEndpoint) {
    const port = options.debugPort ?? 9222;
    cdpEndpoint = `http://localhost:${port}`;
  }

  // Connect via CDP
  const browser = await chromiumConnect(cdpEndpoint);
  const pages = await browser.contexts()[0]?.pages() ?? [];
  const page = pages[0] ?? (await browser.newPage());

  cachedConnection = { browser, page };
  return cachedConnection;
}

/* eslint-disable @typescript-eslint/no-require-imports */
function getNodeModuleCreateRequire(): NodeJS.Require {
  const { createRequire } = require('node:module');
  return createRequire(import.meta.url);
}
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Thin wrapper around playwright-core's CDP connect to allow swapping
 * the implementation during tests.
 */
export async function chromiumConnect(endpoint: string): Promise<Browser> {
  const req = getNodeModuleCreateRequire();
  const pw = req('playwright-core') as unknown as { chromium: { connectOverCDP: (url: string) => Promise<Browser> } };
  return pw.chromium.connectOverCDP(endpoint);
}

export function resetCachedConnection(): void {
  cachedConnection = null;
}
