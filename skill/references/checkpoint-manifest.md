# checkpoint-manifest.json reference

`checkpoint-manifest.json` is the primary index for all checkpoint artifacts produced in a single Playwright test run.

## Top-level schema

```ts
type CheckpointManifest = {
  environment: string;
  project: string;
  testId: string;
  title: string;
  tags: string[];
  startedAt: string; // ISO timestamp
  checkpoints: CheckpointRecord[];
};
```

### Fields

- `environment`: runtime environment label (`test`, `staging`, etc.).
- `project`: Playwright project name (`desktop-light`, `mobile-dark`, ...).
- `testId`: Playwright test ID.
- `title`: test title (usually includes tags in title text if authored that way).
- `tags`: normalized tag list (collected from title path + explicit test tags).
- `startedAt`: run start time in ISO-8601.
- `checkpoints`: ordered list of captured checkpoint records.

## Checkpoint record schema

```ts
type CheckpointRecord = {
  name: string;
  slug: string;
  url: string;
  title: string;
  timestamp: string; // ISO timestamp
  description?: string;
  step?: number;
  collectors: Record<string, CollectorResult>;
};
```

### Fields

- `name`: human-readable checkpoint name from `checkpoint(name, ...)`.
- `slug`: sanitized unique slug used for output directory naming.
- `url`: current page URL at capture time.
- `title`: page title at capture time.
- `timestamp`: capture timestamp.
- `description`: optional long-form step description (important for docs).
- `step`: optional step number (important for deterministic article ordering).
- `collectors`: map of collector name -> collector result.

## Collector result schema

```ts
type CollectorResult = {
  data: unknown;
  artifacts: CollectorArtifact[];
  summary: Record<string, unknown>;
};

type CollectorArtifact = {
  name: string;
  path: string; // absolute path on disk
  contentType: string;
};
```

### How to use each part

- `summary`: quick triage at manifest level (small and fast).
- `data`: machine-readable collector payload for debugging/analysis.
- `artifacts`: physical files to inspect (images/json/html attachments).

## Minimal real-world example

```json
{
  "environment": "test",
  "project": "mobile-dark",
  "testId": "a1b2c3",
  "title": "Checkout flow @smoke @user-journey",
  "tags": ["@smoke", "@user-journey"],
  "startedAt": "2026-04-03T08:40:00.000Z",
  "checkpoints": [
    {
      "name": "01-landing",
      "slug": "01-landing",
      "url": "https://shop.example.com/",
      "title": "Shop",
      "timestamp": "2026-04-03T08:40:02.120Z",
      "description": "Landing page hero and nav are visible.",
      "step": 1,
      "collectors": {
        "screenshot": {
          "summary": { "screenshotPath": "page.png" },
          "artifacts": [
            {
              "name": "screenshot",
              "path": "/.../test-results/.../checkpoints/01-landing/page.png",
              "contentType": "image/png"
            }
          ],
          "data": {
            "fullPage": true,
            "highlightBounds": null,
            "highlightSelector": null,
            "imageSize": { "width": 1280, "height": 2400 }
          }
        },
        "web-vitals": {
          "summary": { "lcpMs": 1680, "cls": 0.02, "inpMs": 105 },
          "artifacts": [
            {
              "name": "web-vitals",
              "path": "/.../checkpoints/01-landing/web-vitals.json",
              "contentType": "application/json"
            }
          ],
          "data": {
            "url": "https://shop.example.com/",
            "capturedAt": "2026-04-03T08:40:02.112Z"
          }
        }
      }
    }
  ]
}
```

## Cross-variant correlation tips

When the same test runs across projects:
- align by `checkpoint.name` (or `step`) first,
- compare collector summaries side-by-side,
- inspect artifact diffs only where summary divergence appears.

This reduces triage time significantly compared to reading raw artifacts first.
