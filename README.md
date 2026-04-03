# playwright-checkpoint

[![npm version](https://img.shields.io/npm/v/playwright-checkpoint.svg)](https://www.npmjs.com/package/playwright-checkpoint)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-ready-3178C6.svg)](https://www.typescriptlang.org/)

Structured page checkpoints for Playwright: screenshots, HTML snapshots, accessibility, web vitals, console/network errors, metadata, and post-run report generation.

---

## Quick start

```bash
npm install -D playwright-checkpoint @playwright/test
```

Use the built-in fixtures right away:

```ts
import { test, expect } from 'playwright-checkpoint';
```

Add the drop-in HTML report teardown:

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  globalTeardown: 'playwright-checkpoint/teardown',
});
```

Example test:

```ts
import { test, expect } from 'playwright-checkpoint';

test('sign in', async ({ page, checkpoint }) => {
  await page.goto('https://example.com/login');
  await checkpoint('Login page', {
    description: 'Open the login page and verify the sign-in form is visible.',
    step: 1,
  });

  await page.getByLabel('Email').fill('ada@example.com');
  await page.getByLabel('Password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/dashboard/);
  await checkpoint('Signed in dashboard', {
    description: 'Submit valid credentials and confirm the dashboard loads.',
    step: 2,
  });
});
```

After the run, checkpoint manifests are written into Playwright's `test-results` output tree and the default teardown generates an HTML report into `./report`.

---

## What it captures

All built-in collectors are registered automatically.

| Collector | Default | What it captures | Main artifact |
| --- | --- | --- | --- |
| `screenshot` | On | PNG screenshot for each checkpoint | `page.png` |
| `html` | On | Full page HTML at checkpoint time | `page.html` |
| `axe` | On | Accessibility audit via `@axe-core/playwright` when available | `axe.json` |
| `web-vitals` | On | CLS, FCP, LCP, INP, TTFB and related navigation timings | `web-vitals.json` |
| `console` | On | New console errors and page errors since the last checkpoint | `console-errors.json` |
| `network` | On | Failed requests and HTTP 4xx/5xx responses since the last checkpoint | `failed-requests.json` |
| `metadata` | On | Title, description, canonical URL, OG tags, language, viewport, JSON-LD | `metadata.json` |

Notes:

- `@axe-core/playwright` is an optional dependency. If it is unavailable, the `axe` collector skips gracefully.
- Screenshot options such as `fullPage` and `highlightSelector` are passed per checkpoint.
- Collector artifacts are also attached to the Playwright test result when possible.

---

## Configuration

### 1. Global configuration with `createCheckpoint()`

Use `createCheckpoint()` when you want project-wide defaults or custom collectors.

```ts
import { createCheckpoint, expect } from 'playwright-checkpoint';

export const { test } = createCheckpoint({
  collectors: {
    axe: { timeoutMs: 10_000 },
    network: true,
    console: true,
  },
});

export { expect };
```

`createCheckpoint()` returns a Playwright `test` object extended with these fixtures:

- `checkpoint(name, options?)`
- `checkpointManifest`
- `testCheckpointConfig`
- `deviceProfile`

### 2. Per-test configuration with `testCheckpointConfig`

Override defaults inside a single test or in a `beforeEach`.

```ts
import { createCheckpoint, expect } from 'playwright-checkpoint';

const { test } = createCheckpoint();

test('checkout on mobile', async ({ page, checkpoint, testCheckpointConfig }) => {
  testCheckpointConfig.set({
    description: 'Mobile checkout happy path.',
    collectors: {
      'web-vitals': true,
      axe: { timeoutMs: 15_000 },
    },
  });

  await page.goto('https://example.com/checkout');
  await checkpoint('Cart review');
});
```

The per-test config merges onto global config. Collector overrides resolve in this order:

1. Global defaults from `createCheckpoint()`
2. Per-test config from `testCheckpointConfig.set()`
3. Per-checkpoint options from `checkpoint(name, options)`

### 3. Per-checkpoint options

Actual supported checkpoint-level options are:

```ts
await checkpoint('Review order', {
  description: 'Review the order summary before placing the order.',
  step: 3,
  fullPage: true,
  highlightSelector: '[data-testid="order-summary"]',
  collectors: {
    axe: false,
    screenshot: true,
  },
});
```

Available checkpoint options:

- `description?: string`
- `step?: number`
- `fullPage?: boolean`
- `highlightSelector?: string`
- `collectors?: Partial<Record<string, boolean | CollectorOptions>>`

---

## Custom collectors

A collector implements `CheckpointCollector` and returns structured data, artifacts, and a summary.

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { createCheckpoint, type CheckpointCollector } from 'playwright-checkpoint';

const urlCollector: CheckpointCollector = {
  name: 'url-fragment',
  defaultEnabled: true,

  async collect(ctx) {
    const outputPath = path.join(ctx.checkpointDir, 'url-fragment.json');
    const data = {
      href: ctx.page.url(),
      checkpoint: ctx.checkpointName,
    };

    await fs.writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');

    return {
      data,
      artifacts: [
        {
          name: 'url-fragment',
          path: outputPath,
          contentType: 'application/json',
        },
      ],
      summary: {
        href: data.href,
      },
    };
  },
};

export const { test } = createCheckpoint({
  custom: [urlCollector],
  collectors: {
    'url-fragment': true,
  },
});
```

You can also register built-ins or shared collectors explicitly:

```ts
import { registerBuiltinCollector } from 'playwright-checkpoint';

registerBuiltinCollector(urlCollector);
```

---

## Report generation

There are three report-generation paths.

### 1. Drop-in global teardown

For the default HTML report only:

```ts
export default defineConfig({
  globalTeardown: 'playwright-checkpoint/teardown',
});
```

That entry point:

- loads manifests from `./test-results` by default
- writes reports to `./report` by default
- enables the built-in HTML reporter
- logs results to the console
- never crashes Playwright teardown on report errors

Optional environment overrides:

- `PLAYWRIGHT_CHECKPOINT_RESULTS_DIR`
- `PLAYWRIGHT_CHECKPOINT_REPORT_DIR`

### 2. CLI

Generate reports after a run:

```bash
npx playwright-checkpoint report
```

Custom directories:

```bash
npx playwright-checkpoint report \
  --results-dir ./test-results \
  --output-dir ./report
```

Choose reporters explicitly:

```bash
npx playwright-checkpoint report --reporter html,markdown
npx playwright-checkpoint report --reporter markdown --output-dir ./docs/help
```

### 3. Programmatic API

Use `runReporters()` when you want markdown articles, custom reporters, or advanced config.

```ts
import { runReporters } from 'playwright-checkpoint';

await runReporters(
  {
    reporters: {
      html: true,
      markdown: {
        frontmatter: true,
        includeTags: ['@user-journey'],
      },
    },
  },
  './test-results',
  './report',
);
```

---

## Built-in reporters

### HTML report

- Enabled by default in `runReporters()`.
- Enabled by the drop-in teardown.
- Writes `index.html` into the chosen output directory.
- Groups runs by story and shows checkpoint artifacts, summaries, and per-project runs.

### Markdown article generator

- Reporter name: `markdown`
- Default: disabled
- Output: one Markdown file per story/test
- Copies screenshot assets into the report output folder by default

Supported markdown reporter config:

```ts
{
  reporters: {
    markdown: {
      storiesDir: '.',
      screenshotsDir: 'screenshots',
      includeTags: ['@user-journey'],
      preferredProject: 'desktop-light',
      header: 'Intro copy shown before the steps.',
      footer: 'Outro copy shown after the steps.',
      frontmatter: true,
      imagePathPrefix: '/static/help',
      copyScreenshots: true,
    },
  },
}
```

Behavior:

- Generates one article per story/test title
- Strips `@tags` from the article title and filename
- Orders steps by explicit `step`, then capture order
- Uses `description` when present
- Falls back to an auto-generated sentence from page title + URL
- Includes URL and breadcrumb text for each step
- Only includes stories that either:
  - have at least one checkpoint with `description` or `step`, or
  - match `includeTags`

---

## Custom reporters

A custom reporter implements `ReportGenerator`.

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  registerBuiltinReporter,
  type ReportGenerator,
} from 'playwright-checkpoint';

