import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  dedupeRuns,
  groupByStory,
  loadRuns,
  orderedCheckpointNames,
  registerBuiltinReporter,
  runReporters,
} from '../../src/report';
import type { CheckpointConfig, CheckpointManifest, ReportGenerator, RunRecord } from '../../src/types';

async function makeTestResultsDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'playwright-checkpoint-report-'));
}

function manifest(overrides: Partial<CheckpointManifest> = {}): CheckpointManifest {
  return {
    environment: 'test',
    project: 'desktop',
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
        collectors: {},
      },
      {
        name: 'Checkout',
        slug: 'checkout',
        url: 'https://example.com/checkout',
        title: 'Checkout',
        timestamp: '2026-04-03T00:00:02.000Z',
        collectors: {},
      },
    ],
    ...overrides,
  };
}

describe('report utilities', () => {
  it('loads checkpoint manifests from nested test-results directories and deduplicates them', async () => {
    const testResultsDir = await makeTestResultsDir();
    await fs.mkdir(path.join(testResultsDir, 'a'), { recursive: true });
    await fs.mkdir(path.join(testResultsDir, 'b', 'nested'), { recursive: true });

    await fs.writeFile(
      path.join(testResultsDir, 'a', 'checkpoint-manifest.json'),
      JSON.stringify(manifest()),
      'utf8',
    );
    await fs.writeFile(
      path.join(testResultsDir, 'b', 'nested', 'checkpoint-manifest-copy.json'),
      JSON.stringify(manifest()),
      'utf8',
    );
    await fs.writeFile(path.join(testResultsDir, 'b', 'bad.json'), '{not-json', 'utf8');

    const runs = await loadRuns(testResultsDir);

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      key: 't-1|desktop|2026-04-03T00:00:00.000Z',
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
        project: 'desktop',
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
        project: 'mobile',
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
        project: 'desktop',
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
        project: 'desktop',
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
        project: 'desktop',
        testId: 't-1',
        title: 'Story',
        tags: [],
        startedAt: '2026-04-03T00:05:00.000Z',
        checkpoints: [],
      },
    ];

    expect(dedupeRuns(runs)).toEqual([runs[1]]);
  });

  it('runs enabled reporters and returns combined results', async () => {
    const reporterName = `unit-reporter-${Math.random().toString(36).slice(2)}`;
    const testResultsDir = await makeTestResultsDir();
    const outputDir = await makeTestResultsDir();
    await fs.writeFile(path.join(testResultsDir, 'checkpoint-manifest.json'), JSON.stringify(manifest()), 'utf8');

    const reporter: ReportGenerator = {
      name: reporterName,
      validateConfig: (config) => !!config && typeof config === 'object',
      async generate(context) {
        const outputPath = path.join(context.outputDir, 'report.txt');
        await fs.mkdir(context.outputDir, { recursive: true });
        await fs.writeFile(outputPath, `runs=${context.runs.length}`, 'utf8');
        return {
          files: [outputPath],
          summary: `generated ${context.runs.length}`,
        };
      },
    };

    registerBuiltinReporter(reporter);

    const results = await runReporters(
      {
        reporters: {
          [reporterName]: { enabled: true },
        },
      } satisfies CheckpointConfig,
      testResultsDir,
      outputDir,
    );

    expect(results).toEqual({
      [reporterName]: {
        files: [path.join(outputDir, 'report.txt')],
        summary: 'generated 1',
      },
    });
    expect(await fs.readFile(path.join(outputDir, 'report.txt'), 'utf8')).toBe('runs=1');
  });
});
