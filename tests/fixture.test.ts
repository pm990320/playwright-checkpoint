import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureCheckpointRecord,
  collectTags,
  createCheckpointManifestRecord,
  createDeviceProfile,
  resolveCollectors,
  sanitizeSegment,
  writeCheckpointManifest,
} from '../src/fixture';
import type { CheckpointCollector, CheckpointConfig, TestCheckpointConfig } from '../src/types';
import { MockPage, createMockTestInfo } from './helpers/mock-page';

function disableBuiltinCollectors(): CheckpointConfig['collectors'] {
  return {
    screenshot: false,
    html: false,
    axe: false,
    'web-vitals': false,
    console: false,
    network: false,
    metadata: false,
  };
}

async function makeOutputDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'playwright-checkpoint-fixture-'));
}

function createPipelineTestInfo(outputDir: string, overrides: Record<string, unknown> = {}) {
  return createMockTestInfo({
    title: 'Checkout flow @smoke',
    testId: 'test-1',
    tags: ['@direct-tag'],
    project: {
      name: 'mobile-light',
      use: {
        isMobile: true,
      },
    },
    titlePath: () => ['Checkout suite @checkout', 'Checkout flow @smoke'],
    outputPath: (...parts: string[]) => path.join(outputDir, ...parts),
    attach: vi.fn(async () => undefined),
    ...overrides,
  });
}

afterEach(() => {
  delete process.env.PLAYWRIGHT_CHECKPOINT_ENV;
  vi.restoreAllMocks();
});

describe('resolveCollectors', () => {
  it('merges global, per-test, and per-checkpoint collector config in precedence order', () => {
    const globalConfig: CheckpointConfig = {
      collectors: {
        screenshot: true,
        html: { pretty: true, redactEmails: true },
        axe: false,
      },
    };

    const testConfig: TestCheckpointConfig = {
      collectors: {
        screenshot: false,
        html: { minify: true },
        axe: true,
      },
    };

    const result = resolveCollectors(globalConfig, testConfig, {
      collectors: {
        screenshot: { quality: 80 },
        html: { minify: false, keepComments: true },
        forms: true,
      },
    });

    expect(Object.fromEntries(result)).toEqual({
      screenshot: { quality: 80 },
      html: { pretty: true, redactEmails: true, minify: false, keepComments: true },
      axe: {},
      forms: {},
      'web-vitals': {},
      console: {},
      network: {},
      metadata: {},
    });
  });

  it('filters disabled collectors out of the resolved set', () => {
    const result = resolveCollectors(
      {
        collectors: {
          screenshot: true,
          html: true,
          axe: true,
        },
      },
      {
        collectors: {
          html: false,
        },
      },
      {
        collectors: {
          axe: false,
        },
      },
    );

    expect([...result.keys()]).toEqual(['screenshot', 'web-vitals', 'console', 'network', 'metadata']);
  });
});