const jsonSummaryReporter: ReportGenerator = {
  name: 'json-summary',

  validateConfig(config) {
    return config != null && typeof config === 'object' && !Array.isArray(config);
  },

  async generate(context) {
    const outputPath = path.join(context.outputDir, 'summary.json');
    await fs.mkdir(context.outputDir, { recursive: true });
    await fs.writeFile(
      outputPath,
      `${JSON.stringify(
        {
          runCount: context.runs.length,
          manifests: context.manifests.length,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    return {
      files: [outputPath],
      summary: `Generated JSON summary for ${context.runs.length} runs.`,
    };
  },
};

registerBuiltinReporter(jsonSummaryReporter);
```

Then run it programmatically or via the CLI:

```ts
await runReporters(
  {
    reporters: {
      html: false,
      'json-summary': {},
    },
  },
  './test-results',
  './report',
);
```

---

## Help article generation

Markdown articles work best when your checkpoints are annotated.

```ts
await checkpoint('Navigate to the login page', {
  step: 1,
  description: 'Open the login page and confirm the email/password fields are visible.',
});

await checkpoint('Enter credentials and sign in', {
  step: 2,
  description: 'Fill in valid credentials and submit the form.',
});
```

Generate articles from the CLI:

```bash
npx playwright-checkpoint report --reporter markdown --output-dir ./docs/help
```

Only include tests tagged for docs:

```ts
await runReporters(
  {
    reporters: {
      html: false,
      markdown: {
        includeTags: ['@user-journey'],
        frontmatter: true,
      },
    },
  },
  './test-results',
  './docs/help',
);
```

Example output shape:

```md
# Sign in to your account

## Step 1: Navigate to the login page

![Login page](./screenshots/sign-in-to-your-account/01-navigate-to-the-login-page.png)

**URL:** `/login`

**Breadcrumb:** login

Open the login page and confirm the email/password fields are visible.
```

---

## CLI reference

### `playwright-checkpoint report`

Generate reports from checkpoint manifests.

```bash
playwright-checkpoint report [--results-dir ./test-results] [--output-dir ./report] [--reporter html,markdown]
```

Flags:

- `--results-dir <path>`: directory containing checkpoint manifests
- `--output-dir <path>`: destination directory for generated reports
- `--reporter <names>`: comma-separated reporter list
- `-h`, `--help`: usage help

Defaults:

- `resultsDir = ./test-results`
- `outputDir = ./report`
- `reporters = html`

---

## API reference

### Main runtime exports

From `playwright-checkpoint`:

- `test` — default Playwright test fixture set with checkpoint support
- `expect` — re-export from `@playwright/test`
- `createCheckpoint(config?)`
- `createDeviceProfile(testInfo)`
- `settlePage(page)`

### Checkpoint helpers

Also exported for advanced use:

- `manifestTags(testInfo)`
- `checkpointSlug(name, existing)`
- `collectPageTitle(page)`
- `resolveCollectors(globalConfig, testConfig, checkpointOptions)`
- `createCheckpointManifestRecord(testInfo)`
- `writeCheckpointManifest(testInfo, manifest)`
- `captureCheckpointRecord(args)`
- `runCollectorSetup(collectors, page, testInfo)`
- `runCollectorTeardown(collectors, page, testInfo)`
- `sanitizeSegment(value)`
- `warn(message, error?)`

### Built-in collectors

Exported collector instances:

- `screenshotCollector`
- `htmlCollector`
- `axeCollector`
- `webVitalsCollector`
- `consoleCollector`
- `networkCollector`
- `metadataCollector`

Collector registry utilities:

- `registerBuiltinCollector(collector)`
- `registerBuiltinCollectors(collectors)`
- `getBuiltinCollectors()`

### Reporting exports

- `runReporters(config, testResultsDir, outputDir)`
- `loadRuns(testResultsDir)`
- `dedupeRuns(runs)`
- `groupByStory(runs)`
- `orderedCheckpointNames(runs)`
- `registerBuiltinReporter(reporter)`
- `htmlReporter`
- `markdownReporter`

### Types

Key exported types include:

- `CheckpointRecord`
- `CheckpointManifest`
- `CheckpointOptions`
- `CheckpointConfig`
- `TestCheckpointConfig`
- `CheckpointCollector`
- `CollectorResult`
- `CollectorArtifact`
- `CollectorContext`
- `CollectorOptions`
- `ResolvedCollectorConfig`
- `CollectorConfig`
- `BoundingBox`
- `ScreenshotCollectorData`
- `HtmlCollectorData`
- `AxeCollectorData`
- `WebVitalRating`
- `WebVitalMetric`
- `WebVitalsSnapshot`
- `ConsoleErrorRecord`
- `FailedRequestRecord`
- `PageMetadata`
- `ReporterConfig`
- `ReportGenerator`
- `ReportGeneratorContext`
- `ReportGeneratorResult`
- `ReportGenerationResults`
- `RunRecord`

---

## Page Object Model pattern

A good pattern is to keep navigation and actions in the page object, and pass the `checkpoint` fixture into methods that should produce documentation.

```ts
import type { Page } from '@playwright/test';
import { test, expect } from 'playwright-checkpoint';

type CheckpointFn = Parameters<typeof test>[1] extends (args: infer T, ...rest: never[]) => unknown
  ? T extends { checkpoint: infer C }
    ? C
    : never
  : never;

class LoginPage {
  constructor(private readonly page: Page) {}

  async open(checkpoint: CheckpointFn) {
    await this.page.goto('https://example.com/login');
    await checkpoint('Login page', {
      step: 1,
      description: 'Open the login page and verify the form is present.',
    });
  }

  async signIn(email: string, password: string, checkpoint: CheckpointFn) {
    await this.page.getByLabel('Email').fill(email);
    await this.page.getByLabel('Password').fill(password);
    await this.page.getByRole('button', { name: 'Sign in' }).click();
    await checkpoint('Signed in', {
      step: 2,
      description: 'Submit valid credentials and wait for the authenticated destination.',
    });
  }
}

test('login flow', async ({ page, checkpoint }) => {
  const loginPage = new LoginPage(page);

  await loginPage.open(checkpoint);
  await loginPage.signIn('ada@example.com', 'secret', checkpoint);

  await expect(page).toHaveURL(/dashboard/);
});
```

If you prefer, you can define your own local alias for the checkpoint function type instead of extracting it from `test`.

---

## Development notes

- Build: `npm run build`
- Lint: `npm run lint`
- Type-check: `npm run check-types`
- Tests: `npm test`

## License

MIT
