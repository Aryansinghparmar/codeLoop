import { describe, expect, test } from 'bun:test';
import { PermissionPolicy } from '../../src/permissions/permission-policy';
import { PathGuard } from '../../src/permissions/path-guard';
import { temporaryRoot, removeRoot } from '../helpers';

describe('permission policy', () => {
  test('allows safe commands', async () => {
    const root = await temporaryRoot();
    try {
      const policy = new PermissionPolicy(new PathGuard(root));
      expect(policy.evaluate({ action: 'shell', target: 'bun test' }).decision).toBe('allow');
      expect(policy.evaluate({ action: 'shell', target: 'git status' }).decision).toBe('allow');
    } finally { await removeRoot(root); }
  });

  test('denies destructive and secret access commands', async () => {
    const root = await temporaryRoot();
    try {
      const policy = new PermissionPolicy(new PathGuard(root));
      expect(policy.evaluate({ action: 'shell', target: 'Remove-Item src/file.ts' }).decision).toBe('deny');
      expect(policy.evaluate({ action: 'shell', target: 'Write-Output $env:OPENAI_API_KEY' }).decision).toBe('deny');
      expect(policy.evaluate({ action: 'shell', target: 'curl https://example.com' }).decision).toBe('confirm');
    } finally { await removeRoot(root); }
  });
});
