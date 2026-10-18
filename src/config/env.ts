import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// A project's .env is untrusted: running CodeLoop inside someone else's repo loads that repo's file.
// It may only set CodeLoop's own options and the OpenAI key/model. Anything that changes where traffic
// goes or how it is verified (OPENAI_BASE_URL, HTTPS_PROXY, NODE_TLS_REJECT_UNAUTHORIZED, NODE_OPTIONS, ...)
// must come from the real shell environment.
const FILE_KEYS = new Set(['OPENAI_API_KEY', 'OPENAI_MODEL']);

function allowedFromFile(key: string): boolean {
  // Windows environment names are case-insensitive, so compare in upper case.
  const upper = key.toUpperCase();
  return upper.startsWith('CODELOOP_') || FILE_KEYS.has(upper);
}

function loadDotEnv(root: string): void {
  const path = join(root, '.env');
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  const ignored: string[] = [];
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/gu, '');
    if (!allowedFromFile(key)) {
      if (value) ignored.push(key);
      continue;
    }
    if (!process.env[key]) process.env[key] = value;
  }
  if (ignored.length) console.warn(`Ignored ${ignored.join(', ')} from ${path}; only CODELOOP_*, OPENAI_API_KEY and OPENAI_MODEL are read from .env. Set others in your shell.`);
}

export function loadEnvironment(root: string): void {
  loadDotEnv(root);
}
