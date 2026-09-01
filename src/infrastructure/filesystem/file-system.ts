export interface FileSystem {
  exists(path: string): boolean;
  read(path: string): string;
  write(path: string, content: string): void;
  mkdir(path: string): void;
  list(path: string): string[];
}
