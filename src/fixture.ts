import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type * as PlaywrightModule from '@playwright/test';
import type {
  Page,
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  TestInfo,
  TestType,
} from '@playwright/test';
import {
  createCheckpointSession,
  registerBuiltinCollector,
  resolveCollectors,
  sanitizeSegment,
  settlePage,
  warn,
} from './core';
import { createDeviceProfile, type DeviceProfile } from './device-profile';
import type {
  CheckpointConfig,
  CheckpointManifest,
  CheckpointOptions,
  CheckpointRecord,
  CollectorConfig,
  CollectorOptions,
  TestCheckpointConfig,
} from './types';

type PlaywrightRuntime = typeof PlaywrightModule;

type TestCheckpointConfigController = {
  set(config: TestCheckpointConfig): void;
  get(): TestCheckpointConfig | null;
};

type CheckpointFixtures = {
  checkpoint: (name: string, options?: CheckpointOptions) => Promise<CheckpointRecord>;
  checkpointManifest: CheckpointManifest;
  testCheckpointConfig: TestCheckpointConfigController;
  deviceProfile: DeviceProfile;
};

const require = (() => {
  try {
    return Function('return require')() as NodeRequire;
  } catch {
    return createRequire(path.join(process.cwd(), 'playwright-checkpoint-runtime.cjs'));
  }
})();

function loadPlaywright(): PlaywrightRuntime {
  return require('@playwright/test') as PlaywrightRuntime;
}

function mergeCollectorOverrides(
  current: Partial<Record<string, boolean | CollectorOptions>> | undefined,
  updates: Partial<Record<string, boolean | CollectorOptions>> | undefined,
): Partial<Record<string, boolean | CollectorOptions>> | undefined {
  if (!current && !updates) {
    return undefined;
  }

  const merged: Partial<Record<string, boolean | CollectorOptions>> = {
    ...(current ?? {}),
  };

  for (const [name, value] of Object.entries(updates ?? {})) {
    const previous = merged[name];

    if (value && typeof value === 'object' && !Array.isArray(value) && previous && typeof previous === 'object' && !Array.isArray(previous)) {
      merged[name] = {
        ...previous,
        ...value,
      };
      continue;
    }

    merged[name] = value;
  }

  return merged;
}

function mergeTestConfig(current: TestCheckpointConfig | null, update: TestCheckpointConfig): TestCheckpointConfig {
  const collectors = mergeCollectorOverrides(current?.collectors, update.collectors);

  return {
    description: update.description ?? current?.description,
    ...(collectors ? { collectors } : {}),
  };
}

function manifestEnvironment(): string {
  return process.env.PLAYWRIGHT_CHECKPOINT_ENV || process.env.NODE_ENV || 'test';
}

function explicitTestTags(testInfo: TestInfo): string[] {
  return (((testInfo as TestInfo & { tags?: string[] }).tags ?? []) as string[]).map((tag) => tag.toLowerCase());
}

export function titleParts(testInfo: TestInfo): string[] {
  const maybeTitlePath = (testInfo as { titlePath?: unknown }).titlePath;
  return typeof maybeTitlePath === 'function' ? maybeTitlePath.call(testInfo) : [testInfo.title];
}

export function collectTags(parts: string[]): Set<string> {
  const tags = new Set<string>();

  for (const part of parts) {
    for (const token of part.match(/@[a-z0-9-]+/gi) || []) {
      tags.add(token.toLowerCase());
    }
  }

  return tags;
}

export function manifestTags(testInfo: TestInfo): string[] {
  return Array.from(new Set([...explicitTestTags(testInfo), ...collectTags(titleParts(testInfo))]));
}

export function createCheckpointManifestRecord(testInfo: TestInfo): CheckpointManifest {
  return {
    environment: manifestEnvironment(),
    project: testInfo.project.name,
    testId: testInfo.testId,
    title: testInfo.title,
    tags: manifestTags(testInfo),
    startedAt: new Date().toISOString(),
    checkpoints: [],
  };
}

export async function writeCheckpointManifest(testInfo: TestInfo, manifest: CheckpointManifest): Promise<string> {
  const manifestPath = testInfo.outputPath('checkpoint-manifest.json');
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifestPath;
}

