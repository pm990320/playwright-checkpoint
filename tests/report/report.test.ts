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
  landingCollectors.screenshot.data = {
    fullPage: true,
    highlightBounds: { x: 10, y: 12, width: 28, height: 18 },
    highlightSelector: '#hero',
    imageSize: { width: 100, height: 100 },
  };
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
    expect(results).not.toHaveProperty('mdx');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Playwright Checkpoint Report');
    expect(html).toContain('Checkout story');
    expect(html).toContain('Landing');
    expect(html).toContain('Checkout');
    expect(html).toContain('Desktop / Light');
    expect(html).toContain('Expand all');
    expect(html).toContain('Console');
    expect(html).toContain('failed-requests.json');
    expect(html).toContain('highlight-overlay');
    expect(html).toContain('Focus: #hero');
  });

  it('generates Markdown help articles when enabled', async () => {
    const testResultsDir = await makeTempDir('playwright-checkpoint-report-');
    const outputDir = await makeTempDir('playwright-checkpoint-markdown-');
    const loginCollectors = await writeCollectorArtifacts(testResultsDir, 'login-page');
    loginCollectors.screenshot.data = {
      fullPage: true,
      highlightBounds: { x: 12, y: 18, width: 36, height: 24 },
      highlightSelector: '#login-form',
      imageSize: { width: 120, height: 80 },
    };
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
    expect(article).toContain('> Focus: `#login-form`');
    expect(article).toContain("Navigate to the login page. You'll see the login form with email and password fields.");
    expect(article).toContain('This step captures **Credentials entered** at `/login`.');
    expect(article).toContain('Need more help? Contact support.');
  });

  it('uses article title overrides without changing story grouping', async () => {
    const testResultsDir = await makeTempDir('playwright-checkpoint-report-');
    const outputDir = await makeTempDir('playwright-checkpoint-markdown-');

    await writeManifestFile(path.join(testResultsDir, 'a'), {
      environment: 'test',
      project: 'desktop-light',
      testId: 't-title-a',
      title: 'Internal title A @docs',
      article: {
        title: 'Shared help article title',
      },
      tags: ['@docs'],
      startedAt: '2026-04-03T00:00:00.000Z',
      checkpoints: [
        {
          name: 'Step A',
          slug: 'step-a',
          url: 'https://example.com/a',
          title: 'Page A',
          timestamp: '2026-04-03T00:00:01.000Z',
          step: 1,
          collectors: await writeCollectorArtifacts(testResultsDir, 'title-a'),
        },
      ],
    });

    await writeManifestFile(path.join(testResultsDir, 'b'), {
      environment: 'test',
      project: 'desktop-light',
      testId: 't-title-b',
      title: 'Internal title B @docs',
      article: {
        title: 'Shared help article title',
      },
      tags: ['@docs'],
      startedAt: '2026-04-03T00:01:00.000Z',
      checkpoints: [
        {
          name: 'Step B',
          slug: 'step-b',
          url: 'https://example.com/b',
          title: 'Page B',
          timestamp: '2026-04-03T00:01:01.000Z',
          step: 1,
          collectors: await writeCollectorArtifacts(testResultsDir, 'title-b'),
        },
      ],
    });

    await runReporters(
      {
        reporters: {
          html: false,
          markdown: {
            frontmatter: true,
          },
        },
      },
      testResultsDir,
      outputDir,
    );

    const articleA = await fs.readFile(path.join(outputDir, 'internal-title-a.md'), 'utf8');
    const articleB = await fs.readFile(path.join(outputDir, 'internal-title-b.md'), 'utf8');

    expect(articleA).toContain('title: "Shared help article title"');
    expect(articleA).toContain('# Shared help article title');
    expect(articleB).toContain('title: "Shared help article title"');
    expect(articleB).toContain('# Shared help article title');
  });

  it('renders article descriptions between the heading and first step', async () => {
    const testResultsDir = await makeTempDir('playwright-checkpoint-report-');
    const outputDir = await makeTempDir('playwright-checkpoint-markdown-');

    await writeManifestFile(testResultsDir, {
      environment: 'test',
      project: 'desktop-light',
      testId: 't-article-description',
      title: 'CSV import @docs',
      article: {
        description: 'Prepare the CSV, map your columns, and review duplicates before importing.',
      },
      tags: ['@docs'],
      startedAt: '2026-04-03T00:00:00.000Z',
      checkpoints: [
        {
          name: 'Upload CSV',
          slug: 'upload-csv',
          url: 'https://example.com/import',
          title: 'Import',
          timestamp: '2026-04-03T00:00:01.000Z',
          step: 1,
          collectors: await writeCollectorArtifacts(testResultsDir, 'article-description'),
        },
      ],
    });

    await runReporters(
      {
        reporters: {
          html: false,
          markdown: true,
        },
      },
      testResultsDir,
      outputDir,
    );

    const article = await fs.readFile(path.join(outputDir, 'csv-import.md'), 'utf8');

    expect(article).toContain('# CSV import');
    expect(article).toContain('Prepare the CSV, map your columns, and review duplicates before importing.');
    expect(article.indexOf('# CSV import')).toBeLessThan(
      article.indexOf('Prepare the CSV, map your columns, and review duplicates before importing.'),
    );
    expect(article.indexOf('Prepare the CSV, map your columns, and review duplicates before importing.')).toBeLessThan(
      article.indexOf('## Step 1: Upload CSV'),
    );
  });

  it('uses article slug overrides for the markdown filename and screenshot directory', async () => {
    const testResultsDir = await makeTempDir('playwright-checkpoint-report-');
    const outputDir = await makeTempDir('playwright-checkpoint-markdown-');

    await writeManifestFile(testResultsDir, {
      environment: 'test',
      project: 'desktop-light',
      testId: 't-article-slug',
      title: 'Internal CSV import story @docs',
      article: {
        slug: 'import-leads-from-csv',
      },
      tags: ['@docs'],
      startedAt: '2026-04-03T00:00:00.000Z',
      checkpoints: [
        {
          name: 'Upload CSV',
          slug: 'upload-csv',
          url: 'https://example.com/import',
          title: 'Import',
          timestamp: '2026-04-03T00:00:01.000Z',
          step: 1,
          collectors: await writeCollectorArtifacts(testResultsDir, 'article-slug'),
        },
      ],
    });

    const results = await runReporters(
      {
        reporters: {
          html: false,
          markdown: true,
        },
      },
      testResultsDir,
      outputDir,
    );

    const articlePath = path.join(outputDir, 'import-leads-from-csv.md');
    const screenshotPath = path.join(outputDir, 'screenshots', 'import-leads-from-csv', '01-upload-csv.png');
    const article = await fs.readFile(articlePath, 'utf8');

    expect(results.markdown?.files).toEqual(expect.arrayContaining([articlePath, screenshotPath]));
    expect(article).toContain('![Import](./screenshots/import-leads-from-csv/01-upload-csv.png)');
  });

  it('supports requireExplicitStep and skips step-less stories when enabled', async () => {
    const testResultsDir = await makeTempDir('playwright-checkpoint-report-');
    const outputDirDefault = await makeTempDir('playwright-checkpoint-markdown-default-');
    const outputDirExplicit = await makeTempDir('playwright-checkpoint-markdown-explicit-');
    const outputDirSkipped = await makeTempDir('playwright-checkpoint-markdown-skipped-');

    await writeManifestFile(path.join(testResultsDir, 'mixed'), {
      environment: 'test',
      project: 'desktop-light',
      testId: 't-require-explicit-step',
      title: 'Generate help article @docs',
      tags: ['@docs'],
      startedAt: '2026-04-03T00:00:00.000Z',
      checkpoints: [
        {
          name: 'Debug snapshot',
          slug: 'debug-snapshot',
          url: 'https://example.com/help',
          title: 'Debug',
          timestamp: '2026-04-03T00:00:01.000Z',
          description: 'Internal-only state snapshot.',
          collectors: await writeCollectorArtifacts(testResultsDir, 'require-explicit-debug'),
        },
        {
          name: 'Open help form',
          slug: 'open-help-form',
          url: 'https://example.com/help',
          title: 'Help form',
          timestamp: '2026-04-03T00:00:02.000Z',
          description: 'Open the form that starts the help flow.',
          step: 1,
          collectors: await writeCollectorArtifacts(testResultsDir, 'require-explicit-step'),
        },
      ],
    });

    const defaultResults = await runReporters(
      {
        reporters: {
          html: false,
          markdown: true,
        },
      },
      testResultsDir,
      outputDirDefault,
    );

    const explicitResults = await runReporters(
      {
        reporters: {
          html: false,
          markdown: {
            requireExplicitStep: true,
          },
        },
      },
      testResultsDir,
      outputDirExplicit,
    );

    await writeManifestFile(path.join(testResultsDir, 'step-less'), {
      environment: 'test',
      project: 'desktop-light',
      testId: 't-step-less-story',
      title: 'Internal debug story @docs',
      tags: ['@docs'],
      startedAt: '2026-04-03T00:01:00.000Z',
      checkpoints: [
        {
          name: 'Debug snapshot only',
          slug: 'debug-snapshot-only',
          url: 'https://example.com/debug',
          title: 'Debug only',
          timestamp: '2026-04-03T00:01:01.000Z',
          description: 'This checkpoint should stay out of the article.',
          collectors: await writeCollectorArtifacts(testResultsDir, 'require-explicit-step-less'),
        },
      ],
    });

    const skippedResults = await runReporters(
      {
        reporters: {
          html: false,
          markdown: {
            requireExplicitStep: true,
          },
        },
      },
      testResultsDir,
      outputDirSkipped,
    );

    const defaultArticle = await fs.readFile(path.join(outputDirDefault, 'generate-help-article.md'), 'utf8');
    const explicitArticle = await fs.readFile(path.join(outputDirExplicit, 'generate-help-article.md'), 'utf8');

    expect(defaultResults.markdown?.summary).toBe('Generated 1 Markdown article.');
    expect(defaultArticle).toContain('## Step 1: Open help form');
    expect(defaultArticle).toContain('## Step 2: Debug snapshot');

    expect(explicitResults.markdown?.summary).toBe('Generated 1 Markdown article.');
    expect(explicitArticle).toContain('## Step 1: Open help form');
    expect(explicitArticle).not.toContain('Debug snapshot');

    expect(skippedResults.markdown?.summary).toBe('Generated 1 Markdown article.');
    await expect(fs.stat(path.join(outputDirSkipped, 'internal-debug-story.md'))).rejects.toThrow();
    expect(await fs.readFile(path.join(outputDirSkipped, 'generate-help-article.md'), 'utf8')).toContain('## Step 1: Open help form');
  });

  it('supports combined article metadata overrides and resolves slug collisions', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const testResultsDir = await makeTempDir('playwright-checkpoint-report-');
    const outputDir = await makeTempDir('playwright-checkpoint-markdown-');

    await writeManifestFile(path.join(testResultsDir, 'a'), {
      environment: 'test',
      project: 'desktop-light',
      testId: 't-combined-a',
      title: 'CSV import primary @docs',
      article: {
        title: 'How to import leads from CSV',
        description: 'Upload the file, map each column, and confirm the import preview.',
        slug: 'import-leads-from-csv',
      },
      tags: ['@docs'],
      startedAt: '2026-04-03T00:00:00.000Z',
      checkpoints: [
        {
          name: 'Upload CSV',
          slug: 'upload-csv',
          url: 'https://example.com/import',
          title: 'Import',
          timestamp: '2026-04-03T00:00:01.000Z',
          step: 1,
          collectors: await writeCollectorArtifacts(testResultsDir, 'combined-a'),
        },
      ],
    });

    await writeManifestFile(path.join(testResultsDir, 'b'), {
      environment: 'test',
      project: 'desktop-light',
      testId: 't-combined-b',
      title: 'CSV import secondary @docs',
      article: {
        title: 'How to import leads from CSV',
        description: 'Review the mapped fields before saving the article draft.',
        slug: 'import-leads-from-csv',
      },
      tags: ['@docs'],
      startedAt: '2026-04-03T00:01:00.000Z',
      checkpoints: [
        {
          name: 'Review mapping',
          slug: 'review-mapping',
          url: 'https://example.com/import/review',
          title: 'Review',
          timestamp: '2026-04-03T00:01:01.000Z',
          step: 1,
          collectors: await writeCollectorArtifacts(testResultsDir, 'combined-b'),
        },
      ],
    });

    await runReporters(
      {
        reporters: {
          html: false,
          markdown: {
            frontmatter: true,
          },
        },
      },
      testResultsDir,
      outputDir,
    );

    const primary = await fs.readFile(path.join(outputDir, 'import-leads-from-csv.md'), 'utf8');
    const secondary = await fs.readFile(path.join(outputDir, 'import-leads-from-csv-2.md'), 'utf8');

    expect(primary).toContain('title: "How to import leads from CSV"');
    expect(primary).toContain('# How to import leads from CSV');
    expect(primary).toContain('Upload the file, map each column, and confirm the import preview.');
    expect(secondary).toContain('# How to import leads from CSV');
    expect(secondary).toContain('Review the mapped fields before saving the article draft.');
    expect(warnSpy).toHaveBeenCalledWith(
      '[playwright-checkpoint] Markdown article slug collision for "CSV import secondary @docs" resolved as "import-leads-from-csv-2".',
    );
  });

  it('merges per-test article frontmatter over global fields while preserving generated metadata', async () => {
    const testResultsDir = await makeTempDir('playwright-checkpoint-report-');
    const outputDir = await makeTempDir('playwright-checkpoint-markdown-');

    await writeManifestFile(testResultsDir, {
      environment: 'test',
      project: 'desktop-light',
      testId: 't-frontmatter',
      title: 'CSV import story @docs',
      article: {
        title: 'How to import leads from CSV',
        frontmatter: {
          collection: 'Software Guides',
          category: 'Importing',
          author: 'engineering',
          testId: 'should-not-win',
          startedAt: 'should-not-win',
          generatedAt: 'should-not-win',
        },
      },
      tags: ['@docs'],
      startedAt: '2026-04-03T00:00:00.000Z',
      checkpoints: [
        {
          name: 'Upload CSV',
          slug: 'upload-csv',
          url: 'https://example.com/import',
          title: 'Import',
          timestamp: '2026-04-03T00:00:01.000Z',
          step: 1,
          collectors: await writeCollectorArtifacts(testResultsDir, 'article-frontmatter'),
        },
      ],
    });

    await runReporters(
      {
        reporters: {
          html: false,
          markdown: {
            frontmatter: {
              collection: 'Global Collection',
              category: 'Global Category',
              canonical_url: 'https://docs.example.com/import',
              author: 'docs-team',
            },
          },
        },
      },
      testResultsDir,
      outputDir,
    );

    const article = await fs.readFile(path.join(outputDir, 'csv-import-story.md'), 'utf8');

    expect(article).toContain('title: "How to import leads from CSV"');
    expect(article).toContain('collection: "Software Guides"');
    expect(article).toContain('category: "Importing"');
    expect(article).toContain('canonical_url: "https://docs.example.com/import"');
    expect(article).toContain('author: "engineering"');
    expect(article).toContain('testId: "t-frontmatter"');
    expect(article).toContain('startedAt: "2026-04-03T00:00:00.000Z"');
    expect(article).toMatch(/generatedAt: "20\d{2}-\d{2}-\d{2}T/);
    expect(article).not.toContain('testId: "should-not-win"');
    expect(article).not.toContain('startedAt: "should-not-win"');
    expect(article).not.toContain('generatedAt: "should-not-win"');
  });

  it('supports generating MDX articles with device variants', async () => {
    const testResultsDir = await makeTempDir('playwright-checkpoint-report-');
    const outputDir = await makeTempDir('playwright-checkpoint-mdx-');
    const desktopCollectors = await writeCollectorArtifacts(testResultsDir, 'login-desktop');
    desktopCollectors.screenshot.data = {
      fullPage: true,
      highlightBounds: { x: 14, y: 20, width: 30, height: 16 },
      highlightSelector: '#login-form',
      imageSize: { width: 100, height: 100 },
    };
    const mobileCollectors = await writeCollectorArtifacts(testResultsDir, 'login-mobile');

    await writeManifestFile(
      path.join(testResultsDir, 'desktop'),
      {
        environment: 'test',
        project: 'desktop-light',
        testId: 't-mdx',
        title: 'Sign in to your account @authentication @onboarding',
        tags: ['@authentication', '@onboarding'],
        startedAt: '2026-04-03T00:00:00.000Z',
        checkpoints: [
          {
            name: 'Navigate to the login page',
            slug: 'navigate-to-the-login-page',
            url: 'https://example.com/login',
            title: 'Login page',
            timestamp: '2026-04-03T00:00:01.000Z',
            description: 'Navigate to `/login`. You\'ll see the login form.',
            step: 1,
            collectors: desktopCollectors,
          },
          {
            name: 'Enter credentials',
            slug: 'enter-credentials',
            url: 'https://example.com/login',
            title: 'Filled form',
            timestamp: '2026-04-03T00:00:02.000Z',
            description: 'Enter your email and password, then click **Sign In**.',
            step: 2,
            collectors: await writeCollectorArtifacts(testResultsDir, 'credentials-desktop'),
          },
        ],
      },
      'checkpoint-manifest.json',
    );

    await writeManifestFile(
      path.join(testResultsDir, 'mobile'),
      {
        environment: 'test',
        project: 'mobile-light',
        testId: 't-mdx-mobile',
        title: 'Sign in to your account @authentication @onboarding',
        tags: ['@authentication', '@onboarding'],
        startedAt: '2026-04-03T00:01:00.000Z',
        checkpoints: [
          {
            name: 'Navigate to the login page',
            slug: 'navigate-to-the-login-page',
            url: 'https://example.com/login',
            title: 'Login page mobile',
            timestamp: '2026-04-03T00:01:01.000Z',
            description: 'Navigate to `/login`. You\'ll see the login form.',
            step: 1,
            collectors: mobileCollectors,
          },
          {
            name: 'Enter credentials',
            slug: 'enter-credentials',
            url: 'https://example.com/login',
            title: 'Filled form mobile',
            timestamp: '2026-04-03T00:01:02.000Z',
            description: 'Enter your email and password, then click **Sign In**.',
            step: 2,
            collectors: await writeCollectorArtifacts(testResultsDir, 'credentials-mobile'),
          },
        ],
      },
      'checkpoint-manifest.json',
    );

    const results = await runReporters(
      {
        reporters: {
          html: false,
          mdx: {
            includeTags: ['@authentication'],
          },
        },
      },
      testResultsDir,
      outputDir,
    );

    const articlePath = path.join(outputDir, 'sign-in-to-your-account.mdx');
    const article = await fs.readFile(articlePath, 'utf8');

    expect(results.mdx?.summary).toBe('Generated 1 MDX article.');
    expect(article).toContain('title: "Sign in to your account"');
    expect(article).toContain('import { Screenshot, StepList, Step, DeviceTabs, DeviceTab } from \'playwright-checkpoint/components\';');
    expect(article).toContain('<DeviceTabs>');
    expect(article).toContain('<DeviceTab label={"Desktop / Light"}>');
    expect(article).toContain('<DeviceTab label={"Mobile / Light"}>');
    expect(article).toContain('<Step number={1} title={"Navigate to the login page"}>');
    expect(article).toContain('Focus: `#login-form`');
    expect(article).toContain('Navigate to `/login`. You\'ll see the login form.');
    expect(article).toContain('Enter your email and password, then click **Sign In**.');
    expect(article).toContain('tags:');
    expect(article).toContain('- "authentication"');
    expect(article).toContain('- "onboarding"');
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
