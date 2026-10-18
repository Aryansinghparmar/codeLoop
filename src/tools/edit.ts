import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { authorize, stringArg, textArg, type Tool, type ToolResult } from './tool';

const MAX_HINT_LINES = 3;

function failure(message: string): ToolResult {
  return { ok: false, content: `Edit failed: ${message}` };
}

function toCrlf(text: string): string {
  return text.replace(/\r?\n/gu, '\r\n');
}

/** Line numbers (1-based) of up to three lines that contain the first non-empty line of oldText. */
function findHintLines(current: string, oldText: string): number[] {
  const firstLine = oldText.split(/\r?\n/u).map((line) => line.trim()).find((line) => line.length > 0);
  if (!firstLine) return [];
  const hits: number[] = [];
  const lines = current.split(/\r?\n/u);
  for (let index = 0; index < lines.length && hits.length < MAX_HINT_LINES; index += 1) {
    if (lines[index]?.includes(firstLine)) hits.push(index + 1);
  }
  return hits;
}

export const editTool: Tool = {
  definition: {
    name: 'edit',
    description: 'Replace one exact text block in an existing project file. The old text must match exactly once.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } },
      required: ['path', 'oldText', 'newText'],
      additionalProperties: false,
    },
  },
  async execute(args, context) {
    const input = stringArg(args, 'path');
    let oldText = stringArg(args, 'oldText');
    let newText = textArg(args, 'newText');
    if (oldText === newText) return failure('oldText and newText are identical, so there is no change to make.');

    const path = context.pathGuard.resolveInside(input);
    const blocked = await authorize(context, { action: 'edit', target: path, detail: `edit ${oldText.length} characters` });
    if (blocked) return blocked;

    // Report the path the model gave us, never the absolute local path.
    if (!existsSync(path)) return failure(`${input} does not exist; use write to create it.`);
    if (!statSync(path).isFile()) return failure(`${input} is not a regular file.`);
    const current = readFileSync(path, 'utf8');

    // The read tool hides '\r', so the model sends LF text. Match the file's CRLF line endings instead.
    if (current.includes('\r\n')) {
      if (!oldText.includes('\r')) oldText = toCrlf(oldText);
      if (!newText.includes('\r')) newText = toCrlf(newText);
    }

    const occurrences = current.split(oldText).length - 1;
    if (occurrences === 0) {
      const hints = findHintLines(current, oldText);
      const hintText = hints.length > 0 ? ` The first line of oldText appears on line ${hints.join(', ')}.` : '';
      return failure(`oldText was not found in ${input}. Re-read the file and copy the text exactly, including whitespace.${hintText}`);
    }
    if (occurrences > 1) {
      return failure(`oldText occurs ${occurrences} times in ${input}, but it must occur exactly once. Include more surrounding lines to make it unique.`);
    }

    // Index slicing, not String.replace: replace() would expand $&, $', $` and $$ in newText.
    const start = current.indexOf(oldText);
    const updated = current.slice(0, start) + newText + current.slice(start + oldText.length);
    writeFileSync(path, updated, 'utf8');
    return { ok: true, content: JSON.stringify({ path: input, changed: true, diff: { removed: oldText, added: newText } }) };
  },
};
