import { Controller, Get, HttpCode } from '@nestjs/common';

@Controller('version')
export class VersionController {
  @Get()
  @HttpCode(200)
  version(): { name: string; version: string; node: string } {
    return {
      name: 'assetnest-api',
      version: '0.1.0',
      node: process.version,
    };
  }
}
