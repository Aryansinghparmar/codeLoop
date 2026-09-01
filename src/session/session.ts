import { newId } from '../shared/ids';

export interface SessionEvent {
  id: string;
  sessionId: string;
  timestamp: string;
  type: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'permission' | 'error' | 'reduction';
  data: Record<string, unknown>;
}

export interface Session {
  id: string;
  projectRoot: string;
  createdAt: string;
}

export function newSession(projectRoot: string): Session {
  return { id: newId('session'), projectRoot, createdAt: new Date().toISOString() };
}

export function event(sessionId: string, type: SessionEvent['type'], data: Record<string, unknown>): SessionEvent {
  return { id: newId('event'), sessionId, timestamp: new Date().toISOString(), type, data };
}
