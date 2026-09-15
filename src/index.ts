#!/usr/bin/env node
/**
 * openisd-mcp — MCP server (stdio) over the vendored OpenISD engine.
 * Stateless: every design lives in the calling agent's context.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools.js';
import { runSelfTest } from './selftest.js';

// Self-test first (AD-5): prove the vendored bundle before serving anything.
const st = runSelfTest();
if (!st.ok) {
  console.error('[openisd-mcp self-test] FAILED — refusing to serve:');
  for (const f of st.failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.error('[openisd-mcp self-test] OK');

const server = new McpServer({ name: 'openisd-mcp', version: '0.1.0' });
registerTools(server);
await server.connect(new StdioServerTransport());
