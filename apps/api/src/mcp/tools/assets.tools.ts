import { Injectable, Inject } from '@nestjs/common';
import { Tool, type McpContext } from '@nestjs/mcp';
import { z } from 'zod';
import { ASSET_STATUSES } from '@assetnest/domain';
import { DATABASE } from '../../common/tokens.js';
import type { Database } from '@assetnest/db';
import { AssetsService } from '../../assets/assets.service.js';
import { CustodyService } from '../../custody/custody.service.js';
import { DocumentsService } from '../../documents/documents.service.js';
import {
  createAssetSchema,
  listAssetsQuerySchema,
  statusTransitionSchema,
  updateAssetSchema,
} from '../../assets/dto.js';
import { assignSchema, returnSchema, transferSchema } from '../../custody/dto.js';
import { McpRateLimiter } from '../rate-limiter.service.js';
import { automationIdentity, auditMcpInvocation, invoke } from '../tool-support.js';

@Injectable()
export class AssetsMcpTools {
  constructor(
    private readonly assets: AssetsService,
    private readonly custody: CustodyService,
    private readonly documents: DocumentsService,
    @Inject(DATABASE) private readonly db: Database,
    private readonly rateLimiter: McpRateLimiter,
  ) {}

  // ─── assets ─────────────────────────────────────────────────────────

