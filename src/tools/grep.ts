import { existsSync, readFileSync, statSync } from 'node:fs';
import { relative } from 'node:path';
import { BINARY_SNIFF_BYTES, MAX_READ_BYTES } from './read';
import { authorize, stringArg, type Tool, type ToolExecutionContext, type ToolResult } from './tool';
import { readDirectory } from './walk';

export const MAX_GREP_RESULTS = 100;
export const MAX_GREP_FILES = 1000;
/** Directory entries the walk may visit, so a huge tree (20k empty folders took 6 s) cannot stall a call. */
export const MAX_GREP_ENTRIES = 20_000;
/** File bytes one call may read (300 non-matching 2 MB files took 6 s). */
export const MAX_GREP_BYTES = 64 * 1024 * 1024;
/**
 * The regex comes from the model and runs on this thread, where nothing can interrupt it:
 * `(\w+\s?)+$` on a v2 fixture ran for over 120 s, and `function.*return.*await` on one 50 KB
 * minified line took 33 s. So only the first MAX_SCAN_CHARS of each line are tested (a match
 * further right is missed), and the scan stops at a deadline checked before every line and file.
 * The bound is soft: the deadline plus one capped line, about 1 s for nested quantifiers.
 */
export const MAX_SCAN_CHARS = 1_000;
export const GREP_TIME_LIMIT_MS = 5_000;
const DEFAULT_GREP_RESULTS = 50;
const MAX_LINE_CHARS = 200;

type StopReason = 'time' | 'files' | 'entries' | 'bytes';

const STOP_NOTES: Record<StopReason, string> = {
  time: `Stopped after ${GREP_TIME_LIMIT_MS / 1000} s. Narrow the path, use a simpler pattern (nested quantifiers and several .* are slow), or set literal: true.`,
  files: `Searched only the first ${MAX_GREP_FILES} files. Use a narrower path.`,
  entries: `Stopped after visiting ${MAX_GREP_ENTRIES} directory entries. Use a narrower path.`,
  bytes: `Stopped after reading ${MAX_GREP_BYTES / 1024 / 1024} MB. Use a narrower path.`,
};

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

/**
 * The file's text, or no text when it is skipped: refused above, not a regular file, over 2 MB,
 * binary, or failing to open (locked, deleted mid-walk). An fs error is never passed on: its
 * message holds the absolute local path. `bytesRead` feeds the MAX_GREP_BYTES budget.
 */
function loadText(context: ToolExecutionContext, candidate: string): { text?: string; bytesRead: number } {
  const path = openable(context, candidate);
  if (!path) return { bytesRead: 0 };
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > MAX_READ_BYTES) return { bytesRead: 0 };
    const bytes = readFileSync(path);
    if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return { bytesRead: bytes.length };
    return { text: bytes.toString('utf8'), bytesRead: bytes.length };
  } catch {
    return { bytesRead: 0 };
  }
}

/** Up to MAX_LINE_CHARS of the line, starting a little before the match so the match is always shown. */
function snippet(line: string, at: number): string {
  const text = line.trim();
  if (text.length <= MAX_LINE_CHARS) return text;
  const start = Math.max(0, Math.min(at - 40, line.length - MAX_LINE_CHARS));
  return `${start > 0 ? '...' : ''}${line.slice(start, start + MAX_LINE_CHARS)}${start + MAX_LINE_CHARS < line.length ? '...' : ''}`;
}

/** Files under `directory`, breadth-first, without entering protected, skipped or linked entries. */
function collectFiles(context: ToolExecutionContext, directory: string, deadline: number): { files: Candidate[]; stop?: StopReason } {
  const files: Candidate[] = [];
  const queue = [directory];
  let visited = 0;
  for (let index = 0; index < queue.length; index += 1) {
    if (performance.now() > deadline) return { files, stop: 'time' };
    for (const entry of readDirectory(context.pathGuard, queue[index] ?? directory)) {
      visited += 1;
      if (visited > MAX_GREP_ENTRIES) return { files, stop: 'entries' };
      if (entry.kind === 'directory' && entry.path) queue.push(entry.path);
      if (entry.kind === 'file' && entry.path) files.push({ relativePath: entry.relativePath, path: entry.path });
      if (files.length > MAX_GREP_FILES) return { files: files.slice(0, MAX_GREP_FILES), stop: 'files' };
    }
  }
  return { files };
}

export const grepTool: Tool = {
  definition: {
    name: 'grep',
    description: 'Search file contents in the project for a regular expression (JavaScript syntax; set literal for plain text). Returns path:line: text for each matching line. path may be a directory (default: the project root) or one file. Only the first 1000 characters of each line are searched.',
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
    const deadline = performance.now() + GREP_TIME_LIMIT_MS;
    const walk = statSync(start).isDirectory()
      ? collectFiles(context, start, deadline)
      : { files: [{ relativePath: relative(context.pathGuard.projectRoot, start).replaceAll('\\', '/'), path: start }] };
    let stop: StopReason | undefined = walk.stop;

    const matches: string[] = [];
    let filesScanned = 0;
    let filesSkipped = 0;
    let bytesRead = 0;
    // Collect one match past the limit, so `truncated` is only true when more matches really exist.
    for (const file of walk.files) {
      if (matches.length > limit || stop === 'time') break;
      if (performance.now() > deadline) stop = 'time';
      else if (bytesRead > MAX_GREP_BYTES) stop = 'bytes';
      if (stop === 'time' || stop === 'bytes') break;
      const loaded = loadText(context, file.path);
      bytesRead += loaded.bytesRead;
      if (loaded.text === undefined) {
        filesSkipped += 1;
        continue;
      }
      filesScanned += 1;
      const lines = loaded.text.split(/\r?\n/u);
      for (let index = 0; index < lines.length && matches.length <= limit; index += 1) {
        if (performance.now() > deadline) {
          stop = 'time';
          break;
        }
        const line = lines[index] ?? '';
        const found = regex.exec(line.slice(0, MAX_SCAN_CHARS));
        if (found) matches.push(`${file.relativePath}:${index + 1}: ${snippet(line, found.index)}`);
      }
    }

    const hitMatchCap = matches.length > limit;
    if (hitMatchCap) matches.pop();
    const truncated = hitMatchCap || stop !== undefined;
    const payload: Record<string, unknown> = { pattern, path: input, matches, filesScanned, filesSkipped, truncated };
    if (stop) payload.note = STOP_NOTES[stop];
    else if (hitMatchCap) payload.note = `Stopped at ${limit} matches. Use a more specific pattern or a narrower path to see the rest.`;
    else if (matches.length === 0 && filesScanned === 0 && filesSkipped > 0) payload.note = 'No file was searched: every file was skipped (binary, over 2 MB, or could not be opened).';
    else if (matches.length === 0) payload.note = 'No matches.';
    return { ok: true, content: JSON.stringify(payload), truncated };
  },
};
