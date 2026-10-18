import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PathGuard } from '../../src/permissions/path-guard';
import { temporaryRoot, removeRoot } from '../helpers';

const isWindows = process.platform === 'win32';

// Junctions need no admin rights on Windows; on POSIX a plain directory symlink does the same job.
function linkDirectory(target: string, link: string): void {
  symlinkSync(target, link, isWindows ? 'junction' : 'dir');
}

describe('path guard', () => {
  let base: string;
  let root: string;
  let outside: string;
  let guard: PathGuard;

  beforeEach(async () => {
    base = realpathSync.native(await temporaryRoot());
    root = join(base, 'root');
    outside = join(base, 'root2');
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, '.git'), { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(root, '.git', 'config'), '[core]\n');
    writeFileSync(join(root, '.env'), 'SECRET=1\n');
    writeFileSync(join(root, '.env.example'), 'OPENAI_API_KEY=\n');
    writeFileSync(join(outside, 'secret.txt'), 'outside\n');
    guard = new PathGuard(root);
  });

  afterEach(async () => { await removeRoot(base); });

  test('allows project files and the example environment file', () => {
    expect(guard.resolveInside('src/index.ts')).toBe(join(root, 'src', 'index.ts'));
    expect(guard.resolveInside('src/new/deep/file.ts')).toBe(join(root, 'src', 'new', 'deep', 'file.ts'));
    expect(guard.resolveInside('.env.example')).toBe(join(root, '.env.example'));
    expect(guard.isHardDenied(join(root, '.env.example'))).toBe(false);
  });

  test.each([
    ['.env'],
    ['.env.local'],
    ['.git/config'],
    ['..'],
    ['src/../.ssh/config'],
    ['../root2/secret.txt'],
    ['id_rsa'],
    ['server.pem'],
  ])('denies %p', (input) => {
    expect(() => guard.resolveInside(input)).toThrow();
  });

  test('denies a sibling directory that shares the root prefix (/root vs /root2)', () => {
    expect(() => guard.resolveInside(join(outside, 'secret.txt'))).toThrow('outside the project root');
  });

  test('denies a link inside the root that points at .git', () => {
    linkDirectory(join(root, '.git'), join(root, 'g'));
    expect(() => guard.resolveInside('g/config')).toThrow('protected');
    expect(() => guard.resolveInside('g/hooks/pre-commit')).toThrow('protected');
  });

  test('denies a link inside the root that points outside, for existing and new files', () => {
    linkDirectory(outside, join(root, 'escape'));
    expect(() => guard.resolveInside('escape/secret.txt')).toThrow('outside the project root');
    expect(() => guard.resolveInside('escape/new-file.txt')).toThrow('outside the project root');
    expect(() => guard.resolveInside('escape/new-dir/new-file.txt')).toThrow('outside the project root');
  });

  test('returns the canonical path when a link stays inside the root', () => {
    linkDirectory(join(root, 'src'), join(root, 'source-link'));
    expect(guard.resolveInside('source-link/a.ts')).toBe(join(root, 'src', 'a.ts'));
  });

  test.skipIf(!isWindows)('denies NTFS alternate data streams', () => {
    expect(() => guard.resolveInside('.env::$DATA')).toThrow('alternate data streams');
    expect(() => guard.resolveInside('src/a.ts:hidden')).toThrow('alternate data streams');
    expect(guard.resolveInside(`${root}\\src\\a.ts`)).toBe(join(root, 'src', 'a.ts'));
  });

  test.skipIf(isWindows || process.platform === 'darwin')('compares case-sensitively on Linux', () => {
    const sibling = join(base, 'ROOT');
    mkdirSync(sibling);
    expect(() => guard.resolveInside(join(sibling, 'a.txt'))).toThrow('outside the project root');
  });
});
