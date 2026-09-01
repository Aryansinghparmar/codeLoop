const SECRET_PATTERNS = [
  /\b(?:sk|nvapi)-[A-Za-z0-9_-]{12,}\b/gu,
  /((?:OPENAI|NVIDIA|AWS|AZURE)[A-Z0-9_]*\s*[=:]\s*)([^\s,}]+)/giu,
];

export function redactSecrets(value: string): string {
  return SECRET_PATTERNS.reduce((current, pattern) => current.replace(pattern, (_match, prefix?: string) => prefix ? `${prefix}[REDACTED]` : '[REDACTED]'), value);
}
