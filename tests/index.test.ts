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

  it('exports all public types from the barrel (checked via dist declaration file)', async () => {
    // Read the generated .d.ts to verify type declarations were emitted.
    const { readFile } = await import('fs/promises');
    const dts = await readFile('dist/index.d.ts', 'utf-8');

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
      'ReporterConfig',
      'ReportGenerator',
      'ReportGeneratorContext',
      'ReportGeneratorResult',
      'RunRecord',
    ] as const;

    for (const typeName of expectedTypes) {
      // Types are emitted as `type CheckpointRecord = {…}` in the .d.ts body,
      // then re-exported via `export { type … }`.
      expect(dts).toMatch(new RegExp(`\\btype ${typeName}\\b`));
    }
  });
});
