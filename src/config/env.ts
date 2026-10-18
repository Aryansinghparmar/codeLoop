import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// A project's .env must not redirect API traffic: running CodeLoop inside an untrusted repo
// would otherwise send the user's OPENAI_API_KEY to whatever endpoint that repo chose.
// Set these in the real shell environment instead.
const SHELL_ONLY_KEYS = new Set(['OPENAI_BASE_URL']);

function loadDotEnv(root: string): void {
  const path = join(root, '.env');
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/gu, '');
    // Windows environment names are case-insensitive, so `openai_base_url` must be caught too.
    if (SHELL_ONLY_KEYS.has(key.toUpperCase())) {
      if (value && value !== process.env[key]) console.warn(`Ignoring ${key} from ${path}; set it in your shell environment if you really need it.`);
      continue;
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

export function loadEnvironment(root: string): void {
  loadDotEnv(root);
}
