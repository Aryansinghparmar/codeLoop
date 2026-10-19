import { existsSync, readFileSync, statSync } from 'node:fs';
import { relative } from 'node:path';
import { BINARY_SNIFF_BYTES, MAX_READ_BYTES } from './read';
import { authorize, stringArg, type Tool, type ToolExecutionContext, type ToolResult } from './tool';
import { readDirectory } from './walk';

export const MAX_GREP_RESULTS = 100;
export const MAX_GREP_FILES = 1000;
const DEFAULT_GREP_RESULTS = 50;
const MAX_LINE_CHARS = 200;

interface Candidate {
  relativePath: string;
  path: string;
}

function failure(message: string): ToolResult {
  return { ok: false, content: `Grep failed: ${message}` };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * The single gate in front of every readFileSync below: PathGuard must accept the path
 * (inside the root, not .env/.git/keys, no link to them) and the policy must allow reading it.
 */
function openable(context: ToolExecutionContext, path: string): string | undefined {
  try {
    const safe = context.pathGuard.resolveInside(path);
    return context.permissionPolicy.evaluate({ action: 'read', target: safe }).decision === 'allow' ? safe : undefined;
  } catch {
    return undefined;
  }
}

/** Files under `directory`, breadth-first, without entering protected, skipped or linked entries. Stops past `max`. */
function collectFiles(context: ToolExecutionContext, directory: string, max: number): Candidate[] {
  const files: Candidate[] = [];
  const queue = [directory];
  for (let index = 0; index < queue.length && files.length <= max; index += 1) {
    for (const entry of readDirectory(context.pathGuard, queue[index] ?? directory)) {
      if (entry.kind === 'directory' && entry.path) queue.push(entry.path);
      if (entry.kind === 'file' && entry.path) files.push({ relativePath: entry.relativePath, path: entry.path });
    }
  }
  return files;
}

export const grepTool: Tool = {
  definition: {
    name: 'grep',
    description: 'Search file contents in the project for a regular expression (JavaScript syntax; set literal for plain text). Returns path:line: text for each matching line. path may be a directory (default: the project root) or one file.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        path: { type: 'string' },
        ignoreCase: { type: 'boolean' },
        literal: { type: 'boolean' },
        maxResults: { type: 'number' },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
  },
  async execute(args, context) {
    const pattern = stringArg(args, 'pattern');
    const input = typeof args.path === 'string' && args.path.length > 0 ? args.path : '.';
    const limit = typeof args.maxResults === 'number' && args.maxResults >= 1 ? Math.min(Math.floor(args.maxResults), MAX_GREP_RESULTS) : DEFAULT_GREP_RESULTS;
    let regex: RegExp;
    try {
      // No `g` flag: a global RegExp keeps lastIndex between test() calls and would skip matches.
      regex = new RegExp(args.literal === true ? escapeRegExp(pattern) : pattern, args.ignoreCase === true ? 'i' : '');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return failure(`the pattern is not a valid regular expression (${message}). Fix it, or set literal: true to search for the exact text.`);
    }

    const start = context.pathGuard.resolveInside(input);
    const blocked = await authorize(context, { action: 'read', target: start });
    if (blocked) return blocked;
    if (!existsSync(start)) return failure(`${input} does not exist.`);
    const files = statSync(start).isDirectory()
      ? collectFiles(context, start, MAX_GREP_FILES)
      : [{ relativePath: relative(context.pathGuard.projectRoot, start).replaceAll('\\', '/'), path: start }];

    const matches: string[] = [];
    let filesScanned = 0;
    let filesSkipped = 0;
    // Collect one match past the limit, so `truncated` is only true when more matches really exist.
    for (const file of files.slice(0, MAX_GREP_FILES)) {
      if (matches.length > limit) break;
      const path = openable(context, file.path);
      const stat = path ? statSync(path) : undefined;
      if (!path || !stat?.isFile() || stat.size > MAX_READ_BYTES) {
        filesSkipped += 1;
        continue;
      }
      const bytes = readFileSync(path);
      if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
        filesSkipped += 1;
        continue;
      }
      filesScanned += 1;
      const lines = bytes.toString('utf8').split(/\r?\n/u);
      for (let index = 0; index < lines.length && matches.length <= limit; index += 1) {
        const line = lines[index] ?? '';
        if (!regex.test(line)) continue;
        const text = line.trim();
        matches.push(`${file.relativePath}:${index + 1}: ${text.length > MAX_LINE_CHARS ? `${text.slice(0, MAX_LINE_CHARS)}...` : text}`);
      }
    }

    const hitMatchCap = matches.length > limit;
    if (hitMatchCap) matches.pop();
    const hitFileCap = files.length > MAX_GREP_FILES;
    const truncated = hitMatchCap || hitFileCap;
    const payload: Record<string, unknown> = { pattern, path: input, matches, filesScanned, filesSkipped, truncated };
    if (hitMatchCap) payload.note = `Stopped at ${limit} matches. Use a more specific pattern or a narrower path to see the rest.`;
    else if (hitFileCap) payload.note = `Searched only the first ${MAX_GREP_FILES} files. Use a narrower path.`;
    else if (matches.length === 0) payload.note = 'No matches.';
    return { ok: true, content: JSON.stringify(payload), truncated };
  },
};
