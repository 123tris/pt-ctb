// The data a page reads, by name, at the address with its hash (packs/core.<hash>.ptcb, players/1.<hash>.json), which
// never changes content and so stays in the browser's cache. Two manifests name the hashes: packs.json for the
// engine's binary packs, meta.json for the JSON files the old pages read and the new ones read until they have packs.
// A page the edge sent carries the slice of both it needs (edge/inline.ts), so its first data starts without waiting
// for either manifest. A few files are kept in memory, the most recently used.

import { hashedName } from '../../../assets/js/core/data-name.js';

export interface Manifest {
  generatedAt: number;
  files: Record<string, string>;
}

/** A manifest's part a page came with: a file's hash, or null for a file the data doesn't have. */
export interface PartManifest {
  generatedAt: number;
  files: Record<string, string | null>;
}

/** The part of both manifests a page came with. */
export interface Slice {
  packs?: PartManifest;
  meta?: PartManifest;
}

export type ManifestName = 'packs.json' | 'meta.json';

/** The data has no such pack: packs.json doesn't name it, or there's no packs.json yet. */
export class PacksMissing extends Error {
  constructor(name: string) {
    super(`No pack ${name} in this data`);
    this.name = 'PacksMissing';
  }
}

export interface StoreOptions {
  /** The error for a JSON file the data doesn't have (the old app shows "not found" for its own NotFound). */
  notFound?: (name: string) => Error;
  /** How many files to keep in memory. */
  keep?: number;
}

export class Store {
  private readonly base: string;
  private readonly slice: Slice;
  private readonly fetchManifest: (name: ManifestName) => Promise<Manifest>;
  private readonly notFound: (name: string) => Error;
  private readonly keep: number;
  private readonly manifests = new Map<ManifestName, Promise<Manifest>>();
  private readonly cache = new Map<string, Promise<unknown>>();

  /** `fetchManifest` gets packs.json or meta.json; for packs.json, a 404 should give an empty manifest (no packs). */
  constructor(base: string, slice: Slice | null, fetchManifest: (name: ManifestName) => Promise<Manifest>, options: StoreOptions = {}) {
    this.base = base;
    this.slice = slice ?? {};
    this.fetchManifest = fetchManifest;
    this.notFound = options.notFound ?? (name => new Error(`${name} isn't in this data`));
    this.keep = options.keep ?? 8;
  }

  /** A manifest, fetched once (again after a failure). */
  manifest(name: ManifestName): Promise<Manifest> {
    let m = this.manifests.get(name);
    if (!m) {
      m = this.fetchManifest(name);
      m.catch(() => this.manifests.delete(name));
      this.manifests.set(name, m);
    }
    return m;
  }

  /** When the data was exported, unix seconds. */
  async generatedAt(): Promise<number> {
    return this.slice.packs?.generatedAt ?? this.slice.meta?.generatedAt ?? (await this.manifest('meta.json')).generatedAt;
  }

  private async hash(kind: ManifestName, name: string): Promise<string | undefined> {
    // The page's slice answers for every file it lists, there or not; anything else needs the whole manifest.
    const own = (kind === 'packs.json' ? this.slice.packs : this.slice.meta)?.files;
    if (own && name in own) return own[name] ?? undefined;
    return (await this.manifest(kind)).files[name];
  }

  /** A pack's address. */
  async packUrl(name: string): Promise<string> {
    const hash = await this.hash('packs.json', name);
    if (!hash) throw new PacksMissing(name);
    return `${this.base}${hashedName(name, hash)}`;
  }

  /** Whether meta.json lists a JSON file (some exist only once a feature is on: hill.json, admin.json). */
  async hasJson(name: string): Promise<boolean> {
    return Boolean(await this.hash('meta.json', name));
  }

  /** The pack `name`, read with `read` (a generated reader, gen/packs.ts). */
  pack<T>(name: string, read: (buffer: ArrayBuffer) => T): Promise<T> {
    return this.remember(`pack:${name}`, async () => {
      const url = await this.packUrl(name);
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${name} answered HTTP ${r.status}`);
      return read(await r.arrayBuffer());
    });
  }

  /**
   * A JSON file of the export. One meta.json doesn't list is asked for under its plain name, as the old app does, and
   * a 404 is the `notFound` error.
   */
  json<T>(name: string): Promise<T> {
    return this.remember(`json:${name}`, async () => {
      const hash = await this.hash('meta.json', name);
      const url = hash ? `${this.base}${hashedName(name, hash)}` : `${this.base}${name}?v=${await this.generatedAt()}`;
      const r = await fetch(url);
      if (r.status === 404) throw this.notFound(name);
      if (!r.ok) throw new Error(`${name} answered HTTP ${r.status}`);
      return r.json() as Promise<T>;
    });
  }

  private remember<T>(key: string, load: () => Promise<T>): Promise<T> {
    let value = this.cache.get(key) as Promise<T> | undefined;
    if (value) {
      this.cache.delete(key);
    } else {
      value = load();
      value.catch(() => this.cache.delete(key));
    }
    this.cache.set(key, value);
    if (this.cache.size > this.keep) this.cache.delete(this.cache.keys().next().value!);
    return value;
  }
}
