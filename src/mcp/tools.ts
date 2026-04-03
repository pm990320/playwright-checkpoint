/**
 * Checkpoint tool definitions and the handler that runs them locally.
 */

import type { Page } from 'playwright-core';
import type {
  CheckpointRecord,
  WebVitalsSnapshot,
} from '../types';
import { captureCheckpoint, sanitizeSegment } from '../core';
import { runReporters } from '../report';
import type { CheckpointConfig } from '../types';

// ---------------------------------------------------------------------------
// Tool input schemas (JSON Schema for MCP tool registration)
// ---------------------------------------------------------------------------

const browserCheckpointSchema = {
  type: 'object' as const,
  properties: {
    name: { type: 'string', description: 'Unique name for this checkpoint (e.g. "homepage", "after-login").' },
    description: {
      type: 'string',
      description: 'Long-form description of what this checkpoint captures.',
    },
    highlightSelector: {
      type: 'string',
      description: 'CSS selector for a region to highlight in the annotated screenshot.',
    },
    fullPage: {
      type: 'boolean',
      description: 'Capture the full page (default: true). Set false for viewport-only.',
    },
    collectors: {
      type: 'object',
      description: 'Per-collector overrides. Set to false to disable, or an options object to configure.',
      additionalProperties: true,
    },
  },
  required: ['name'],
};

const browserCheckpointReportSchema = {
  type: 'object' as const,
  properties: {
    outputDir: {
      type: 'string',
      description: 'Directory to write report files (default: ./report).',
    },
    format: {
      type: 'string',
      enum: ['html', 'markdown', 'mdx'],
      description: 'Report format(s) to generate.',
    },
  },
};

const browserCheckpointCompareSchema = {
  type: 'object' as const,
  properties: {
    baseline: { type: 'string', description: 'Path or name of the baseline checkpoint manifest.' },
    current: { type: 'string', description: 'Path or name of the current checkpoint manifest.' },
  },
  required: ['baseline', 'current'],
};

export const CHECKPOINT_TOOL_NAME = 'browser_checkpoint';
export const REPORT_TOOL_NAME = 'browser_checkpoint_report';
export const COMPARE_TOOL_NAME = 'browser_checkpoint_compare';

export const CHECKPOINT_TOOLS = [
  {
    name: CHECKPOINT_TOOL_NAME,
    description:
      'Capture a structured snapshot of the current browser page: screenshot, accessibility violations, Web Vitals, console errors, and network failures. Returns an LLM-friendly summary plus artifact paths.',
    inputSchema: browserCheckpointSchema,
  },
  {
    name: REPORT_TOOL_NAME,
    description: 'Generate an HTML, Markdown, or MDX report from all checkpoint manifests in a directory.',
    inputSchema: browserCheckpointReportSchema,
  },
  {
    name: COMPARE_TOOL_NAME,
    description: 'Compare two checkpoint runs to surface differences (not yet implemented).',
    inputSchema: browserCheckpointCompareSchema,
  },
] as const;

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

export type ToolContext = {
  page: Page;
  outputDir: string;
};

export async function handleBrowserCheckpoint(
  args: {
    name: string;
    description?: string;
    highlightSelector?: string;
    fullPage?: boolean;
    collectors?: Record<string, unknown>;
  },
  ctx: ToolContext,
): Promise<string> {
  const slug = sanitizeSegment(args.name);

  const record = await captureCheckpoint(ctx.page, args.name, {
    outputDir: ctx.outputDir,
    highlightSelector: args.highlightSelector,
    fullPage: args.fullPage ?? true,
    description: args.description,
    collectors: args.collectors as Record<string, boolean | Record<string, unknown>> | undefined,
  });

  void slug; // reserved for future path-building use
  return formatCheckpointSummary(record);
}

export async function handleBrowserCheckpointReport(
  args: {
    outputDir?: string;
    format?: 'html' | 'markdown' | 'mdx';
  },
  testResultsDir = 'test-results',
): Promise<string> {
  const outputDir = args.outputDir ?? 'report';
  const config: CheckpointConfig = {
    reporters: {
      html: args.format === undefined || args.format === 'html',
      markdown: args.format === 'markdown',
      mdx: args.format === 'mdx',
    },
  };

  const { resolve } = await import('node:path');

  const results = await runReporters(
    config,
    resolve(process.cwd(), testResultsDir),
    resolve(process.cwd(), outputDir),
  );

  const lines = Object.entries(results).map(([name, result]) => `- ${name}: ${result.summary}`);
  if (lines.length === 0) {
    return 'No reports generated.';
  }
  return `Report generation complete:\n${lines.join('\n')}`;
}

