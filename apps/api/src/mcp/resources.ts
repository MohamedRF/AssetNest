import { Injectable } from '@nestjs/common';
import { Resource, ResourceTemplate, type McpContext } from '@nestjs/mcp';
import { ResourceNotFoundError } from '@modelcontextprotocol/server';
import { WorkspacesService } from '../workspaces/workspaces.service.js';
import { AssetsService } from '../assets/assets.service.js';
import { WarrantiesService } from '../warranties/warranties.service.js';
import { OrgService } from '../org/org.service.js';
import { automationIdentity } from './tool-support.js';

/**
 * Read-only workspace knowledge for MCP clients. URIs are opaque and
 * workspace-agnostic: every read resolves the workspace from the caller's
 * automation identity, never from the URI.
 */
@Injectable()
export class AssetNestMcpResources {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly assets: AssetsService,
    private readonly warranties: WarrantiesService,
    private readonly org: OrgService,
  ) {}

  @Resource({
    uri: 'assetnest://workspace/current',
    name: 'workspace_current',
    mimeType: 'application/json',
    description: 'The workspace this token is bound to (id, name, mode, member count).',
  })
  current(_input: Record<string, never>, ctx: McpContext) {
    const id = automationIdentity(ctx);
    return this.workspaces.get(id.wsCtx);
  }

  @Resource({
    uri: 'assetnest://assets',
    name: 'assets_recent',
    mimeType: 'application/json',
    description: 'The 10 most recently created assets in the workspace.',
  })
  recentAssets(_input: Record<string, never>, ctx: McpContext) {
    const id = automationIdentity(ctx);
    return this.assets.list(id.wsCtx, { page: 1, pageSize: 10, sort: 'createdAt', order: 'desc' });
  }

  @ResourceTemplate({
    uriTemplate: 'assetnest://assets/{assetId}',
    name: 'asset_by_id',
    mimeType: 'application/json',
    description: 'Full details for one asset.',
  })
  async assetById(variables: { assetId: string }, ctx: McpContext) {
    const id = automationIdentity(ctx);
    try {
      return await this.assets.get(id.wsCtx, variables.assetId);
    } catch (error) {
      // The SDK serializes ProtocolErrors to their spec'd JSON-RPC codes.
      if (error instanceof ResourceNotFoundError) {
        throw error;
      }
      throw new ResourceNotFoundError(ctx.uri ? ctx.uri.href : `assetnest://assets/${variables.assetId}`);
    }
  }

  @Resource({
    uri: 'assetnest://warranties/expiring',
    name: 'warranties_expiring',
    mimeType: 'application/json',
    description: 'Warranties expiring within 30 days or already expired.',
  })
  expiringWarranties(_input: Record<string, never>, ctx: McpContext) {
    const id = automationIdentity(ctx);
    return this.warranties.list(id.wsCtx, { expiringDays: 30 });
  }

  @Resource({
    uri: 'assetnest://categories',
    name: 'catalog_categories',
    mimeType: 'application/json',
    description: 'Category catalog.',
  })
  categories(_input: Record<string, never>, ctx: McpContext) {
    const id = automationIdentity(ctx);
    return this.org.listCategories(id.wsCtx);
  }

  @Resource({
    uri: 'assetnest://locations',
    name: 'catalog_locations',
    mimeType: 'application/json',
    description: 'Location catalog (hierarchy via parentId).',
  })
  locations(_input: Record<string, never>, ctx: McpContext) {
    const id = automationIdentity(ctx);
    return this.org.listLocations(id.wsCtx);
  }

  @Resource({
    uri: 'assetnest://vendors',
    name: 'catalog_vendors',
    mimeType: 'application/json',
    description: 'Vendor catalog.',
  })
  vendors(_input: Record<string, never>, ctx: McpContext) {
    const id = automationIdentity(ctx);
    return this.org.listVendors(id.wsCtx);
  }

  @Resource({
    uri: 'assetnest://audit-log/recent',
    name: 'audit_log_recent',
    mimeType: 'application/json',
    description: 'The 8 most recent audit-log entries.',
    scopes: ['audit:read'],
  })
  recentAuditLog(_input: Record<string, never>, ctx: McpContext) {
    const id = automationIdentity(ctx);
    return this.workspaces.listAuditLog(id.wsCtx, 8, 0);
  }
}
