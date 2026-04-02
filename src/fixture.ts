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
import { builtinCollectors as defaultBuiltinCollectors } from './collectors/builtin-collectors';
import { getBuiltinCollectors, registerBuiltinCollector, registerBuiltinCollectors } from './collectors/registry';
import { settlePage } from './page-utils';
import type {
  CheckpointCollector,
  CheckpointConfig,
  CheckpointManifest,
  CheckpointOptions,
  CheckpointRecord,
  CollectorArtifact,
  CollectorConfig,
  CollectorOptions,
  CollectorResult,
  ResolvedCollectorConfig,
  TestCheckpointConfig,
} from './types';

type PlaywrightRuntime = typeof PlaywrightModule;

type DeviceProfile = {
  name: string;
  browserName?: string;
  isMobile?: boolean;
  viewport?: {
    width: number;
    height: number;
  } | null;
  deviceScaleFactor?: number;
};

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

type CollectorInput = boolean | CollectorOptions | CollectorConfig | undefined;

type MutableCollectorState = {
  enabled: boolean;
  config: ResolvedCollectorConfig;
};

const require = (() => {
  try {
    return Function('return require')() as NodeRequire;
  } catch {
    return createRequire(path.join(process.cwd(), 'playwright-checkpoint-runtime.cjs'));
  }
})();

registerBuiltinCollectors(defaultBuiltinCollectors);

function loadPlaywright(): PlaywrightRuntime {
  return require('@playwright/test') as PlaywrightRuntime;
}

function cloneResolvedConfig(config: ResolvedCollectorConfig): ResolvedCollectorConfig {
  return { ...config };
}

function cloneCollectorState(state: MutableCollectorState | undefined): MutableCollectorState {
  return {
    enabled: state?.enabled ?? false,
    config: cloneResolvedConfig(state?.config ?? {}),
  };
}

function applyCollectorInput(state: MutableCollectorState | undefined, input: CollectorInput): MutableCollectorState {
  const next = cloneCollectorState(state);

  if (input === undefined) {
    return next;
  }

  if (input === false) {
    return {
      enabled: false,
      config: {},
    };
  }

  if (input === true) {
    return {
      enabled: true,
      config: next.config,
    };
  }

  return {
    enabled: true,
    config: {
      ...next.config,
      ...input,
    },
  };
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

function mergeTestConfig(
  current: TestCheckpointConfig | null,
  update: TestCheckpointConfig,
): TestCheckpointConfig {
  const collectors = mergeCollectorOverrides(current?.collectors, update.collectors);

  return {
    description: update.description ?? current?.description,
    ...(collectors ? { collectors } : {}),
  };
}

function collectorRegistryFor(globalConfig: CheckpointConfig = {}): Map<string, CheckpointCollector> {
  const registry = getBuiltinCollectors();

  for (const collector of globalConfig.custom ?? []) {
    registry.set(collector.name, collector);
  }

  return registry;
}

function manifestEnvironment(): string {
  return process.env.PLAYWRIGHT_CHECKPOINT_ENV || process.env.NODE_ENV || 'test';
}

function explicitTestTags(testInfo: TestInfo): string[] {
  return (((testInfo as TestInfo & { tags?: string[] }).tags ?? []) as string[]).map((tag) => tag.toLowerCase());
}

function manifestTags(testInfo: TestInfo): string[] {
  return Array.from(new Set([...explicitTestTags(testInfo), ...collectTags(titleParts(testInfo))]));
}

function warn(message: string, error?: unknown): void {
  if (error instanceof Error) {
    console.warn(`[playwright-checkpoint] ${message}`, error);
    return;
  }

  if (error !== undefined) {
    console.warn(`[playwright-checkpoint] ${message}`, String(error));
    return;
  }

  console.warn(`[playwright-checkpoint] ${message}`);
}

function checkpointSlug(name: string, existing: CheckpointRecord[]): string {
  const base = sanitizeSegment(name);
  const existingSlugs = new Set(existing.map((record) => record.slug));

  if (!existingSlugs.has(base)) {
    return base;
  }

  let index = 2;
  let candidate = `${base}-${index}`;
  while (existingSlugs.has(candidate)) {
    index += 1;
    candidate = `${base}-${index}`;
  }

  return candidate;
}

function createDeviceProfile(testInfo: TestInfo): DeviceProfile {
  const useOptions = testInfo.project.use as {
    browserName?: string;
    isMobile?: boolean;
    viewport?: { width: number; height: number } | null;
    deviceScaleFactor?: number;
  };

  return {
    name: testInfo.project.name,
    browserName: typeof useOptions.browserName === 'string' ? useOptions.browserName : undefined,
    isMobile: typeof useOptions.isMobile === 'boolean' ? useOptions.isMobile : undefined,
    viewport: useOptions.viewport ?? null,
    deviceScaleFactor: typeof useOptions.deviceScaleFactor === 'number' ? useOptions.deviceScaleFactor : undefined,
  };
}

async function attachArtifacts(
  testInfo: TestInfo,
  checkpointSlugValue: string,
  collectorName: string,
  artifacts: CollectorArtifact[],
): Promise<void> {
  for (const artifact of artifacts) {
    try {
      await testInfo.attach(`${checkpointSlugValue}/${collectorName}/${artifact.name}`, {
        path: artifact.path,
        contentType: artifact.contentType,
      });
    } catch (error) {
      warn(`Failed to attach artifact "${artifact.name}" from collector "${collectorName}".`, error);
    }
  }
}

async function collectPageTitle(page: Page): Promise<string> {
  try {
    return await page.title();
  } catch {
    return '';
  }
}

async function runCollectorSetup(collectors: Iterable<CheckpointCollector>, page: Page, testInfo: TestInfo): Promise<void> {
  for (const collector of collectors) {
    if (!collector.setup) {
      continue;
    }

    try {
      await collector.setup({ page, testInfo });
    } catch (error) {
      warn(`Collector "${collector.name}" setup failed.`, error);
    }
  }
}

async function runCollectorTeardown(collectors: Iterable<CheckpointCollector>, page: Page, testInfo: TestInfo): Promise<void> {
  const collectorList = Array.from(collectors).reverse();

  for (const collector of collectorList) {
    if (!collector.teardown) {
      continue;
    }

    try {
      await collector.teardown({ page, testInfo });
    } catch (error) {
      warn(`Collector "${collector.name}" teardown failed.`, error);
    }
  }
}

export { registerBuiltinCollector };

export function sanitizeSegment(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'checkpoint'
  );
}

