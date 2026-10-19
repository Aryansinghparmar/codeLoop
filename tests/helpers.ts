import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function temporaryRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'codeloop-test-'));
}

export async function removeRoot(root: string): Promise<void> {
  // Retries cover EBUSY on Windows, where a virus scanner or indexer can briefly hold a just-written file.
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
