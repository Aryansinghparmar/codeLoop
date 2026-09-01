import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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
    if (!process.env[key]) process.env[key] = value;
  }
}

export function loadEnvironment(root: string): void {
  loadDotEnv(root);
}
