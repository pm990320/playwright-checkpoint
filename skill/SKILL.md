---
name: playwright-checkpoint
description: Write e2e tests with checkpointing, analyze outputs to find issues, generate help articles
---

# Playwright Checkpoint Skill

Use this skill to:
- design robust Playwright journeys with meaningful checkpoints,
- debug failures by reading checkpoint artifacts in the right order,
- and generate support-ready help articles from annotated checkpoints.

## Installation (brief)

Install and configure the package exactly as documented in the project README:
- [README.md](../README.md)

Use this skill after installation when writing tests, triaging regressions, or generating docs.

## Workflow overview

1. Write tests with purposeful checkpoint placement.
2. Run tests and open `checkpoint-manifest.json` first.
3. Use collector artifacts to isolate the failure class (layout, a11y, perf, JS/runtime, API, metadata).
4. Correlate findings across collectors before deciding on a fix.
5. Re-run only the targeted scenario and variant to validate.
6. Generate Markdown/MDX help articles from high-quality checkpoint descriptions.

For deeper references:
- Manifest schema: [references/checkpoint-manifest.md](./references/checkpoint-manifest.md)
- Collector outputs: [references/collector-outputs.md](./references/collector-outputs.md)
- Triage scenarios: [references/workflow-examples.md](./references/workflow-examples.md)
- POM patterns: [references/page-object-patterns.md](./references/page-object-patterns.md)

---

## 1) Writing effective e2e tests with checkpointing

### Place checkpoints at stable states, not every click

Add a checkpoint when the page has settled into a meaningful milestone:
- initial page render,
- after auth redirect completes,
- after data-heavy section loads,
- before/after destructive action confirmation,
- final success/failure state.

Avoid checkpoint spam (e.g., every field fill/click). Too many snapshots dilute signal and slow triage.

### Naming convention

Use ordered, descriptive names to make story timelines obvious:
- `01-landing`
- `02-after-login`
- `03-cart-review`
- `04-payment-submitted`

Rules:
- keep names short and concrete,
- include outcome/state, not implementation detail,
- keep sequence explicit for long flows.

### Use `description`, `step`, and `highlightSelector` intentionally

- `step`: controls deterministic ordering in generated docs.
- `description`: operator-facing explanation of what must be true here.
- `highlightSelector`: visual focus box in screenshot output and articles.

Example:

```ts
await checkpoint('03-cart-review', {
  step: 3,
  description: 'User sees itemized totals and selected shipping method before submitting payment.',
  highlightSelector: '[data-testid="order-summary"]',
});
```

### Tag consistently for filtering and report generation

Recommended tags:
- `@smoke`
- `@prod-safe`
- `@user-journey`
- `@destructive`
- `@fixtures`

Use tags to:
- run targeted test subsets,
- generate scoped docs (`includeTags`),
- separate destructive vs safe suites.

### Use per-test config for journey-specific needs

Use `testCheckpointConfig.set()` at test start to tailor collectors:

```ts
testCheckpointConfig.set({
  collectors: {
    axe: { timeoutMs: 15_000 },
    'web-vitals': true,
    'network-timing': true,
    forms: { redact: ['customerId'] },
  },
});
```

---

## 2) Page Object Model (POM) pattern

### Why POM matters

POM keeps selectors and UI actions maintainable while tests retain business intent.

### Structure guidance

- one class per page or reusable component,
- page objects expose intents (`login`, `addItemToCart`) not click internals,
- tests orchestrate the journey and assertions.

### Critical rule

**Put checkpoints in the test, not inside page objects.**

Reason: checkpoints represent test narrative milestones, not reusable implementation steps.

### Full example (POM + checkpoints)

```ts
// login-page.ts
export class LoginPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/login');
  }

  async login(email: string, password: string) {
    await this.page.getByLabel('Email').fill(email);
    await this.page.getByLabel('Password').fill(password);
    await this.page.getByRole('button', { name: 'Sign in' }).click();
  }
}

// login.spec.ts
import { test, expect } from 'playwright-checkpoint';

test('user can sign in @smoke @user-journey', async ({ page, checkpoint }) => {
  const login = new LoginPage(page);

  await login.goto();
  await checkpoint('01-login-page', {
    step: 1,
    description: 'Login form is visible and ready for credentials.',
    highlightSelector: '#login-form',
  });

  await login.login('user@example.com', 'correct horse battery staple');
  await expect(page).toHaveURL(/dashboard/);

  await checkpoint('02-dashboard', {
    step: 2,
    description: 'Dashboard loads successfully after authentication redirect.',
    highlightSelector: '[data-testid="dashboard-root"]',
  });
});
```

---

## 3) Analyze checkpoint outputs to find issues (core)

Always start with manifest context, then drill down.

### A. Read `checkpoint-manifest.json` first

Use it to answer:
- Which test/story and project variant failed?
- Which checkpoint names exist/missing?
- Which collectors ran and what summaries spiked?

Cross-variant correlation is usually the fastest path to root cause.

### B. Screenshots (`page.png`)

