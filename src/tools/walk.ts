import { readdirSync, type Dirent } from 'node:fs';
import { join, relative } from 'node:path';
import type { PathGuard } from '../permissions/path-guard';

/** Directories that are large, generated or protected, so list and grep never descend into them. */
export const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist']);

// `prod.env`-style files often hold real secrets, so a sweep never opens them. They are not hard-denied,
// because projects also ship sample files such as `tests/fixtures/sample.env` that are meant to be read.
const SENSITIVE_FILE = /^.+\.env$/iu;

/**
 * - `file` / `directory`: PathGuard accepted it; `path` is the canonical path to open.
 * - `skipped`: a directory in SKIPPED_DIRECTORIES.
 * - `protected`: PathGuard refused it (a secret, `.git`, or a link that leaves the project).
 * - `link`: a symlink or junction. Never followed, so a walk cannot loop or leave the root.
 * - `sensitive`: a `<name>.env` file. Listed, but grep never opens it; read can, by name.
 * - `other`: a socket, FIFO or device. Never opened.
 */
export type EntryKind = 'file' | 'directory' | 'skipped' | 'protected' | 'link' | 'sensitive' | 'other';

export interface WalkEntry {
  /** Path relative to the project root, with `/` separators, as the model should pass it back. */
  relativePath: string;
  kind: EntryKind;
  /** Only set for `file` and `directory`: the path PathGuard returned. Callers open this and nothing else. */
  path?: string;
}

/** Reads one directory and classifies every entry through PathGuard. Directories come first, then by name. */
export function readDirectory(guard: PathGuard, directory: string): WalkEntry[] {
  let dirents: Dirent[];
  try {
    dirents = readdirSync(directory, { withFileTypes: true });
  } catch {
    return []; // Deleted or unreadable mid-walk. The fs error would hold the absolute local path.
  }
  const entries = dirents.map((dirent) => classify(guard, directory, dirent));
  return entries.sort((a, b) => rank(a) - rank(b) || (a.relativePath < b.relativePath ? -1 : 1));
}

function classify(guard: PathGuard, directory: string, dirent: Dirent): WalkEntry {
  const full = join(directory, dirent.name);
  const relativePath = relative(guard.projectRoot, full).replaceAll('\\', '/');
  let safe: string;
  try {
    safe = guard.resolveInside(full);
  } catch {
    return { relativePath, kind: 'protected' };
  }
  // If the canonical path differs from the one we built, something in it is a link: do not follow it.
  if (dirent.isSymbolicLink() || safe !== full) return { relativePath, kind: 'link' };
  if (dirent.isDirectory()) return SKIPPED_DIRECTORIES.has(dirent.name) ? { relativePath, kind: 'skipped' } : { relativePath, kind: 'directory', path: safe };
  if (dirent.isFile()) return SENSITIVE_FILE.test(dirent.name) ? { relativePath, kind: 'sensitive' } : { relativePath, kind: 'file', path: safe };
  return { relativePath, kind: 'other' };
}

function rank(entry: WalkEntry): number {
  return entry.kind === 'directory' || entry.kind === 'skipped' ? 0 : 1;
}
