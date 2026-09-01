import { describe, expect, test } from 'bun:test';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createConfig } from '../../src/config/config';
import { AgentLoop } from '../../src/agent/agent-loop';
import { MockProvider, textResponse } from '../../src/llm/mock-provider';
import { createBuiltinRegistry } from '../../src/tools/builtins';
import { temporaryRoot, removeRoot } from '../helpers';

describe('agent loop', () => {
  test('executes a mock tool call and stops on final text', async () => {
    const root = await temporaryRoot();
    try {
      await mkdir(join(root, 'src'), { recursive: true });
      const provider = new MockProvider((_request, index) => index === 0
        ? Promise.resolve({ text: '', toolCalls: [{ id: 'call-1', name: 'write', arguments: { path: 'src/answer.ts', content: 'export const answer = 42;\n' } }], usage: {}, provider: 'mock', model: 'mock' })
        : Promise.resolve(textResponse('Done.')));
      const config = createConfig(root);
      const builtins = createBuiltinRegistry(config);
      const loop = new AgentLoop(config, provider, builtins.registry, builtins.pathGuard, builtins.permissionPolicy);
      const result = await loop.run('Create the answer file.');
      expect(result.text).toBe('Done.');
      expect(result.toolCalls).toBe(1);
      expect(await readFile(join(root, 'src', 'answer.ts'), 'utf8')).toContain('42');
    } finally { await removeRoot(root); }
  });
});
