import { describe, expect, test } from 'bun:test';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { JsonlSessionStore } from '../../src/session/jsonl-store';
import { event } from '../../src/session/session';
import { temporaryRoot, removeRoot } from '../helpers';

describe('JSONL session store', () => {
  test('keeps valid records and ignores an incomplete final record', async () => {
    const root = await temporaryRoot();
    try {
      await mkdir(join(root, 'sessions'), { recursive: true });
      const store = new JsonlSessionStore(join(root, 'sessions'));
      const record = event('session_test', 'user', { text: 'hello' });
      store.append(record);
      await appendFile(store.pathFor('session_test'), '{"broken":', 'utf8');
      expect(store.read('session_test')).toHaveLength(1);
    } finally { await removeRoot(root); }
  });
});
