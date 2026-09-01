export interface TruncatedText {
  text: string;
  truncated: boolean;
  originalLength: number;
}

export function truncateMiddle(text: string, limit: number): TruncatedText {
  if (text.length <= limit) return { text, truncated: false, originalLength: text.length };
  const marker = limit >= 40 ? `\n...[truncated ${text.length - limit} characters]...\n` : '...[truncated]...';
  const remaining = Math.max(0, limit - marker.length);
  const head = Math.ceil(remaining * 0.5);
  const tail = remaining - head;
  return {
    text: `${text.slice(0, head)}${marker}${text.slice(-tail)}`,
    truncated: true,
    originalLength: text.length,
  };
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
