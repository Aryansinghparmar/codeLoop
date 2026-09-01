import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionEvent } from './session';

export class JsonlSessionStore {
  public constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true });
  }

  public pathFor(sessionId: string): string {
    return join(this.root, `${sessionId}.jsonl`);
  }

  public append(record: SessionEvent): void {
    appendFileSync(this.pathFor(record.sessionId), `${JSON.stringify(record)}\n`, 'utf8');
  }

  public read(sessionId: string): SessionEvent[] {
    const path = this.pathFor(sessionId);
    if (!existsSync(path)) return [];
    const events: SessionEvent[] = [];
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/u)) {
      if (!line.trim()) continue;
      try {
        const value: unknown = JSON.parse(line);
        if (isSessionEvent(value)) events.push(value);
      } catch {
        // Ignore an incomplete final record after a process crash.
      }
    }
    return events;
  }
}

function isSessionEvent(value: unknown): value is SessionEvent {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SessionEvent>;
  return typeof candidate.id === 'string' && typeof candidate.sessionId === 'string' && typeof candidate.timestamp === 'string' && typeof candidate.type === 'string' && !!candidate.data;
}
