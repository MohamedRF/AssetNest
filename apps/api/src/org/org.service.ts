import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { categories, locations, vendors } from '@assetnest/db';
import type { Database } from '@assetnest/db';
import { DATABASE } from '../common/tokens.js';
import { writeAuditLog } from '../common/audit.js';
import { httpCode, isUniqueViolation } from '../common/problem.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import type {
  CreateCategoryInput,
  CreateLocationInput,
  CreateVendorInput,
  UpdateCategoryInput,
  UpdateLocationInput,
  UpdateVendorInput,
} from './dto.js';

function slugifySegment(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
  return slug.length > 0 ? slug : 'location';
}

@Injectable()
export class OrgService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  // ─── Categories ──────────────────────────────────────────────────────────

  async listCategories(ctx: WorkspaceContext) {
    return this.db
      .select()
      .from(categories)
      .where(eq(categories.workspaceId, ctx.workspaceId))
      .orderBy(asc(categories.name));
  }

  async createCategory(ctx: WorkspaceContext, actorId: string, input: CreateCategoryInput) {
    try {
      const [created] = await this.db
        .insert(categories)
        .values({ workspaceId: ctx.workspaceId, name: input.name, description: input.description })
        .returning();
      await writeAuditLog(this.db, {
        workspaceId: ctx.workspaceId,
        actorId,
        action: 'category.created',
        resource: 'category',
        resourceId: created!.id,
        metadata: { name: created!.name },
      });
      return created!;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw httpCode(
          HttpStatus.CONFLICT,
          `A category named '${input.name}' already exists`,
          'CATEGORY_EXISTS',
        );
      }
      throw error;
    }
  }

  async updateCategory(
    ctx: WorkspaceContext,
    actorId: string,
    categoryId: string,
    input: UpdateCategoryInput,
  ) {
    const [updated] = await this.db
      .update(categories)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(categories.id, categoryId), eq(categories.workspaceId, ctx.workspaceId)))
      .returning();
    if (!updated) {
      throw httpCode(HttpStatus.NOT_FOUND, 'Category not found', 'CATEGORY_NOT_FOUND');
    }
    await writeAuditLog(this.db, {
      workspaceId: ctx.workspaceId,
      actorId,
      action: 'category.updated',
      resource: 'category',
      resourceId: updated.id,
      metadata: { fields: Object.keys(input) },
    });
    return updated;
  }

  // ─── Locations ───────────────────────────────────────────────────────────

  async listLocations(ctx: WorkspaceContext) {
    return this.db
      .select()
      .from(locations)
      .where(eq(locations.workspaceId, ctx.workspaceId))
      .orderBy(asc(locations.path), asc(locations.name));
  }

  private async findLocation(ctx: WorkspaceContext, locationId: string) {
    const [location] = await this.db
      .select()
      .from(locations)
      .where(and(eq(locations.id, locationId), eq(locations.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!location) {
      throw httpCode(HttpStatus.NOT_FOUND, 'Location not found', 'LOCATION_NOT_FOUND');
    }
    return location;
  }

  private async buildPath(ctx: WorkspaceContext, parentId: string | null, name: string): Promise<string> {
    const segment = slugifySegment(name);
    if (parentId === null) {
      return `/${segment}`;
    }
    const parent = await this.findLocation(ctx, parentId);
    return `${parent.path}/${segment}`;
  }

  /** Ancestors of a location, root first — used for cycle prevention. */
  private async ancestorChain(ctx: WorkspaceContext, startParentId: string): Promise<string[]> {
    const chain: string[] = [];
    let current: string | null = startParentId;
    for (let depth = 0; current !== null && depth < 64; depth += 1) {
      chain.push(current);
      const parentRows: Array<{ parentId: string | null }> = await this.db
        .select({ parentId: locations.parentId })
        .from(locations)
        .where(and(eq(locations.id, current), eq(locations.workspaceId, ctx.workspaceId)))
        .limit(1);
      const parent: { parentId: string | null } | undefined = parentRows[0];
      if (!parent) {
        break;
      }
      current = parent.parentId ?? null;
    }
    return chain;
  }

  async createLocation(ctx: WorkspaceContext, actorId: string, input: CreateLocationInput) {
    const parentId = input.parentId ?? null;
    if (parentId !== null) {
      // Must reference a location in the SAME workspace (composite FK enforces too).
      await this.findLocation(ctx, parentId);
    }
    const path = await this.buildPath(ctx, parentId, input.name);
    const [created] = await this.db
      .insert(locations)
      .values({ workspaceId: ctx.workspaceId, name: input.name, type: input.type, parentId, path })
      .returning();
    await writeAuditLog(this.db, {
      workspaceId: ctx.workspaceId,
      actorId,
      action: 'location.created',
      resource: 'location',
      resourceId: created!.id,
      metadata: { name: created!.name, parentId },
    });
    return created!;
  }

  async updateLocation(
    ctx: WorkspaceContext,
    actorId: string,
    locationId: string,
    input: UpdateLocationInput,
  ) {
    const current = await this.findLocation(ctx, locationId);

    // Cycle prevention: the new parent must not be the location itself or any descendant.
    if (input.parentId !== undefined && input.parentId !== current.parentId) {
      const nextParent = input.parentId;
      if (nextParent !== null) {
        if (nextParent === locationId) {
          throw httpCode(HttpStatus.CONFLICT, 'A location cannot be its own parent', 'LOCATION_CYCLE');
        }
        await this.findLocation(ctx, nextParent); // same-workspace check
        const ancestors = await this.ancestorChain(ctx, nextParent);
        if (ancestors.includes(locationId)) {
          throw httpCode(
            HttpStatus.CONFLICT,
            'A location cannot be moved under its own descendant',
            'LOCATION_CYCLE',
          );
        }
      }
    }

    const nextName = input.name ?? current.name;
    const parentChanged = input.parentId !== undefined && input.parentId !== current.parentId;
    const nameChanged = input.name !== undefined && input.name !== current.name;

    let nextPath = current.path;
    if (parentChanged || nameChanged) {
      nextPath = await this.buildPath(
        ctx,
        input.parentId !== undefined ? input.parentId : current.parentId,
        nextName,
      );
    }

    const [updated] = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(locations)
        .set({
          name: nextName,
          type: input.type ?? current.type,
          ...(parentChanged ? { parentId: input.parentId } : {}),
          path: nextPath,
          updatedAt: new Date(),
        })
        .where(and(eq(locations.id, locationId), eq(locations.workspaceId, ctx.workspaceId)))
        .returning();
      if (!row) {
        throw httpCode(HttpStatus.NOT_FOUND, 'Location not found', 'LOCATION_NOT_FOUND');
      }

      // Re-anchor the subtree when this location moved or was renamed.
      if (nextPath !== current.path) {
        await tx
          .update(locations)
          .set({
            path: sql`${nextPath} || substring(${locations.path} from ${current.path.length + 1}::int)`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(locations.workspaceId, ctx.workspaceId),
              ne(locations.id, locationId),
              sql`${locations.path} like ${current.path + '/%'}`,
            ),
          );
      }
      return [row];
    });

    await writeAuditLog(this.db, {
      workspaceId: ctx.workspaceId,
      actorId,
      action: 'location.updated',
      resource: 'location',
      resourceId: updated.id,
      metadata: { parentChanged, nameChanged },
    });
    return updated;
  }

  // ─── Vendors ─────────────────────────────────────────────────────────────

  async listVendors(ctx: WorkspaceContext) {
    return this.db
      .select()
      .from(vendors)
      .where(eq(vendors.workspaceId, ctx.workspaceId))
      .orderBy(asc(vendors.name));
  }

  async createVendor(ctx: WorkspaceContext, actorId: string, input: CreateVendorInput) {
    const [created] = await this.db
      .insert(vendors)
      .values({
        workspaceId: ctx.workspaceId,
        name: input.name,
        contactJson: input.contact ?? {},
        notes: input.notes,
      })
      .returning();
    await writeAuditLog(this.db, {
      workspaceId: ctx.workspaceId,
      actorId,
      action: 'vendor.created',
      resource: 'vendor',
      resourceId: created!.id,
      metadata: { name: created!.name },
    });
    return created!;
  }

  async updateVendor(ctx: WorkspaceContext, actorId: string, vendorId: string, input: UpdateVendorInput) {
    const current = await this.db
      .select()
      .from(vendors)
      .where(and(eq(vendors.id, vendorId), eq(vendors.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (current.length === 0) {
      throw httpCode(HttpStatus.NOT_FOUND, 'Vendor not found', 'VENDOR_NOT_FOUND');
    }
    const [updated] = await this.db
      .update(vendors)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.contact !== undefined ? { contactJson: input.contact } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(vendors.id, vendorId), eq(vendors.workspaceId, ctx.workspaceId)))
      .returning();
    await writeAuditLog(this.db, {
      workspaceId: ctx.workspaceId,
      actorId,
      action: 'vendor.updated',
      resource: 'vendor',
      resourceId: updated!.id,
      metadata: { fields: Object.keys(input) },
    });
    return updated!;
  }
}
