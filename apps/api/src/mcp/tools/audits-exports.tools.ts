import { Injectable, Inject } from '@nestjs/common';
import { Tool, type McpContext } from '@nestjs/mcp';
import { z } from 'zod';
import { DATABASE } from '../../common/tokens.js';
import type { Database } from '@assetnest/db';
import { AuditsService } from '../../audits/audits.service.js';
import { closeAuditSchema, createAuditSchema, verifyItemSchema } from '../../audits/dto.js';
import { ExportsService } from '../../exports/exports.service.js';
import { REPORTS, createExportSchema } from '../../exports/dto.js';
import { ImportsService } from '../../imports/imports.service.js';
import { runImportSchema } from '../../imports/dto.js';
import { McpRateLimiter } from '../rate-limiter.service.js';
import { automationIdentity, auditMcpInvocation, invoke } from '../tool-support.js';

@Injectable()
export class AuditsExportsMcpTools {
  constructor(
    private readonly audits: AuditsService,
    private readonly exportsService: ExportsService,
    private readonly importsService: ImportsService,
    @Inject(DATABASE) private readonly db: Database,
    private readonly rateLimiter: McpRateLimiter,
  ) {}

  // ─── physical inventory audits ─────────────────────────────────────────

  @Tool({
    name: 'audits_list',
    description: 'List physical inventory audit sessions (open and closed).',
    inputSchema: z.object({}),
    scopes: ['audits:manage'],
    annotations: { readOnlyHint: true },
  })
  async auditsList(_input: Record<string, never>, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, false);
    return invoke(() => this.audits.list(id.wsCtx));
  }

  @Tool({
    name: 'audits_get',
    description: 'Get an audit session with its items and observed counts.',
    inputSchema: z.object({ auditId: z.uuid() }),
    scopes: ['audits:manage'],
    annotations: { readOnlyHint: true },
  })
  async auditsGet(input: { auditId: string }, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, false);
    return invoke(() => this.audits.get(id.wsCtx, input.auditId));
  }

  @Tool({
    name: 'audits_create',
    description:
      'Open a physical inventory audit session. scope optionally narrows by locationId and/or categoryId; the asset set is snapshotted at open time. label is a short human name.',
    inputSchema: createAuditSchema,
    scopes: ['audits:manage'],
    annotations: { readOnlyHint: false },
  })
  async auditsCreate(input: z.infer<typeof createAuditSchema>, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, true);
    const result = await invoke(() => this.audits.create(id.wsCtx, id.actorId ?? '', input));
    if (!('isError' in (result as object))) {
      await auditMcpInvocation(this.db, ctx, id, 'audits_create');
    }
    return result;
  }

  @Tool({
    name: 'audits_verify_item',
    description:
      'Record the observation for one asset in an open audit session. observation ∈ present|missing|moved|extra. observedLocationId is required context for moved observations.',
    inputSchema: verifyItemSchema.extend({ auditId: z.uuid() }),
    scopes: ['audits:manage'],
    annotations: { readOnlyHint: false },
  })
  async auditsVerify(input: z.infer<typeof verifyItemSchema> & { auditId: string }, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, true);
    const { auditId, ...body } = input;
    const result = await invoke(() => this.audits.verify(id.wsCtx, id.actorId ?? '', auditId, body));
    if (!('isError' in (result as object))) {
      await auditMcpInvocation(this.db, ctx, id, 'audits_verify_item');
    }
    return result;
  }

  @Tool({
    name: 'audits_close',
    description:
      'Close an audit session. After closing, the session is immutable and an audit-log entry records the close. notes summarize findings.',
    inputSchema: closeAuditSchema.extend({ auditId: z.uuid() }),
    scopes: ['audits:manage'],
    annotations: { readOnlyHint: false, destructiveHint: true },
  })
  async auditsClose(input: z.infer<typeof closeAuditSchema> & { auditId: string }, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, true);
    const { auditId, ...body } = input;
    const result = await invoke(() => this.audits.close(id.wsCtx, id.actorId ?? '', auditId, body));
    if (!('isError' in (result as object))) {
      await auditMcpInvocation(this.db, ctx, id, 'audits_close');
    }
    return result;
  }

  // ─── exports ───────────────────────────────────────────────────────────

  @Tool({
    name: 'exports_list',
    description:
      'List generated CSV exports (assets, warranties or maintenance) with their download references.',
    inputSchema: z.object({}),
    scopes: ['reports:read'],
    annotations: { readOnlyHint: true },
  })
  async exportsList(_input: Record<string, never>, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, false);
    return invoke(() => this.exportsService.listAll(id.wsCtx));
  }

  @Tool({
    name: 'exports_create',
    description:
      'Generate a CSV export for one of: assets, warranties, maintenance. Returns the export descriptor.',
    inputSchema: createExportSchema,
    scopes: ['reports:read'],
    annotations: { readOnlyHint: false },
  })
  async exportsCreate(input: { report: (typeof REPORTS)[number] }, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, true);
    const result = await invoke(() => this.exportsService.generate(id.wsCtx, id.actorId ?? '', input.report));
    if (!('isError' in (result as object))) {
      await auditMcpInvocation(this.db, ctx, id, 'exports_create');
    }
    return result;
  }

  // ─── imports ───────────────────────────────────────────────────────────

  @Tool({
    name: 'imports_run',
    description:
      'Import assets from inline CSV text with an explicit column mapping. mapping maps CSV column headers to fields: ' +
      'assetTag, displayName, serialNumber, status, condition, purchaseDate, amount, currency, notes, tags, categoryId, locationId. ' +
      'Set dryRun: true first to preview verdicts per row; only valid CSV (max 2 MB) please. Duplicates follow onDuplicate (skip|fail).',
    inputSchema: runImportSchema,
    scopes: ['assets:write'],
    annotations: { readOnlyHint: false },
  })
  async importsRun(input: z.infer<typeof runImportSchema>, ctx: McpContext) {
    const id = automationIdentity(ctx);
    this.rateLimiter.hit(id.tokenId, true);
    const result = await invoke(() => this.importsService.run(id.wsCtx, id.actorId ?? '', input));
    if (!('isError' in (result as object))) {
      await auditMcpInvocation(this.db, ctx, id, 'imports_run');
    }
    return result;
  }
}
