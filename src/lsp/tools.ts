import type { LspClient } from './json-rpc-client';
import { truncateMiddle } from '../shared/text';
import type { Tool } from '../tools/tool';
import { stringArg } from '../tools/tool';

function positionArgs(args: Record<string, unknown>): Record<string, unknown> {
  return {
    textDocument: { uri: stringArg(args, 'uri') },
    position: { line: Number(args.line ?? 0), character: Number(args.character ?? 0) },
  };
}

export function definitionTool(client: LspClient): Tool {
  return {
    definition: { name: 'lsp_definition', description: 'Find the definition at a source position.', parameters: { type: 'object', properties: { uri: { type: 'string' }, line: { type: 'number' }, character: { type: 'number' } }, required: ['uri', 'line', 'character'] } },
    async execute(args) { const result = truncateMiddle(JSON.stringify(await client.definition(positionArgs(args))), 16_000); return { ok: true, content: result.text, truncated: result.truncated }; },
  };
}

export function referencesTool(client: LspClient): Tool {
  return {
    definition: { name: 'lsp_references', description: 'Find references at a source position.', parameters: { type: 'object', properties: { uri: { type: 'string' }, line: { type: 'number' }, character: { type: 'number' } }, required: ['uri', 'line', 'character'] } },
    async execute(args) { const result = truncateMiddle(JSON.stringify(await client.references({ ...positionArgs(args), context: { includeDeclaration: true } })), 16_000); return { ok: true, content: result.text, truncated: result.truncated }; },
  };
}
