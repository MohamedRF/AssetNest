import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep, dirname } from 'node:path';
import { Injectable } from '@nestjs/common';

/**
 * Local filesystem private storage (STORAGE_DRIVER=local).
 * Object keys are opaque and UUID-based — user-controlled filenames never
 * reach the filesystem. All paths are verified to stay inside the root.
 * S3-compatible storage is intentionally not implemented yet (Phase 6) —
 * the factory fails loudly instead of silently falling back.
 */

const EXTENSION_BY_MIME: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'text/plain': '.txt',
};

export function extensionForMime(mime: string): string | undefined {
  return EXTENSION_BY_MIME[mime];
}

export function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

@Injectable()
export class LocalStorage {
  private readonly root: string;

  constructor(root: string) {
    if (!isAbsolute(root)) {
      this.root = resolve(process.cwd(), root);
    } else {
      this.root = resolve(root);
    }
  }

  /** Object key: <workspaceId>/<assetId>/<uuid><ext> — opaque and traversal-proof. */
  buildObjectKey(workspaceId: string, assetId: string, mime: string): string {
    const ext = extensionForMime(mime) ?? '.bin';
    return `${workspaceId}/${assetId}/${randomUUID()}${ext}`;
  }

  private resolveInsideRoot(objectKey: string): string {
    const target = resolve(join(this.root, objectKey));
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new Error('storage containment violation');
    }
    return target;
  }

  async put(objectKey: string, buffer: Buffer): Promise<void> {
    const target = this.resolveInsideRoot(objectKey);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, buffer);
  }

  async stat(objectKey: string): Promise<{ size: number } | null> {
    try {
      const target = this.resolveInsideRoot(objectKey);
      const info = await stat(target);
      return { size: info.size };
    } catch {
      return null;
    }
  }

  stream(objectKey: string) {
    return createReadStream(this.resolveInsideRoot(objectKey));
  }

  async remove(objectKey: string): Promise<void> {
    try {
      await unlink(this.resolveInsideRoot(objectKey));
    } catch {
      // Already gone — deletion is idempotent.
    }
  }

  exists(objectKey: string): boolean {
    return existsSync(this.resolveInsideRoot(objectKey));
  }
}
