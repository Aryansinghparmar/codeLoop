import type { LlmToolCall } from '../../llm/provider';
import { commandHelp } from '../keybindings';

export class ConsoleRenderer {
  public printWelcome(provider: string): void {
    console.log(`CodeLoop | provider: ${provider}`);
    console.log(commandHelp());
  }

  public printText(text: string): void {
    if (text) console.log(text);
  }

  public printToolCall(call: LlmToolCall): void {
    console.log(`→ ${call.name}`);
  }

  public printToolResult(ok: boolean, content: string): void {
    console.log(ok ? '  ✓ tool completed' : `  ✗ ${content}`);
  }
}
