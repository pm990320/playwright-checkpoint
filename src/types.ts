/**
 * playwright-checkpoint: public type definitions
 *
 * Config resolution order (later levels win):
 *   1. Global defaults  — from `createCheckpoint()`
 *   2. Per-test config  — from `testCheckpointConfig.set()`
 *   3. Per-checkpoint options — from `checkpoint("name", opts)`
 *
 * Collector enable/disable at each level is a simple boolean override.
 */

import type { Page, TestInfo } from '@playwright/test';

// ---------------------------------------------------------------------------
// Core checkpoint types
// ---------------------------------------------------------------------------

/**
 * Checkpoint data captured per `checkpoint()` call.
 */
export type CheckpointRecord = {
  name: string;
  slug: string;
  url: string;
  title: string;
  timestamp: string;
  description?: string;
  step?: number;
  collectors: Record<string, CollectorResult>;
};

/**
 * Manifest produced per test run.
 */
export type CheckpointManifest = {
  environment: string;
  project: string;
  testId: string;
  title: string;
  tags: string[];
  startedAt: string;
  checkpoints: CheckpointRecord[];
};

// ---------------------------------------------------------------------------
// Collector types
// ---------------------------------------------------------------------------

/**
 * Options passed at the per-checkpoint level.
 */
export type CheckpointOptions = {
  /**
   * Override which collectors run for this checkpoint.
   * `true` = enable, `false` = disable, or a partial CollectorOptions object.
   */
  collectors?: Partial<Record<string, boolean | CollectorOptions>>;
  /** Long-form description used for help-article generation. */
  description?: string;
  /** CSS selector used to highlight a region in screenshot annotation. */
  highlightSelector?: string;
  /** Step number embedded in generated documentation. */
  step?: number;
  /** Screenshot option — capture the full page. */
  fullPage?: boolean;
};

/**
 * Per-test configuration applied to every checkpoint in a test.
 */
export type TestCheckpointConfig = {
  collectors?: Partial<Record<string, boolean | CollectorOptions>>;
  description?: string;
};

/**
 * Per-collector options a user can override at the global or per-collector level.
 */
export type CollectorOptions = Record<string, unknown>;

/**
 * Global-level collector enable/disable + options.
 */
export type CollectorConfig = boolean | CollectorOptions;

/**
 * Resolved collector configuration after applying the three-level merge.
 */
export type ResolvedCollectorConfig = CollectorOptions;

/**
 * A single file artifact produced by a collector.
 */
export type CollectorArtifact = {
  /** Human-readable artifact name, e.g. "screenshot", "axe-report". */
  name: string;
  /** Absolute path to the written artifact file. */
  path: string;
  /** MIME type for testInfo.attach(). */
  contentType: string;
};

/**
 * Value returned by a collector's `collect()` method.
 */
export type CollectorResult = {
  /** Collector-specific structured data. Each collector defines its own shape. */
  data: unknown;
  /** Files written to the checkpoint directory. */
  artifacts: CollectorArtifact[];
  /** Summary fields written into the checkpoint manifest. */
  summary: Record<string, unknown>;
};

/**
 * Context object passed to a collector's `collect()` method.
 */
export type CollectorContext = {
  page: Page;
  testInfo?: TestInfo;
  /** Directory path where artifacts should be written. */
  checkpointDir: string;
  checkpointName: string;
  checkpointSlug: string;
  /** Global redact patterns plus any collector-specific overrides. */
  redact: string[];
  config: ResolvedCollectorConfig;
  options: CheckpointOptions;
  adjustTimeout?: (ms: number) => void;
};

/**
 * Collector plugin interface.
 *
 * Optional `setup()` runs once per test (e.g., to attach event listeners).
 * `collect()` runs at every `checkpoint()` call.
 * Optional `teardown()` runs after the test finishes.
 */
export type CheckpointCollector = {
  name: string;
  defaultEnabled: boolean;

  /** Runs once per test before the first checkpoint. */
  setup?(context: { page: Page; testInfo?: TestInfo }): Promise<void>;

  /** Runs at each checkpoint call. */
  collect(context: CollectorContext): Promise<CollectorResult>;

  /** Runs once after the test finishes. */
  teardown?(context: { page: Page; testInfo?: TestInfo }): Promise<void>;
};

// ---------------------------------------------------------------------------
// Built-in collector data shapes
// ---------------------------------------------------------------------------

export type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ScreenshotCollectorData = {
  fullPage: boolean;
  highlightBounds: BoundingBox | null;
  highlightSelector?: string | null;
  imageSize?: {
    width: number;
    height: number;
  } | null;
};

export type HtmlCollectorData = {
  contentLength: number;
};

export type AxeCollectorData = {
  skipped: boolean;
  reason: string | null;
  violations: number;
  results: unknown | null;
};

export type WebVitalRating = 'good' | 'needs-improvement' | 'poor' | 'unknown';

export type WebVitalMetric = {
  value: number | null;
  rating: WebVitalRating;
};

export type WebVitalsSnapshot = {
  url: string;
  capturedAt: string;
  cls: WebVitalMetric;
  fcpMs: WebVitalMetric;
  lcpMs: WebVitalMetric;
  inpMs: WebVitalMetric;
  ttfbMs: WebVitalMetric;
  domContentLoadedMs: number | null;
  loadEventMs: number | null;
};

