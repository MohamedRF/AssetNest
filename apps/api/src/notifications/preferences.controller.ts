import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Put } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { notificationPreferences } from '@assetnest/db';
import type { Database } from '@assetnest/db';
import { DATABASE } from '../common/tokens.js';
import { ApiProblemResponse, openApiSchema } from '../common/openapi.js';
import { CurrentWorkspace } from '../auth/current-workspace.decorator.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { upsertPreferenceSchema, type UpsertPreferenceInput } from './dto.js';

const listPreferencesResponse = openApiSchema(
  z.object({
    preferences: z.array(upsertPreferenceSchema.extend({ channel: z.enum(['log', 'email', 'webhook']) })),
  }),
);

/**
 * Own notification preferences — any active member manages their own,
 * scoped to their membership in :workspaceId. No special permission needed.
 */
@ApiTags('Notifications')
@ApiSecurity('cookieAuth')
@ApiProblemResponse()
@Controller({ path: 'workspaces/:workspaceId/notification-preferences', version: '1' })
export class NotificationPreferencesController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  @ApiOperation({ operationId: 'listNotificationPreferences' })
  @ApiOkResponse({ schema: listPreferencesResponse })
  async list(@CurrentWorkspace() ctx: WorkspaceContext) {
    const rows = await this.db
      .select({
        channel: notificationPreferences.channel,
        event: notificationPreferences.event,
        enabled: notificationPreferences.enabled,
      })
      .from(notificationPreferences)
      .where(eq(notificationPreferences.memberId, ctx.membershipId));
    return { preferences: rows };
  }

  @Put()
  @ApiOperation({ operationId: 'upsertNotificationPreference' })
  @ApiBody({ schema: openApiSchema(upsertPreferenceSchema, 'input') })
  @ApiOkResponse({ schema: openApiSchema(upsertPreferenceSchema) })
  @HttpCode(HttpStatus.OK)
  async upsert(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Body(new ZodValidationPipe(upsertPreferenceSchema)) body: UpsertPreferenceInput,
  ) {
    const [row] = await this.db
      .insert(notificationPreferences)
      .values({
        workspaceId: ctx.workspaceId,
        memberId: ctx.membershipId,
        channel: body.channel,
        event: body.event,
        enabled: body.enabled,
      })
      .onConflictDoUpdate({
        target: [
          notificationPreferences.workspaceId,
          notificationPreferences.memberId,
          notificationPreferences.channel,
          notificationPreferences.event,
        ],
        set: { enabled: body.enabled },
      })
      .returning({
        channel: notificationPreferences.channel,
        event: notificationPreferences.event,
        enabled: notificationPreferences.enabled,
      });
    return row;
  }
}