  @Tool({
    name: 'assets_list',
    description:
      'List assets in the workspace with pagination, full-text search and filters (status, condition, category, location). Returns { items, total, page, pageSize }.',
    inputSchema: z.object({
      page: z.number().int().min(1).max(10_000).optional(),
      pageSize: z.number().int().min(1).max(100).optional(),
      q: z.string().trim().max(200).optional(),
      status: z.enum(ASSET_STATUSES).optional(),
      categoryId: z.uuid().optional(),
      locationId: z.uuid().optional(),
      condition: z.enum(['new', 'good', 'fair', 'poor', 'damaged', 'unknown']).optional(),
      sort: z.enum(['createdAt', 'displayName', 'assetTag', 'status', 'updatedAt']).optional(),
      order: z.enum(['asc', 'desc']).optional(),
    }),
    scopes: ['assets:read'],
    annotations: { readOnlyHint: true },
  })
  async listAssets(
    input: {
      page?: number;
      pageSize?: number;
      q?: string;
      status?: (typeof ASSET_STATUSES)[number];
      categoryId?: string;
      locationId?: string;
      condition?: 'new' | 'good' | 'fair' | 'poor' | 'damaged' | 'unknown';
      sort?: 'createdAt' | 'displayName' | 'assetTag' | 'status' | 'updatedAt';
      order?: 'asc' | 'desc';
    },
    ctx: McpContext,
  ) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, false);
    return invoke(() => this.assets.list(id.wsCtx, listAssetsQuerySchema.parse(input)));
  }

  @Tool({
    name: 'assets_get',
    description: 'Get one asset by id, including its current custody and warranty summary.',
    inputSchema: z.object({ assetId: z.uuid() }),
    scopes: ['assets:read'],
    annotations: { readOnlyHint: true },
  })
  async getAsset(input: { assetId: string }, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, false);
    return invoke(() => this.assets.get(id.wsCtx, input.assetId));
  }

  @Tool({
    name: 'assets_history',
    description:
      'Immutable lifecycle event history for an asset (creation, assignments, status changes, archived).',
    inputSchema: z.object({ assetId: z.uuid() }),
    scopes: ['assets:read'],
    annotations: { readOnlyHint: true },
  })
  async assetHistory(input: { assetId: string }, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, false);
    return invoke(() => this.assets.history(id.wsCtx, input.assetId));
  }

  @Tool({
    name: 'assets_create',
    description:
      'Create an asset in the workspace. assetTag is uppercase letters/digits/hyphens and unique per workspace. Money amount is a string with at most 2 decimals; currency is ISO 4217.',
    inputSchema: createAssetSchema,
    scopes: ['assets:write'],
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  })
  async createAsset(input: z.infer<typeof createAssetSchema>, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, true);
    const result = await invoke(() => this.assets.create(id.wsCtx, id.actorId ?? '', input));
    if (!('isError' in (result as object))) {
      await auditMcpInvocation(this.db, ctx, id, 'assets_create');
    }
    return result;
  }

  @Tool({
    name: 'assets_update',
    description:
      "Update mutable fields of an asset with optimistic concurrency: expectedVersion is REQUIRED and must match the asset's current version; on mismatch a version-conflict error is returned and you must re-read (assets_get) and retry.",
    inputSchema: updateAssetSchema.extend({ assetId: z.uuid() }),
    scopes: ['assets:write'],
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  })
  async updateAsset(input: z.infer<typeof updateAssetSchema> & { assetId: string }, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, true);
    const { assetId, ...patch } = input;
    const result = await invoke(() => this.assets.update(id.wsCtx, id.actorId ?? '', assetId, patch));
    if (!('isError' in (result as object))) {
      await auditMcpInvocation(this.db, ctx, id, 'assets_update');
    }
    return result;
  }

  @Tool({
    name: 'assets_transition_status',
    description:
      'Transition an asset to a new status (available, assigned, lost, maintenance, retired). expectedVersion is REQUIRED (optimistic concurrency). Invalid transitions are rejected.',
    inputSchema: statusTransitionSchema.extend({ assetId: z.uuid() }),
    scopes: ['assets:write'],
    annotations: { readOnlyHint: false, destructiveHint: false },
  })
  async transitionStatus(
    input: z.infer<typeof statusTransitionSchema> & { assetId: string },
    ctx: McpContext,
  ) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, true);
    const { assetId, ...body } = input;
    const result = await invoke(() =>
      this.assets.transitionStatus(id.wsCtx, id.actorId ?? '', assetId, body),
    );
    if (!('isError' in (result as object))) {
      await auditMcpInvocation(this.db, ctx, id, 'assets_transition_status');
    }
    return result;
  }

  @Tool({
    name: 'assets_archive',
    description: 'Archive an asset (soft-retire). The asset keeps its full history but leaves active views.',
    inputSchema: z.object({ assetId: z.uuid() }),
    scopes: ['assets:write'],
    annotations: { readOnlyHint: false, destructiveHint: true },
  })
  async archiveAsset(input: { assetId: string }, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, true);
    const result = await invoke(() => this.assets.archive(id.wsCtx, id.actorId ?? '', input.assetId));
    if (!('isError' in (result as object))) {
      await auditMcpInvocation(this.db, ctx, id, 'assets_archive');
    }
    return result;
  }

  // ─── custody ────────────────────────────────────────────────────────

  @Tool({
    name: 'custody_list_active',
    description: 'List all active (open) custody assignments in the workspace.',
    inputSchema: z.object({}),
    scopes: ['assets:read'],
    annotations: { readOnlyHint: true },
  })
  async custodyList(_input: Record<string, never>, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, false);
    return invoke(() => this.custody.listActive(id.wsCtx));
  }

  @Tool({
    name: 'custody_assign',
    description:
      'Assign an asset to a team member. memberId is the membership id (see members_list). expectedVersion REQUIRED (optimistic concurrency). The asset moves to status assigned.',
    inputSchema: assignSchema.extend({ assetId: z.uuid() }),
    scopes: ['assets:assign'],
    annotations: { readOnlyHint: false },
  })
  async custodyAssign(input: z.infer<typeof assignSchema> & { assetId: string }, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, true);
    const { assetId, ...body } = input;
    const result = await invoke(() => this.custody.assign(id.wsCtx, id.actorId ?? '', assetId, body));
    if (!('isError' in (result as object))) {
      await auditMcpInvocation(this.db, ctx, id, 'custody_assign');
    }
    return result;
  }

  @Tool({
    name: 'custody_return',
    description: 'Return an assigned asset. expectedVersion REQUIRED. Closes the active custody assignment.',
    inputSchema: returnSchema.extend({ assetId: z.uuid() }),
    scopes: ['assets:assign'],
    annotations: { readOnlyHint: false },
  })
  async custodyReturn(input: z.infer<typeof returnSchema> & { assetId: string }, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, true);
    const { assetId, ...body } = input;
    const result = await invoke(() => this.custody.returnAsset(id.wsCtx, id.actorId ?? '', assetId, body));
    if (!('isError' in (result as object))) {
      await auditMcpInvocation(this.db, ctx, id, 'custody_return');
    }
    return result;
  }

  @Tool({
    name: 'custody_transfer',
    description: 'Move an asset to a different location (not a person). expectedVersion REQUIRED.',
    inputSchema: transferSchema.extend({ assetId: z.uuid() }),
    scopes: ['assets:assign'],
    annotations: { readOnlyHint: false },
  })
  async custodyTransfer(input: z.infer<typeof transferSchema> & { assetId: string }, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, true);
    const { assetId, ...body } = input;
    const result = await invoke(() => this.custody.transfer(id.wsCtx, id.actorId ?? '', assetId, body));
    if (!('isError' in (result as object))) {
      await auditMcpInvocation(this.db, ctx, id, 'custody_transfer');
    }
    return result;
  }

  // ─── documents ───────────────────────────────────────────────────────

  @Tool({
    name: 'documents_list',
    description: 'List private documents (attachments) for an asset.',
    inputSchema: z.object({ assetId: z.uuid() }),
    scopes: ['documents:read'],
    annotations: { readOnlyHint: true },
  })
  async documentsList(input: { assetId: string }, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, false);
    return invoke(() => this.documents.listForAsset(id.wsCtx, input.assetId));
  }

  @Tool({
    name: 'documents_get',
    description:
      'Get document metadata and its authorized download location. Document bytes never transit MCP.',
    inputSchema: z.object({ documentId: z.uuid() }),
    scopes: ['documents:read'],
    annotations: { readOnlyHint: true },
  })
  async documentsGet(input: { documentId: string }, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, false);
    return invoke(() => this.documents.downloadInfo(id.wsCtx, input.documentId));
  }

  @Tool({
    name: 'documents_delete',
    description:
      'Delete a document attachment (soft delete). The file stays in storage until retention purges it.',
    inputSchema: z.object({ documentId: z.uuid() }),
    scopes: ['documents:write'],
    annotations: { readOnlyHint: false, destructiveHint: true },
  })
  async documentsDelete(input: { documentId: string }, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, true);
    const result = await invoke(() => this.documents.remove(id.wsCtx, id.actorId ?? '', input.documentId));
    if (!('isError' in (result as object))) {
      await auditMcpInvocation(this.db, ctx, id, 'documents_delete');
    }
    return result;
  }
}