export function handleBrowserCheckpointCompare(
  _args: { baseline: string; current: string },
): string {
  return 'browser_checkpoint_compare is not yet implemented.';
}

// ---------------------------------------------------------------------------
// Summary formatter
// ---------------------------------------------------------------------------

/**
 * Format a CheckpointRecord into a clean, LLM-friendly text summary.
 */
export function formatCheckpointSummary(record: CheckpointRecord): string {
  const lines: string[] = [];

  lines.push(`Checkpoint "${record.name}" captured.`);
  lines.push(`URL: ${record.url}`);
  lines.push(`Title: ${record.title}`);
  lines.push('');

  // ── Accessibility ──────────────────────────────────────────────────────
  const axeData = record.collectors['axe'];
  if (axeData?.data) {
    const axe = axeData.data as { skipped?: boolean; violations?: number; reason?: string | null };
    if (axe.skipped) {
      lines.push(`Accessibility: skipped (${axe.reason ?? 'unknown reason'})`);
    } else {
      const violations = axe.violations ?? 0;
      lines.push(`Accessibility: ${violations} violation${violations !== 1 ? 's' : ''}`);
    }
  }

  // ── Web Vitals ────────────────────────────────────────────────────────
  const wvData = record.collectors['web-vitals'];
  if (wvData?.data) {
    const wv = wvData.data as WebVitalsSnapshot;
    lines.push('Web Vitals:');

    const metricLines: string[] = [];
    for (const [key, metric] of Object.entries(wv)) {
      if (!metric || typeof metric !== 'object') continue;
      const m = metric as { value: number | null; rating: string };
      if (m.value === null) continue;

      const ratingIcon = m.rating === 'good' ? '✅' : m.rating === 'needs-improvement' ? '⚠️' : m.rating === 'poor' ? '❌' : '';
      const label = key.replace(/Ms$/, '').toUpperCase();
      const formatted =
        key.endsWith('Ms') ? `${Math.round(m.value)}ms` : m.value.toFixed ? m.value.toFixed(3) : String(m.value);
      metricLines.push(`  ${label}: ${formatted} (${m.rating} ${ratingIcon})`.trim());
    }
    if (metricLines.length > 0) {
      lines.push(metricLines.join('\n'));
    }
  }

  // ── Console ────────────────────────────────────────────────────────────
  const consoleData = record.collectors['console'];
  if (consoleData?.data) {
    const entries = consoleData.data as Array<{ type: string; text: string }>;
    const errors = entries.filter((e) => e.type === 'error' || e.type === 'pageerror');
    if (errors.length > 0) {
      lines.push(`Console: ${errors.length} error${errors.length !== 1 ? 's' : ''}`);
      for (const err of errors.slice(0, 3)) {
        lines.push(`  ${err.text}`);
      }
      if (errors.length > 3) {
        lines.push(`  ... and ${errors.length - 3} more`);
      }
    } else {
      lines.push('Console: no errors');
    }
  }

  // ── Network ────────────────────────────────────────────────────────────
  const netData = record.collectors['network'];
  if (netData?.data) {
    const requests = netData.data as Array<{
      url: string;
      status: number | null;
      failureText: string | null;
    }>;
    const failed = requests.filter((r) => r.status === null || r.status >= 400 || r.failureText);
    if (failed.length > 0) {
      lines.push(`Network: ${failed.length} failed request${failed.length !== 1 ? 's' : ''}`);
      for (const req of failed.slice(0, 3)) {
        const reason = req.failureText ?? `${req.status} ${req.url}`;
        lines.push(`  ${req.url} → ${reason}`);
      }
      if (failed.length > 3) {
        lines.push(`  ... and ${failed.length - 3} more`);
      }
    } else {
      lines.push('Network: 0 failed requests');
    }
  }

  // ── Screenshot ─────────────────────────────────────────────────────────
  const ssData = record.collectors['screenshot'];
  if (ssData?.summary) {
    const ss = ssData.summary as { screenshotPath?: string };
    if (ss.screenshotPath) {
      lines.push(`Screenshot: ${ss.screenshotPath}`);
    }
  }

  return lines.join('\n');
}
