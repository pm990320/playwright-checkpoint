import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { settlePage } from '../page-utils';
import type { AxeCollectorData, CheckpointCollector } from '../types';

type AxeBuilderInstance = {
  analyze(): Promise<unknown>;
};

type AxeBuilderConstructor = new (options: { page: Page }) => AxeBuilderInstance;

type AxeModule = {
  default?: AxeBuilderConstructor;
  AxeBuilder?: AxeBuilderConstructor;
};

let axeLoader: () => Promise<AxeModule> = () => import('@axe-core/playwright');
let warnedAboutMissingAxe = false;

function warnOnce(message: string, error?: unknown): void {
  if (warnedAboutMissingAxe) {
    return;
  }

  warnedAboutMissingAxe = true;
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

function resolveAxeBuilder(module: AxeModule): AxeBuilderConstructor | null {
  return module.default ?? module.AxeBuilder ?? null;
}

async function analyzeAccessibility(page: Page, AxeBuilder: AxeBuilderConstructor): Promise<unknown> {
  try {
    await settlePage(page);
    return await new AxeBuilder({ page }).analyze();
  } catch {
    await page.waitForTimeout(500);
    await settlePage(page);
    return await new AxeBuilder({ page }).analyze();
  }
}

function skippedAxeResult(reason: string): {
  data: AxeCollectorData;
  artifacts: [];
  summary: { violations: number };
} {
  return {
    data: {
      skipped: true,
      reason,
      violations: 0,
      results: null,
    },
    artifacts: [],
    summary: {
      violations: 0,
    },
  };
}

export function setAxeLoaderForTests(loader: (() => Promise<AxeModule>) | null): void {
  axeLoader = loader ?? (() => import('@axe-core/playwright'));
  warnedAboutMissingAxe = false;
}

export const axeCollector: CheckpointCollector = {
  name: 'axe',
  defaultEnabled: true,

  async collect(ctx) {
    const timeoutBudgetMs = typeof ctx.config.timeoutMs === 'number' ? ctx.config.timeoutMs : 5_000;

    if (timeoutBudgetMs > 0) {
      if (typeof ctx.adjustTimeout === 'function') {
        ctx.adjustTimeout(timeoutBudgetMs);
      } else if (ctx.testInfo && typeof ctx.testInfo.setTimeout === 'function') {
        ctx.testInfo.setTimeout(ctx.testInfo.timeout + timeoutBudgetMs);
      }
    }

    let module: AxeModule;
    try {
      module = await axeLoader();
    } catch (error) {
      warnOnce('Skipping axe collector because @axe-core/playwright is unavailable.', error);
      return skippedAxeResult('@axe-core/playwright is unavailable');
    }

    const AxeBuilder = resolveAxeBuilder(module);
    if (!AxeBuilder) {
      warnOnce('Skipping axe collector because @axe-core/playwright did not expose an AxeBuilder export.');
      return skippedAxeResult('@axe-core/playwright did not expose AxeBuilder');
    }

    const results = await analyzeAccessibility(ctx.page, AxeBuilder);
    const violations =
      results &&
      typeof results === 'object' &&
      Array.isArray((results as { violations?: unknown }).violations)
        ? (results as { violations: unknown[] }).violations.length
        : 0;
    const axePath = path.join(ctx.checkpointDir, 'axe.json');

    await fs.writeFile(axePath, `${JSON.stringify(results, null, 2)}\n`, 'utf8');

    return {
      data: {
        skipped: false,
        reason: null,
        violations,
        results,
      } satisfies AxeCollectorData,
      artifacts: [
        {
          name: 'axe',
          path: axePath,
          contentType: 'application/json',
        },
      ],
      summary: {
        violations,
      },
    };
  },
};
