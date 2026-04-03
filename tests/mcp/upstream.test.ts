import { describe, expect, it } from 'vitest';
import { resolveUpstream, injectDebugPort } from '../../src/mcp/upstream';

describe('resolveUpstream', () => {
  it('returns explicit upstream when provided', () => {
    expect(resolveUpstream({ upstream: '@playwright/mcp' })).toBe('@playwright/mcp');
    expect(resolveUpstream({ upstream: 'playwright-mcp-advanced' })).toBe('playwright-mcp-advanced');
  });
});

describe('injectDebugPort', () => {
  it('returns args unchanged when --remote-debugging-port is present', () => {
    const args = ['--headless', '--remote-debugging-port=9223'];
    expect(injectDebugPort(args)).toBe(args);
  });

  it('returns args unchanged when --cdp-endpoint is present', () => {
    const args = ['--cdp-endpoint=http://localhost:9222'];
    expect(injectDebugPort(args)).toBe(args);
  });

  it('prepends --remote-debugging-port=9222 when no debug port is set', () => {
    expect(injectDebugPort([])).toEqual(['--remote-debugging-port=9222']);
    expect(injectDebugPort(['--headless'])).toEqual(['--remote-debugging-port=9222', '--headless']);
    expect(injectDebugPort(['--browser', 'chrome'])).toEqual([
      '--remote-debugging-port=9222',
      '--browser',
      'chrome',
    ]);
  });
});
