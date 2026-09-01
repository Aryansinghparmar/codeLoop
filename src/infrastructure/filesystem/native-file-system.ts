import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import type { FileSystem } from './file-system';

export class NativeFileSystem implements FileSystem {
  public exists(path: string): boolean {
    return existsSync(path);
  }

  public read(path: string): string {
    return readFileSync(path, 'utf8');
  }

  public write(path: string, content: string): void {
    writeFileSync(path, content, 'utf8');
  }

  public mkdir(path: string): void {
    mkdirSync(path, { recursive: true });
  }

  public list(path: string): string[] {
    return readdirSync(path);
  }
}
