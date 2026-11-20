import { Controller, Get, HttpCode, Inject, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Response } from 'express';
import type { Database } from '@assetnest/db';
import { DATABASE } from '../common/tokens.js';
import { Public } from '../common/public.decorator.js';
import { openApiSchema } from '../common/openapi.js';

const DB_CHECK_TIMEOUT_MS = 2000;

export interface ReadyBody {
  status: 'ready' | 'unavailable';
  checks: { database: 'up' | 'down' };
}

@Public()
@ApiTags('System')
@Controller('health')
export class HealthController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Liveness: process is up. Must NOT touch the database or any dependency. */
  @Get('live')
  @ApiOperation({ operationId: 'getLiveness' })
  @ApiOkResponse({ schema: openApiSchema(z.object({ status: z.literal('ok') })) })
  @HttpCode(200)
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /**
   * Readiness: dependencies reachable. On failure returns 503 with a generic
   * body — never leaks connection strings, hosts or driver error text.
   */
  @Get('ready')
  @ApiOperation({ operationId: 'getReadiness' })
  @ApiOkResponse({
    schema: openApiSchema(
      z.object({ status: z.literal('ready'), checks: z.object({ database: z.literal('up') }) }),
    ),
  })
  @ApiServiceUnavailableResponse({
    schema: openApiSchema(
      z.object({ status: z.literal('unavailable'), checks: z.object({ database: z.literal('down') }) }),
    ),
  })
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
