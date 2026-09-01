import { CodeLoopError } from '../shared/errors';
import { truncateMiddle } from '../shared/text';
import { stringArg, type Tool } from '../tools/tool';

export const webSearchTool: Tool = {
  definition: { name: 'web_search', description: 'Search the web through the configured Serper endpoint.', parameters: { type: 'object', properties: { query: { type: 'string' }, count: { type: 'number' } }, required: ['query'] } },
  async execute(args, context) {
    const approved = await context.approve?.({ action: 'shell', target: 'web search', detail: 'Web search sends the query to an external service.' });
    if (!approved) return { ok: false, content: 'Web search rejected by the user.' };
    const key = process.env.SERPER_API_KEY;
    if (!key) throw new CodeLoopError('CONFIG_ERROR', 'SERPER_API_KEY is not set.');
    const response = await fetch('https://google.serper.dev/search', { method: 'POST', headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ q: stringArg(args, 'query'), num: typeof args.count === 'number' ? args.count : 5 }) });
    if (!response.ok) throw new CodeLoopError('TOOL_ERROR', `Web search failed with HTTP ${response.status}.`);
    const result = truncateMiddle(JSON.stringify(await response.json()), 16_000);
    return { ok: true, content: result.text, truncated: result.truncated };
  },
};
