import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CurrentWorkspace } from '../auth/current-workspace.decorator.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';
import type { PublicUser } from '../auth/auth.service.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import { ApiProblemResponse, openApiSchema } from '../common/openapi.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { ApiTokensService } from './api-tokens.service.js';
import { createTokenSchema, type CreateTokenInput } from './dto.js';
import { issuedTokenResponse, listTokensResponse, revokeTokenResponse } from './openapi.js';

@ApiTags('API tokens')
@ApiSecurity('bearer')
@ApiSecurity('cookieAuth')
@ApiProblemResponse()
@Controller({ path: 'workspaces/:workspaceId/api-tokens', version: '1' })
@RequirePermissions('integrations:manage')
export class ApiTokensController {
  constructor(private readonly apiTokensService: ApiTokensService) {}

  @Post()
  @ApiOperation({ operationId: 'createApiToken', description: 'Requires integrations:manage.' })
  @ApiBody({ schema: openApiSchema(createTokenSchema, 'input') })
  @ApiCreatedResponse({ schema: issuedTokenResponse })
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(createTokenSchema)) body: CreateTokenInput,
  ) {
    return this.apiTokensService.create(ctx, user.id, body);
  }

  @Get()
  @ApiOperation({ operationId: 'listApiTokens', description: 'Requires integrations:manage.' })
  @ApiOkResponse({ schema: listTokensResponse })
  async list(@CurrentWorkspace() ctx: WorkspaceContext) {
    return { tokens: await this.apiTokensService.list(ctx) };
  }

  @Delete(':tokenId')
  @ApiOperation({ operationId: 'revokeApiToken', description: 'Requires integrations:manage.' })
  @ApiOkResponse({ schema: revokeTokenResponse })
  @HttpCode(HttpStatus.OK)
  async revoke(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Param('tokenId') tokenId: string,
  ) {
    return this.apiTokensService.revoke(ctx, user.id, tokenId);
  }

  @Post(':tokenId/rotate')
  @ApiOperation({ operationId: 'rotateApiToken', description: 'Requires integrations:manage.' })
  @ApiOkResponse({ schema: issuedTokenResponse })
  @HttpCode(HttpStatus.OK)
  async rotate(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentUser() user: PublicUser,
    @Param('tokenId') tokenId: string,
  ) {
    return this.apiTokensService.rotate(ctx, user.id, tokenId);
  }
}
