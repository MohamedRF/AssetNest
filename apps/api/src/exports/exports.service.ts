import { createWriteStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { HttpStatus, Inject, Injectable, HttpException } from '@nestjs/common';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { exports as exportsTable } from '@assetnest/db';
import type { Database } from '@assetnest/db';
import type { AppConfig } from '@assetnest/config';
import { exportExpiryCutoff, isExportExpired } from '@assetnest/domain';
import { APP_CONFIG, DATABASE } from '../common/tokens.js';
import { writeAuditLog } from '../common/audit.js';
import { httpCode } from '../common/problem.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import { PoliciesService } from '../policies/policies.service.js';
import type { ReportKind } from './dto.js';

const CHUNK_SIZE = 500;

export interface ExportListRow {
  id: string;
  report: string;
  status: string;
  requestedBy: string | null;
  createdAt: Date;
}

/**
 * Spreadsheet formula-injection defense (OWASP CSV Injection). Excel, Sheets and
 * LibreOffice treat a leading = + - @ (or a leading tab/CR) as the start of a
 * formula even inside a quoted cell, so untrusted text is prefixed with a single
 * quote to force literal display. Genuinely numeric cells (amounts, costs) are
 * validated numeric upstream and must be preserved verbatim, so they bypass this
 * via the `numeric` option.
 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function neutralizeFormula(value: string): string {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

function csvEscape(value: string | null | undefined, options: { numeric?: boolean } = {}): string {
  const raw = value ?? '';
  const safe = options.numeric ? raw : neutralizeFormula(raw);
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

@Injectable()
export class ExportsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly policies: PoliciesService,
  ) {}

  private resolveInsideRoot(objectKey: string): string {
    const root = resolve(process.cwd(), this.config.STORAGE_ROOT, 'exports');
    const target = resolve(join(root, objectKey));
    if (!target.startsWith(root + sep)) {
      throw new Error('storage containment violation');
    }
    return target;
  }

  async listAll(ctx: WorkspaceContext) {
    const policy = await this.policies.getExportPolicy(ctx);
    // Disabled policy hides all exports (and their metadata) from every caller.
    if (!policy.enabled) {
      return { exports: [] as ExportListRow[], policy };
    }
    const cutoff = exportExpiryCutoff(policy);
    const rows = await this.db
      .select({
        id: exportsTable.id,
        report: exportsTable.report,
        status: exportsTable.status,
        requestedBy: exportsTable.requestedBy,
        createdAt: exportsTable.createdAt,
      })
      .from(exportsTable)
      .where(
        and(
          eq(exportsTable.workspaceId, ctx.workspaceId),
          cutoff ? gte(exportsTable.createdAt, cutoff) : undefined,
        ),
      )
      .orderBy(desc(exportsTable.createdAt), desc(exportsTable.id))
      .limit(20);
    return { exports: rows, policy };
  }

  async generate(ctx: WorkspaceContext, actorId: string, report: ReportKind) {
    const policy = await this.policies.getExportPolicy(ctx);
    if (!policy.enabled) {
      throw httpCode(
        HttpStatus.FORBIDDEN,
        'Exports are disabled by this workspace’s export policy',
        'EXPORT_DISABLED',
      );
    }
    const [exportRow] = await this.db
      .insert(exportsTable)
      .values({
        workspaceId: ctx.workspaceId,
        requestedBy: actorId,
        report,
        objectKey: 'pending',
        status: 'pending',
      })
      .returning({ id: exportsTable.id });
    if (!exportRow) {
      throw httpCode(HttpStatus.INTERNAL_SERVER_ERROR, 'Could not create export', 'EXPORT_FAILED');
    }
    const objectKey = `${exportRow.id}.csv`;
    let target: string | null = null;
    try {
      await mkdir(resolve(process.cwd(), this.config.STORAGE_ROOT, 'exports'), { recursive: true });
      target = this.resolveInsideRoot(objectKey);
      const out = createWriteStream(target, { encoding: 'utf8' });
      // Prevent an unhandled 'error' event from crashing the process; per-write
      // and end() handlers below surface the failure to the awaiting caller.
      out.on('error', () => undefined);
      try {
        await this.streamReport(out, ctx, report);
        await new Promise<void>((res, rej) =>
          out.end((error?: Error | null) => (error ? rej(error) : res())),
        );
      } catch (error) {
        out.destroy();
        throw error;
      }
      // The file is fully written and closed. Only now publish completion
      // metadata, so the download endpoint never advertises a half-written file.
      await this.db
        .update(exportsTable)
        .set({ objectKey, status: 'completed' })
        .where(eq(exportsTable.id, exportRow.id));
      await writeAuditLog(this.db, {
        workspaceId: ctx.workspaceId,
        actorId,
        action: 'export.completed',
        resource: 'export',
        resourceId: exportRow.id,
        metadata: { report },
      });
      return {
        id: exportRow.id,
        report,
        status: 'completed',
        downloadUrl: `/api/v1/workspaces/${ctx.workspaceId}/exports/${exportRow.id}/download`,
      };
    } catch (error) {
      // Clean up the partial file and mark the export failed; never leave an
      // orphaned or half-written CSV that a later download could serve.
      if (target) {
        await unlink(target).catch(() => undefined);
      }
      await this.db.update(exportsTable).set({ status: 'failed' }).where(eq(exportsTable.id, exportRow.id));
      if (error instanceof HttpException) {
        throw error;
      }
      throw httpCode(HttpStatus.INTERNAL_SERVER_ERROR, 'Could not generate the export', 'EXPORT_FAILED');
    }
  }

  private async streamReport(
    out: NodeJS.WritableStream,
    ctx: WorkspaceContext,
    report: ReportKind,
  ): Promise<void> {
    const write = (line: string) =>
      new Promise<void>((resolvePromise, rejectPromise) => {
        const onError = (error: Error) => {
          out.removeListener('drain', onDrain);
          rejectPromise(error);
        };
        const onDrain = () => {
          out.removeListener('error', onError);
          resolvePromise();
        };
        out.once('error', onError);
        if (out.write(line + '\n')) {
          out.removeListener('error', onError);
          resolvePromise();
        } else {
          out.once('drain', onDrain);
        }
      });

    if (report === 'assets') {
      await write(
        'asset_tag,display_name,serial_number,status,condition,purchase_date,amount,currency,location_path,category_name,tags,created_at',
      );
      let offset = 0;
      for (;;) {
        const rows = await this.db.execute<{
          asset_tag: string;
          display_name: string;
          serial_number: string | null;
          status: string;
          condition: string;
          purchase_date: string | null;
          amount: string | null;
          currency: string | null;
          location_path: string | null;
          category_name: string | null;
          tags: string | null;
          created_at: Date;
        }>(
          sql`select a.asset_tag, a.display_name, a.serial_number, a.status, a.condition,
                     a.purchased_at as purchase_date, a.amount::text as amount, a.currency,
                     l.path as location_path, c.name as category_name,
                     coalesce((select string_agg(t.tag, ';' order by t.tag) from asset_tags t where t.asset_id = a.id), '') as tags,
                     a.created_at
              from assets a
              left join locations l on l.id = a.location_id
              left join categories c on c.id = a.category_id
              where a.workspace_id = ${ctx.workspaceId} and a.deleted_at is null
              order by a.asset_tag
              limit ${CHUNK_SIZE} offset ${offset}`,
        );
        if (rows.rows.length === 0) break;
        for (const row of rows.rows) {
          await write(
            [
              csvEscape(row.asset_tag),
              csvEscape(row.display_name),
              csvEscape(row.serial_number),
              csvEscape(row.status),
              csvEscape(row.condition),
              csvEscape(row.purchase_date),
              csvEscape(row.amount, { numeric: true }),
              csvEscape(row.currency),
              csvEscape(row.location_path),
              csvEscape(row.category_name),
              csvEscape(row.tags),
              csvEscape(String(row.created_at)),
            ].join(','),
          );
        }
        offset += CHUNK_SIZE;
        if (rows.rows.length < CHUNK_SIZE) break;
      }
      return;
    }

    if (report === 'warranties') {
      await write('asset_tag,asset_name,provider,starts_on,expires_on,status,details');
      let offset = 0;
      for (;;) {
        const rows = await this.db.execute<{
          asset_tag: string;
          asset_name: string;
          provider: string;
          starts_on: string;
          expires_on: string;
          details: string | null;
        }>(
          sql`select a.asset_tag, a.display_name as asset_name, w.provider, w.starts_on::text as starts_on,
                     w.expires_on::text as expires_on, w.details
              from warranties w
              join assets a on a.id = w.asset_id
              where w.workspace_id = ${ctx.workspaceId}
              order by w.expires_on
              limit ${CHUNK_SIZE} offset ${offset}`,
        );
        if (rows.rows.length === 0) break;
        const today = new Date().toISOString().slice(0, 10);
        for (const row of rows.rows) {
          const status = row.expires_on < today ? 'expired' : 'active';
          await write(
            [
              csvEscape(row.asset_tag),
              csvEscape(row.asset_name),
              csvEscape(row.provider),
              csvEscape(row.starts_on),
              csvEscape(row.expires_on),
              status,
              csvEscape(row.details),
            ].join(','),
          );
        }
        offset += CHUNK_SIZE;
        if (rows.rows.length < CHUNK_SIZE) break;
      }
      return;
    }

    // maintenance
    await write('asset_tag,asset_name,performed_at,vendor,cost,currency,notes');
    let offset = 0;
    for (;;) {
      const rows = await this.db.execute<{
        asset_tag: string;
        asset_name: string;
        performed_at: string;
        vendor: string | null;
        cost: string | null;
        currency: string | null;
        notes: string | null;
      }>(
        sql`select a.asset_tag, a.display_name as asset_name, r.performed_at::text as performed_at,
                   v.name as vendor, r.cost::text as cost, r.currency, r.notes
            from maintenance_records r
            join assets a on a.id = r.asset_id
            left join vendors v on v.id = r.vendor_id
            where r.workspace_id = ${ctx.workspaceId}
            order by r.performed_at desc
            limit ${CHUNK_SIZE} offset ${offset}`,
      );
      if (rows.rows.length === 0) break;
      for (const row of rows.rows) {
        await write(
          [
            csvEscape(row.asset_tag),
            csvEscape(row.asset_name),
            csvEscape(row.performed_at),
            csvEscape(row.vendor),
            csvEscape(row.cost, { numeric: true }),
            csvEscape(row.currency),
            csvEscape(row.notes),
          ].join(','),
        );
      }
      offset += CHUNK_SIZE;
      if (rows.rows.length < CHUNK_SIZE) break;
    }
  }

  async getForDownload(ctx: WorkspaceContext, exportId: string) {
    // Policy is re-evaluated at download time so a later change (disable, or a
    // shorter maxAgeDays) applies to files that were generated earlier.
    const policy = await this.policies.getExportPolicy(ctx);
    if (!policy.enabled) {
      throw httpCode(
        HttpStatus.FORBIDDEN,
        'Exports are disabled by this workspace’s export policy',
        'EXPORT_DISABLED',
      );
    }
    const [row] = await this.db
      .select()
      .from(exportsTable)
      .where(and(eq(exportsTable.id, exportId), eq(exportsTable.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!row) {
      throw httpCode(HttpStatus.NOT_FOUND, 'Export not found', 'EXPORT_NOT_FOUND');
    }
    if (row.status !== 'completed') {
      throw httpCode(HttpStatus.CONFLICT, 'Export is not ready', 'EXPORT_NOT_READY');
    }
    if (isExportExpired(row.createdAt, policy)) {
      throw httpCode(HttpStatus.GONE, 'Export file is missing (may have expired)', 'EXPORT_EXPIRED');
    }
    const filePath = this.resolveInsideRoot(row.objectKey);
    try {
      const info = await stat(filePath);
      return { row, filePath, size: info.size };
    } catch {
      throw httpCode(HttpStatus.GONE, 'Export file is missing (may have expired)', 'EXPORT_EXPIRED');
    }
  }
}
