/**
 * playwright-checkpoint MCP proxy server.
 *
 * Proxies all tools from an upstream Playwright MCP server while adding
 * the browser_checkpoint, browser_checkpoint_report, and
 * browser_checkpoint_compare tools handled locally.
 *
 * The StdioServerTransport is inlined locally. The SDK is loaded at runtime
 * (not bundled) so this module works even when the SDK is not installed,
 * with a clear error message when startMcpProxy() is actually called.
 */

import { StdioServerTransport } from './transport';

import { resolveUpstream, spawnUpstream, injectDebugPort } from './upstream';
import { getUpstreamPage, resetCachedConnection } from './browser-connect';
import {
  CHECKPOINT_TOOLS,
  CHECKPOINT_TOOL_NAME,
  REPORT_TOOL_NAME,
  COMPARE_TOOL_NAME,
  handleBrowserCheckpoint,
  handleBrowserCheckpointReport,
  handleBrowserCheckpointCompare,
} from './tools';

// ---------------------------------------------------------------------------
// SDK availability check
// ---------------------------------------------------------------------------

function ensureMcpSdk(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@modelcontextprotocol/sdk');
  } catch {
    throw new Error(
      'playwright-checkpoint MCP mode requires @modelcontextprotocol/sdk.\n' +
        'Install it: npm install @modelcontextprotocol/sdk',
    );
  }
}

/* eslint-disable @typescript-eslint/no-require-imports */
function getNodeModuleCreateRequire(): (specifier: string) => NodeJS.Require {
  const { createRequire } = require('node:module');
  return createRequire(import.meta.url);
}
/* eslint-enable @typescript-eslint/no-require-imports */

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type McpProxyOptions = {
  /** Explicit upstream package to proxy (e.g. "@playwright/mcp"). */
  upstream?: string;
  /** Run in standalone mode — no upstream proxying. */
  standalone?: boolean;
  /** CDP endpoint to connect to the browser directly (overrides auto-detection). */
  cdpEndpoint?: string;
  /** Directory for checkpoint output files (default: ./checkpoints). */
  outputDir?: string;
  /** Arguments to pass through to the upstream server (everything after --). */
  passthrough?: string[];
};

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export async function startMcpProxy(options: McpProxyOptions = {}): Promise<void> {
  ensureMcpSdk();

  // Load SDK at runtime — it is a peer-optional dep so we do not bundle it.
  const req = getNodeModuleCreateRequire();
  const sdk: { ListToolsRequestSchema: unknown; CallToolRequestSchema: unknown } = req('@modelcontextprotocol/sdk') as unknown as {
    ListToolsRequestSchema: unknown;
    CallToolRequestSchema: unknown;
  };
  const sdkServer: { Server: unknown } = req('@modelcontextprotocol/sdk/server') as unknown as {
    Server: new (opts: unknown, capabilities?: unknown) => unknown
  };

  const ListToolsRequestSchema = sdk.ListToolsRequestSchema;
  const CallToolRequestSchema = sdk.CallToolRequestSchema;
   
  const Server = sdkServer.Server as new (opts: unknown, capabilities?: unknown) => any;

  const outputDir = options.outputDir ?? './checkpoints';

  // ── Resolve upstream ────────────────────────────────────────────────────
  let upstreamConnection: ReturnType<typeof spawnUpstream> | null = null;
  const upstreamTools: Array<{
    name: string;
    description?: string;
    inputSchema: Record<string, unknown>;
  }> = [];

  const upstreamPkg = options.standalone ? null : resolveUpstream({ upstream: options.upstream });

  if (upstreamPkg) {
    console.error(`[playwright-checkpoint MCP] Proxying upstream: ${upstreamPkg}`);

    let passthroughArgs = options.passthrough ?? [];

    // If no explicit CDP endpoint and no debug port in args, inject one
    // so we can auto-detect the browser
    if (!options.cdpEndpoint) {
      passthroughArgs = injectDebugPort(passthroughArgs);
    }

    upstreamConnection = spawnUpstream(upstreamPkg, passthroughArgs);

    // Wait briefly for the upstream to initialize, then fetch its tool list
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
    try {
      const result = await upstreamConnection.listTools();
      for (const tool of result.tools) {
        upstreamTools.push({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        });
      }
    } catch (err) {
      console.error('[playwright-checkpoint MCP] Warning: could not list upstream tools:', err);
    }
  } else {
    console.error('[playwright-checkpoint MCP] Running in standalone mode (no upstream).');
  }

  // ── Build merged tool list ──────────────────────────────────────────────
  const checkpointTools = CHECKPOINT_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema as Record<string, unknown>,
  }));

  const allTools = [...checkpointTools, ...upstreamTools];

  // ── Create MCP server ─────────────────────────────────────────────────
   
  const server = new Server({ name: 'playwright-checkpoint', version: '0.1.0' }, { capabilities: { tools: {} } });

   
  server.setRequestHandler(ListToolsRequestSchema as any, async () => {
    return { tools: allTools };
  });

   
  server.setRequestHandler(CallToolRequestSchema as any, async (request: {
    params: { name: string; arguments?: Record<string, unknown> };
  }) => {
    const { name, arguments: args = {} } = request.params;

    // ── Handle checkpoint tools locally ──────────────────────────────────
    if (name === CHECKPOINT_TOOL_NAME) {
      const { page } = await getUpstreamPage(upstreamConnection?.process ?? null, {
        cdpEndpoint: options.cdpEndpoint,
        debugPort: 9222,
      });

      const result = await handleBrowserCheckpoint(
        args as Parameters<typeof handleBrowserCheckpoint>[0],
        { page, outputDir },
      );

      return { content: [{ type: 'text', text: result }] };
    }

    if (name === REPORT_TOOL_NAME) {
      const result = await handleBrowserCheckpointReport(
        args as Parameters<typeof handleBrowserCheckpointReport>[0],
      );
      return { content: [{ type: 'text', text: result }] };
    }

    if (name === COMPARE_TOOL_NAME) {
      const result = handleBrowserCheckpointCompare(
        args as Parameters<typeof handleBrowserCheckpointCompare>[0],
      );
      return { content: [{ type: 'text', text: result }], isError: true };
    }

    // ── Forward to upstream ──────────────────────────────────────────────
    if (upstreamConnection) {
      try {
        const result = await upstreamConnection.callTool(name, args as Record<string, unknown>);
        return {
          content: result.content as Array<{ type: string; [key: string]: unknown }>,
          isError: result.isError,
          structuredContent: result.structuredContent,
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Upstream tool "${name}" failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }

    // No upstream and tool not found
    return { content: [{ type: 'text', text: `Tool "${name}" is not available.` }], isError: true };
  });

  // ── Connect transport and start ───────────────────────────────────────
  const transport = new StdioServerTransport();
   
  await (server as any).connect(transport);

  // Clean up on exit
  const cleanup = (): void => {
    resetCachedConnection();
    upstreamConnection?.close();
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}
