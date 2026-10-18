import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { CodeLoopError } from '../shared/errors';

const SECRET_FILE = /(^|[\\/])\.env(?:\.[^\\/]+)?$/iu;
const PROTECTED_COMPONENT = /(^|[\\/])(?:\.git|\.codeloop|\.ssh|\.aws|\.azure|\.kube)([\\/]|$)/iu;
const SECRET_NAME = /(^|[\\/])(?:credentials|secrets|secret|service-account|token)\.(?:json|ya?ml|toml)$/iu;
const SECRET_EXTENSION = /\.(?:pem|key|pfx|p12)$/iu;
const SECRET_KEY_NAME = /(^|[\\/])(?:id_rsa|id_ed25519|known_hosts)$/iu;
const SYSTEM_PATH = /[\\/]Windows[\\/](?:System32|SysWOW64|WinSxS|Boot|Servicing)(?:[\\/]|$)|[\\/]Program Files(?: \(x86\))?(?:[\\/]|$)|[\\/]ProgramData(?:[\\/]|$)|[\\/]AppData[\\/](?:Local|Roaming)[\\/]Microsoft[\\/](?:Credentials|Vault)(?:[\\/]|$)/iu;
const WINDOWS_DRIVE_PREFIX = /^(?:\\\\[?.]\\)?[a-z]:/iu;

const IS_WINDOWS = process.platform === 'win32';
// NTFS (Windows) and APFS (macOS) are case-insensitive by default; Linux file systems are not.
const CASE_INSENSITIVE = IS_WINDOWS || process.platform === 'darwin';

export class PathGuard {
  public readonly projectRoot: string;

  public constructor(projectRoot: string) {
    this.projectRoot = realpathSync.native(projectRoot);
  }

  /** Returns the canonical (link-free) absolute path, or throws PATH_DENIED. */
  public resolveInside(input: string): string {
    if (!input || input.includes('\0')) throw denied('The path is empty or contains an invalid character.');
    const lexical = resolve(this.projectRoot, input);
    if (IS_WINDOWS && hasAlternateDataStream(lexical)) throw denied('NTFS alternate data streams are not allowed.');
    const canonical = canonicalPath(lexical);
    if (!this.isInside(canonical)) throw denied('The path is outside the project root.');
    // Check both forms: the lexical name catches `.env`, the canonical one catches a link that points at `.git`.
    if (this.isHardDenied(lexical) || this.isHardDenied(canonical)) throw denied('The path is protected.');
    return canonical;
  }

  public isInside(candidate: string): boolean {
    const difference = relative(foldCase(this.projectRoot), foldCase(resolve(candidate)));
    return difference === '' || (difference !== '..' && !difference.startsWith(`..${sep}`) && !isAbsolute(difference));
  }

  public isHardDenied(candidate: string): boolean {
    const normalised = candidate.replaceAll('/', '\\');
    const envExample = normalised.split('\\').at(-1)?.toLowerCase() === '.env.example';
    return (SECRET_FILE.test(normalised) && !envExample)
      || PROTECTED_COMPONENT.test(normalised)
      || SECRET_NAME.test(normalised)
      || SECRET_EXTENSION.test(normalised)
      || SECRET_KEY_NAME.test(normalised)
      || SYSTEM_PATH.test(normalised);
  }
}

function denied(message: string): CodeLoopError {
  return new CodeLoopError('PATH_DENIED', message);
}

function foldCase(path: string): string {
  return CASE_INSENSITIVE ? path.toLowerCase() : path;
}

// `file.txt:stream` and `.env::$DATA` open the same file under another name, dodging name-based rules.
function hasAlternateDataStream(path: string): boolean {
  return path.replace(WINDOWS_DRIVE_PREFIX, '').includes(':');
}

/**
 * Resolves every link in the path. A file that does not exist yet has no realpath,
 * so canonicalise its nearest existing ancestor and append the missing segments.
 */
function canonicalPath(path: string): string {
  const missing: string[] = [];
  let current = path;
  while (!pathEntryExists(current)) {
    const parent = dirname(current);
    if (parent === current) return path;
    missing.unshift(basename(current));
    current = parent;
  }
  try {
    return join(realpathSync.native(current), ...missing);
  } catch {
    // lstat saw an entry but realpath failed: a dangling link that a write would follow.
    throw denied('The path uses a broken link.');
  }
}

// lstat (not exists) so that a dangling symlink still counts as an entry instead of a missing file.
function pathEntryExists(path: string): boolean {
  try {
    return lstatSync(path, { throwIfNoEntry: false }) !== undefined;
  } catch {
    return false;
  }
}
