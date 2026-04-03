import { describe, expect, it } from 'vitest';
import { formatCheckpointSummary } from '../../src/mcp/tools';
import type { CheckpointRecord } from '../../src/types';

function makeRecord(overrides: Partial<CheckpointRecord>): CheckpointRecord {
  return {
    name: 'test-checkpoint',
    slug: 'test-checkpoint',
    url: 'https://example.com',
    title: 'Example Page',
    timestamp: '2025-01-01T00:00:00.000Z',
    collectors: {},
    ...overrides,
  };
}

describe('formatCheckpointSummary', () => {
  it('includes the checkpoint name, URL, and title', () => {
    const record = makeRecord({ name: 'homepage', url: 'https://example.com', title: 'Example' });
    const output = formatCheckpointSummary(record);
    expect(output).toContain('Checkpoint "homepage" captured.');
    expect(output).toContain('URL: https://example.com');
    expect(output).toContain('Title: Example');
  });

  it('formats axe violations when axe collector data is present', () => {
    const record = makeRecord({
      collectors: {
        axe: {
          data: { skipped: false, violations: 3, reason: null, results: null },
          artifacts: [],
          summary: { violations: 3 },
        },
      },
    });
    const output = formatCheckpointSummary(record);
    expect(output).toContain('Accessibility: 3 violations');
  });

  it('reports skipped axe collector', () => {
    const record = makeRecord({
      collectors: {
        axe: {
          data: { skipped: true, reason: '@axe-core/playwright is unavailable', violations: 0, results: null },
          artifacts: [],
          summary: { violations: 0 },
        },
      },
    });
    const output = formatCheckpointSummary(record);
    expect(output).toContain('Accessibility: skipped');
    expect(output).toContain('@axe-core/playwright is unavailable');
  });

  it('formats web vitals when present', () => {
    const record = makeRecord({
      collectors: {
        'web-vitals': {
          data: {
            url: 'https://example.com',
            capturedAt: '2025-01-01T00:00:00.000Z',
            cls: { value: 0.05, rating: 'good' },
            fcpMs: { value: 800, rating: 'good' },
            lcpMs: { value: 2500, rating: 'good' },
            inpMs: { value: 180, rating: 'needs-improvement' },
            ttfbMs: { value: 800, rating: 'needs-improvement' },
            domContentLoadedMs: null,
            loadEventMs: null,
          },
          artifacts: [],
          summary: {},
        },
      },
    });
    const output = formatCheckpointSummary(record);
    expect(output).toContain('Web Vitals:');
    expect(output).toContain('LCP'); // LCP label
    expect(output).toContain('CLS'); // CLS label
    expect(output).toContain('INP'); // INP label
  });

  it('formats console errors when present', () => {
    const record = makeRecord({
      collectors: {
        console: {
          data: [
            { type: 'error', text: 'TypeError: Cannot read property', location: null, timestamp: '' },
            { type: 'error', text: 'Failed to load resource: 404', location: null, timestamp: '' },
          ],
          artifacts: [],
          summary: { consoleErrorCount: 2 },
        },
      },
    });
    const output = formatCheckpointSummary(record);
    expect(output).toContain('Console: 2 errors');
    expect(output).toContain('TypeError: Cannot read property');
    expect(output).toContain('Failed to load resource: 404');
  });

  it('reports no console errors when none exist', () => {
    const record = makeRecord({
      collectors: {
        console: {
          data: [],
          artifacts: [],
          summary: { consoleErrorCount: 0 },
        },
      },
    });
    const output = formatCheckpointSummary(record);
    expect(output).toContain('Console: no errors');
  });

  it('formats failed network requests when present', () => {
    const record = makeRecord({
      collectors: {
        network: {
          data: [
            {
              kind: 'http-error',
              url: 'https://example.com/api/data',
              method: 'GET',
              status: 404,
              statusText: 'Not Found',
              failureText: null,
              timestamp: '',
            },
          ],
          artifacts: [],
          summary: { failedRequestCount: 1 },
        },
      },
    });
    const output = formatCheckpointSummary(record);
    expect(output).toContain('Network: 1 failed request');
    expect(output).toContain('404 https://example.com/api/data');
  });

  it('reports 0 failed network requests when none exist', () => {
    const record = makeRecord({
      collectors: {
        network: {
          data: [],
          artifacts: [],
          summary: { failedRequestCount: 0 },
        },
      },
    });
    const output = formatCheckpointSummary(record);
    expect(output).toContain('Network: 0 failed requests');
  });

  it('includes screenshot path when screenshot collector ran', () => {
    const record = makeRecord({
      collectors: {
        screenshot: {
          data: { fullPage: true, highlightBounds: null, highlightSelector: null, imageSize: null },
          artifacts: [],
          summary: { screenshotPath: 'page.png' },
        },
      },
    });
    const output = formatCheckpointSummary(record);
    expect(output).toContain('Screenshot: page.png');
  });

  it('handles empty collectors gracefully', () => {
    const record = makeRecord({ collectors: {} });
    expect(() => formatCheckpointSummary(record)).not.toThrow();
    expect(formatCheckpointSummary(record)).toContain('Checkpoint "test-checkpoint" captured.');
  });
});
