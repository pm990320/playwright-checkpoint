import path from 'node:path';
import { runReporters } from '../report';
import type { CheckpointConfig } from '../types';

export const DEFAULT_RESULTS_DIR = 'test-results';
export const DEFAULT_REPORT_OUTPUT_DIR = 'report';
export const DEFAULT_DOCS_OUTPUT_DIR = 'docs';

type CliDeps = {
  cwd?: () => string;
  log?: (message: string) => void;
  error?: (message: string) => void;
  runReportersImpl?: typeof runReporters;
};

type ParsedCli =
  | {
      command: 'help';
    }
  | {
      command: 'report';
      resultsDir: string;
      outputDir: string;
      reporters: string[] | null;
    }
  | {
      command: 'docs';
      resultsDir: string;
      outputDir: string;
      format: 'markdown' | 'mdx';
      filterTags: string[];
    };

function printHelp(log: (message: string) => void): void {
  log(`playwright-checkpoint

Usage:
  playwright-checkpoint report [--results-dir ./test-results] [--output-dir ./report] [--reporter html,markdown]
  playwright-checkpoint docs [--results-dir ./test-results] [--output-dir ./docs] [--format markdown|mdx] [--filter @user-journey]

Commands:
  report    Generate reports from checkpoint manifests
  docs      Generate Markdown or MDX help articles from checkpoint manifests

Options:
  --results-dir <path>   Directory containing checkpoint manifests (default: ./${DEFAULT_RESULTS_DIR})
  --output-dir <path>    Directory where generated output is written (defaults: ./${DEFAULT_REPORT_OUTPUT_DIR} for report, ./${DEFAULT_DOCS_OUTPUT_DIR} for docs)
  --reporter <names>     Comma-separated reporters to run with the report command (default: html)
  --format <name>        Docs output format: markdown or mdx (default: markdown)
  --filter <tags>        Comma-separated tag filter for docs generation
  -h, --help             Show this help text`);
}

function takeFlagValue(args: string[], index: number, flag: string): { value: string; nextIndex: number } {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`Missing value for ${flag}.`);
  }

  return {
    value,
    nextIndex: index + 1,
  };
}

function parseCommaSeparated(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function parseCliArgs(argv: string[]): ParsedCli {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    return { command: 'help' };
  }

  const [command, ...rest] = argv;
  if (command !== 'report' && command !== 'docs') {
    throw new Error(`Unknown command "${command}".`);
  }

  let resultsDir = DEFAULT_RESULTS_DIR;
  let outputDir = command === 'docs' ? DEFAULT_DOCS_OUTPUT_DIR : DEFAULT_REPORT_OUTPUT_DIR;
  let reporters: string[] | null = null;
  let format: 'markdown' | 'mdx' = 'markdown';
  let filterTags: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (!argument) {
      continue;
    }

    if (argument === '--results-dir') {
      const { value, nextIndex } = takeFlagValue(rest, index, argument);
      resultsDir = value;
      index = nextIndex;
      continue;
    }

    if (argument.startsWith('--results-dir=')) {
      resultsDir = argument.slice('--results-dir='.length);
      continue;
    }

    if (argument === '--output-dir') {
      const { value, nextIndex } = takeFlagValue(rest, index, argument);
      outputDir = value;
      index = nextIndex;
      continue;
    }

    if (argument.startsWith('--output-dir=')) {
      outputDir = argument.slice('--output-dir='.length);
      continue;
    }

    if (command === 'report') {
      if (argument === '--reporter') {
        const { value, nextIndex } = takeFlagValue(rest, index, argument);
        reporters = parseCommaSeparated(value);
        index = nextIndex;
        continue;
      }

      if (argument.startsWith('--reporter=')) {
        reporters = parseCommaSeparated(argument.slice('--reporter='.length));
        continue;
      }
    }

    if (command === 'docs') {
      if (argument === '--format') {
        const { value, nextIndex } = takeFlagValue(rest, index, argument);
        if (value !== 'markdown' && value !== 'mdx') {
          throw new Error(`Unsupported docs format "${value}".`);
        }
        format = value;
        index = nextIndex;
        continue;
      }

      if (argument.startsWith('--format=')) {
        const value = argument.slice('--format='.length);
        if (value !== 'markdown' && value !== 'mdx') {
          throw new Error(`Unsupported docs format "${value}".`);
        }
        format = value;
        continue;
      }

      if (argument === '--filter') {
        const { value, nextIndex } = takeFlagValue(rest, index, argument);
        filterTags = parseCommaSeparated(value);
        index = nextIndex;
        continue;
      }

      if (argument.startsWith('--filter=')) {
        filterTags = parseCommaSeparated(argument.slice('--filter='.length));
        continue;
      }
    }

    throw new Error(`Unknown argument "${argument}".`);
  }

  if (command === 'docs') {
    return {
      command,
      resultsDir,
      outputDir,
      format,
      filterTags,
    };
  }

  return {
    command,
    resultsDir,
    outputDir,
    reporters,
  };
}

function reporterConfig(reporters: string[] | null): CheckpointConfig {
  if (!reporters || reporters.length === 0) {
    return {};
  }

  const selected = new Set(reporters);

  return {
    reporters: {
      html: selected.has('html'),
      markdown: selected.has('markdown'),
      mdx: selected.has('mdx'),
      ...Object.fromEntries(reporters.map((name) => [name, true])),
    },
  };
}

function docsConfig(format: 'markdown' | 'mdx', filterTags: string[]): CheckpointConfig {
  const reporterName = format === 'mdx' ? 'mdx' : 'markdown';

  return {
    reporters: {
      html: false,
      markdown: false,
      mdx: false,
      [reporterName]: {
        ...(filterTags.length > 0 ? { includeTags: filterTags } : {}),
      },
    },
  };
}

export async function runCli(argv = process.argv.slice(2), deps: CliDeps = {}): Promise<number> {
  const cwd = deps.cwd ?? process.cwd;
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;
  const runReportersImpl = deps.runReportersImpl ?? runReporters;

  let parsed: ParsedCli;
  try {
    parsed = parseCliArgs(argv);
  } catch (caught) {
    error(`[playwright-checkpoint] ${caught instanceof Error ? caught.message : String(caught)}`);
    error('Run `playwright-checkpoint --help` for usage.');
    return 1;
  }

  if (parsed.command === 'help') {
    printHelp(log);
    return 0;
  }

  const resultsDir = path.resolve(cwd(), parsed.resultsDir);
  const outputDir = path.resolve(cwd(), parsed.outputDir);

  try {
    const config = parsed.command === 'docs' ? docsConfig(parsed.format, parsed.filterTags) : reporterConfig(parsed.reporters);
    const results = await runReportersImpl(config, resultsDir, outputDir);
    const summaryLines = Object.entries(results).map(([name, result]) => `- ${name}: ${result.summary}`);

    log(
      parsed.command === 'docs'
        ? `[playwright-checkpoint] Generated ${parsed.format.toUpperCase()} docs from ${resultsDir} to ${outputDir}`
        : `[playwright-checkpoint] Generated reports from ${resultsDir} to ${outputDir}`,
    );

    if (summaryLines.length > 0) {
      for (const line of summaryLines) {
        log(line);
      }
    } else {
      log('- No reporters were enabled.');
    }

    return 0;
  } catch (caught) {
    error('[playwright-checkpoint] Failed to generate reports.');
    error(caught instanceof Error ? caught.stack ?? caught.message : String(caught));
    return 1;
  }
}