describe('checkpoint capture pipeline', () => {
  it('runs enabled collectors, skips disabled ones, and passes the expected custom collector context', async () => {
    const outputDir = await makeOutputDir();
    const page = new MockPage();
    page.urlValue = 'https://example.com/checkout';
    page.titleValue = 'Checkout';
    const testInfo = createPipelineTestInfo(outputDir);
    const manifest = createCheckpointManifestRecord(testInfo);

    const enabledCalls: unknown[] = [];
    const disabledCollect = vi.fn(async () => ({
      data: null,
      artifacts: [],
      summary: {},
    }));

    const enabledCollector: CheckpointCollector = {
      name: 'custom-enabled',
      defaultEnabled: false,
      async collect(context) {
        enabledCalls.push(context);
        const artifactPath = path.join(context.checkpointDir, 'custom.json');
        await fs.writeFile(artifactPath, JSON.stringify({ ok: true }), 'utf8');

        return {
          data: { ran: true },
          artifacts: [
            {
              name: 'custom',
              path: artifactPath,
              contentType: 'application/json',
            },
          ],
          summary: {
            collector: 'enabled',
          },
        };
      },
    };

    const disabledCollector: CheckpointCollector = {
      name: 'custom-disabled',
      defaultEnabled: true,
      collect: disabledCollect,
    };

    await captureCheckpointRecord({
      globalConfig: {
        collectors: {
          ...disableBuiltinCollectors(),
          'custom-enabled': { level: 'global' },
          'custom-disabled': false,
        },
        custom: [enabledCollector, disabledCollector],
      },
      page: page.asPage(),
      testInfo,
      checkpointManifest: manifest,
      testConfig: {
        collectors: {
          'custom-enabled': { level: 'test', retries: 2 },
        },
      },
      name: 'Checkout / Final Review',
      options: {
        description: 'Per-checkpoint description',
        step: 2,
        collectors: {
          'custom-enabled': { retries: 3, source: 'checkpoint' },
        },
      },
    });

    expect(disabledCollect).not.toHaveBeenCalled();
    expect(enabledCalls).toHaveLength(1);

    expect(enabledCalls[0]).toMatchObject({
      checkpointName: 'Checkout / Final Review',
      checkpointSlug: 'checkout-final-review',
      checkpointDir: path.join(outputDir, 'checkpoints', 'checkout-final-review'),
      config: {
        level: 'test',
        retries: 3,
        source: 'checkpoint',
      },
      options: {
        description: 'Per-checkpoint description',
        step: 2,
        collectors: {
          'custom-enabled': {
            retries: 3,
            source: 'checkpoint',
          },
        },
      },
      page: page.asPage(),
      testInfo,
    });

    expect(manifest.checkpoints).toHaveLength(1);
    expect(manifest.checkpoints[0]).toMatchObject({
      name: 'Checkout / Final Review',
      slug: 'checkout-final-review',
      url: 'https://example.com/checkout',
      title: 'Checkout',
      description: 'Per-checkpoint description',
      step: 2,
      collectors: {
        'custom-enabled': {
          data: { ran: true },
          summary: { collector: 'enabled' },
        },
      },
    });

    expect(testInfo.attach).toHaveBeenCalledWith('checkout-final-review/custom-enabled/custom', {
      path: path.join(outputDir, 'checkpoints', 'checkout-final-review', 'custom.json'),
      contentType: 'application/json',
    });
  });

  it('creates and writes checkpoint manifests with populated fields', async () => {
    process.env.PLAYWRIGHT_CHECKPOINT_ENV = 'staging';

    const outputDir = await makeOutputDir();
    const page = new MockPage();
    page.urlValue = 'https://example.com/account';
    page.titleValue = 'Account';

    const collector: CheckpointCollector = {
      name: 'custom',
      defaultEnabled: true,
      async collect(context) {
        const artifactPath = path.join(context.checkpointDir, 'manifest-artifact.json');
        await fs.writeFile(artifactPath, JSON.stringify({ slug: context.checkpointSlug }), 'utf8');

        return {
          data: { slug: context.checkpointSlug },
          artifacts: [
            {
              name: 'manifest-artifact',
              path: artifactPath,
              contentType: 'application/json',
            },
          ],
          summary: {
            ok: true,
          },
        };
      },
    };

    const testInfo = createPipelineTestInfo(outputDir, {
      title: 'Account story @regression',
      tags: ['@direct-tag', '@manual'],
      titlePath: () => ['Authenticated suite @checkout', 'Account story @regression'],
      project: {
        name: 'desktop-light',
        use: {
          isMobile: false,
        },
      },
    });

    const manifest = createCheckpointManifestRecord(testInfo);

    await captureCheckpointRecord({
      globalConfig: {
        collectors: {
          ...disableBuiltinCollectors(),
          custom: true,
        },
        custom: [collector],
      },
      page: page.asPage(),
      testInfo,
      checkpointManifest: manifest,
      name: 'Account Overview',
    });

    const manifestPath = await writeCheckpointManifest(testInfo, manifest);
    const written = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
      environment: string;
      project: string;
      title: string;
      tags: string[];
      checkpoints: Array<{ name: string; collectors: Record<string, unknown> }>;
    };

    expect(written.environment).toBe('staging');
    expect(written.project).toBe('desktop-light');
    expect(written.title).toBe('Account story @regression');
    expect(written.tags.sort()).toEqual(['@checkout', '@direct-tag', '@manual', '@regression']);
    expect(written.checkpoints).toHaveLength(1);
    expect(written.checkpoints[0]).toMatchObject({
      name: 'Account Overview',
      collectors: {
        custom: {
          summary: { ok: true },
        },
      },
    });
  });

  it('gracefully degrades when a collector throws', async () => {
    const outputDir = await makeOutputDir();
    const page = new MockPage();
    const testInfo = createPipelineTestInfo(outputDir);
    const manifest = createCheckpointManifestRecord(testInfo);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const failingCollector: CheckpointCollector = {
      name: 'broken',
      defaultEnabled: true,
      async collect() {
        throw new Error('boom');
      },
    };

    const healthyCollector: CheckpointCollector = {
      name: 'healthy',
      defaultEnabled: true,
      async collect() {
        return {
          data: { ok: true },
          artifacts: [],
          summary: { ok: true },
        };
      },
    };

    const record = await captureCheckpointRecord({
      globalConfig: {
        collectors: {
          ...disableBuiltinCollectors(),
          broken: true,
          healthy: true,
        },
        custom: [failingCollector, healthyCollector],
      },
      page: page.asPage(),
      testInfo,
      checkpointManifest: manifest,
      name: 'Resilient checkpoint',
    });

    expect(record.collectors).toEqual({
      healthy: {
        data: { ok: true },
        artifacts: [],
        summary: { ok: true },
      },
    });
    expect(warnSpy).toHaveBeenCalledWith(
      '[playwright-checkpoint] Collector "broken" failed during checkpoint "Resilient checkpoint".',
      expect.any(Error),
    );
    expect(manifest.checkpoints).toHaveLength(1);
  });
});

