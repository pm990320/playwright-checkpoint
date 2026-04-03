import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  dedupeRuns,
  groupByStory,
  loadRuns,
  orderedCheckpointNames,
  registerBuiltinReporter,
  runReporters,
} from '../../src/report';
import type { CheckpointConfig, CheckpointManifest, CollectorResult, ReportGenerator, RunRecord } from '../../src/types';

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeCollectorArtifacts(root: string, slug: string): Promise<Record<string, CollectorResult>> {
  const checkpointDir = path.join(root, 'checkpoints', slug);
  await fs.mkdir(checkpointDir, { recursive: true });

  const screenshotPath = path.join(checkpointDir, 'page.png');
  const htmlPath = path.join(checkpointDir, 'page.html');
  const axePath = path.join(checkpointDir, 'axe.json');
  const vitalsPath = path.join(checkpointDir, 'web-vitals.json');
  const consolePath = path.join(checkpointDir, 'console-errors.json');
  const requestsPath = path.join(checkpointDir, 'failed-requests.json');

  await Promise.all([
    fs.writeFile(screenshotPath, 'png', 'utf8'),
    fs.writeFile(htmlPath, '<html></html>', 'utf8'),
    fs.writeFile(axePath, JSON.stringify({ violations: [{ id: 'color-contrast' }] }), 'utf8'),
    fs.writeFile(vitalsPath, JSON.stringify({ cls: 0.01 }), 'utf8'),
    fs.writeFile(consolePath, JSON.stringify([{ type: 'error', text: 'Boom' }]), 'utf8'),
    fs.writeFile(requestsPath, JSON.stringify([{ status: 500, url: 'https://example.com/api' }]), 'utf8'),
  ]);

  return {
    screenshot: {
      data: { fullPage: true, highlightBounds: null },
      artifacts: [{ name: 'screenshot', path: screenshotPath, contentType: 'image/png' }],
      summary: { screenshotPath: 'page.png' },
    },
    html: {
      data: { contentLength: 13 },
      artifacts: [{ name: 'html', path: htmlPath, contentType: 'text/html' }],
      summary: { htmlPath: 'page.html' },
    },
    axe: {
      data: { skipped: false, reason: null, violations: 1, results: { violations: [{ id: 'color-contrast' }] } },
      artifacts: [{ name: 'axe', path: axePath, contentType: 'application/json' }],
      summary: { violations: 1 },
    },
    'web-vitals': {
      data: { url: 'https://example.com', capturedAt: '2026-04-03T00:00:00.000Z' },
      artifacts: [{ name: 'web-vitals', path: vitalsPath, contentType: 'application/json' }],
      summary: {},
    },
    console: {
      data: [{ type: 'error', text: 'Boom', location: null, timestamp: '2026-04-03T00:00:02.000Z' }],
      artifacts: [{ name: 'console-errors', path: consolePath, contentType: 'application/json' }],
      summary: { consoleErrorCount: 1 },
    },
    network: {
      data: [
        {
          kind: 'http-error',
          url: 'https://example.com/api',
          method: 'GET',
          status: 500,
          statusText: 'Server Error',
          failureText: null,
          timestamp: '2026-04-03T00:00:03.000Z',
        },
      ],
      artifacts: [{ name: 'failed-requests', path: requestsPath, contentType: 'application/json' }],
      summary: { failedRequestCount: 1 },
    },
  };
}

async function manifestFixture(
  root: string,
  overrides: Partial<CheckpointManifest> = {},
): Promise<CheckpointManifest> {
  const landingCollectors = await writeCollectorArtifacts(root, 'landing');
  const checkoutCollectors = await writeCollectorArtifacts(root, 'checkout');

  return {
    environment: 'test',
    project: 'desktop-light',
    testId: 't-1',
    title: 'Checkout story',
    tags: ['@smoke'],
    startedAt: '2026-04-03T00:00:00.000Z',
    checkpoints: [
      {
        name: 'Landing',
        slug: 'landing',
        url: 'https://example.com',
        title: 'Landing',
        timestamp: '2026-04-03T00:00:01.000Z',
        collectors: landingCollectors,
      },
      {
        name: 'Checkout',
        slug: 'checkout',
        url: 'https://example.com/checkout',
        title: 'Checkout',
        timestamp: '2026-04-03T00:00:02.000Z',
        collectors: checkoutCollectors,
      },
    ],
    ...overrides,
  };
}

