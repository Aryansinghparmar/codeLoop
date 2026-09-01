import type { McpClient } from './protocol';
import { adaptMcpTool } from './tool-adapter';
import type { ToolRegistry } from '../tools/registry';

export class McpServerRegistry {
  private readonly clients: McpClient[] = [];

  public async register(client: McpClient, registry: ToolRegistry): Promise<void> {
    this.clients.push(client);
    for (const definition of await client.listTools()) registry.register(adaptMcpTool(client, definition));
  }

  public async close(): Promise<void> {
    for (const client of this.clients) await client.close();
  }
}
