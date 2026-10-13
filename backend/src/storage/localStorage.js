import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SEGMENT = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9]{1,8})?$/;

/**
 * Local filesystem storage adapter (outside any web-served directory).
 * Callers only ever hold opaque *keys* ("<id>.pdf" or "<jobId>/p000_original.png"); keys are validated and the
 * resolved path must stay inside the root, so keys can never address arbitrary files. Replace this class with an
 * S3/GCS adapter exposing the same methods to change storage backends.
 */
export class LocalStorage {
  constructor(root) { this.root = path.resolve(root); }

  async init() { await fs.mkdir(this.root, { recursive: true, mode: 0o700 }); }

  newKey(ext = 'pdf') { return `${crypto.randomUUID()}.${ext}`; }

  resolve(key) {
    if (typeof key !== 'string') throw new Error('Invalid storage key');
    const segs = key.split('/');
    if (segs.length > 2 || !segs.every((s) => SEGMENT.test(s))) throw new Error('Invalid storage key');
    const full = path.resolve(this.root, ...segs);
    if (!full.startsWith(this.root + path.sep)) throw new Error('Invalid storage key');
    return full;
  }

  /** Writes exclusively (never overwrites) and marks the file read-only. */
  async put(key, data) {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
    await fs.writeFile(full, data, { flag: 'wx', mode: 0o440 });
    return key;
  }

  async putFromFile(key, srcPath) { return this.put(key, await fs.readFile(srcPath)); }
  async exists(key) { try { await fs.access(this.resolve(key)); return true; } catch { return false; } }
  async stat(key) { return fs.stat(this.resolve(key)); }
  stream(key) { return createReadStream(this.resolve(key)); }
  async delete(key) { await fs.rm(this.resolve(key), { force: true }); }
  async deletePrefix(dirKey) { await fs.rm(this.resolve(dirKey), { recursive: true, force: true }); }
}
