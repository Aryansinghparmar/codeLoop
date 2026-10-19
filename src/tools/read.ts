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
      if (stat.isDirectory()) return failure(`${input} is a directory. Use the list tool to see what it contains.`);
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

      // Return whole lines from startLine until the size cap, and say exactly where the file continues.
      // (Cutting the middle out would hide lines while still reporting endLine = the last line.)
      const shown: string[] = [];
      let size = 0;
      let lastShown = startLine - 1;
      for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
        const numberedLine = `${String(lineNumber).padStart(5, ' ')}| ${lines[lineNumber - 1] ?? ''}`;
        if (shown.length > 0 && size + numberedLine.length + 1 > config.fileReadMaxChars) break;
        shown.push(numberedLine);
        size += numberedLine.length + 1;
        lastShown = lineNumber;
      }
      // A single line longer than the cap is still shown, but cut (keeping its start and end).
      const text = truncateMiddle(shown.join('\n'), config.fileReadMaxChars);
      const truncated = lastShown < endLine || text.truncated;
      const payload: Record<string, unknown> = { path: input, startLine, endLine: lastShown, totalLines, text: text.text, truncated };
      if (lastShown < endLine) {
        payload.nextStartLine = lastShown + 1;
        payload.note = `Showing lines ${startLine}-${lastShown} of ${totalLines}. Call read again with startLine ${lastShown + 1} to continue.`;
      }
      return {
        ok: true,
        content: JSON.stringify(payload),
        truncated,
        metadata: { originalLength: text.originalLength },
      };
    },
  };
}
