import { readFileSync } from 'node:fs';
import type { CodeLoopConfig } from '../config/config';
import { truncateMiddle } from '../shared/text';
import { stringArg, type Tool } from './tool';

export function createReadTool(config: CodeLoopConfig): Tool {
  return {
    definition: {
      name: 'read',
      description: 'Read a UTF-8 text file inside the project. Use line ranges when possible.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, startLine: { type: 'number' }, endLine: { type: 'number' } },
        required: ['path'],
        additionalProperties: false,
      },
    },
    async execute(args, context) {
      const input = stringArg(args, 'path');
      const path = context.pathGuard.resolveInside(input);
      const permission = context.permissionPolicy.evaluate({ action: 'read', target: path });
      if (permission.decision !== 'allow') return { ok: false, content: `Read denied: ${permission.reason}` };
      const text = readFileSync(path, 'utf8');
      const startLine = typeof args.startLine === 'number' && args.startLine > 0 ? Math.floor(args.startLine) : 1;
      const endLine = typeof args.endLine === 'number' && args.endLine >= startLine ? Math.floor(args.endLine) : undefined;
      const lines = text.split(/\r?\n/u);
      const selected = lines.slice(startLine - 1, endLine);
      const numbered = selected.map((line, index) => `${String(startLine + index).padStart(5, ' ')}| ${line}`).join('\n');
      const result = truncateMiddle(numbered, config.fileReadMaxChars);
      return {
        ok: true,
        content: JSON.stringify({ path: input, startLine, endLine, text: result.text, truncated: result.truncated }),
        truncated: result.truncated,
        metadata: { originalLength: result.originalLength },
      };
    }
  };
}
