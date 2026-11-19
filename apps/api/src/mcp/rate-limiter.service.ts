import { Injectable } from '@nestjs/common';

/**
 * Fixed-window in-memory rate limiter for MCP tool/resource/prompt calls.
 * Keyed on the API token id. Per-process: deployments with multiple
 * instances should move this to Redis (documented limitation).
 */
@Injectable()
export class McpRateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private readonly limitPerMinute = 300;
  private readonly mutatingLimitPerMinute = 60;

  /** Throws when the caller is over budget for the window. */
  hit(tokenId: string, mutating: boolean): void {
    const key = `${mutating ? 'm' : 'r'}:${tokenId}`;
    const now = Date.now();
    const limit = mutating ? this.mutatingLimitPerMinute : this.limitPerMinute;
    const current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + 60_000 });
      this.sweep(now);
      return;
    }
    current.count += 1;
    if (current.count > limit) {
      const retryAfterSeconds = Math.ceil((current.resetAt - now) / 1000);
      throw new Error(
        `Rate limit exceeded (${limit}/min for ${mutating ? 'mutating' : 'read'} calls). Retry after ${retryAfterSeconds}s.`,
      );
    }
  }

  private sweep(now: number): void {
    if (this.windows.size < 1000) return;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}
