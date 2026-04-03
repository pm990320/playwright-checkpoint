import { describe, expect, it } from 'vitest';
import { extractCdpUrlFromStderr } from '../../src/mcp/browser-connect';

describe('extractCdpUrlFromStderr', () => {
  it('extracts ws:// URL from Chrome DevTools listening message', () => {
    const line =
      'DevTools listening on ws://127.0.0.1:9222/devtools/browser/abc-123';
    expect(extractCdpUrlFromStderr(line)).toBe(
      'ws://127.0.0.1:9222/devtools/browser/abc-123',
    );
  });

  it('extracts from a longer stderr block', () => {
    const block = [
      'some other output',
      'DevTools listening on ws://localhost:9223',
      'more output',
    ].join('\n');
    expect(extractCdpUrlFromStderr(block)).toBe('ws://localhost:9223');
  });

  it('returns null when no CDP URL is present', () => {
    expect(extractCdpUrlFromStderr('nothing here')).toBeNull();
    expect(extractCdpUrlFromStderr('')).toBeNull();
  });
});
