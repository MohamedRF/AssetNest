import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { assets, assetTags, assetEvents, categories, imports, locations } from '@assetnest/db';
import type { Database } from '@assetnest/db';
import type { AssetStatus } from '@assetnest/domain';
import { isAssetStatus } from '@assetnest/domain';
import { DATABASE } from '../common/tokens.js';
import { writeAuditLog } from '../common/audit.js';
import { httpCode } from '../common/problem.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import { parseCsv, CsvParseError } from './csv.js';
import type { PreviewImportInput, RunImportInput, ImportableField } from './dto.js';

const CONDITION = new Set(['new', 'good', 'fair', 'poor', 'damaged', 'unknown']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT = /^\d{1,16}(\.\d{1,2})?$/;
const CURRENCY = /^[A-Z]{3}$/;
const TAG = /^[A-Z0-9][A-Z0-9-]{0,63}$/;

const SUGGESTED_MAPPING: Record<string, ImportableField> = {
  assettag: 'assetTag',
  tag: 'assetTag',
  'asset tag': 'assetTag',
  asset_id: 'assetTag',
  'asset id': 'assetTag',
  asset_tag: 'assetTag',
  displayname: 'displayName',
  'display name': 'displayName',
  name: 'displayName',
  assetname: 'displayName',
  'asset name': 'displayName',
  serial: 'serialNumber',
  'serial number': 'serialNumber',
  'serial no': 'serialNumber',
  serial_number: 'serialNumber',
  serialnumber: 'serialNumber',
  condition: 'condition',
  status: 'status',
  purchasedate: 'purchaseDate',
  'purchase date': 'purchaseDate',
  purchase_date: 'purchaseDate',
  'date of purchase': 'purchaseDate',
  amount: 'amount',
  'purchase amount': 'amount',
  purchase_amount: 'amount',
  price: 'amount',
  cost: 'amount',
  currency: 'currency',
  notes: 'notes',
  remarks: 'notes',
  comment: 'notes',
  comments: 'notes',
  tags: 'tags',
  categoryid: 'categoryId',
  category_id: 'categoryId',
  locationid: 'locationId',
  location_id: 'locationId',
};

export interface ImportRowError {
  row: number; // 1-based, counting data rows (excluding header)
  field?: string;
  message: string;
}

export interface ImportSummary {
  total: number;
  imported: number;
  skippedDuplicate: number;
  failed: number;
  errors: ImportRowError[];
  importId?: string;
}

@Injectable()
export class ImportsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  preview(input: PreviewImportInput) {
    let parsed;
    try {
      parsed = parseCsv(input.csvText, 5000);
    } catch (error) {
      if (error instanceof CsvParseError) {
        throw httpCode(HttpStatus.BAD_REQUEST, error.message, 'IMPORT_PARSE_FAILED');
      }
      throw error;
    }
    const suggestedMapping: Record<string, ImportableField | ''> = {};
    for (const header of parsed.headers) {
      suggestedMapping[header] = SUGGESTED_MAPPING[header.trim().toLowerCase()] ?? '';
    }
    return {
      headers: parsed.headers,
      sample: parsed.rows.slice(0, 5),
      totalRows: parsed.rows.length,
      suggestedMapping,
    };
  }

  async run(ctx: WorkspaceContext, actorId: string, input: RunImportInput): Promise<ImportSummary> {
    let parsed;
    try {
      parsed = parseCsv(input.csvText, 5000);
    } catch (error) {
      if (error instanceof CsvParseError) {
        throw httpCode(HttpStatus.BAD_REQUEST, error.message, 'IMPORT_PARSE_FAILED');
      }
      throw error;
    }
    const { headers, rows } = parsed;
    // header → field, inverted from mapping (mapping: header→field already)
    const columnFor = new Map<ImportableField, number>();
    for (const [header, field] of Object.entries(input.mapping)) {
      const index = headers.findIndex((h) => h === header);
      if (index >= 0) {
        columnFor.set(field, index);
      }
    }
    const cell = (row: string[], field: ImportableField): string | undefined => {
      const idx = columnFor.get(field);
      return idx === undefined ? undefined : row[idx]?.trim() || undefined;
    };

    const errors: ImportRowError[] = [];
    const candidateTags = new Set<string>();
    const staged: Array<{ rowNumber: number; values: Record<string, string> }> = [];

    for (let i = 0; i < rows.length; i += 1) {
      const rowNumber = i + 1;
      const raw: Record<ImportableField, string | undefined> = {
        assetTag: cell(rows[i]!, 'assetTag')?.toUpperCase(),
        displayName: cell(rows[i]!, 'displayName'),
        serialNumber: cell(rows[i]!, 'serialNumber'),
        status: cell(rows[i]!, 'status')?.toLowerCase(),
        condition: cell(rows[i]!, 'condition')?.toLowerCase(),
        purchaseDate: cell(rows[i]!, 'purchaseDate'),
        amount: cell(rows[i]!, 'amount'),
        currency: cell(rows[i]!, 'currency')?.toUpperCase(),
        notes: cell(rows[i]!, 'notes'),
        tags: cell(rows[i]!, 'tags'),
        categoryId: cell(rows[i]!, 'categoryId'),
        locationId: cell(rows[i]!, 'locationId'),
      };

      if (!raw.assetTag || !TAG.test(raw.assetTag)) {
        errors.push({
          row: rowNumber,
          field: 'assetTag',
          message: 'Missing or invalid asset tag (A-Z, 0-9, hyphens)',
        });
        continue;
      }
      if (!raw.displayName || raw.displayName.length > 200) {
        errors.push({
          row: rowNumber,
          field: 'displayName',
          message: 'Display name is required (max 200 chars)',
        });
        continue;
      }
      if (raw.status !== undefined && !isAssetStatus(raw.status)) {
        errors.push({ row: rowNumber, field: 'status', message: `Unknown status '${raw.status}'` });
        continue;
      }
      if (raw.condition !== undefined && !CONDITION.has(raw.condition)) {
        errors.push({ row: rowNumber, field: 'condition', message: `Unknown condition '${raw.condition}'` });
        continue;
      }
      if (raw.purchaseDate !== undefined && !ISO_DATE.test(raw.purchaseDate)) {
        errors.push({ row: rowNumber, field: 'purchaseDate', message: 'Expected YYYY-MM-DD' });
        continue;
      }
      if (raw.amount !== undefined && !AMOUNT.test(raw.amount)) {
        errors.push({ row: rowNumber, field: 'amount', message: 'Digits with at most 2 decimals' });
        continue;
      }
      if (raw.currency !== undefined && !CURRENCY.test(raw.currency)) {
        errors.push({ row: rowNumber, field: 'currency', message: 'ISO 4217 (3 uppercase letters)' });
        continue;
      }
      if (candidateTags.has(raw.assetTag)) {
        errors.push({ row: rowNumber, field: 'assetTag', message: 'Duplicate asset tag within the file' });
        continue;
      }
      candidateTags.add(raw.assetTag);
      staged.push({
        rowNumber,
        values: Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined)) as Record<
          string,
          string
        >,
      });
    }

    // Workspace-scoped reference resolution (category/location ids) — one query each.
    const categoryIds = [
      ...new Set(staged.map((s) => s.values.categoryId).filter((v): v is string => Boolean(v))),
    ];
    const locationIds = [
      ...new Set(staged.map((s) => s.values.locationId).filter((v): v is string => Boolean(v))),
    ];
    const validCategoryIds = new Set<string>();
    const validLocationIds = new Set<string>();
    if (categoryIds.length > 0) {
      const rows = await this.db
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.workspaceId, ctx.workspaceId));
      for (const row of rows) validCategoryIds.add(row.id);
    }
    if (locationIds.length > 0) {
      const rows = await this.db
        .select({ id: locations.id })
        .from(locations)
        .where(eq(locations.workspaceId, ctx.workspaceId));
      for (const row of rows) validLocationIds.add(row.id);
    }

    const validated: typeof staged = [];
    for (const stagedRow of staged) {
      if (stagedRow.values.categoryId && !validCategoryIds.has(stagedRow.values.categoryId)) {
        errors.push({
          row: stagedRow.rowNumber,
          field: 'categoryId',
          message: 'Category not found in this workspace',
        });
        continue;
      }
      if (stagedRow.values.locationId && !validLocationIds.has(stagedRow.values.locationId)) {
        errors.push({
          row: stagedRow.rowNumber,
          field: 'locationId',
          message: 'Location not found in this workspace',
        });
        continue;
      }
      validated.push(stagedRow);
    }

    // Duplicate detection against the workspace (one query).
    const existingTags = new Set<string>();
    if (validated.length > 0) {
      const existing = await this.db
        .select({ tag: assets.assetTag })
        .from(assets)
        .where(
          and(
            eq(assets.workspaceId, ctx.workspaceId),
            inArray(
              assets.assetTag,
              validated.map((v) => v.values.assetTag!),
            ),
          ),
        );
      for (const row of existing) {
        existingTags.add(row.tag);
      }
    }

    let imported = 0;
    let skippedDuplicate = 0;
    const rowErrors: ImportRowError[] = [...errors];

    if (!input.dryRun) {
      const [importRow] = await this.db
        .insert(imports)
        .values({
          workspaceId: ctx.workspaceId,
          requestedBy: actorId,
          objectKey: `csv-import/${Date.now()}`,
          status: 'running',
          countsJson: { total: rows.length },
        })
        .returning({ id: imports.id });

      for (const stagedRow of validated) {
        const tag = stagedRow.values.assetTag!;
        if (existingTags.has(tag)) {
          if (input.onDuplicate === 'fail') {
            rowErrors.push({
              row: stagedRow.rowNumber,
              field: 'assetTag',
              message: 'Asset tag already exists in this workspace',
            });
          } else {
            skippedDuplicate += 1;
          }
          continue;
        }
        try {
          const values = stagedRow.values;
          const tags = values.tags
            ? values.tags
                .split(';')
                .map((t) => t.trim().toLowerCase())
                .filter(Boolean)
                .slice(0, 20)
            : [];
          await this.db.transaction(async (tx) => {
            const [asset] = await tx
              .insert(assets)
              .values({
                workspaceId: ctx.workspaceId,
                assetTag: tag,
                displayName: values.displayName!,
                serialNumber: values.serialNumber ?? null,
                status: (values.status as AssetStatus | undefined) ?? 'available',
                condition: values.condition ?? 'good',
                purchasedAt: values.purchaseDate ?? null,
                amount: values.amount ?? null,
                currency: values.currency ?? null,
                notes: values.notes ?? null,
                categoryId: values.categoryId ?? null,
                locationId: values.locationId ?? null,
              })
              .returning({ id: assets.id });
            if (!asset) {
              throw new Error('asset insert returned no row');
            }
            if (tags.length > 0) {
              await tx.insert(assetTags).values(
                tags.map((tagValue) => ({
                  workspaceId: ctx.workspaceId,
                  assetId: asset.id,
                  tag: tagValue,
                })),
              );
            }
            await tx.insert(assetEvents).values({
              workspaceId: ctx.workspaceId,
              assetId: asset.id,
              actorId,
              action: 'asset.created',
              afterJson: { assetTag: tag, source: 'csv_import' },
            });
          });
          imported += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          rowErrors.push({ row: stagedRow.rowNumber, message: message.slice(0, 200) });
        }
      }

      const failed = rowErrors.length - errors.length;
      if (importRow) {
        await this.db
          .update(imports)
          .set({
            status: failed > 0 ? 'partial' : 'completed',
            countsJson: { total: rows.length, imported, skippedDuplicate, failed },
            validationJson: { errors: rowErrors },
          })
          .where(eq(imports.id, importRow.id));
        await writeAuditLog(this.db, {
          workspaceId: ctx.workspaceId,
          actorId,
          action: 'import.completed',
          resource: 'import',
          resourceId: importRow.id,
          metadata: { total: rows.length, imported, skippedDuplicate, failed },
        });
        return {
          total: rows.length,
          imported,
          skippedDuplicate,
          failed,
          errors: rowErrors,
          importId: importRow.id,
        };
      }
    }

    const failed = rowErrors.length;
    return { total: rows.length, imported, skippedDuplicate, failed, errors: rowErrors };
  }
}
