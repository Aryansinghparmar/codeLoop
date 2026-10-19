import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { authorize, stringArg, textArg, type Tool } from './tool';

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
    const blocked = await authorize(context, { action: 'write', target: path, detail: `write ${content.length} characters` });
    if (blocked) return blocked;

    const previous = existsSync(path) ? statSync(path) : undefined;
    if (previous && !previous.isFile()) return { ok: false, content: `Write failed: ${input} exists and is not a regular file.` };
    // A hard link shares its content with another name (possibly `.env`), so overwriting it would change that file.
    if (previous && previous.nlink > 1) return { ok: false, content: `Write failed: ${input} has ${previous.nlink} hard links, so it may be a protected file under another name.` };

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
    const summary = {
      path: input,
      bytes: Buffer.byteLength(content, 'utf8'),
      created: previous === undefined,
      overwritten: previous !== undefined,
      previousBytes: previous?.size ?? 0,
    };
    return { ok: true, content: JSON.stringify(summary) };
  },
};