function createAdjustTimeout(testInfo: TestInfo): (ms: number) => void {
  return (ms: number) => {
    if (ms > 0 && typeof testInfo.setTimeout === 'function') {
      testInfo.setTimeout(testInfo.timeout + ms);
    }
  };
}

function mergeConfig(
  globalConfig: CheckpointConfig = {},
  testConfig: TestCheckpointConfig | null,
): Partial<Record<string, boolean | CollectorConfig>> | undefined {
  return mergeCollectorOverrides(
    globalConfig.collectors,
    testConfig?.collectors,
  ) as Partial<Record<string, boolean | CollectorConfig>> | undefined;
}

export async function captureCheckpointRecord(args: {
  globalConfig?: CheckpointConfig;
  page: Page;
  testInfo: TestInfo;
  checkpointManifest: CheckpointManifest;
  testConfig?: TestCheckpointConfig | null;
  name: string;
  options?: CheckpointOptions;
}): Promise<CheckpointRecord> {
  const globalConfig = args.globalConfig ?? {};
  const session = await createCheckpointSession(args.page, {
    outputDir: args.testInfo.outputPath('checkpoints'),
    manifestPath: args.testInfo.outputPath('checkpoint-manifest.json'),
    manifest: args.checkpointManifest,
    collectors: mergeConfig(globalConfig, args.testConfig ?? null),
    custom: globalConfig.custom,
    redact: globalConfig.redact,
    testInfo: args.testInfo,
    adjustTimeout: createAdjustTimeout(args.testInfo),
  });

  try {
    return await session.checkpoint(args.name, args.options);
  } finally {
    await session.finalize();
  }
}

export function createCheckpoint(globalConfig: CheckpointConfig = {}): {
  test: TestType<PlaywrightTestArgs & PlaywrightTestOptions & CheckpointFixtures, PlaywrightWorkerArgs & PlaywrightWorkerOptions>;
} {
  const playwright = loadPlaywright();
  const base = playwright.test as TestType<
    PlaywrightTestArgs & PlaywrightTestOptions,
    PlaywrightWorkerArgs & PlaywrightWorkerOptions
  >;

  const test = base.extend<CheckpointFixtures>({
    checkpointManifest: [
      async ({}, use, testInfo) => {
        const manifest = createCheckpointManifestRecord(testInfo);

        try {
          await use(manifest);
        } finally {
          try {
            await writeCheckpointManifest(testInfo, manifest);
          } catch (error) {
            warn(`Failed to write checkpoint manifest for test "${testInfo.title}".`, error);
          }
        }
      },
      { auto: true },
    ],

    testCheckpointConfig: async ({}, use) => {
      let current: TestCheckpointConfig | null = null;

      const controller: TestCheckpointConfigController = {
        set(config) {
          current = mergeTestConfig(current, config);
        },
        get() {
          return current
            ? {
                ...current,
                ...(current.collectors ? { collectors: mergeCollectorOverrides(undefined, current.collectors) } : {}),
              }
            : null;
        },
      };

      await use(controller);
    },

    deviceProfile: async ({}, use, testInfo) => {
      await use(createDeviceProfile(testInfo));
    },

    checkpoint: async ({ page, checkpointManifest, testCheckpointConfig }, use, testInfo) => {
      const session = await createCheckpointSession(page, {
        outputDir: testInfo.outputPath('checkpoints'),
        manifestPath: testInfo.outputPath('checkpoint-manifest.json'),
        manifest: checkpointManifest,
        collectors: mergeConfig(globalConfig, testCheckpointConfig.get()),
        custom: globalConfig.custom,
        redact: globalConfig.redact,
        testInfo,
        adjustTimeout: createAdjustTimeout(testInfo),
      });

      try {
        await use((name, options = {}) => session.checkpoint(name, options));
      } finally {
        await session.finalize();
      }
    },
  });

  return { test };
}

export const expect = loadPlaywright().expect;
export const { test } = createCheckpoint();
export { createCheckpointSession, createDeviceProfile, registerBuiltinCollector, resolveCollectors, sanitizeSegment, settlePage, warn };
export type { DeviceProfile, TestCheckpointConfigController };
