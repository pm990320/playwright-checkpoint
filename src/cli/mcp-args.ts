/**
 * Argument parsing for the `playwright-checkpoint mcp` subcommand.
 *
 * Syntax:
 *   playwright-checkpoint mcp [--upstream <pkg>] [--standalone] [--cdp-endpoint <url>]
 *                             [--output-dir <path>] [--] [<passthrough-args>...]
 *
 * The `--` separator terminates flag parsing; everything after it is passed
 * through to the upstream MCP server unchanged.
 */

export type McpFlags = {
  upstream?: string;
  standalone?: boolean;
  cdpEndpoint?: string;
  outputDir?: string;
};

export type ParsedMcpArgs = {
  flags: McpFlags;
  passthroughArgs: string[];
};

/**
 * Parse CLI arguments for the `mcp` subcommand.
 *
 * Returns the parsed flags and any remaining positional / passthrough arguments.
 */
export function parseMcpCliArgs(argv: string[]): ParsedMcpArgs {
  const flags: McpFlags = {};
  const passthroughArgs: string[] = [];
  let doubleDashSeen = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';

    if (doubleDashSeen) {
      passthroughArgs.push(arg);
      continue;
    }

    if (arg === '--') {
      doubleDashSeen = true;
      continue;
    }

    if (arg === '--upstream') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('--upstream requires a package name argument.');
      }
      flags.upstream = value;
      i += 1;
      continue;
    }

    if (arg.startsWith('--upstream=')) {
      flags.upstream = arg.slice('--upstream='.length);
      continue;
    }

    if (arg === '--standalone') {
      flags.standalone = true;
      continue;
    }

    if (arg === '--cdp-endpoint') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('--cdp-endpoint requires a URL argument.');
      }
      flags.cdpEndpoint = value;
      i += 1;
      continue;
    }

    if (arg.startsWith('--cdp-endpoint=')) {
      flags.cdpEndpoint = arg.slice('--cdp-endpoint='.length);
      continue;
    }

    if (arg === '--output-dir') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('--output-dir requires a path argument.');
      }
      flags.outputDir = value;
      i += 1;
      continue;
    }

    if (arg.startsWith('--output-dir=')) {
      flags.outputDir = arg.slice('--output-dir='.length);
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      flags.upstream = '__help__'; // signal to bin.ts to print help
      return { flags, passthroughArgs: [] };
    }

    // Unknown flag — treat remaining args as passthrough
    passthroughArgs.push(arg, ...argv.slice(i + 1));
    break;
  }

  return { flags, passthroughArgs };
}

/**
 * Print the MCP subcommand help text.
 */
export function printMcpHelp(log: (msg: string) => void): void {
  log(`playwright-checkpoint mcp

Start the playwright-checkpoint MCP proxy server.

Usage:
  playwright-checkpoint mcp [options] [-- <upstream-args>...]

Options:
  --upstream <pkg>         Upstream MCP package to proxy (default: auto-detect)
  --standalone             Run without an upstream MCP server
  --cdp-endpoint <url>     Connect directly to a browser CDP endpoint
  --output-dir <path>      Directory for checkpoint output (default: ./checkpoints)
  -h, --help               Show this help text

All arguments after -- are passed through to the upstream MCP server.

Examples:
  # Auto-detect @playwright/mcp from node_modules
  playwright-checkpoint mcp

  # Explicit upstream package
  playwright-checkpoint mcp --upstream @playwright/mcp

  # Pass headless args to upstream
  playwright-checkpoint mcp -- --headless --browser chrome

  # Standalone mode (no upstream, connect to existing browser)
  playwright-checkpoint mcp --standalone --cdp-endpoint http://localhost:9222
`);
}
