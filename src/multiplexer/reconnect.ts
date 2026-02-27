/**
 * Auto-reconnect logic with exponential backoff.
 * Retries upstream server connections after unexpected disconnects.
 */

import type { ServerConfig } from "../config/types";
import { error as logError, log, warn } from "../util/logger";

export interface ReconnectOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

const DEFAULT_OPTIONS: Required<ReconnectOptions> = {
  maxAttempts: 5,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
};

/**
 * Calculate backoff delay for a given attempt number.
 * Uses exponential backoff: delay = initialDelay * 2^attempt, capped at maxDelay.
 */
export function calculateBackoff(
  attempt: number,
  options?: ReconnectOptions,
): number {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const delay = opts.initialDelayMs * Math.pow(2, attempt);
  return Math.min(delay, opts.maxDelayMs);
}

export type ReconnectFn = (
  serverName: string,
  config: ServerConfig,
) => Promise<void>;

export class ReconnectManager {
  private activeRetries = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; attempt: number; }
  >();
  private options: Required<ReconnectOptions>;
  private reconnectFn: ReconnectFn;

  constructor(reconnectFn: ReconnectFn, options?: ReconnectOptions) {
    this.reconnectFn = reconnectFn;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  scheduleReconnect(serverName: string, config: ServerConfig): void {
    const existing = this.activeRetries.get(serverName);
    const attempt = existing ? existing.attempt + 1 : 0;

    if (attempt >= this.options.maxAttempts) {
      logError(`Max reconnect attempts reached for ${serverName}`);
      this.activeRetries.delete(serverName);
      return;
    }

    const delay = calculateBackoff(attempt, this.options);
    warn(
      `Scheduling reconnect for ${serverName} in ${delay}ms (attempt ${
        attempt + 1
      }/${this.options.maxAttempts})`,
    );

    const timer = setTimeout(async () => {
      try {
        await this.reconnectFn(serverName, config);
        log(`Successfully reconnected to ${serverName}`);
        this.activeRetries.delete(serverName);
      } catch (err) {
        warn(
          `Reconnect attempt ${attempt + 1} for ${serverName} failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        this.scheduleReconnect(serverName, config);
      }
    }, delay);

    this.activeRetries.set(serverName, { timer, attempt });
  }

  cancelAll(): void {
    for (const { timer } of this.activeRetries.values()) {
      clearTimeout(timer);
    }
    this.activeRetries.clear();
  }

  get pendingReconnects(): number {
    return this.activeRetries.size;
  }
}
