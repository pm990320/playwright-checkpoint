import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
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

type CollectorInput = boolean | CollectorOptions | CollectorConfig | undefined;

type MutableCollectorState = {
  enabled: boolean;
  config: ResolvedCollectorConfig;
};

export type CheckpointSessionMetadata = Partial<
  Pick<CheckpointManifest, 'environment' | 'project' | 'testId' | 'title' | 'tags'>
>;

export type CheckpointSessionOptions = Omit<CheckpointConfig, 'collectors'> & {
  outputDir: string;
  collectors?: Partial<Record<string, boolean | CollectorConfig>>;
  sessionMetadata?: CheckpointSessionMetadata;
  manifest?: CheckpointManifest;
  manifestPath?: string;
  testInfo?: TestInfo;
  adjustTimeout?: (ms: number) => void;
};

export type CaptureCheckpointOptions = CheckpointSessionOptions & CheckpointOptions;

export type CheckpointSession = {
  outputDir: string;
  manifest: CheckpointManifest;
  checkpoint(name: string, options?: CheckpointOptions): Promise<CheckpointRecord>;
  finalize(): Promise<CheckpointManifest>;
};

export type RunCollectorPipelineArgs = {
  page: Page;
  name: string;
  outputDir: string;
  resolvedCollectors: Map<string, ResolvedCollectorConfig>;
  registry: Map<string, CheckpointCollector>;
  options?: CheckpointOptions;
  manifest?: CheckpointManifest;
  slug?: string;
  redact?: string[];
  testInfo?: TestInfo;
  adjustTimeout?: (ms: number) => void;
};

registerBuiltinCollectors(defaultBuiltinCollectors);

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

function collectorRegistryFor(config: CheckpointConfig = {}): Map<string, CheckpointCollector> {
  const registry = getBuiltinCollectors();

  for (const collector of config.custom ?? []) {
    registry.set(collector.name, collector);
  }

  return registry;
}

function cloneCheckpointOptions(options: CheckpointOptions): CheckpointOptions {
  return {
    ...options,
    ...(options.collectors ? { collectors: { ...options.collectors } } : {}),
  };
}

function defaultManifestEnvironment(): string {
  return process.env.PLAYWRIGHT_CHECKPOINT_ENV || process.env.NODE_ENV || 'test';
}

function createManifest(sessionMetadata: CheckpointSessionMetadata | undefined): CheckpointManifest {
  return {
    environment: sessionMetadata?.environment ?? defaultManifestEnvironment(),
    project: sessionMetadata?.project ?? '',
    testId: sessionMetadata?.testId ?? '',
    title: sessionMetadata?.title ?? '',
    tags: [...(sessionMetadata?.tags ?? [])],
    startedAt: new Date().toISOString(),
    checkpoints: [],
  };
}

async function writeManifestFile(manifestPath: string, manifest: CheckpointManifest): Promise<string> {
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifestPath;
}

export function warn(message: string, error?: unknown): void {
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

export function sanitizeSegment(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'checkpoint'
  );
}

