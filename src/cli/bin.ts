#!/usr/bin/env node

import { runCli } from './index';
import { parseMcpCliArgs, printMcpHelp } from './mcp-args';

const argv = process.argv.slice(2);

if (argv[0] === 'mcp') {
  const { passthroughArgs, flags } = parseMcpCliArgs(argv.slice(1));

  if (flags.upstream === '__help__') {
    printMcpHelp(console.log);
    process.exit(0);
  }

  void (async () => {
    try {
      const { startMcpProxy } = await import('../mcp/index.js');
      await startMcpProxy({
        upstream: flags.upstream,
        standalone: flags.standalone,
        cdpEndpoint: flags.cdpEndpoint,
        outputDir: flags.outputDir,
        passthrough: passthroughArgs,
      });
    } catch (err) {
      console.error(
        '[playwright-checkpoint MCP]',
        err instanceof Error ? err.message : String(err),
      );
      process.exit(1);
    }
  })();
} else {
  void runCli(argv).then((code) => {
    process.exitCode = code;
  });
}
