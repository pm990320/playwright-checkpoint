import fs from 'node:fs';
import path from 'node:path';
import type { FullConfig } from '@playwright/test';
import { DEFAULT_REPORT_OUTPUT_DIR, DEFAULT_RESULTS_DIR } from './cli/index';
import { runReporters } from './report';

function resolveResultsDir(config?: FullConfig): string {
  if (process.env.PLAYWRIGHT_CHECKPOINT_RESULTS_DIR) {
    return path.resolve(process.env.PLAYWRIGHT_CHECKPOINT_RESULTS_DIR);
  }

  const defaultDir = path.resolve(process.cwd(), DEFAULT_RESULTS_DIR);
  if (fs.existsSync(defaultDir)) {
    return defaultDir;
  }

  const firstProjectOutputDir = config?.projects.find((project) => typeof project.outputDir === 'string')?.outputDir;
  return path.resolve(firstProjectOutputDir ?? defaultDir);
}

function resolveOutputDir(): string {
  if (process.env.PLAYWRIGHT_CHECKPOINT_REPORT_DIR) {
    return path.resolve(process.env.PLAYWRIGHT_CHECKPOINT_REPORT_DIR);
  }

  return path.resolve(process.cwd(), DEFAULT_REPORT_OUTPUT_DIR);
}

export async function globalTeardown(config?: FullConfig): Promise<void> {
  const testResultsDir = resolveResultsDir(config);
  const outputDir = resolveOutputDir();

  try {
    const results = await runReporters({}, testResultsDir, outputDir);
    const summaries = Object.entries(results).map(([name, result]) => `- ${name}: ${result.summary}`);

    console.log(`[playwright-checkpoint] Generated reports from ${testResultsDir} to ${outputDir}`);
    if (summaries.length > 0) {
      for (const summary of summaries) {
        console.log(summary);
      }
    }
  } catch (error) {
    console.error('[playwright-checkpoint] Global teardown report generation failed.');
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  }
}

export default globalTeardown;
