import { describe, expect, test } from 'bun:test';
import { PermissionPolicy } from '../../src/permissions/permission-policy';
import { PathGuard } from '../../src/permissions/path-guard';
import { ToolRegistry } from '../../src/tools/registry';
import type { Tool } from '../../src/tools/tool';
import { temporaryRoot, removeRoot } from '../helpers';

function fakeTool(name: string, run: () => Promise<string>): Tool {
  return {
    definition: { name, description: 'test tool', parameters: { type: 'object', properties: {} } },
    async execute() { return { ok: true, content: await run() }; },
  };
}

describe('tool registry', () => {
  test('rejects duplicate tool names', () => {
    const registry = new ToolRegistry();
    registry.register(fakeTool('echo', async () => 'hi'));
    expect(() => registry.register(fakeTool('echo', async () => 'hi'))).toThrow("Tool 'echo' is already registered.");
  });

  test('turns thrown errors into failed results and redacts all output', async () => {
    const root = await temporaryRoot();
    try {
      const guard = new PathGuard(root);
      const context = { projectRoot: root, pathGuard: guard, permissionPolicy: new PermissionPolicy(guard) };
      const registry = new ToolRegistry();
      registry.register(fakeTool('leak', async () => 'OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwx'));
      registry.register(fakeTool('crash', async () => { throw new Error('boom with Bearer abcdefghijklmnopqrstuvwxyz'); }));

      expect(await registry.execute('leak', {}, context)).toEqual({ ok: true, content: 'OPENAI_API_KEY=[REDACTED]' });
      expect(await registry.execute('crash', {}, context)).toEqual({ ok: false, content: 'boom with Bearer [REDACTED]' });
      expect((await registry.execute('missing', {}, context)).ok).toBe(false);
    } finally { await removeRoot(root); }
  });
});
