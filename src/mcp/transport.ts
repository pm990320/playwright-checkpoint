/**
 * Minimal MCP stdio transport — inlined from @modelcontextprotocol/sdk/shared/stdio
 * to avoid SDK subpath resolution issues. This matches the SDK's protocol exactly.
 */

import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types';

function serializeMessage(message: JSONRPCMessage): string {
  return JSON.stringify(message) + '\n';
}

class ReadBuffer {
  private _buffer?: Buffer;

  append(chunk: Buffer): void {
    this._buffer = this._buffer ? Buffer.concat([this._buffer, chunk]) : chunk;
  }

  readMessage(): JSONRPCMessage | null {
    if (!this._buffer) return null;
    const index = this._buffer.indexOf('\n');
    if (index === -1) return null;
    const line = this._buffer.toString('utf8', 0, index).replace(/\r$/, '');
    this._buffer = this._buffer.subarray(index + 1);
    try {
      return JSON.parse(line) as JSONRPCMessage;
    } catch {
      return null;
    }
  }

  clear(): void {
    this._buffer = undefined;
  }
}

/**
 * Minimal stdio transport for the MCP server.
 * Communicates with the MCP client via stdin/stdout using newline-delimited JSON-RPC.
 */
export class StdioServerTransport {
  private readonly _stdin: NodeJS.ReadableStream;
  private readonly _stdout: NodeJS.WritableStream;
  private readonly _readBuffer = new ReadBuffer();
  private _started = false;

  constructor(stdin?: NodeJS.ReadableStream, stdout?: NodeJS.WritableStream) {
    this._stdin = stdin ?? process.stdin;
    this._stdout = stdout ?? process.stdout;
  }

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  async start(): Promise<void> {
    if (this._started) {
      throw new Error('StdioServerTransport already started!');
    }
    this._started = true;

    this._stdin.on('data', (chunk: Buffer) => {
      this._readBuffer.append(chunk);
      this.#processReadBuffer();
    });

    this._stdin.on('error', (error: Error) => {
      this.onerror?.(error);
    });
  }

  #processReadBuffer(): void {
    while (true) {
      try {
        const message = this._readBuffer.readMessage();
        if (message === null) break;
        this.onmessage?.(message);
      } catch (error) {
        this.onerror?.(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  async close(): Promise<void> {
    (this._stdin as NodeJS.ReadableStream & { pause?: () => void }).pause?.();
    this._readBuffer.clear();
    this.onclose?.();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    const json = serializeMessage(message);
    if (this._stdout.write(json)) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this._stdout.once('drain', resolve);
    });
  }
}
