import { Module } from '@nestjs/common';
import { PoliciesModule } from '../policies/policies.module.js';
import { ExportsController } from './exports.controller.js';
import { ExportsService } from './exports.service.js';

@Module({
  imports: [PoliciesModule],
  controllers: [ExportsController],
  providers: [ExportsService],
  exports: [ExportsService],
})
export class ExportsModule {}
