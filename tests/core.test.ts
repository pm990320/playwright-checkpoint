import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { captureCheckpoint, createCheckpointSession } from '../src/core';
import type { CheckpointCollector, CheckpointConfig } from '../src/types';
import { MockPage } from './helpers/mock-page';

function disableBuiltinCollectors(): CheckpointConfig['collectors'] {
  return {
    screenshot: false,
    html: false,
    axe: false,
    'web-vitals': false,
    console: false,
    network: false,
    metadata: false,
    'aria-snapshot': false,
    'dom-stats': false,
    forms: false,
    storage: false,
    'network-timing': false,
  };
}

async function makeOutputDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'playwright-checkpoint-core-'));
}

describe('captureCheckpoint', () => {
  it('runs the collector pipeline and returns the checkpoint record without requiring a manifest', async () => {
    const outputDir = await makeOutputDir();
    const page = new MockPage();
    page.urlValue = 'https://example.com/home';
    page.titleValue = 'Homepage';

    const events: string[] = [];
    const adjustTimeout = vi.fn();

    const customCollector: CheckpointCollector = {
      name: 'custom',
      defaultEnabled: true,
      async setup() {
        events.push('setup');
      },
      async collect(context) {
        events.push(`collect:${context.checkpointSlug}`);
        context.adjustTimeout?.(250);

        const artifactPath = path.join(context.checkpointDir, 'custom.json');
        await fs.writeFile(artifactPath, JSON.stringify({ ok: true }), 'utf8');

        return {
          data: { ok: true },
          artifacts: [
            {
              name: 'custom',
              path: artifactPath,
              contentType: 'application/json',
            },
          ],
          summary: { ok: true },
        };
      },
      async teardown() {
        events.push('teardown');
      },
    };

    const record = await captureCheckpoint(page.asPage(), 'Homepage', {
      outputDir,
      collectors: {
        ...disableBuiltinCollectors(),
        custom: true,
      },
      custom: [customCollector],
      adjustTimeout,
      description: 'Landing page',
      step: 1,
    });

    expect(events).toEqual(['setup', 'collect:homepage', 'teardown']);
    expect(adjustTimeout).toHaveBeenCalledWith(250);
    expect(record).toMatchObject({
      name: 'Homepage',
      slug: 'homepage',
      url: 'https://example.com/home',
      title: 'Homepage',
      description: 'Landing page',
      step: 1,
      collectors: {
        custom: {
          data: { ok: true },
          summary: { ok: true },
        },
      },
    });
    expect(await fs.readFile(path.join(outputDir, 'homepage', 'custom.json'), 'utf8')).toContain('ok');
    await expect(fs.access(path.join(outputDir, 'checkpoint-manifest.json'))).rejects.toThrow();
  });
});

describe('createCheckpointSession', () => {
  it('sets up once, captures multiple checkpoints, finalizes teardowns, and writes a manifest', async () => {
    const outputDir = await makeOutputDir();
    const page = new MockPage();
    page.urlValue = 'https://example.com/login';
    page.titleValue = 'Login';

    const events: string[] = [];

    const customCollector: CheckpointCollector = {
      name: 'custom',
      defaultEnabled: true,
      async setup() {
        events.push('setup');
      },
      async collect(context) {
        events.push(`collect:${context.checkpointSlug}`);

        const artifactPath = path.join(context.checkpointDir, `${context.checkpointSlug}.json`);
        await fs.writeFile(artifactPath, JSON.stringify({ slug: context.checkpointSlug }), 'utf8');

        return {
          data: { slug: context.checkpointSlug },
          artifacts: [
            {
              name: 'custom',
              path: artifactPath,
              contentType: 'application/json',
            },
          ],
          summary: { slug: context.checkpointSlug },
        };
      },
      async teardown() {
        events.push('teardown');
      },
    };

    const session = await createCheckpointSession(page.asPage(), {
      outputDir,
      collectors: {
        ...disableBuiltinCollectors(),
        custom: true,
      },
      custom: [customCollector],
      sessionMetadata: {
        environment: 'staging',
        project: 'desktop-chrome',
        title: 'Login Flow',
        tags: ['@user-journey'],
      },
    });

    const first = await session.checkpoint('login-page', {
      description: 'The login form',
      step: 1,
    });
    page.urlValue = 'https://example.com/dashboard';
    page.titleValue = 'Dashboard';
    const second = await session.checkpoint('after-submit', {
      description: 'Dashboard',
      step: 2,
    });
    const manifest = await session.finalize();

    expect(first.slug).toBe('login-page');
    expect(second.slug).toBe('after-submit');
    expect(events).toEqual(['setup', 'collect:login-page', 'collect:after-submit', 'teardown']);
    expect(manifest).toMatchObject({
      environment: 'staging',
      project: 'desktop-chrome',
      title: 'Login Flow',
      tags: ['@user-journey'],
      checkpoints: [
        {
          name: 'login-page',
          slug: 'login-page',
          description: 'The login form',
          step: 1,
        },
        {
          name: 'after-submit',
          slug: 'after-submit',
          description: 'Dashboard',
          step: 2,
        },
      ],
    });

    const written = JSON.parse(await fs.readFile(path.join(outputDir, 'checkpoint-manifest.json'), 'utf8')) as {
      checkpoints: Array<{ slug: string }>;
    };
    expect(written.checkpoints.map((checkpoint) => checkpoint.slug)).toEqual(['login-page', 'after-submit']);
  });
});

describe('/core entrypoint', () => {
  it('does not emit a runtime @playwright/test import from the core entry source', async () => {
    const typescript = await import('typescript');
    const source = await fs.readFile('src/core.ts', 'utf8');
    const emitted = typescript.transpileModule(source, {
      compilerOptions: {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ES2022,
        verbatimModuleSyntax: true,
      },
    }).outputText;

    expect(emitted).not.toContain('@playwright/test');
  });

  it('only uses type-only @playwright/test imports across the core dependency graph', async () => {
    const files = [
      'src/core.ts',
      'src/page-utils.ts',
      'src/types.ts',
      ...(await fs.readdir('src/collectors')).map((file) => path.join('src/collectors', file)),
    ];

    for (const file of files) {
      if (!file.endsWith('.ts')) {
        continue;
      }

      const source = await fs.readFile(file, 'utf8');
      const playwrightImportLines = source.split('\n').filter((line) => line.includes("@playwright/test"));

      for (const line of playwrightImportLines) {
        expect(line).toContain('import type');
      }
    }
  });
});
