import { describe, expect, it } from 'vitest';
import { parseMcpCliArgs, printMcpHelp } from '../../src/cli/mcp-args';

describe('parseMcpCliArgs', () => {
  it('returns empty flags and passthrough for empty args', () => {
    expect(parseMcpCliArgs([])).toEqual({ flags: {}, passthroughArgs: [] });
  });

  it('parses --upstream with a value', () => {
    expect(parseMcpCliArgs(['--upstream', '@playwright/mcp'])).toEqual({
      flags: { upstream: '@playwright/mcp' },
      passthroughArgs: [],
    });
  });

  it('parses --upstream=value syntax', () => {
    expect(parseMcpCliArgs(['--upstream=playwright-mcp-advanced'])).toEqual({
      flags: { upstream: 'playwright-mcp-advanced' },
      passthroughArgs: [],
    });
  });

  it('parses --standalone flag', () => {
    expect(parseMcpCliArgs(['--standalone'])).toEqual({
      flags: { standalone: true },
      passthroughArgs: [],
    });
  });

  it('parses --cdp-endpoint with a URL', () => {
    expect(parseMcpCliArgs(['--cdp-endpoint', 'http://localhost:9222'])).toEqual({
      flags: { cdpEndpoint: 'http://localhost:9222' },
      passthroughArgs: [],
    });
  });

  it('parses --cdp-endpoint=value syntax', () => {
    expect(parseMcpCliArgs(['--cdp-endpoint=http://localhost:9222'])).toEqual({
      flags: { cdpEndpoint: 'http://localhost:9222' },
      passthroughArgs: [],
    });
  });

  it('parses --output-dir with a path', () => {
    expect(parseMcpCliArgs(['--output-dir', './checkpoints'])).toEqual({
      flags: { outputDir: './checkpoints' },
      passthroughArgs: [],
    });
  });

  it('parses multiple flags together', () => {
    expect(
      parseMcpCliArgs([
        '--upstream',
        '@playwright/mcp',
        '--output-dir',
        './out',
        '--standalone',
      ]),
    ).toEqual({
      flags: {
        upstream: '@playwright/mcp',
        outputDir: './out',
        standalone: true,
      },
      passthroughArgs: [],
    });
  });

  it('treats everything after -- as passthrough', () => {
    const result = parseMcpCliArgs([
      '--standalone',
      '--',
      '--headless',
      '--browser',
      'chrome',
    ]);
    expect(result.flags).toEqual({ standalone: true });
    expect(result.passthroughArgs).toEqual(['--headless', '--browser', 'chrome']);
  });

  it('captures remaining unknown args as passthrough', () => {
    const result = parseMcpCliArgs(['--upstream', '@playwright/mcp', 'some-arg']);
    expect(result.flags).toEqual({ upstream: '@playwright/mcp' });
    expect(result.passthroughArgs).toEqual(['some-arg']);
  });

  it('returns __help__ for --help', () => {
    const result = parseMcpCliArgs(['--help']);
    expect(result.flags.upstream).toBe('__help__');
    expect(result.passthroughArgs).toEqual([]);
  });

  it('returns __help__ for -h', () => {
    const result = parseMcpCliArgs(['-h']);
    expect(result.flags.upstream).toBe('__help__');
    expect(result.passthroughArgs).toEqual([]);
  });

  it('throws for --upstream with missing value', () => {
    expect(() => parseMcpCliArgs(['--upstream'])).toThrow('--upstream requires a package name argument.');
  });

  it('throws for --cdp-endpoint with missing value', () => {
    expect(() => parseMcpCliArgs(['--cdp-endpoint'])).toThrow('--cdp-endpoint requires a URL argument.');
  });

  it('throws for --output-dir with missing value', () => {
    expect(() => parseMcpCliArgs(['--output-dir'])).toThrow('--output-dir requires a path argument.');
  });
});

describe('printMcpHelp', () => {
  it('does not throw when called with console.log', () => {
    expect(() => printMcpHelp(console.log)).not.toThrow();
  });

  it('outputs the command name', () => {
    const lines: string[] = [];
    printMcpHelp((msg) => lines.push(msg));
    expect(lines.some((l) => l.includes('playwright-checkpoint mcp'))).toBe(true);
  });
});