describe('sanitizeSegment', () => {
  it('creates lowercase, dash-separated slugs', () => {
    expect(sanitizeSegment('  Login Form / Step 1  ')).toBe('login-form-step-1');
  });

  it('handles special characters, empty strings, and unicode-only values', () => {
    expect(sanitizeSegment('!!! Settings && Billing ???')).toBe('settings-billing');
    expect(sanitizeSegment('   ')).toBe('checkpoint');
    expect(sanitizeSegment('Über Café')).toBe('ber-caf');
    expect(sanitizeSegment('東京')).toBe('checkpoint');
  });
});

describe('collectTags', () => {
  it('extracts lowercase tags from title parts', () => {
    expect(
      Array.from(collectTags(['Checkout flow @Smoke @Auth', 'Nested suite @regression', 'No tags here'])).sort(),
    ).toEqual(['@auth', '@regression', '@smoke']);
  });

  it('handles punctuation, dedupes repeated tags, and preserves numeric or hyphenated tags', () => {
    expect(
      Array.from(
        collectTags(['Flow (@SMOKE) @release-2026', 'Suite: @smoke @auth-login @e2e-1', 'Nothing here']),
      ).sort(),
    ).toEqual(['@auth-login', '@e2e-1', '@release-2026', '@smoke']);
  });
});

describe('createDeviceProfile', () => {
  it('derives mobile and desktop surfaces from project.use.isMobile', () => {
    expect(
      createDeviceProfile(
        createPipelineTestInfo('/tmp/device-mobile', {
          project: {
            name: 'mobile-dark',
            use: {
              isMobile: true,
            },
          },
        }),
      ),
    ).toEqual({
      name: 'mobile-dark',
      isMobile: true,
      surface: 'mobile',
    });

    expect(
      createDeviceProfile(
        createPipelineTestInfo('/tmp/device-desktop', {
          project: {
            name: 'desktop-light',
            use: {
              isMobile: false,
            },
          },
        }),
      ),
    ).toEqual({
      name: 'desktop-light',
      isMobile: false,
      surface: 'desktop',
    });
  });
});
