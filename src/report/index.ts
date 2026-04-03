import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  CheckpointConfig,
  CheckpointManifest,
  ReportGenerationResults,
  ReportGenerator,
  ReporterConfig,
  RunRecord,
} from '../types';
import { htmlReporter } from './html-reporter';
import { markdownReporter } from './markdown-reporter';
import { mdxReporter } from './mdx-reporter';
export { groupByStory, orderedCheckpointNames } from './story-utils';

const builtinReporters = new Map<string, ReportGenerator>();
const builtinReporterDefaults: Partial<Record<string, ReporterConfig>> = {
  html: true,
  markdown: false,
  mdx: false,
};

async function walkFiles(directory: string): Promise<string[]> {
  const dirents = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const dirent of dirents) {
    const absolutePath = path.join(directory, dirent.name);
    if (dirent.isDirectory()) {
      files.push(...(await walkFiles(absolutePath)));
      continue;
    }
    if (dirent.isFile()) {
      files.push(absolutePath);
    }
  }

  return files;
}

function isCheckpointManifestFile(filePath: string): boolean {
  const fileName = path.basename(filePath);
  return fileName === 'checkpoint-manifest.json' || (fileName.startsWith('checkpoint-manifest-') && fileName.endsWith('.json'));
}

function isCheckpointManifest(value: unknown): value is CheckpointManifest {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const manifest = value as Partial<CheckpointManifest>;
  return (
    typeof manifest.project === 'string' &&
    typeof manifest.testId === 'string' &&
    typeof manifest.title === 'string' &&
    typeof manifest.startedAt === 'string' &&
    Array.isArray(manifest.tags) &&
    Array.isArray(manifest.checkpoints)
  );
}

function toRunRecord(manifest: CheckpointManifest, sourceManifestPath: string): RunRecord {
  return {
    key: `${manifest.testId}|${manifest.project}|${manifest.startedAt}`,
    sourceManifestPath,
    environment: manifest.environment || 'unknown',
    project: manifest.project,
    testId: manifest.testId,
    title: manifest.title,
    tags: manifest.tags,
    startedAt: manifest.startedAt,
    checkpoints: manifest.checkpoints,
  };
}

function toManifest(run: RunRecord): CheckpointManifest {
  return {
    environment: run.environment,
    project: run.project,
    testId: run.testId,
    title: run.title,
    tags: run.tags,
    startedAt: run.startedAt,
    checkpoints: run.checkpoints,
  };
}

function normalizeReporterConfig(config: ReporterConfig | undefined): Record<string, unknown> | null {
  if (config == null || config === false) {
    return null;
  }

  if (config === true) {
    return {};
  }

  return { ...config };
}

export function registerBuiltinReporter(reporter: ReportGenerator): void {
  builtinReporters.set(reporter.name, reporter);
}

export function dedupeRuns(runs: RunRecord[]): RunRecord[] {
  const map = new Map<string, RunRecord>();

  for (const run of runs) {
    const existing = map.get(run.key);
    if (!existing) {
      map.set(run.key, run);
      continue;
    }

    const existingTime = new Date(existing.startedAt).getTime();
    const currentTime = new Date(run.startedAt).getTime();
    if (currentTime >= existingTime) {
      map.set(run.key, run);
    }
  }

  return [...map.values()];
}

export async function loadRuns(testResultsDir: string): Promise<RunRecord[]> {
  let manifestFiles: string[];
  try {
    manifestFiles = (await walkFiles(testResultsDir)).filter(isCheckpointManifestFile);
  } catch {
    return [];
  }

  const runs: RunRecord[] = [];
  for (const manifestPath of manifestFiles) {
    let rawManifest: unknown;
    try {
      rawManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    } catch {
      continue;
    }

    if (!isCheckpointManifest(rawManifest)) {
      continue;
    }

    runs.push(toRunRecord(rawManifest, manifestPath));
  }

  return dedupeRuns(runs);
}

export async function runReporters(
  config: CheckpointConfig,
  testResultsDir: string,
  outputDir: string,
): Promise<ReportGenerationResults> {
  const runs = await loadRuns(testResultsDir);
  const manifests = runs.map(toManifest);
  const results: ReportGenerationResults = {};
  const reporterConfigMap: Partial<Record<string, ReporterConfig>> = {
    ...builtinReporterDefaults,
    ...(config.reporters ?? {}),
  };

  for (const [name, value] of Object.entries(reporterConfigMap)) {
    const reporterConfig = normalizeReporterConfig(value);
    if (!reporterConfig) {
      continue;
    }

    const reporter = builtinReporters.get(name);
    if (!reporter) {
      throw new Error(`Reporter "${name}" is enabled but no implementation is registered.`);
    }

    if (reporter.validateConfig && !reporter.validateConfig(reporterConfig)) {
      throw new Error(`Reporter "${name}" received invalid configuration.`);
    }

    results[name] = await reporter.generate({
      runs,
      outputDir,
      config: reporterConfig,
      manifests,
    });
  }

  return results;
}

registerBuiltinReporter(htmlReporter);
registerBuiltinReporter(markdownReporter);
registerBuiltinReporter(mdxReporter);

export { annotateScreenshot } from './annotate';
export { htmlReporter, markdownReporter, mdxReporter };
export type { ReportGenerator } from '../types';
