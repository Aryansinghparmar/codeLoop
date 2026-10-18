// Redacts secrets from text before it reaches the model, the console or session logs.
// Each rule is a regex plus a plain replacement string. Rules that keep a label
// (for example `OPENAI_API_KEY=`) capture it in a group named `keep`, and the
// replacement `$<keep>[REDACTED]` puts that label back in front of the marker.

const REDACTED = '[REDACTED]';

// Upper-case env-style names such as OPENAI_API_KEY, GITHUB_TOKEN, AZURE_CLIENT_SECRET, DB_PASSWORD.
const SECRET_NAME = String.raw`\b(?:[A-Z0-9]+_)*(?:API_KEY|ACCESS_KEY|SECRET_KEY|TOKEN|SECRET|PASSWORD)\b`;

interface RedactionRule {
  name: string;
  pattern: RegExp;
  replacement: string;
}

const RULES: RedactionRule[] = [
  {
    // OPENAI_API_KEY=value, "SERPER_API_KEY": "value", DB_PASSWORD: value
    name: 'secret-assignment',
    pattern: new RegExp(String.raw`(?<keep>${SECRET_NAME}["']?\s*[=:]\s*["']?)[^\s"'\x60,;}]+`, 'gu'),
    replacement: `$<keep>${REDACTED}`,
  },
  {
    // Table output such as `Get-ChildItem env:` -> "SERPER_API_KEY   3f9a...". Only long, token-like
    // values are redacted so prose like "set OPENAI_API_KEY first" is left alone.
    name: 'secret-table-row',
    pattern: new RegExp(String.raw`(?<keep>${SECRET_NAME}[ \t]+)[A-Za-z0-9_\-./+=]{16,}`, 'gu'),
    replacement: `$<keep>${REDACTED}`,
  },
  { name: 'openai-key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}/gu, replacement: REDACTED },
  { name: 'nvidia-key', pattern: /\bnvapi-[A-Za-z0-9_-]{16,}/gu, replacement: REDACTED },
  { name: 'github-token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/gu, replacement: REDACTED },
  { name: 'bearer-token', pattern: /(?<keep>\bBearer\s+)[A-Za-z0-9._~+/=-]{16,}/giu, replacement: `$<keep>${REDACTED}` },
];

export function redactSecrets(value: string): string {
  let result = value;
  for (const rule of RULES) result = result.replace(rule.pattern, rule.replacement);
  return result;
}
