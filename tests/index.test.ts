/**
 * Smoke test — verifies the package barrel loads and exports the public API.
 */
import { describe, expect, it } from 'vitest';
import * as pkg from '../src/index';

describe('playwright-checkpoint', () => {
  it('loads the package barrel without errors', () => {
    expect(pkg).toBeDefined();
  });

  it('exports VERSION as a runtime value', () => {
    expect(pkg.VERSION).toBe('0.1.0');
  });

  it('exports all public types from the barrel source', async () => {
    const { readFile } = await import('fs/promises');
    const barrel = await readFile('src/index.ts', 'utf-8');
    const typesSource = await readFile('src/types.ts', 'utf-8');

    expect(barrel).toContain("export type * from './types';");

    const expectedTypes = [
      'CheckpointRecord',
      'CheckpointManifest',
      'CheckpointOptions',
      'CheckpointConfig',
      'TestCheckpointConfig',
      'CheckpointCollector',
      'CollectorResult',
      'CollectorArtifact',
      'CollectorContext',
      'CollectorOptions',
      'ResolvedCollectorConfig',
      'CollectorConfig',
      'BoundingBox',
      'ScreenshotCollectorData',
      'HtmlCollectorData',
      'AxeCollectorData',
      'WebVitalRating',
      'WebVitalMetric',
      'WebVitalsSnapshot',
      'ConsoleErrorRecord',
      'FailedRequestRecord',
      'PageMetadata',
      'AriaSnapshotCollectorData',
      'DomStatsCollectorData',
      'FormFieldValue',
      'FormFieldState',
      'FormsCollectorData',
      'StorageCookieState',
      'StorageEntryState',
      'StorageCollectorData',
      'NetworkTimingBreakdown',
      'NetworkTimingRecord',
      'NetworkTimingCollectorData',
      'ReporterConfig',
      'ReportGenerator',
      'ReportGeneratorContext',
      'ReportGeneratorResult',
      'ReportGenerationResults',
      'RunRecord',
    ] as const;

    for (const typeName of expectedTypes) {
      expect(typesSource).toMatch(new RegExp(`export type ${typeName}\\b`));
    }
  });
});
