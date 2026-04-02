import { describe, expect, it } from 'vitest';
import { collectTags, resolveCollectors, sanitizeSegment } from '../src/fixture';
import type { CheckpointConfig, TestCheckpointConfig } from '../src/types';

describe('resolveCollectors', () => {
  it('merges global, per-test, and per-checkpoint collector config in precedence order', () => {
    const globalConfig: CheckpointConfig = {
      collectors: {
        screenshot: true,
        html: { pretty: true },
        axe: false,
      },
    };

    const testConfig: TestCheckpointConfig = {
      collectors: {
        screenshot: false,
        html: { minify: true },
        axe: true,
      },
    };

    const result = resolveCollectors(globalConfig, testConfig, {
      collectors: {
        screenshot: { quality: 80 },
        html: false,
        forms: true,
      },
    });

    expect(Object.fromEntries(result)).toEqual({
      screenshot: { quality: 80 },
      axe: {},
      forms: {},
    });
  });

  it('filters disabled collectors out of the resolved set', () => {
    const result = resolveCollectors(
      {
        collectors: {
          screenshot: true,
          html: true,
          axe: true,
        },
      },
      {
        collectors: {
          html: false,
        },
      },
      {
        collectors: {
          axe: false,
        },
      },
    );

    expect([...result.keys()]).toEqual(['screenshot']);
  });
});

describe('sanitizeSegment', () => {
  it('creates lowercase, dash-separated slugs', () => {
    expect(sanitizeSegment('  Login Form / Step 1  ')).toBe('login-form-step-1');
  });

  it('falls back to checkpoint when nothing slug-safe remains', () => {
    expect(sanitizeSegment('!!!')).toBe('checkpoint');
  });
});

describe('collectTags', () => {
  it('extracts lowercase tags from title parts', () => {
    expect(
      Array.from(collectTags(['Checkout flow @Smoke @Auth', 'Nested suite @regression', 'No tags here'])).sort(),
    ).toEqual(['@auth', '@regression', '@smoke']);
  });

  it('deduplicates repeated tags across title parts', () => {
    expect(Array.from(collectTags(['Flow @smoke', 'Suite @SMOKE @smoke']))).toEqual(['@smoke']);
  });
});