export function checkpointSlug(name: string, existing: CheckpointRecord[]): string {
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

async function attachArtifacts(
  testInfo: TestInfo | undefined,
  checkpointSlugValue: string,
  collectorName: string,
  artifacts: CollectorArtifact[],
): Promise<void> {
  const attach = testInfo?.attach;
  if (typeof attach !== 'function') {
    return;
  }

  for (const artifact of artifacts) {
    try {
      await attach.call(testInfo, `${checkpointSlugValue}/${collectorName}/${artifact.name}`, {
        path: artifact.path,
        contentType: artifact.contentType,
      });
    } catch (error) {
      warn(`Failed to attach artifact "${artifact.name}" from collector "${collectorName}".`, error);
    }
  }
}

export async function collectPageTitle(page: Page): Promise<string> {
  try {
    return await page.title();
  } catch {
    return '';
  }
}

export async function runCollectorSetup(
  collectors: Iterable<CheckpointCollector>,
  page: Page,
  testInfo?: TestInfo,
): Promise<void> {
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

export async function runCollectorTeardown(
  collectors: Iterable<CheckpointCollector>,
  page: Page,
  testInfo?: TestInfo,
): Promise<void> {
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

export async function runCollectorPipeline(args: RunCollectorPipelineArgs): Promise<CheckpointRecord> {
  const options = cloneCheckpointOptions(args.options ?? {});
  const slug = args.slug ?? checkpointSlug(args.name, args.manifest?.checkpoints ?? []);
  const checkpointDir = path.join(args.outputDir, slug);
  const collectorResults: Record<string, CollectorResult> = {};

  await fs.mkdir(checkpointDir, { recursive: true });
  await settlePage(args.page);

  for (const [collectorName, collectorConfig] of args.resolvedCollectors) {
    const collector = args.registry.get(collectorName);
    if (!collector) {
      warn(`Collector "${collectorName}" is enabled but no implementation is registered.`);
      continue;
    }

    try {
      const result = await collector.collect({
        page: args.page,
        testInfo: args.testInfo,
        checkpointDir,
        checkpointName: args.name,
        checkpointSlug: slug,
        redact: [...(args.redact ?? [])],
        config: cloneResolvedConfig(collectorConfig),
        options,
        adjustTimeout: args.adjustTimeout,
      });

      collectorResults[collectorName] = result;
      await attachArtifacts(args.testInfo, slug, collectorName, result.artifacts);
    } catch (error) {
      warn(`Collector "${collectorName}" failed during checkpoint "${args.name}".`, error);
    }
  }

  const record: CheckpointRecord = {
    name: args.name,
    slug,
    url: args.page.url(),
    title: await collectPageTitle(args.page),
    timestamp: new Date().toISOString(),
    ...(options.description ? { description: options.description } : {}),
    ...(typeof options.step === 'number' ? { step: options.step } : {}),
    collectors: collectorResults,
  };

  args.manifest?.checkpoints.push(record);
  return record;
}

export async function captureCheckpoint(
  page: Page,
  name: string,
  options: CaptureCheckpointOptions,
): Promise<CheckpointRecord> {
  const sessionConfig: CheckpointConfig = {
    collectors: options.collectors,
    custom: options.custom,
    redact: options.redact,
  };
  const registry = collectorRegistryFor(sessionConfig);
  const resolvedCollectors = resolveCollectors(sessionConfig, null, options);
  const enabledCollectors = Array.from(resolvedCollectors.keys())
    .map((collectorName) => registry.get(collectorName))
    .filter((collector): collector is CheckpointCollector => Boolean(collector));

  await fs.mkdir(options.outputDir, { recursive: true });
  await runCollectorSetup(enabledCollectors, page, options.testInfo);

  try {
    return await runCollectorPipeline({
      page,
      name,
      outputDir: options.outputDir,
      resolvedCollectors,
      registry,
      options,
      redact: options.redact,
      testInfo: options.testInfo,
      adjustTimeout: options.adjustTimeout,
      slug: checkpointSlug(name, []),
    });
  } finally {
    await runCollectorTeardown(enabledCollectors, page, options.testInfo);
  }
}

export async function createCheckpointSession(page: Page, options: CheckpointSessionOptions): Promise<CheckpointSession> {
  const sessionConfig: CheckpointConfig = {
    collectors: options.collectors,
    custom: options.custom,
    redact: options.redact,
  };
  const outputDir = options.outputDir;
  const registry = collectorRegistryFor(sessionConfig);
  const manifest = options.manifest ?? createManifest(options.sessionMetadata);
  const setupCollectorNames = new Set<string>();
  const setupCollectors: CheckpointCollector[] = [];
  let finalizePromise: Promise<CheckpointManifest> | null = null;

  async function ensureCollectorsSetup(resolvedCollectors: Map<string, ResolvedCollectorConfig>): Promise<void> {
    for (const collectorName of resolvedCollectors.keys()) {
      if (setupCollectorNames.has(collectorName)) {
        continue;
      }

      const collector = registry.get(collectorName);
      if (!collector) {
        warn(`Collector "${collectorName}" is enabled but no implementation is registered.`);
        continue;
      }

      setupCollectorNames.add(collectorName);
      setupCollectors.push(collector);
      await runCollectorSetup([collector], page, options.testInfo);
    }
  }

  await fs.mkdir(outputDir, { recursive: true });
  await ensureCollectorsSetup(resolveCollectors(sessionConfig));

  return {
    outputDir,
    manifest,
    async checkpoint(name, checkpointOptions = {}) {
      if (finalizePromise) {
        throw new Error('Checkpoint session has already been finalized.');
      }

      const resolvedCollectors = resolveCollectors(sessionConfig, null, checkpointOptions);
      await ensureCollectorsSetup(resolvedCollectors);

      return runCollectorPipeline({
        page,
        name,
        outputDir,
        resolvedCollectors,
        registry,
        options: checkpointOptions,
        manifest,
        redact: options.redact,
        testInfo: options.testInfo,
        adjustTimeout: options.adjustTimeout,
      });
    },
    finalize() {
      if (!finalizePromise) {
        finalizePromise = (async () => {
          await runCollectorTeardown(setupCollectors, page, options.testInfo);
          await writeManifestFile(options.manifestPath ?? path.join(outputDir, 'checkpoint-manifest.json'), manifest);
          return manifest;
        })();
      }

      return finalizePromise;
    },
  };
}

export { registerBuiltinCollector, registerBuiltinCollectors, settlePage };
