import { EventEmitter } from 'node:events';
import type { Page, TestInfo } from '@playwright/test';
import { vi } from 'vitest';
import type { CheckpointOptions, ResolvedCollectorConfig } from '../../src/types';

export class MockPage extends EventEmitter {
  urlValue = 'https://example.com/';
  titleValue = 'Example';
  screenshotImpl = vi.fn(async () => undefined as Buffer | undefined);
  contentImpl = vi.fn(async () => '<html></html>');
  waitForLoadStateImpl = vi.fn(async () => undefined);
  waitForTimeoutImpl = vi.fn(async () => undefined);
  addInitScriptImpl = vi.fn(async () => undefined);
  evaluateImpl = vi.fn(async (fn?: unknown) => {
    if (typeof fn === 'function') {
      return (fn as () => unknown)();
    }
    return undefined;
  });
  locatorBoundingBoxImpl = vi.fn(async () => null);
  locatorAriaSnapshotImpl = vi.fn(async () => null as unknown);
  accessibilitySnapshotImpl = vi.fn(async () => null as unknown);
  contextCookiesImpl = vi.fn(async () => [] as unknown[]);

  url(): string {
    return this.urlValue;
  }

  async title(): Promise<string> {
    return this.titleValue;
  }

  async screenshot(options?: unknown): Promise<Buffer | undefined> {
    return this.screenshotImpl(options) as Promise<Buffer | undefined>;
  }

  locator(selector: string): { boundingBox: () => Promise<unknown>; ariaSnapshot: () => Promise<unknown> } {
    void selector;
    return {
      boundingBox: this.locatorBoundingBoxImpl,
      ariaSnapshot: this.locatorAriaSnapshotImpl,
    };
  }

  accessibility = {
    snapshot: (options?: unknown) => this.accessibilitySnapshotImpl(options),
  };

  context(): { cookies: () => Promise<unknown[]> } {
    return {
      cookies: this.contextCookiesImpl,
    };
  }

  async content(): Promise<string> {
    return this.contentImpl();
  }

  async waitForLoadState(state?: unknown, options?: unknown): Promise<void> {
    await this.waitForLoadStateImpl(state, options);
  }

  async waitForTimeout(ms?: number): Promise<void> {
    await this.waitForTimeoutImpl(ms);
  }

  async addInitScript(fn?: unknown): Promise<void> {
    await this.addInitScriptImpl(fn);
  }

  async evaluate<T>(fn?: unknown): Promise<T> {
    return (await this.evaluateImpl(fn)) as T;
  }

  asPage(): Page {
    return this as unknown as Page;
  }
}

export function createMockTestInfo(overrides: Partial<TestInfo> = {}): TestInfo {
  const state: { timeout: number } = {
    timeout: 30_000,
  };

  const testInfo = {
    ...overrides,
    get timeout() {
      return state.timeout;
    },
    setTimeout: vi.fn((nextTimeout: number) => {
      state.timeout = nextTimeout;
    }),
  };

  return testInfo as unknown as TestInfo;
}

export function createCollectorContext(options?: {
  page?: MockPage;
  testInfo?: TestInfo;
  checkpointDir?: string;
  checkpointName?: string;
  checkpointSlug?: string;
  redact?: string[];
  config?: ResolvedCollectorConfig;
  checkpointOptions?: CheckpointOptions;
}) {
  const page = options?.page ?? new MockPage();
  const testInfo = options?.testInfo ?? createMockTestInfo();

  return {
    page: page.asPage(),
    testInfo,
    checkpointDir: options?.checkpointDir ?? '/tmp/checkpoint',
    checkpointName: options?.checkpointName ?? 'Homepage',
    checkpointSlug: options?.checkpointSlug ?? 'homepage',
    redact: options?.redact ?? [],
    config: options?.config ?? {},
    options: options?.checkpointOptions ?? {},
  };
}
