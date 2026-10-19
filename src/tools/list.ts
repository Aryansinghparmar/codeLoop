import { existsSync, statSync } from 'node:fs';
import { authorize, type Tool, type ToolResult } from './tool';
import { readDirectory, type EntryKind } from './walk';

export const MAX_LIST_ENTRIES = 500;
const DEFAULT_LIST_ENTRIES = 200;

// What the model sees after each entry's path. Protected entries are named (a name holds no secret value)
// so the model knows `.env` exists, but list never descends into them and read/grep refuse them.
const SUFFIX: Record<EntryKind, string> = {
  file: '',
  directory: '/',
  skipped: '/ (skipped)',
  protected: ' (protected)',
  link: ' (link, not followed)',
  other: ' (special file)',
};

function failure(message: string): ToolResult {
  return { ok: false, content: `List failed: ${message}` };
}

export const listTool: Tool = {
  definition: {
    name: 'list',
    description: 'List a project directory (default: the project root). Directories end with /. Set recursive to include subdirectories. Paths are relative to the project root, ready to pass to read.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, recursive: { type: 'boolean' }, maxEntries: { type: 'number' } },
      additionalProperties: false,
    },
  },
  async execute(args, context) {
    const input = typeof args.path === 'string' && args.path.length > 0 ? args.path : '.';
    const recursive = args.recursive === true;
    const limit = typeof args.maxEntries === 'number' && args.maxEntries >= 1 ? Math.min(Math.floor(args.maxEntries), MAX_LIST_ENTRIES) : DEFAULT_LIST_ENTRIES;
    const start = context.pathGuard.resolveInside(input);
    const blocked = await authorize(context, { action: 'read', target: start });
    if (blocked) return blocked;
    if (!existsSync(start)) return failure(`${input} does not exist.`);
    if (!statSync(start).isDirectory()) return failure(`${input} is a file, not a directory; use read to open it.`);

    // Breadth-first (the queue grows while we walk it), so a capped listing still shows the top level.
    const entries: string[] = [];
    const queue = [start];
    let truncated = false;
    for (let index = 0; index < queue.length && !truncated; index += 1) {
      for (const entry of readDirectory(context.pathGuard, queue[index] ?? start)) {
        if (entries.length >= limit) {
          truncated = true;
          break;
        }
        entries.push(entry.relativePath + SUFFIX[entry.kind]);
        if (recursive && entry.kind === 'directory' && entry.path) queue.push(entry.path);
      }
    }

    const payload: Record<string, unknown> = { path: input, recursive, entries, truncated };
    if (truncated) payload.note = `Stopped after ${limit} entries. List a subdirectory to see the rest.`;
    else if (entries.length === 0) payload.note = 'The directory is empty.';
    return { ok: true, content: JSON.stringify(payload), truncated };
  },
};
