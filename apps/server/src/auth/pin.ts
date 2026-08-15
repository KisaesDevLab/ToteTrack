import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import type { Db } from '../db/index.js';
import { getSetting, SETTING_KEYS, setSetting } from '../services/settings.js';

const CACHE_TTL_MS = 30_000;

export class PinStore {
  private cached: { hash: string | null; gen: string | null; at: number } | undefined;

  constructor(private readonly db: Db) {}

  invalidate(): void {
    this.cached = undefined;
  }

  private async load(): Promise<{ hash: string | null; gen: string | null }> {
    const now = Date.now();
    if (this.cached && now - this.cached.at < CACHE_TTL_MS) return this.cached;
    const [hash, gen] = await Promise.all([
      getSetting(this.db, SETTING_KEYS.pinHash),
      getSetting(this.db, SETTING_KEYS.sessionGeneration),
    ]);
    this.cached = { hash, gen, at: now };
    return this.cached;
  }

  async getHash(): Promise<string | null> {
    return (await this.load()).hash;
  }

  async isSetupRequired(): Promise<boolean> {
    return (await this.getHash()) === null;
  }

  /**
   * Session generation: a random value stored alongside the PIN. Every session cookie embeds it;
   * rotating it (`signOutEverywhere`) invalidates all sessions. Changing the PIN does NOT rotate it,
   * so other devices stay logged in.
   */
  async generation(): Promise<string | null> {
    const { hash, gen } = await this.load();
    if (!hash) return null;
    if (gen) return gen;
    return this.rotateGeneration();
  }

  async verify(pin: string): Promise<boolean> {
    const hash = await this.getHash();
    if (!hash) return false;
    try {
      return await argon2.verify(hash, pin);
    } catch {
      return false;
    }
  }

  /** Sets/changes the PIN and returns the (unchanged) session generation. */
  async setPin(pin: string): Promise<string> {
    const hash = await argon2.hash(pin, { type: argon2.argon2id });
    await setSetting(this.db, SETTING_KEYS.pinHash, hash);
    this.invalidate();
    return this.generation() as Promise<string>;
  }

  /** Invalidates every session on every device. */
  async rotateGeneration(): Promise<string> {
    const gen = randomBytes(12).toString('base64url');
    await setSetting(this.db, SETTING_KEYS.sessionGeneration, gen);
    this.invalidate();
    return gen;
  }
}
