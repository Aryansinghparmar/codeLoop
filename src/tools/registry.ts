import type { LlmToolDefinition } from '../llm/provider';
import type { Tool, ToolExecutionContext, ToolResult } from './tool';
import { redactSecrets } from '../shared/redact';

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  public register(tool: Tool): void {
    const name = tool.definition.name;
    if (this.tools.has(name)) throw new Error(`Tool '${name}' is already registered.`);
    this.tools.set(name, tool);
  }

  public get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  public definitions(): LlmToolDefinition[] {
    return [...this.tools.values()].map((tool) => tool.definition);
  }

  /** Runs a tool. A thrown error becomes a failed result, and all output is redacted before it leaves. */
  public async execute(name: string, args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return { ok: false, content: `Unknown tool '${name}'.` };
    try {
      const result = await tool.execute(args, context);
      return { ...result, content: redactSecrets(result.content) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, content: redactSecrets(message) };
    }
  }
}