export type ConsoleErrorRecord = {
  type: string;
  text: string;
  location:
    | {
        url?: string;
        lineNumber?: number;
        columnNumber?: number;
      }
    | null;
  timestamp: string;
};

export type FailedRequestRecord = {
  kind: 'requestfailed' | 'http-error';
  url: string;
  method: string;
  status: number | null;
  statusText: string | null;
  failureText: string | null;
  timestamp: string;
};

export type PageMetadata = {
  url: string;
  title: string;
  description: string | null;
  openGraph: {
    title: string | null;
    description: string | null;
    image: string | null;
  };
  canonicalUrl: string | null;
  lang: string | null;
  viewport: string | null;
  structuredData: unknown[];
};

export type AriaSnapshotCollectorData = {
  snapshot: unknown | null;
  nodeCount: number;
};

export type DomStatsCollectorData = {
  nodeCount: number;
  maxDepth: number;
  formCount: number;
  imageCount: number;
  scriptCount: number;
  stylesheetCount: number;
  eventListenerCount: number | null;
};

export type FormFieldValue = string | string[] | null;

export type FormFieldState = {
  tagName: 'input' | 'select' | 'textarea';
  type: string | null;
  name: string | null;
  id: string | null;
  label: string | null;
  placeholder: string | null;
  value: FormFieldValue;
  checked: boolean | null;
  disabled: boolean;
  required: boolean;
  redacted: boolean;
};

export type FormsCollectorData = {
  fieldCount: number;
  redactedCount: number;
  fields: FormFieldState[];
};

export type StorageCookieState = {
  name: string;
  domain: string;
  path: string;
  value: string | null;
  redacted: boolean;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
};

export type StorageEntryState = {
  key: string;
  value: string | null;
  redacted: boolean;
};

export type StorageCollectorData = {
  cookieCount: number;
  localStorageKeyCount: number;
  cookies: StorageCookieState[];
  localStorage: StorageEntryState[];
};

export type NetworkTimingBreakdown = {
  startTimeMs: number | null;
  redirectMs: number | null;
  dnsMs: number | null;
  connectMs: number | null;
  tlsMs: number | null;
  requestMs: number | null;
  responseMs: number | null;
};

export type NetworkTimingRecord = {
  url: string;
  status: number | null;
  statusText: string | null;
  resourceType: string | null;
  timestamp: string;
  durationMs: number | null;
  transferSize: number | null;
  encodedBodySize: number | null;
  decodedBodySize: number | null;
  nextHopProtocol: string | null;
  timing: NetworkTimingBreakdown;
};

export type NetworkTimingCollectorData = {
  requestCount: number;
  totalBytes: number;
  slowestRequestMs: number;
  requests: NetworkTimingRecord[];
};

// ---------------------------------------------------------------------------
// Reporter types
// ---------------------------------------------------------------------------

/**
 * Configuration accepted by a report generator plugin.
 */
export type ReporterConfig = boolean | Record<string, unknown>;

/**
 * Context passed to a report generator's `generate()` method.
 */
export type ReportGeneratorContext = {
  /** Run records loaded from manifest files, enriched for reporting. */
  runs: RunRecord[];
  /** Output directory for generated report files. */
  outputDir: string;
  /** Resolved reporter configuration. */
  config: Record<string, unknown>;
  /** Raw checkpoint manifests. */
  manifests: CheckpointManifest[];
};

/**
 * Value returned by a report generator's `generate()` method.
 */
export type ReportGeneratorResult = {
  /** Paths to files written by the generator. */
  files: string[];
  /** One-line summary of the generated report. */
  summary: string;
};

/**
 * Report generator plugin interface.
 */
export type ReportGenerator = {
  name: string;
  description?: string;

  /** Optional config validation — return false to reject invalid config. */
  validateConfig?(config: unknown): boolean;

  /** Generate the report from loaded runs and manifests. */
  generate(context: ReportGeneratorContext): Promise<ReportGeneratorResult>;
};

export type ReportGenerationResults = Record<string, ReportGeneratorResult>;

// ---------------------------------------------------------------------------
// Global config
// ---------------------------------------------------------------------------

/**
 * Global checkpoint configuration, passed to `createCheckpoint()`.
 */
export type CheckpointConfig = {
  /** Per-collector global defaults. */
  collectors?: Partial<Record<string, boolean | CollectorConfig>>;
  /** Custom collector plugins registered at the global level. */
  custom?: CheckpointCollector[];
  /** Reporter generator plugins. */
  reporters?: Partial<Record<string, boolean | ReporterConfig>>;
  /** Regex patterns used to strip PII from artifact filenames / content. */
  redact?: string[];
};

// ---------------------------------------------------------------------------
// Run record (for report generators)
// ---------------------------------------------------------------------------

/**
 * A run record loaded from a manifest file, enriched with a unique key
 * and the path to its source manifest.
 */
export type RunRecord = {
  key: string;
  sourceManifestPath: string;
  environment: string;
  project: string;
  testId: string;
  title: string;
  tags: string[];
  startedAt: string;
  checkpoints: CheckpointRecord[];
};
