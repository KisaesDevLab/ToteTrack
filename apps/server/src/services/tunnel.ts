import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import type { Db } from '../db/index.js';
import type { Env } from '../env.js';
import { logger } from '../lib/logger.js';
import { effectiveTunnelToken } from './settings.js';

export type TunnelState = 'disabled' | 'unavailable' | 'starting' | 'connected' | 'error';

export interface TunnelStatus {
  /** Whether a token is configured and where it comes from. */
  tokenSource: 'env' | 'settings' | 'none';
  binaryAvailable: boolean;
  state: TunnelState;
  connectedSince: string | null;
  lastError: string | null;
  /** Last few connector log lines (for the Settings page). */
  log: string[];
  restarts: number;
}

const LOG_LINES = 30;
const MAX_BACKOFF_MS = 60_000;

/**
 * Runs the Cloudflare connector (`cloudflared tunnel run --token …`) as a child of the app so the
 * whole thing is configured from Settings: paste a token → the tunnel comes up; remove it → it stops.
 * The binary is bundled into the Docker image; in dev set CLOUDFLARED_BIN to a local install.
 */
export class TunnelManager {
  private child: ChildProcess | undefined;
  private state: TunnelState = 'disabled';
  private lastError: string | null = null;
  private connectedSince: Date | null = null;
  private log: string[] = [];
  private restarts = 0;
  private backoffMs = 2_000;
  private restartTimer: NodeJS.Timeout | undefined;
  private tokenSource: 'env' | 'settings' | 'none' = 'none';
  private stopping = false;
  private currentToken: string | undefined;

  constructor(
    private readonly db: Db,
    private readonly env: Env,
  ) {}

  get binaryAvailable(): boolean {
    try {
      fs.accessSync(this.env.CLOUDFLARED_BIN, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  status(): TunnelStatus {
    return {
      tokenSource: this.tokenSource,
      binaryAvailable: this.binaryAvailable,
      state: this.state,
      connectedSince: this.connectedSince?.toISOString() ?? null,
      lastError: this.lastError,
      log: [...this.log],
      restarts: this.restarts,
    };
  }

  /** (Re)reads the token and starts, restarts or stops the connector to match. */
  async apply(): Promise<TunnelStatus> {
    const { token, source } = await effectiveTunnelToken(this.db, this.env);
    this.tokenSource = source;
    if (!token) {
      await this.stop();
      this.state = 'disabled';
      this.lastError = null;
      return this.status();
    }
    if (!this.binaryAvailable) {
      await this.stop();
      this.state = 'unavailable';
      this.lastError = `cloudflared binary not found at ${this.env.CLOUDFLARED_BIN}`;
      return this.status();
    }
    if (this.child && token === this.currentToken) return this.status();
    await this.stop();
    this.currentToken = token;
    this.restarts = 0;
    this.backoffMs = 2_000;
    this.launch(token);
    return this.status();
  }

  /** Manual restart from the UI. */
  async restart(): Promise<TunnelStatus> {
    await this.stop();
    this.currentToken = undefined;
    return this.apply();
  }

  async stop(): Promise<void> {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
    const child = this.child;
    if (!child) return;
    this.stopping = true;
    this.child = undefined;
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 5_000);
      child.once('exit', () => {
        clearTimeout(t);
        resolve();
      });
      child.kill('SIGTERM');
    });
    this.stopping = false;
    this.connectedSince = null;
  }

  private launch(token: string): void {
    this.state = 'starting';
    this.lastError = null;
    this.connectedSince = null;
    this.push(`starting cloudflared (${this.env.CLOUDFLARED_BIN})`);
    let child: ChildProcess;
    try {
      child = spawn(
        this.env.CLOUDFLARED_BIN,
        ['tunnel', '--no-autoupdate', '--metrics', '127.0.0.1:0', 'run', '--token', token],
        { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TUNNEL_TOKEN: token } },
      );
    } catch (err) {
      this.fail(`failed to start cloudflared: ${(err as Error).message}`);
      return;
    }
    this.child = child;
    const onLine = (line: string) => this.handleLine(line);
    child.stdout?.on('data', (d: Buffer) =>
      d.toString().split(/\r?\n/).filter(Boolean).forEach(onLine),
    );
    child.stderr?.on('data', (d: Buffer) =>
      d.toString().split(/\r?\n/).filter(Boolean).forEach(onLine),
    );
    child.on('error', (err) => this.fail(`cloudflared error: ${err.message}`));
    child.on('exit', (code, signal) => {
      if (this.child === child) this.child = undefined;
      if (this.stopping) return;
      // Prefer a specific message already captured (e.g. "Provided Tunnel token is not valid.").
      const specific =
        this.lastError && !/^cloudflared exited/.test(this.lastError) ? this.lastError : null;
      this.fail(specific ?? `cloudflared exited (${signal ?? `code ${code}`})`);
      this.scheduleRestart(token);
    });
  }

  private handleLine(line: string): void {
    this.push(line);
    const lower = line.toLowerCase();
    if (lower.includes('registered tunnel connection') || lower.includes('connection registered')) {
      if (this.state !== 'connected') {
        this.state = 'connected';
        this.connectedSince = new Date();
        this.lastError = null;
        this.backoffMs = 2_000;
        logger.info('cloudflare tunnel connected');
      }
    } else if (
      (/\b(err|error|fatal)\b/i.test(line) || /not valid|invalid/i.test(line)) &&
      !lower.includes('retrying')
    ) {
      // Keep the most recent error text for the UI without flipping a healthy connection to error.
      const msg = line.replace(/^\S+\s+\S+\s+/, '').slice(0, 300);
      if (this.state !== 'connected') this.lastError = msg;
      if (
        /invalid.*token|token.*(invalid|not valid)|unauthorized|failed to parse|401|403/i.test(line)
      ) {
        this.state = 'error';
        this.lastError = msg;
      }
    }
  }

  private fail(message: string): void {
    this.state = 'error';
    this.lastError = message;
    this.connectedSince = null;
    this.push(message);
    logger.warn({ message }, 'cloudflare tunnel problem');
  }

  private scheduleRestart(token: string): void {
    this.restarts += 1;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(MAX_BACKOFF_MS, this.backoffMs * 2);
    this.push(`restarting in ${Math.round(delay / 1000)}s`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      if (this.currentToken === token && !this.child) this.launch(token);
    }, delay);
    this.restartTimer.unref();
  }

  private push(line: string): void {
    const stamped = `${new Date().toISOString().slice(11, 19)} ${line}`.slice(0, 400);
    this.log.push(stamped);
    if (this.log.length > LOG_LINES) this.log.splice(0, this.log.length - LOG_LINES);
  }
}