export { settlePage };

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

export function resolveCollectors(
  globalConfig: CheckpointConfig = {},
  testConfig: TestCheckpointConfig | null = null,
  checkpointOptions: CheckpointOptions = {},
): Map<string, ResolvedCollectorConfig> {
  const registry = collectorRegistryFor(globalConfig);
  const states = new Map<string, MutableCollectorState>();

  for (const collector of registry.values()) {
    states.set(collector.name, {
      enabled: collector.defaultEnabled,
      config: {},
    });
  }

  const levels = [globalConfig.collectors, testConfig?.collectors, checkpointOptions.collectors];

  for (const level of levels) {
    for (const [name, input] of Object.entries(level ?? {})) {
      states.set(name, applyCollectorInput(states.get(name), input));
    }
  }

  const resolved = new Map<string, ResolvedCollectorConfig>();

  for (const [name, state] of states) {
    if (state.enabled) {
      resolved.set(name, cloneResolvedConfig(state.config));
    }
  }

  return resolved;
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
      async (_args, use, testInfo) => {
        const manifest: CheckpointManifest = {
          environment: manifestEnvironment(),
          project: testInfo.project.name,
          testId: testInfo.testId,
          title: testInfo.title,
          tags: manifestTags(testInfo),
          startedAt: new Date().toISOString(),
          checkpoints: [],
        };

        try {
          await use(manifest);
        } finally {
          const manifestPath = testInfo.outputPath('checkpoint-manifest.json');
          try {
            await fs.mkdir(path.dirname(manifestPath), { recursive: true });
            await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
          } catch (error) {
            warn(`Failed to write checkpoint manifest to ${manifestPath}.`, error);
          }
        }
      },
      { auto: true },
    ],

    testCheckpointConfig: async (_args, use) => {
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

    deviceProfile: async (_args, use, testInfo) => {
      await use(createDeviceProfile(testInfo));
    },

    checkpoint: async ({ page, checkpointManifest, testCheckpointConfig }, use, testInfo) => {
      const registry = collectorRegistryFor(globalConfig);
      await runCollectorSetup(registry.values(), page, testInfo);

      try {
        await use(async (name, options = {}) => {
          const resolvedCollectors = resolveCollectors(globalConfig, testCheckpointConfig.get(), options);
          const slug = checkpointSlug(name, checkpointManifest.checkpoints);
          const checkpointDir = testInfo.outputPath('checkpoints', slug);
          const collectorResults: Record<string, CollectorResult> = {};

          await fs.mkdir(checkpointDir, { recursive: true });
          await settlePage(page);

          for (const [collectorName, collectorConfig] of resolvedCollectors) {
            const collector = registry.get(collectorName);
            if (!collector) {
              warn(`Collector "${collectorName}" is enabled but no implementation is registered.`);
              continue;
            }

            try {
              const result = await collector.collect({
                page,
                testInfo,
                checkpointDir,
                checkpointName: name,
                checkpointSlug: slug,
                config: cloneResolvedConfig(collectorConfig),
                options: {
                  ...options,
                  ...(options.collectors ? { collectors: { ...options.collectors } } : {}),
                },
              });

              collectorResults[collectorName] = result;
              await attachArtifacts(testInfo, slug, collectorName, result.artifacts);
            } catch (error) {
              warn(`Collector "${collectorName}" failed during checkpoint "${name}".`, error);
            }
          }

          const record: CheckpointRecord = {
            name,
            slug,
            url: page.url(),
            title: await collectPageTitle(page),
            timestamp: new Date().toISOString(),
            collectors: collectorResults,
          };

          checkpointManifest.checkpoints.push(record);
          return record;
        });
      } finally {
        await runCollectorTeardown(registry.values(), page, testInfo);
      }
    },
  });

  return { test };
}

export const expect = loadPlaywright().expect;
export const { test } = createCheckpoint();
export type { DeviceProfile, TestCheckpointConfigController };
