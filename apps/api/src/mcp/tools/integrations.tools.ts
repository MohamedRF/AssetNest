import { Injectable } from '@nestjs/common';
import { Tool, type McpContext } from '@nestjs/mcp';
import { z } from 'zod';
import { WebhooksService } from '../../webhooks/webhooks.service.js';
import { ApiTokensService } from '../../api-tokens/api-tokens.service.js';
import { McpRateLimiter } from '../rate-limiter.service.js';
import { automationIdentity, invoke } from '../tool-support.js';

/**
 * Read-only view of workspace integration configuration. Mutating
 * integrations (creating webhooks or API tokens) is deliberately NOT
 * exposed over MCP: those operations mint credentials/destinations and
 * require interactive, human-in-the-loop consent.
 */
@Injectable()
export class IntegrationsMcpTools {
  constructor(
    private readonly webhooks: WebhooksService,
    private readonly apiTokens: ApiTokensService,
    private readonly rateLimiter: McpRateLimiter,
  ) {}

  @Tool({
    name: 'webhooks_list',
    description:
      'List outbound webhook subscriptions (id, url, description, event types, active, createdAt). Signing secrets are never returned.',
    inputSchema: z.object({}),
    scopes: ['integrations:manage'],
    annotations: { readOnlyHint: true },
  })
  async webhooksList(_input: Record<string, never>, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, false);
    return invoke(() => this.webhooks.list(id.wsCtx));
  }

  @Tool({
    name: 'webhooks_deliveries_list',
    description:
      'List recent deliveries for one webhook subscription (status, HTTP code, attempt, error). Used for dead-letter triage.',
    inputSchema: z.object({
      webhookId: z.uuid(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    scopes: ['integrations:manage'],
    annotations: { readOnlyHint: true },
  })
  async webhooksDeliveriesList(input: { webhookId: string; limit?: number }, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, false);
    return invoke(() => this.webhooks.deliveries(id.wsCtx, input.webhookId, input.limit));
  }

  @Tool({
    name: 'api_tokens_list',
    description:
      'List API tokens (id, name, prefix, scopes, expiry, lastUsedAt, revokedAt). Token secrets are stored hashed and never returned.',
    inputSchema: z.object({}),
    scopes: ['integrations:manage'],
    annotations: { readOnlyHint: true },
  })
  async apiTokensList(_input: Record<string, never>, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, false);
    return invoke(() => this.apiTokens.list(id.wsCtx));
  }
}
