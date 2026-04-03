import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    core: 'src/core.ts',
    components: 'src/components.ts',
    'cli/index': 'src/cli/index.ts',
    'cli/bin': 'src/cli/bin.ts',
    'cli/mcp-args': 'src/cli/mcp-args.ts',
    'mcp/index': 'src/mcp/index.ts',
    teardown: 'src/teardown.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  outDir: 'dist',
  external: [
    '@playwright/test',
    '@axe-core/playwright',
    // MCP and browser deps are optional peer deps — leave them external so
    // the package can be used without installing them.
    '@modelcontextprotocol/sdk',
    'playwright-core',
  ],
});
