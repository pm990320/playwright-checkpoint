import path from 'node:path';
import { runReporters } from '../report';
import type { CheckpointConfig } from '../types';

export const DEFAULT_RESULTS_DIR = 'test-results';
export const DEFAULT_REPORT_OUTPUT_DIR = 'report';

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
    };

function printHelp(log: (message: string) => void): void {
  log(`playwright-checkpoint\n\nUsage:\n  playwright-checkpoint report [--results-dir ./test-results] [--output-dir ./report] [--reporter html,markdown]\n\nCommands:\n  report    Generate reports from checkpoint manifests\n\nOptions:\n  --results-dir <path>   Directory containing checkpoint manifests (default: ./${DEFAULT_RESULTS_DIR})\n  --output-dir <path>    Directory where generated reports are written (default: ./${DEFAULT_REPORT_OUTPUT_DIR})\n  --reporter <names>     Comma-separated reporters to run (default: html)\n  -h, --help             Show this help text`);
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

export function parseCliArgs(argv: string[]): ParsedCli {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    return { command: 'help' };
  }

  const [command, ...rest] = argv;
  if (command !== 'report') {
    throw new Error(`Unknown command "${command}".`);
  }

  let resultsDir = DEFAULT_RESULTS_DIR;
  let outputDir = DEFAULT_REPORT_OUTPUT_DIR;
  let reporters: string[] | null = null;

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

    if (argument === '--reporter') {
      const { value, nextIndex } = takeFlagValue(rest, index, argument);
      reporters = value.split(',').map((entry) => entry.trim()).filter(Boolean);
      index = nextIndex;
      continue;
    }

    if (argument.startsWith('--reporter=')) {
      reporters = argument
        .slice('--reporter='.length)
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
      continue;
    }

    throw new Error(`Unknown argument "${argument}".`);
  }

  return {
    command: 'report',
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
      ...Object.fromEntries(reporters.map((name) => [name, true])),
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
    const results = await runReportersImpl(reporterConfig(parsed.reporters), resultsDir, outputDir);
    const summaryLines = Object.entries(results).map(([name, result]) => `- ${name}: ${result.summary}`);

    log(`[playwright-checkpoint] Generated reports from ${resultsDir} to ${outputDir}`);
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
