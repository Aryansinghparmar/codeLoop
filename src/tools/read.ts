import { existsSync, readFileSync, statSync } from 'node:fs';
import type { CodeLoopConfig } from '../config/config';
import { truncateMiddle } from '../shared/text';
import { authorize, stringArg, type Tool, type ToolResult } from './tool';

export const MAX_READ_BYTES = 2 * 1024 * 1024;
const BINARY_SNIFF_BYTES = 8 * 1024;

function failure(message: string): ToolResult {
  return { ok: false, content: `Read failed: ${message}` };
}

/** Split into lines without counting the empty string after a final newline as a line. */
function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/u);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

export function createReadTool(config: CodeLoopConfig): Tool {
  return {
    definition: {
      name: 'read',
      description: 'Read a UTF-8 text file inside the project. Returns numbered lines and totalLines. Use line ranges when possible.',
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
      const blocked = await authorize(context, { action: 'read', target: path });
      if (blocked) return blocked;

      // Check the file before loading it, and never put the absolute local path in a message.
      if (!existsSync(path)) return failure(`${input} does not exist.`);
      const stat = statSync(path);
      if (!stat.isFile()) return failure(`${input} is not a regular file.`);
      if (stat.size > MAX_READ_BYTES) {
        return failure(`${input} is ${stat.size} bytes, over the ${MAX_READ_BYTES}-byte read limit. Use the shell tool to inspect part of it.`);
      }
      if (stat.size === 0) return { ok: true, content: JSON.stringify({ path: input, totalLines: 0, text: 'File is empty.' }) };

      const bytes = readFileSync(path);
      if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return failure(`${input} looks like a binary file (it contains NUL bytes).`);

      const lines = splitLines(bytes.toString('utf8'));
      const totalLines = lines.length;
      const startLine = typeof args.startLine === 'number' && args.startLine > 0 ? Math.floor(args.startLine) : 1;
      if (startLine > totalLines) return failure(`startLine ${startLine} is past the end of ${input} (${totalLines} lines).`);
      const requestedEnd = typeof args.endLine === 'number' && args.endLine >= startLine ? Math.floor(args.endLine) : totalLines;
      const endLine = Math.min(requestedEnd, totalLines);

      const selected = lines.slice(startLine - 1, endLine);
      const numbered = selected.map((line, index) => `${String(startLine + index).padStart(5, ' ')}| ${line}`).join('\n');
      const result = truncateMiddle(numbered, config.fileReadMaxChars);
      return {
        ok: true,
        content: JSON.stringify({ path: input, startLine, endLine, totalLines, text: result.text, truncated: result.truncated }),
        truncated: result.truncated,
        metadata: { originalLength: result.originalLength },
      };
    },
  };
}
