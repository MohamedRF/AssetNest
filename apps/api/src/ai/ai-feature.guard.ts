import { HttpStatus, Inject, Injectable, type CanActivate } from '@nestjs/common';
import type { AppConfig } from '@assetnest/config';
import { httpCode } from '../common/problem.js';
import { APP_CONFIG } from '../common/tokens.js';

@Injectable()
export class AiFeatureGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(): boolean {
    if (!this.config.AI_ENABLED) {
      throw httpCode(HttpStatus.NOT_FOUND, 'AI is disabled on this deployment', 'AI_DISABLED');
    }
    return true;
  }
}
