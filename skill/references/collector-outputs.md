# Collector outputs reference

Use this file as a fast lookup for what each collector writes and how to interpret it.

## Default-enabled collectors

### `screenshot`
- Artifact: `page.png`
- Summary: `{ screenshotPath }`
- Data highlights:
  - `fullPage`
  - `highlightBounds`
  - `highlightSelector`
  - `imageSize`
- Use for: visual regressions, overflow/cropping, missing responsive elements.

### `html`
- Artifact: `page.html`
- Summary: `{ contentLength }`
- Data highlights: content length snapshot
- Use for: render-state validation, DOM structure checks.

### `axe`
- Artifact: `axe.json` (when available)
- Summary: `{ violations }`
- Data highlights:
  - `skipped`, `reason`
  - full axe result payload
- Use for: accessibility violations triage (priority critical -> serious -> moderate).

### `web-vitals`
- Artifact: `web-vitals.json`
- Summary: key metrics (`cls`, `lcpMs`, `inpMs`, etc.)
- Use for: performance regressions and UX stability diagnosis.

### `console`
- Artifact: `console-errors.json`
- Summary: `{ consoleErrorCount }`
- Data highlights: message type/text/location/timestamp
- Use for: runtime exceptions, hydration errors, JS failures.

### `network`
- Artifact: `failed-requests.json`
- Summary: `{ failedRequestCount }`
- Data highlights: failed request + HTTP 4xx/5xx records
- Use for: broken assets, API failures, CORS issues.

### `metadata`
- Artifact: `metadata.json`
- Summary: `{ url, title, lang }`
- Data highlights:
  - description
  - canonical
  - Open Graph
  - JSON-LD parse status
- Use for: SEO metadata quality and structured-data checks.

---

## Extended opt-in collectors (`defaultEnabled: false`)

### `aria-snapshot`
- Artifact: `aria-snapshot.json`
- Summary: `{ nodeCount }`
- Data shape:
  - `snapshot`: full ARIA tree payload
  - `nodeCount`: recursive node count
- Use for:
  - machine-readable accessibility structure validation,
  - detecting missing landmarks/roles,
  - cross-variant ARIA parity checks.

### `dom-stats`
- Artifact: `dom-stats.json`
- Summary: `{ nodeCount, maxDepth, formCount, imageCount }`
- Data shape:
  - `scriptCount`
  - `stylesheetCount`
  - `eventListenerCount` (if exposed)
- Use for:
  - unexpected DOM bloat,
  - abnormal page complexity,
  - page-size regressions after feature changes.

### `forms`
- Artifact: `form-state.json`
- Summary: `{ fieldCount, redactedCount }`
- Data shape:
  - field list with `tagName`, `name/id/label`, `value`, `checked`, `required`, `redacted`
- Redaction behavior:
  - defaults redact likely secrets (`password`, `token`, `secret`, emails)
  - supports custom `redact` patterns
- Use for:
  - verifying runtime form values in multi-step flows,
  - proving whether fields were populated/visible at a checkpoint,
  - safe debugging in CI logs.

### `storage`
- Artifact: `storage-state.json`
- Summary: `{ cookieCount, localStorageKeyCount }`
- Data shape:
  - cookie metadata (`name`, `domain`, flags, optional/redacted value)
  - localStorage keys (optional/redacted values)
- Use for:
  - auth/session debugging,
  - environment-specific storage drift,
  - cookie/localStorage presence checks without leaking sensitive values.

### `network-timing`
- Artifact: `network-timing.json`
- Summary: `{ requestCount, totalBytes, slowestRequestMs }`
- Data shape per request:
  - URL, status, resource type, timestamp
  - duration + transfer size
  - timing breakdown (DNS/connect/TLS/request/response)
- Use for:
  - latency regressions,
  - oversized resources,
  - pinpointing whether delay is network vs backend vs render-adjacent.

---

## Recommended collector combinations

### Visual/layout regression
Enable:
- `screenshot`
- `dom-stats`
- `web-vitals`

### Accessibility audit pass
Enable:
- `axe`
- `aria-snapshot`
- `html`

### Form submission/debug pass
Enable:
- `forms`
- `console`
- `network`
- `storage`

### Performance deep-dive pass
Enable:
- `web-vitals`
- `network-timing`
- `dom-stats`
