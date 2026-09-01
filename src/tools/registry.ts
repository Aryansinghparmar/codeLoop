import type { LlmToolDefinition } from '../llm/provider';
import type { Tool, ToolExecutionContext, ToolResult } from './tool';
import { redactSecrets } from '../shared/redact';

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  public register(tool: Tool): void {
    if (this.tools.has(tool.definition.name)) throw new Error(`Tool '${tool.definition.name}' is already registered.`);
    this.tools.set(tool.definition.name, tool);
  }

  public get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  public definitions(): LlmToolDefinition[] {
    return [...this.tools.values()].map((tool) => tool.definition);
  }

  public async execute(name: string, args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return { ok: false, content: `Unknown tool '${name}'.` };
    try {
      const result = await tool.execute(args, context);
      return { ...result, content: redactSecrets(result.content) };
    } catch (error) {
      return { ok: false, content: redactSecrets(error instanceof Error ? error.message : String(error)) };
    }
  }
}
