import { Controller, Get, HttpCode, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { Database } from '@assetnest/db';
import { DATABASE } from '../common/tokens.js';

const DB_CHECK_TIMEOUT_MS = 2000;

export interface ReadyBody {
  status: 'ready' | 'unavailable';
  checks: { database: 'up' | 'down' };
}

@Controller('health')
export class HealthController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Liveness: process is up. Must NOT touch the database or any dependency. */
  @Get('live')
  @HttpCode(200)
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /**
   * Readiness: dependencies reachable. On failure returns 503 with a generic
   * body — never leaks connection strings, hosts or driver error text.
   */
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response): Promise<ReadyBody> {
    const up = await this.checkDatabase();
    if (up) {
      res.status(200);
      return { status: 'ready', checks: { database: 'up' } };
    }
    res.status(503);
    return { status: 'unavailable', checks: { database: 'down' } };
  }

  private async checkDatabase(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('database readiness check timed out')), DB_CHECK_TIMEOUT_MS);
    });
    try {
      await Promise.race([this.db.$client.query('SELECT 1'), timeout]);
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
