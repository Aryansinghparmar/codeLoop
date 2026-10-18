import { readFileSync, writeFileSync } from 'node:fs';
import { authorize, stringArg, textArg, type Tool } from './tool';

export const editTool: Tool = {
  definition: {
    name: 'edit',
    description: 'Replace one exact text block in an existing project file. The old text must match exactly.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } },
      required: ['path', 'oldText', 'newText'],
      additionalProperties: false,
    },
  },
  async execute(args, context) {
    const input = stringArg(args, 'path');
    const oldText = stringArg(args, 'oldText');
    const newText = textArg(args, 'newText');
    const path = context.pathGuard.resolveInside(input);
    const blocked = await authorize(context, { action: 'edit', target: path, detail: `edit ${oldText.length} characters` });
    if (blocked) return blocked;
    const current = readFileSync(path, 'utf8');
    const occurrences = current.split(oldText).length - 1;
    if (occurrences !== 1) {
      return { ok: false, content: occurrences === 0 ? 'Edit failed: expected text was not found.' : 'Edit failed: expected text occurs more than once.' };
    }
    const updated = current.replace(oldText, newText);
    writeFileSync(path, updated, 'utf8');
    return { ok: true, content: JSON.stringify({ path: input, changed: true, diff: { removed: oldText, added: newText } }) };
  },
};
