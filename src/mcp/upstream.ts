/**
 * Upstream Playwright MCP detection and spawning.
 *
 * Auto-detection priority:
 *  1. Explicit `--upstream @playwright/mcp` flag
 *  2. Scan node_modules for `@playwright/mcp`
 *  3. Scan node_modules for `playwright-mcp-advanced`
 *  4. null — standalone mode (no upstream proxying)
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

/* eslint-disable @typescript-eslint/no-require-imports */
function getNodeModuleCreateRequire(): NodeJS.Require {
  const { createRequire } = require('node:module');
  return createRequire(process.cwd() + '/noop.js');
}
/* eslint-enable @typescript-eslint/no-require-imports */

interface ToolDescriptor {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

interface ListToolsResult {
  tools: ToolDescriptor[];
}

interface CallToolResult {
  content: Array<{ type: string; [key: string]: unknown }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Package detection
// ---------------------------------------------------------------------------

/** Attempt to resolve a package's package.json from the current working directory. */
function resolvePackageJson(pkg: string): string | null {
  try {
    const req = getNodeModuleCreateRequire();
    return req.resolve(`${pkg}/package.json`);
  } catch {
    return null;
  }
}

/**
 * Resolve the upstream MCP package to use.
 *
 * Returns the package name to spawn, or null for standalone mode.
 */
export function resolveUpstream(options: { upstream?: string }): string | null {
  // Explicit override always wins
  if (options.upstream) {
    return options.upstream;
  }

  // Auto-detect
  if (resolvePackageJson('@playwright/mcp')) {
    return '@playwright/mcp';
  }
  if (resolvePackageJson('playwright-mcp-advanced')) {
    return 'playwright-mcp-advanced';
  }

  return null;
}

// ---------------------------------------------------------------------------
// Stdio transport helpers (minimal, no external deps beyond Node built-ins)
// ---------------------------------------------------------------------------

type MessageCallback = (message: unknown) => void;

/**
 * Minimal stdio transport that wraps a ChildProcess's stdin/stdout as an
 * MCP transport using the same newline-delimited JSON-RPC format as the SDK.
 */
class ChildProcessTransport {
  private pendingRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private id = 0;

  constructor(
    private stdin: Writable,
    private stdout: Readable,
    private stderr: Readable | null,
    private onMessage: MessageCallback,
    private onClose?: () => void,
  ) {}

  start(): void {
    // Drain stdout line-by-line into JSON-RPC messages
    let buffer = '';
    this.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) {
          try {
            const msg = JSON.parse(line);
            this.handleMessage(msg);
          } catch {
            // ignore parse errors
          }
        }
      }
    });

    this.stdout.on('end', () => {
      this.onClose?.();
    });

    this.stderr?.on('data', (chunk: Buffer) => {
      // Pass stderr through to parent stderr so Chrome debug URLs are visible
      process.stderr.write(chunk);
    });
  }

  private handleMessage(
     
    msg: { id?: unknown; result?: unknown; error?: unknown; method?: string; params?: unknown },
  ): void {
    // Response to one of our requests
    if (msg.id !== undefined) {
      const pending = this.pendingRequests.get(String(msg.id));
      if (pending) {
        this.pendingRequests.delete(String(msg.id));
        if (msg.error) {
          pending.reject(new Error(String(msg.error)));
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }
    // Server-to-client notification (shouldn't happen in our use case but handle gracefully)
    if (msg.method) {
      this.onMessage(msg);
    }
  }

  send(message: { method: string; params?: unknown; id?: unknown }): void {
    const json = JSON.stringify(message) + '\n';
    this.stdin.write(json);
  }

  request(method: string, params?: unknown): Promise<unknown> {
    const id = String(++this.id);
    const promise = new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve: resolve as (v: unknown) => void, reject });
    });
    this.send({ method, params, id });
    return promise;
  }

  close(): void {
    this.stdin.end();
  }
}

// ---------------------------------------------------------------------------
// Upstream connection
// ---------------------------------------------------------------------------

export interface UpstreamConnection {
  /** List all tools the upstream server provides. */
  listTools(): Promise<ListToolsResult>;
  /** Call a tool on the upstream server. */
  callTool(name: string, args?: Record<string, unknown>): Promise<CallToolResult>;
  /** The underlying child process (may be null in standalone mode). */
  process: ChildProcess | null;
  /** Close the upstream connection. */
  close(): void;
}

// ---------------------------------------------------------------------------
// CDP port injection
// ---------------------------------------------------------------------------

/**
 * Inject `--remote-debugging-port=9222` into the args array if no existing
 * remote-debugging-port or cdp-endpoint flag is present.
 */
export function injectDebugPort(args: string[]): string[] {
  const hasDebugFlag = args.some(
    (a) => a.startsWith('--remote-debugging-port') || a.startsWith('--cdp-endpoint'),
  );
  if (hasDebugFlag) {
    return args;
  }
  return ['--remote-debugging-port=9222', ...args];
}

// ---------------------------------------------------------------------------
// Spawn and connect
// ---------------------------------------------------------------------------

/**
 * Spawn the upstream MCP server as a child process and return a connection handle.
 */
export function spawnUpstream(pkg: string, passthroughArgs: string[]): UpstreamConnection {
  // Spawn via npx so scoped packages work without a local install
  const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const npxArgs = [pkg, ...passthroughArgs];

  const child = spawn(npxBin, npxArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // Prevent npx from prompting or caching in CI
      NPM_CONFIG_YES: 'true',
      NPM_CONFIG_INTERACTIVE: 'false',
    },
    shell: false,
    windowsHide: true,
  });

  const transport = new ChildProcessTransport(
    child.stdin!,
    child.stdout!,
    child.stderr!,
    (_msg: unknown) => {
      // Notifications from upstream — not expected in proxy use, ignore
    },
    () => {
      // Process ended
    },
  );
  transport.start();

  const connection: UpstreamConnection = {
    process: child,

    async listTools(): Promise<ListToolsResult> {
      const result = await transport.request('tools/list');
      return result as ListToolsResult;
    },

    async callTool(name: string, args?: Record<string, unknown>): Promise<CallToolResult> {
      const result = await transport.request('tools/call', { name, arguments: args ?? {} });
      return result as CallToolResult;
    },

    close(): void {
      transport.close();
    },
  };

  return connection;
}
