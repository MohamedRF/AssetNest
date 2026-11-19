import { Injectable, Inject } from '@nestjs/common';
import { Tool, type McpContext } from '@nestjs/mcp';
import { z } from 'zod';
import { DATABASE } from '../../common/tokens.js';
import type { Database } from '@assetnest/db';
import { OrgService } from '../../org/org.service.js';
import {
  createCategorySchema,
  createLocationSchema,
  createVendorSchema,
  updateCategorySchema,
  updateLocationSchema,
  updateVendorSchema,
} from '../../org/dto.js';
import { McpRateLimiter } from '../rate-limiter.service.js';
import { automationIdentity, auditMcpInvocation, invoke } from '../tool-support.js';

@Injectable()
export class OrgMcpTools {
  constructor(
    private readonly org: OrgService,
    @Inject(DATABASE) private readonly db: Database,
    private readonly rateLimiter: McpRateLimiter,
  ) {}

  // ─── categories ───────────────────────────────────────────────────────

  @Tool({
    name: 'categories_list',
    description: 'List the workspace’s asset categories.',
    inputSchema: z.object({}),
    scopes: ['assets:read'],
    annotations: { readOnlyHint: true },
  })
  async categoriesList(_input: Record<string, never>, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, false);
    return invoke(() => this.org.listCategories(id.wsCtx));
  }

  @Tool({
    name: 'categories_create',
    description: 'Create an asset category.',
    inputSchema: createCategorySchema,
    scopes: ['assets:write'],
    annotations: { readOnlyHint: false },
  })
  async categoriesCreate(input: z.infer<typeof createCategorySchema>, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, true);
    const result = await invoke(() => this.org.createCategory(id.wsCtx, id.actorId ?? '', input));
    if (!('isError' in (result as object))) {
      await auditMcpInvocation(this.db, ctx, id, 'categories_create');
    }
    return result;
  }

  @Tool({
    name: 'categories_update',
    description: 'Update a category (at least one of name/description).',
    inputSchema: updateCategorySchema.extend({ categoryId: z.uuid() }),
    scopes: ['assets:write'],
    annotations: { readOnlyHint: false },
  })
  async categoriesUpdate(
    input: z.infer<typeof updateCategorySchema> & { categoryId: string },
    ctx: McpContext,
  ) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, true);
    const { categoryId, ...patch } = input;
    const result = await invoke(() => this.org.updateCategory(id.wsCtx, id.actorId ?? '', categoryId, patch));
    if (!('isError' in (result as object))) {
      await auditMcpInvocation(this.db, ctx, id, 'categories_update');
    }
    return result;
  }

  // ─── locations ────────────────────────────────────────────────────────

  @Tool({
    name: 'locations_list',
    description:
      'List locations (buildings/floors/rooms/shelves). Hierarchy is implied by parentId; paths are materialized.',
    inputSchema: z.object({}),
    scopes: ['assets:read'],
    annotations: { readOnlyHint: true },
  })
  async locationsList(_input: Record<string, never>, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, false);
    return invoke(() => this.org.listLocations(id.wsCtx));
  }

  @Tool({
    name: 'locations_create',
    description:
      'Create a location. type ∈ building|floor|room|shelf|area|other; parentId re-parents it in the hierarchy (no cycles allowed).',
    inputSchema: createLocationSchema,
    scopes: ['assets:write'],
    annotations: { readOnlyHint: false },
  })
  async locationsCreate(input: z.infer<typeof createLocationSchema>, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, true);
    const result = await invoke(() => this.org.createLocation(id.wsCtx, id.actorId ?? '', input));
    if (!('isError' in (result as object))) {
      await auditMcpInvocation(this.db, ctx, id, 'locations_create');
    }
    return result;
  }

  @Tool({
    name: 'locations_update',
    description:
      'Update a location’s name, type or parent (re-parenting rewrites materialized paths; cycles are refused).',
    inputSchema: updateLocationSchema.extend({ locationId: z.uuid() }),
    scopes: ['assets:write'],
    annotations: { readOnlyHint: false },
  })
  async locationsUpdate(
    input: z.infer<typeof updateLocationSchema> & { locationId: string },
    ctx: McpContext,
  ) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, true);
    const { locationId, ...patch } = input;
    const result = await invoke(() => this.org.updateLocation(id.wsCtx, id.actorId ?? '', locationId, patch));
    if (!('isError' in (result as object))) {
      await auditMcpInvocation(this.db, ctx, id, 'locations_update');
    }
    return result;
  }

  // ─── vendors ──────────────────────────────────────────────────────────

  @Tool({
    name: 'vendors_list',
    description: 'List workspace vendors.',
    inputSchema: z.object({}),
    scopes: ['assets:read'],
    annotations: { readOnlyHint: true },
  })
  async vendorsList(_input: Record<string, never>, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, false);
    return invoke(() => this.org.listVendors(id.wsCtx));
  }

  @Tool({
    name: 'vendors_create',
    description: 'Create a vendor. contact is optional { phone, email, url }.',
    inputSchema: createVendorSchema,
    scopes: ['assets:write'],
    annotations: { readOnlyHint: false },
  })
  async vendorsCreate(input: z.infer<typeof createVendorSchema>, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, true);
    const result = await invoke(() => this.org.createVendor(id.wsCtx, id.actorId ?? '', input));
    if (!('isError' in (result as object))) {
      await auditMcpInvocation(this.db, ctx, id, 'vendors_create');
    }
    return result;
  }

  @Tool({
    name: 'vendors_update',
    description: 'Update a vendor (at least one of name/contact/notes).',
    inputSchema: updateVendorSchema.extend({ vendorId: z.uuid() }),
    scopes: ['assets:write'],
    annotations: { readOnlyHint: false },
  })
  async vendorsUpdate(input: z.infer<typeof updateVendorSchema> & { vendorId: string }, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, true);
    const { vendorId, ...patch } = input;
    const result = await invoke(() => this.org.updateVendor(id.wsCtx, id.actorId ?? '', vendorId, patch));
    if (!('isError' in (result as object))) {
      await auditMcpInvocation(this.db, ctx, id, 'vendors_update');
    }
    return result;
  }
}