Look for:
- layout breaks between desktop/mobile,
- clipped/overflowed containers,
- hidden CTAs on small viewports,
- misplaced sticky/fixed elements.

If visual bug appears only in one variant, compare the same checkpoint name across projects.

### C. Axe (`axe.json`)

Triage order:
1. `critical`
2. `serious`
3. `moderate`
4. `minor`

Common high-value fixes:
- missing form labels,
- low color contrast,
- invalid heading hierarchy,
- duplicate IDs / missing ARIA relationships.

### D. Web Vitals (`web-vitals.json`)

Interpret quickly:
- **LCP**: primary content render speed (target ~<=2.5s)
- **CLS**: visual stability (target <=0.1)
- **INP**: interaction responsiveness (target ~<=200ms)
- **FCP/TTFB**: early render and backend/network latency clues

Debug pattern:
- high LCP + large hero image => optimize image preload/compression.
- high CLS + screenshot shift => reserve dimensions, avoid late ad/widget insertion.
- high INP + console long-task hints => reduce main-thread JS cost.

### E. Console errors (`console-errors.json`)

Separate noise from blockers:
- deprioritize known benign third-party warnings,
- prioritize uncaught exceptions, hydration errors, module load failures.

Correlate timestamp + checkpoint state before attributing cause.

### F. Failed requests (`failed-requests.json`) and network timing (`network-timing.json`)

Check for:
- 404 static assets,
- API 4xx/5xx,
- CORS/preflight problems,
- regressions in payload size/timing.

`network-timing` is especially useful for "it works but feels slow" reports.

### G. Metadata (`metadata.json`)

Quick SEO/content quality checks:
- missing/incorrect `<title>` and `description`,
- missing canonical URL,
- missing/incorrect `lang`,
- absent/malformed Open Graph fields.

### H. HTML snapshot (`page.html`) and ARIA snapshot (`aria-snapshot.json`)

Use for structural verification:
- expected landmarks/roles missing,
- dynamic sections not rendered,
- ARIA tree divergence between variants,
- broken DOM hierarchy after JS error.

### I. DOM stats (`dom-stats.json`), forms (`form-state.json`), storage (`storage-state.json`)

Use these focused diagnostics when needed:
- `dom-stats`: detect runaway DOM growth or unexpected complexity.
- `form-state`: confirm real runtime field values/visibility with safe redaction.
- `storage-state`: confirm cookie/localStorage presence without exposing secrets.

---

## 4) Triage workflow (operational sequence)

1. Run suite and open manifest summary.
2. Identify degraded/failing checkpoints by variant.
3. Deep-dive relevant artifacts (start with screenshot + console + network).
4. Correlate multi-signal evidence before fixing.
5. Implement smallest plausible fix.
6. Re-run targeted test/project.
7. Confirm improvement in both assertion and checkpoint artifacts.

Correlation examples:
- high CLS + screenshot jump = layout reservation problem.
- blank section + console module error + 404 chunk = broken asset pipeline.
- failed submit + form-state shows empty required field = selector/fill regression.

---

## 5) Narrow in on specific issues fast

Single test:

```bash
npx playwright test path/to/test.spec.ts
```

Single project variant:

```bash
npx playwright test path/to/test.spec.ts --project mobile-dark
```

Tag filter:

```bash
npx playwright test --grep @payments
```

Bisect with temporary checkpoints:
- add 1-2 temporary checkpoints around suspected transition,
- re-run only that test/project,
- remove temporary checkpoints once root cause is confirmed.

Enable extra diagnostics only for debug passes:
- `aria-snapshot`, `dom-stats`, `forms`, `storage`, `network-timing`.

---

## 6) Patterns and anti-patterns

### Good patterns

- checkpoint only at stable milestones,
- descriptive ordered names,
- explicit `step` + meaningful `description`,
- clean deterministic fixture/test data,
- include mobile variants in PR validation,
- fail builds on serious a11y/perf regressions where possible.

### Anti-patterns

- checkpoint after every action,
- brittle selectors bound to cosmetic DOM,
- test interdependence/shared mutable state,
- ignoring accessibility findings as "non-blocking",
- debugging from one artifact only without cross-correlation.

---

## 7) Generate help articles

1. Add high-quality checkpoint descriptions and step numbers in tests.
2. Generate docs from checkpoint manifests.
3. Review for language quality and product accuracy.
4. Edit manually before publishing (support/legal/product style alignment).

Typical command:

```bash
npx playwright-checkpoint docs --format markdown --output-dir ./docs/help
```

or:

```bash
npx playwright-checkpoint report --reporter markdown --output-dir ./docs/help
```

For richer doc sites:

```bash
npx playwright-checkpoint docs --format mdx --output-dir ./docs/help
```

Use tags to limit to user-facing journeys.

---

## Reference reading order during triage

1. [checkpoint-manifest.md](./references/checkpoint-manifest.md)
2. [collector-outputs.md](./references/collector-outputs.md)
3. [workflow-examples.md](./references/workflow-examples.md)
4. [page-object-patterns.md](./references/page-object-patterns.md)
