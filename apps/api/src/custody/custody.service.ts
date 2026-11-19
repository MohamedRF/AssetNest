import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  assets,
  assetAssignments,
  assetEvents,
  assetTransfers,
  locations,
  memberships,
  users,
} from '@assetnest/db';
import type { Database } from '@assetnest/db';
import { DATABASE } from '../common/tokens.js';
import { writeAuditLog } from '../common/audit.js';
import { httpCode, isUniqueViolation } from '../common/problem.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import type { AssignInput, ReturnInput, TransferInput } from './dto.js';

@Injectable()
export class CustodyService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private async findAssetForUpdate(ctx: WorkspaceContext, assetId: string, expectedVersion?: number) {
    const [asset] = await this.db
      .select()
      .from(assets)
      .where(and(eq(assets.id, assetId), eq(assets.workspaceId, ctx.workspaceId), isNull(assets.deletedAt)))
      .limit(1);
    if (!asset) {
      throw httpCode(HttpStatus.NOT_FOUND, 'Asset not found', 'ASSET_NOT_FOUND');
    }
    if (expectedVersion !== undefined && asset.version !== expectedVersion) {
      throw httpCode(
        HttpStatus.CONFLICT,
        `Asset was modified elsewhere (your version ${expectedVersion}, current version ${asset.version}). Reload and retry.`,
        'ASSET_VERSION_CONFLICT',
      );
    }
    return asset;
  }

  async assign(ctx: WorkspaceContext, actorId: string, assetId: string, input: AssignInput) {
    const asset = await this.findAssetForUpdate(ctx, assetId, input.expectedVersion);
    if (asset.status === 'archived' || asset.status === 'disposed' || asset.status === 'retired') {
      throw httpCode(
        HttpStatus.CONFLICT,
        `Cannot assign an asset in status '${asset.status}'`,
        'INVALID_TRANSITION',
      );
    }

    const [member] = await this.db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.id, input.memberId),
          eq(memberships.workspaceId, ctx.workspaceId),
          eq(memberships.status, 'active'),
        ),
      )
      .limit(1);
    if (!member) {
      throw httpCode(
        HttpStatus.BAD_REQUEST,
        'Custodian is not an active member of this workspace',
        'CUSTODIAN_NOT_MEMBER',
      );
    }

    try {
      const updated = await this.db.transaction(async (tx) => {
        // CAS on version + one ACTIVE assignment enforced by partial unique index.
        const [row] = await tx
          .update(assets)
          .set({
            status: 'assigned',
            custodianMembershipId: member.id,
            version: sql`${assets.version} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(assets.id, assetId),
              eq(assets.workspaceId, ctx.workspaceId),
              eq(assets.version, input.expectedVersion),
              isNull(assets.deletedAt),
            ),
          )
          .returning();
        if (!row) {
          throw httpCode(
            HttpStatus.CONFLICT,
            'Asset was modified elsewhere. Reload and retry.',
            'ASSET_VERSION_CONFLICT',
          );
        }
        const [assignment] = await tx
          .insert(assetAssignments)
          .values({
            workspaceId: ctx.workspaceId,
            assetId,
            memberId: member.id,
            assignedBy: actorId,
            notes: input.notes,
          })
          .returning({
            id: assetAssignments.id,
            memberId: assetAssignments.memberId,
            assignedAt: assetAssignments.assignedAt,
          });
        await tx.insert(assetEvents).values({
          workspaceId: ctx.workspaceId,
          assetId,
          actorId,
          action: 'asset.assigned',
          beforeJson: { status: asset.status, custodianMembershipId: asset.custodianMembershipId },
          afterJson: { status: 'assigned', custodianMembershipId: member.id },
        });
        return { asset: row, assignment };
      });

      await writeAuditLog(this.db, {
        workspaceId: ctx.workspaceId,
        actorId,
        action: 'asset.assigned',
        resource: 'asset',
        resourceId: assetId,
        metadata: { memberId: member.id },
      });
      return updated;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw httpCode(HttpStatus.CONFLICT, 'Asset already has an active assignment', 'ALREADY_ASSIGNED');
      }
      throw error;
    }
  }

  async returnAsset(ctx: WorkspaceContext, actorId: string, assetId: string, input: ReturnInput) {
    const asset = await this.findAssetForUpdate(ctx, assetId, input.expectedVersion);

    const [assignment] = await this.db
      .select()
      .from(assetAssignments)
      .where(
        and(
          eq(assetAssignments.workspaceId, ctx.workspaceId),
          eq(assetAssignments.assetId, assetId),
          isNull(assetAssignments.returnedAt),
        ),
      )
      .limit(1);
    if (!assignment) {
      throw httpCode(HttpStatus.NOT_FOUND, 'Asset has no active assignment', 'ASSIGNMENT_NOT_FOUND');
    }

    const updated = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(assets)
        .set({
          status: 'available',
          custodianMembershipId: null,
          version: sql`${assets.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(assets.id, assetId),
            eq(assets.workspaceId, ctx.workspaceId),
            eq(assets.version, input.expectedVersion),
            isNull(assets.deletedAt),
          ),
        )
        .returning();
      if (!row) {
        throw httpCode(
          HttpStatus.CONFLICT,
          'Asset was modified elsewhere. Reload and retry.',
          'ASSET_VERSION_CONFLICT',
        );
      }
      await tx
        .update(assetAssignments)
        .set({
          returnedAt: new Date(),
          returnedBy: actorId,
          status: 'returned',
          notes: input.notes ?? assignment.notes,
        })
        .where(eq(assetAssignments.id, assignment.id));
      await tx.insert(assetEvents).values({
        workspaceId: ctx.workspaceId,
        assetId,
        actorId,
        action: 'asset.returned',
        beforeJson: { status: asset.status, custodianMembershipId: asset.custodianMembershipId },
        afterJson: { status: 'available', custodianMembershipId: null },
      });
      return row;
    });

    await writeAuditLog(this.db, {
      workspaceId: ctx.workspaceId,
      actorId,
      action: 'asset.returned',
      resource: 'asset',
      resourceId: assetId,
      metadata: { assignmentId: assignment.id },
    });
    return updated;
  }

  async transfer(ctx: WorkspaceContext, actorId: string, assetId: string, input: TransferInput) {
    const asset = await this.findAssetForUpdate(ctx, assetId, input.expectedVersion);

    const [location] = await this.db
      .select({ id: locations.id })
      .from(locations)
      .where(and(eq(locations.id, input.toLocationId), eq(locations.workspaceId, ctx.workspaceId)))
      .limit(1);
    if (!location) {
      throw httpCode(HttpStatus.NOT_FOUND, 'Location not found in this workspace', 'LOCATION_NOT_FOUND');
    }
    if (asset.locationId === location.id) {
      throw httpCode(HttpStatus.CONFLICT, 'Asset is already at that location', 'ASSET_ALREADY_THERE');
    }

    const updated = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(assets)
        .set({ locationId: location.id, version: sql`${assets.version} + 1`, updatedAt: new Date() })
        .where(
          and(
            eq(assets.id, assetId),
            eq(assets.workspaceId, ctx.workspaceId),
            eq(assets.version, input.expectedVersion),
            isNull(assets.deletedAt),
          ),
        )
        .returning();
      if (!row) {
        throw httpCode(
          HttpStatus.CONFLICT,
          'Asset was modified elsewhere. Reload and retry.',
          'ASSET_VERSION_CONFLICT',
        );
      }
      await tx.insert(assetTransfers).values({
        workspaceId: ctx.workspaceId,
        assetId,
        fromLocationId: asset.locationId,
        toLocationId: location.id,
        actorId,
        notes: input.notes,
      });
      await tx.insert(assetEvents).values({
        workspaceId: ctx.workspaceId,
        assetId,
        actorId,
        action: 'asset.transferred',
        beforeJson: { locationId: asset.locationId },
        afterJson: { locationId: location.id },
      });
      return row;
    });

    await writeAuditLog(this.db, {
      workspaceId: ctx.workspaceId,
      actorId,
      action: 'asset.transferred',
      resource: 'asset',
      resourceId: assetId,
      metadata: { from: asset.locationId, to: location.id },
    });
    return updated;
  }

  async listActive(ctx: WorkspaceContext) {
    return this.db
      .select({
        assignmentId: assetAssignments.id,
        assetId: assets.id,
        assetTag: assets.assetTag,
        displayName: assets.displayName,
        memberId: memberships.id,
        memberName: users.displayName,
        memberEmail: users.email,
        role: memberships.roleKey,
        assignedAt: assetAssignments.assignedAt,
        notes: assetAssignments.notes,
      })
      .from(assetAssignments)
      .innerJoin(assets, eq(assets.id, assetAssignments.assetId))
      .innerJoin(memberships, eq(memberships.id, assetAssignments.memberId))
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(assetAssignments.workspaceId, ctx.workspaceId), isNull(assetAssignments.returnedAt)))
      .orderBy(assetAssignments.assignedAt);
  }
}
