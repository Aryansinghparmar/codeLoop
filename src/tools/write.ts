import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { stringArg, textArg, type Tool } from './tool';

export const writeTool: Tool = {
  definition: {
    name: 'write',
    description: 'Create or replace a text file inside the project. Prefer edit for an existing file.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  async execute(args, context) {
    const input = stringArg(args, 'path');
    const content = textArg(args, 'content');
    const path = context.pathGuard.resolveInside(input);
    const permission = context.permissionPolicy.evaluate({ action: 'write', target: path, detail: `write ${content.length} characters` });
    if (permission.decision === 'deny') return { ok: false, content: `Write denied: ${permission.reason}` };
    if (permission.decision === 'confirm' && !(await context.approve?.({ action: 'write', target: path, detail: permission.reason }))) {
      return { ok: false, content: 'Write rejected by the user.' };
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
    return { ok: true, content: JSON.stringify({ path: input, bytes: Buffer.byteLength(content, 'utf8'), created: true }) };
  },
};
