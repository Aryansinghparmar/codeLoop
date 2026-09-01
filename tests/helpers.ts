import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function temporaryRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'codeloop-test-'));
}

export async function removeRoot(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}
