import { describe, expect, test } from 'bun:test';
import { PathGuard } from '../../src/permissions/path-guard';
import type { PermissionDecision, PermissionRequest } from '../../src/permissions/permission-policy';
import { authorize, type ToolExecutionContext } from '../../src/tools/tool';
import { temporaryRoot, removeRoot } from '../helpers';

function fakePolicy(decision: PermissionDecision): ToolExecutionContext['permissionPolicy'] {
  return { evaluate: () => ({ decision, reason: `policy said ${decision}` }) };
}

const request: PermissionRequest = { action: 'write', target: 'notes.txt' };

describe('authorize', () => {
  test('continues when the policy allows', async () => {
    const root = await temporaryRoot();
    try {
      const context = { projectRoot: root, pathGuard: new PathGuard(root), permissionPolicy: fakePolicy('allow') };
      expect(await authorize(context, request)).toBeUndefined();
    } finally { await removeRoot(root); }
  });

  test('stops with the reason when the policy denies', async () => {
    const root = await temporaryRoot();
    try {
      const context = { projectRoot: root, pathGuard: new PathGuard(root), permissionPolicy: fakePolicy('deny'), approve: async () => true };
      const result = await authorize(context, request);
      expect(result?.ok).toBe(false);
      expect(result?.content).toBe('Write denied: policy said deny');
    } finally { await removeRoot(root); }
  });

  test('rejects a confirm decision when no approver exists (fail-closed)', async () => {
    const root = await temporaryRoot();
    try {
      const context = { projectRoot: root, pathGuard: new PathGuard(root), permissionPolicy: fakePolicy('confirm') };
      const result = await authorize(context, request);
      expect(result?.ok).toBe(false);
      expect(result?.content).toContain('no approver is available');
    } finally { await removeRoot(root); }
  });

  test('rejects a confirm decision when the approver says no', async () => {
    const root = await temporaryRoot();
    try {
      const context = { projectRoot: root, pathGuard: new PathGuard(root), permissionPolicy: fakePolicy('confirm'), approve: async () => false };
      const result = await authorize(context, request);
      expect(result?.content).toBe('Write rejected: policy said confirm It needs approval, which was not given.');
    } finally { await removeRoot(root); }
  });

  test('continues when the approver resolves true, and passes the policy reason', async () => {
    const root = await temporaryRoot();
    try {
      const seen: PermissionRequest[] = [];
      const approve = async (asked: PermissionRequest): Promise<boolean> => { seen.push(asked); return true; };
      const context = { projectRoot: root, pathGuard: new PathGuard(root), permissionPolicy: fakePolicy('confirm'), approve };
      expect(await authorize(context, request)).toBeUndefined();
      expect(seen).toEqual([{ action: 'write', target: 'notes.txt', detail: 'policy said confirm' }]);
    } finally { await removeRoot(root); }
  });
});
