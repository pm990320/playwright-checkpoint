import { describe, expect, it, vi } from 'vitest';
import { parseCliArgs, runCli } from '../src/cli/index';

describe('CLI', () => {
  it('parses the report command and supported flags', () => {
    expect(
      parseCliArgs(['report', '--results-dir', './artifacts', '--output-dir=./docs', '--reporter', 'html,markdown']),
    ).toEqual({
      command: 'report',
      resultsDir: './artifacts',
      outputDir: './docs',
      reporters: ['html', 'markdown'],
    });
  });

  it('runs report generation with defaults and logs a summary', async () => {
    const log = vi.fn();
    const error = vi.fn();
    const runReportersImpl = vi.fn(async () => ({
      html: {
        files: ['/tmp/report/index.html'],
        summary: 'Generated HTML report for 1 story (1 run).',
      },
    }));

    const exitCode = await runCli(['report'], {
      cwd: () => '/workspace',
      log,
      error,
      runReportersImpl,
    });

    expect(exitCode).toBe(0);
    expect(runReportersImpl).toHaveBeenCalledWith({}, '/workspace/test-results', '/workspace/report');
    expect(log).toHaveBeenCalledWith('[playwright-checkpoint] Generated reports from /workspace/test-results to /workspace/report');
    expect(log).toHaveBeenCalledWith('- html: Generated HTML report for 1 story (1 run).');
    expect(error).not.toHaveBeenCalled();
  });

  it('disables built-in reporters when a reporter list is provided', async () => {
    const runReportersImpl = vi.fn(async () => ({
      markdown: {
        files: ['/tmp/report/story.md'],
        summary: 'Generated 1 Markdown article.',
      },
    }));

    const exitCode = await runCli(['report', '--reporter', 'markdown'], {
      cwd: () => '/workspace',
      log: vi.fn(),
      error: vi.fn(),
      runReportersImpl,
    });

    expect(exitCode).toBe(0);
    expect(runReportersImpl).toHaveBeenCalledWith(
      {
        reporters: {
          html: false,
          markdown: true,
        },
      },
      '/workspace/test-results',
      '/workspace/report',
    );
  });
});
