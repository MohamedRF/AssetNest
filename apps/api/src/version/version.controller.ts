import { Controller, Get, HttpCode } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { openApiSchema } from '../common/openapi.js';
import { Public } from '../common/public.decorator.js';

@Public()
@ApiTags('System')
@Controller('version')
export class VersionController {
  @Get()
  @ApiOperation({ operationId: 'getVersion' })
  @ApiOkResponse({
    schema: openApiSchema(z.object({ name: z.string(), version: z.string(), node: z.string() })),
  })
  @HttpCode(200)
  version(): { name: string; version: string; node: string } {
    return {
      name: 'assetnest-api',
      version: '0.1.0',
      node: process.version,
    };
  }
}