async function writeManifestFile(directory: string, manifest: CheckpointManifest, relativePath = 'checkpoint-manifest.json') {
  const manifestPath = path.join(directory, relativePath);
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify(manifest), 'utf8');
  return manifestPath;
}

describe('report utilities', () => {
  it('loads checkpoint manifests from nested test-results directories and deduplicates them', async () => {
    const testResultsDir = await makeTempDir('playwright-checkpoint-report-');
    const manifestA = await manifestFixture(path.join(testResultsDir, 'a'));
    const manifestB = await manifestFixture(path.join(testResultsDir, 'b', 'nested'));

    await writeManifestFile(path.join(testResultsDir, 'a'), manifestA);
    await writeManifestFile(path.join(testResultsDir, 'b', 'nested'), manifestB, 'checkpoint-manifest-copy.json');
    await fs.writeFile(path.join(testResultsDir, 'b', 'bad.json'), '{not-json', 'utf8');

    const runs = await loadRuns(testResultsDir);

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      key: 't-1|desktop-light|2026-04-03T00:00:00.000Z',
      title: 'Checkout story',
      checkpoints: [{ name: 'Landing' }, { name: 'Checkout' }],
    });
  });

  it('groups runs by story title and preserves checkpoint order', () => {
    const runs: RunRecord[] = [
      {
        key: '1',
        sourceManifestPath: '/tmp/1.json',
        environment: 'test',
        project: 'desktop-light',
        testId: 't-1',
        title: 'Story A',
        tags: [],
        startedAt: '2026-04-03T00:00:00.000Z',
        checkpoints: [
          { name: 'First', slug: 'first', url: '', title: '', timestamp: '', collectors: {} },
          { name: 'Second', slug: 'second', url: '', title: '', timestamp: '', collectors: {} },
        ],
      },
      {
        key: '2',
        sourceManifestPath: '/tmp/2.json',
        environment: 'test',
        project: 'mobile-light',
        testId: 't-2',
        title: 'Story B',
        tags: [],
        startedAt: '2026-04-03T00:01:00.000Z',
        checkpoints: [{ name: 'Second', slug: 'second', url: '', title: '', timestamp: '', collectors: {} }],
      },
      {
        key: '3',
        sourceManifestPath: '/tmp/3.json',
        environment: 'test',
        project: 'desktop-dark',
        testId: 't-3',
        title: 'Story A',
        tags: [],
        startedAt: '2026-04-03T00:02:00.000Z',
        checkpoints: [{ name: 'Third', slug: 'third', url: '', title: '', timestamp: '', collectors: {} }],
      },
    ];

    const grouped = groupByStory(runs);

    expect([...grouped.keys()]).toEqual(['Story A', 'Story B']);
    expect(grouped.get('Story A')).toHaveLength(2);
    expect(orderedCheckpointNames(runs)).toEqual(['First', 'Second', 'Third']);
  });

  it('keeps the latest run when deduplicating records with the same key', () => {
    const runs: RunRecord[] = [
      {
        key: 'same',
        sourceManifestPath: '/tmp/old.json',
        environment: 'test',
        project: 'desktop-light',
        testId: 't-1',
        title: 'Story',
        tags: [],
        startedAt: '2026-04-03T00:00:00.000Z',
        checkpoints: [],
      },
      {
        key: 'same',
        sourceManifestPath: '/tmp/new.json',
        environment: 'test',
        project: 'desktop-light',
        testId: 't-1',
        title: 'Story',
        tags: [],
        startedAt: '2026-04-03T00:05:00.000Z',
        checkpoints: [],
      },
    ];

    expect(dedupeRuns(runs)).toEqual([runs[1]]);
  });

  it('calls custom reporter generate with the expected context', async () => {
    const reporterName = `unit-reporter-${Math.random().toString(36).slice(2)}`;
    const testResultsDir = await makeTempDir('playwright-checkpoint-report-');
    const outputDir = await makeTempDir('playwright-checkpoint-output-');
    const generate = vi.fn(async (context: Parameters<ReportGenerator['generate']>[0]) => {
      const outputPath = path.join(context.outputDir, 'report.txt');
      await fs.mkdir(context.outputDir, { recursive: true });
      await fs.writeFile(outputPath, `runs=${context.runs.length};manifests=${context.manifests.length}`, 'utf8');
      return {
        files: [outputPath],
        summary: `generated ${context.runs.length}`,
      };
    });

    registerBuiltinReporter({
      name: reporterName,
      validateConfig: (config) => !!config && typeof config === 'object',
      generate,
    });

    await writeManifestFile(testResultsDir, await manifestFixture(testResultsDir));

    const results = await runReporters(
      {
        reporters: {
          html: false,
          [reporterName]: { mode: 'custom' },
        },
      } satisfies CheckpointConfig,
      testResultsDir,
      outputDir,
    );

    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        outputDir,
        config: { mode: 'custom' },
        manifests: expect.arrayContaining([expect.objectContaining({ title: 'Checkout story' })]),
        runs: expect.arrayContaining([expect.objectContaining({ title: 'Checkout story' })]),
      }),
    );
    expect(results).toEqual({
      [reporterName]: {
        files: [path.join(outputDir, 'report.txt')],
        summary: 'generated 1',
      },
    });
  });

  it('does not run disabled reporters', async () => {
    const reporterName = `disabled-reporter-${Math.random().toString(36).slice(2)}`;
    const generate = vi.fn(async () => ({
      files: [],
      summary: 'should not run',
    }));

    registerBuiltinReporter({
      name: reporterName,
      generate,
    });

    const testResultsDir = await makeTempDir('playwright-checkpoint-report-');
    const outputDir = await makeTempDir('playwright-checkpoint-output-');
    await writeManifestFile(testResultsDir, await manifestFixture(testResultsDir));

    const results = await runReporters(
      {
        reporters: {
          [reporterName]: false,
        },
      },
      testResultsDir,
      outputDir,
    );

    expect(generate).not.toHaveBeenCalled();
    expect(results).not.toHaveProperty(reporterName);
    expect(results).toHaveProperty('html');
  });

  it('generates the built-in HTML report by default', async () => {
    const testResultsDir = await makeTempDir('playwright-checkpoint-report-');
    const outputDir = await makeTempDir('playwright-checkpoint-html-');
    await writeManifestFile(testResultsDir, await manifestFixture(testResultsDir));

    const results = await runReporters({}, testResultsDir, outputDir);
    const htmlPath = path.join(outputDir, 'index.html');
    const html = await fs.readFile(htmlPath, 'utf8');

    expect(results.html).toEqual({
      files: [htmlPath],
      summary: 'Generated HTML report for 1 story (1 run).',
    });
    expect(results).not.toHaveProperty('markdown');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Playwright Checkpoint Report');
    expect(html).toContain('Checkout story');
    expect(html).toContain('Landing');
    expect(html).toContain('Checkout');
    expect(html).toContain('Desktop / Light');
    expect(html).toContain('Expand all');
    expect(html).toContain('Console');
    expect(html).toContain('failed-requests.json');
  });

  it('generates Markdown help articles when enabled', async () => {
    const testResultsDir = await makeTempDir('playwright-checkpoint-report-');
    const outputDir = await makeTempDir('playwright-checkpoint-markdown-');
    const loginCollectors = await writeCollectorArtifacts(testResultsDir, 'login-page');
    const signInCollectors = await writeCollectorArtifacts(testResultsDir, 'sign-in');

    await writeManifestFile(testResultsDir, {
      environment: 'test',
      project: 'desktop-light',
      testId: 't-docs',
      title: 'Sign in to your account @user-journey',
      tags: ['@docs'],
      startedAt: '2026-04-03T00:00:00.000Z',
      checkpoints: [
        {
          name: 'Navigate to the login page',
          slug: 'navigate-to-the-login-page',
          url: 'https://example.com/login',
          title: 'Login page',
          timestamp: '2026-04-03T00:00:01.000Z',
          description: 'Navigate to the login page. You\'ll see the login form with email and password fields.',
          step: 1,
          collectors: loginCollectors,
        },
        {
          name: 'Enter credentials and sign in',
          slug: 'enter-credentials-and-sign-in',
          url: 'https://example.com/login',
          title: 'Credentials entered',
          timestamp: '2026-04-03T00:00:02.000Z',
          step: 2,
          collectors: signInCollectors,
        },
      ],
    });

    const results = await runReporters(
      {
        reporters: {
          html: false,
          markdown: {
            frontmatter: true,
            header: 'Follow this flow to sign in safely.',
            footer: 'Need more help? Contact support.',
          },
        },
      },
      testResultsDir,
      outputDir,
    );

    const articlePath = path.join(outputDir, 'sign-in-to-your-account.md');
    const imagePath = path.join(outputDir, 'screenshots', 'sign-in-to-your-account', '01-navigate-to-the-login-page.png');
    const article = await fs.readFile(articlePath, 'utf8');

    expect(results.markdown?.summary).toBe('Generated 1 Markdown article.');
    expect(results.markdown?.files).toEqual(expect.arrayContaining([articlePath, imagePath]));
    expect(article).toContain('title: "Sign in to your account"');
    expect(article).toContain('# Sign in to your account');
    expect(article).toContain('Follow this flow to sign in safely.');
    expect(article).toContain('## Step 1: Navigate to the login page');
    expect(article).toContain('![Login page](./screenshots/sign-in-to-your-account/01-navigate-to-the-login-page.png)');
    expect(article).toContain('**URL:** `/login`');
    expect(article).toContain('**Breadcrumb:** login');
    expect(article).toContain("Navigate to the login page. You'll see the login form with email and password fields.");
    expect(article).toContain('This step captures **Credentials entered** at `/login`.');
    expect(article).toContain('Need more help? Contact support.');
  });

  it('supports generating Markdown articles from tag filters', async () => {
    const testResultsDir = await makeTempDir('playwright-checkpoint-report-');
    const outputDir = await makeTempDir('playwright-checkpoint-markdown-tags-');
    const collectors = await writeCollectorArtifacts(testResultsDir, 'search');

    await writeManifestFile(testResultsDir, {
      environment: 'test',
      project: 'desktop-light',
      testId: 't-docs-tags',
      title: 'Search docs @user-journey',
      tags: ['@user-journey'],
      startedAt: '2026-04-03T00:00:00.000Z',
      checkpoints: [
        {
          name: 'Open search',
          slug: 'open-search',
          url: 'https://example.com/search',
          title: 'Search',
          timestamp: '2026-04-03T00:00:01.000Z',
          collectors,
        },
      ],
    });

    const results = await runReporters(
      {
        reporters: {
          html: false,
          markdown: {
            includeTags: ['@user-journey'],
          },
        },
      },
      testResultsDir,
      outputDir,
    );

    expect(results.markdown?.summary).toBe('Generated 1 Markdown article.');
    await expect(fs.readFile(path.join(outputDir, 'search-docs.md'), 'utf8')).resolves.toContain('# Search docs');
  });

  it('produces an empty-state HTML report when no manifests are found', async () => {
    const testResultsDir = await makeTempDir('playwright-checkpoint-report-empty-');
    const outputDir = await makeTempDir('playwright-checkpoint-html-empty-');

    const results = await runReporters({}, testResultsDir, outputDir);
    const html = await fs.readFile(path.join(outputDir, 'index.html'), 'utf8');

    expect(results.html).toEqual({
      files: [path.join(outputDir, 'index.html')],
      summary: 'Generated HTML report for 0 stories (0 runs).',
    });
    expect(html).toContain('No checkpoint manifests found.');
  });
});
