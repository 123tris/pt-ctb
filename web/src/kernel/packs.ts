// Loads packs by name (packs/core.ptcb), at the address with their hash (packs/core.<hash>.ptcb), which never changes
// content and stays in the browser's cache. The hashes come from packs.json, which the engine writes next to meta.json;
// a page the edge sent carries the slice of it that page needs (edge/inline.ts), so its first pack starts without
// waiting for packs.json. A few packs are kept in memory, the most recently used.

import { hashedName } from '../../../assets/js/core/data-name.js';

export interface Manifest {
  generatedAt: number;
  files: Record<string, string>;
}

/** The data has no such pack: packs.json doesn't name it, or there's no packs.json yet. */
export class PacksMissing extends Error {
  constructor(name: string) {
    super(`No pack ${name} in this data`);
    this.name = 'PacksMissing';
  }
}

export class Packs {
  private readonly base: string;
  private readonly slice: Manifest | null;
  private readonly fetchManifest: () => Promise<Manifest>;
  private readonly keep: number;
  private full: Promise<Manifest> | null = null;
  private readonly cache = new Map<string, Promise<unknown>>();

  /** `slice` is the page's own part of packs.json, if it came with one; `keep` how many packs to hold in memory. */
  constructor(base: string, slice: Manifest | null, fetchManifest: () => Promise<Manifest>, keep = 8) {
    this.base = base;
    this.slice = slice;
    this.fetchManifest = fetchManifest;
    this.keep = keep;
  }

  /** packs.json, fetched once (again after a failure). */
  manifest(): Promise<Manifest> {
    this.full ??= this.fetchManifest().catch(e => {
      this.full = null;
      throw e;
    });
    return this.full;
  }

  /** When the data was exported, unix seconds. */
  async generatedAt(): Promise<number> {
    return this.slice?.generatedAt ?? (await this.manifest()).generatedAt;
  }

  async url(name: string): Promise<string> {
    const hash = this.slice?.files[name] ?? (await this.manifest()).files[name];
    if (!hash) throw new PacksMissing(name);
    return `${this.base}${hashedName(name, hash)}`;
  }

  /** The pack `name`, read with `read` (a generated reader, gen/packs.ts). */
  load<T>(name: string, read: (buffer: ArrayBuffer) => T): Promise<T> {
    let pack = this.cache.get(name) as Promise<T> | undefined;
    if (pack) {
      this.cache.delete(name);
    } else {
      pack = this.url(name)
        .then(url => fetch(url))
        .then(r => {
          if (!r.ok) throw new Error(`${name} answered HTTP ${r.status}`);
          return r.arrayBuffer();
        })
        .then(read);
      pack.catch(() => this.cache.delete(name));
    }
    this.cache.set(name, pack);
    if (this.cache.size > this.keep) this.cache.delete(this.cache.keys().next().value!);
    return pack;
  }
}
