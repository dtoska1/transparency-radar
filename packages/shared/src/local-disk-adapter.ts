import { existsSync } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { IStorageAdapter } from './adapters.js';

export class LocalDiskAdapter implements IStorageAdapter {
  constructor(private readonly basePath: string) {}

  async upload(key: string, data: Buffer, _contentType: string): Promise<string> {
    const fullPath = join(this.basePath, key);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, data);
    return fullPath;
  }

  async download(key: string): Promise<Buffer> {
    return readFile(join(this.basePath, key));
  }

  async delete(key: string): Promise<void> {
    await unlink(join(this.basePath, key));
  }

  async exists(key: string): Promise<boolean> {
    return existsSync(join(this.basePath, key));
  }
}
