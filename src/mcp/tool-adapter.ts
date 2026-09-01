import type { McpClient, McpToolDefinition } from './protocol';
import { truncateMiddle } from '../shared/text';
import type { Tool } from '../tools/tool';

export function adaptMcpTool(client: McpClient, definition: McpToolDefinition): Tool {
  return {
    definition: {
      name: `mcp_${definition.name}`,
      description: `[External MCP tool] ${definition.description ?? definition.name}`,
      parameters: definition.inputSchema,
    },
    async execute(args, context) {
      const approved = await context.approve?.({ action: 'shell', target: `MCP tool ${definition.name}`, detail: 'External MCP tools require confirmation.' });
      if (!approved) return { ok: false, content: 'MCP tool call rejected by the user.' };
      const result = await client.callTool(definition.name, args);
      const output = truncateMiddle(JSON.stringify(result), 16_000);
      return { ok: true, content: output.text, truncated: output.truncated };
    },
  };
}
