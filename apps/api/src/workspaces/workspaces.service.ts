import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { AppConfig } from '@assetnest/config';
import { users, memberships, workspaces, workspaceInvites, auditLog } from '@assetnest/db';
import type { Database } from '@assetnest/db';
import { APP_CONFIG, DATABASE } from '../common/tokens.js';
import { generateToken, sha256Hex } from '../common/crypto.js';
import { writeAuditLog } from '../common/audit.js';
import { AuthService, type RequestMeta, type WorkspaceSummary } from '../auth/auth.service.js';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import type {
  ChangeRoleInput,
  CreateInviteInput,
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
} from './dto.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function httpCode(status: HttpStatus, message: string, code: string): HttpException {
  return new HttpException({ message, code }, status);
}

/** Walk the drizzle/driver cause chain looking for PG error code 23505 (unique_violation). */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if ((current as { code?: unknown }).code === '23505') {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function slugify(name: string): string {
  const slug = name
    .normalize('NFD')
    // strip combining diacritics in the U+0300–U+036F range (e.g. é -> e)
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');
  return slug.length >= 2 ? slug : 'workspace';
}

@Injectable()
export class WorkspacesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly authService: AuthService,
  ) {}

  async listMine(userId: string): Promise<WorkspaceSummary[]> {
    return this.authService.listWorkspaces(userId);
  }

  async create(input: CreateWorkspaceInput, userId: string) {
    const baseSlug = input.slug ?? slugify(input.name);
    const explicit = input.slug !== undefined;
    const candidates = explicit
      ? [baseSlug]
      : [baseSlug, `${baseSlug}-2`, `${baseSlug}-3`, `${baseSlug}-4`, `${baseSlug}-5`];

    for (const slug of candidates) {
      try {
        const [created] = await this.db.transaction(async (tx) => {
          const [ws] = await tx
            .insert(workspaces)
            .values({ name: input.name, mode: input.mode, slug })
            .returning({
              id: workspaces.id,
              name: workspaces.name,
              slug: workspaces.slug,
              mode: workspaces.mode,
            });
          if (!ws) {
            throw new Error('Workspace insert returned no row');
          }
          await tx.insert(memberships).values({ workspaceId: ws.id, userId, roleKey: 'owner' });
          return [ws];
        });
        if (created) {
          await writeAuditLog(this.db, {
            workspaceId: created.id,
            actorId: userId,
            action: 'workspace.created',
            resource: 'workspace',
            resourceId: created.id,
            metadata: { slug: created.slug, mode: created.mode },
          });
          return {
            id: created.id,
            name: created.name,
            slug: created.slug,
            mode: created.mode,
            role: 'owner' as const,
          };
        }
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
      }
    }
    throw httpCode(
      HttpStatus.CONFLICT,
      `Slug '${baseSlug}' is already taken. Try '${baseSlug}-2'.`,
      'SLUG_TAKEN',
    );
  }

  async get(ctx: WorkspaceContext) {
    const [ws] = await this.db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        mode: workspaces.mode,
        slug: workspaces.slug,
        settings: workspaces.settingsJson,
        createdAt: workspaces.createdAt,
      })
      .from(workspaces)
      .where(eq(workspaces.id, ctx.workspaceId))
      .limit(1);
    if (!ws) {
      throw httpCode(HttpStatus.NOT_FOUND, 'Workspace not found', 'WORKSPACE_NOT_FOUND');
    }
    const memberCountRow = await this.db
      .select({ value: sql<number>`count(*)::int` })
      .from(memberships)
      .where(and(eq(memberships.workspaceId, ctx.workspaceId), eq(memberships.status, 'active')));
    const memberCount = memberCountRow[0]?.value ?? 0;
    return { ...ws, role: ctx.role, memberCount };
  }

  async update(ctx: WorkspaceContext, actorId: string, input: UpdateWorkspaceInput) {
    const updates: Record<string, unknown> = {};
    if (input.name !== undefined) updates.name = input.name;
    if (input.mode !== undefined) updates.mode = input.mode;
    if (input.settings !== undefined) updates.settingsJson = input.settings;
    const [updated] = await this.db
      .update(workspaces)
      .set(updates)
      .where(eq(workspaces.id, ctx.workspaceId))
      .returning({ id: workspaces.id, name: workspaces.name, mode: workspaces.mode, slug: workspaces.slug });
    if (!updated) {
      throw httpCode(HttpStatus.NOT_FOUND, 'Workspace not found', 'WORKSPACE_NOT_FOUND');
    }
    await writeAuditLog(this.db, {
      workspaceId: ctx.workspaceId,
      actorId,
      action: 'workspace.updated',
      resource: 'workspace',
      resourceId: updated.id,
      metadata: { fields: Object.keys(input) },
    });
    return { ...updated, role: ctx.role };
  }

  async listMembers(ctx: WorkspaceContext) {
    return this.db
      .select({
        userId: memberships.userId,
        membershipId: memberships.id,
        displayName: users.displayName,
        email: users.email,
        role: memberships.roleKey,
        status: memberships.status,
        joinedAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.workspaceId, ctx.workspaceId))
      .orderBy(memberships.createdAt);
  }

  async createInvite(ctx: WorkspaceContext, actorId: string, input: CreateInviteInput) {
    // Supersede any pending invite for the same email (partial unique index).
    await this.db
      .update(workspaceInvites)
      .set({ status: 'revoked', revokedAt: new Date() })
      .where(
        and(
          eq(workspaceInvites.workspaceId, ctx.workspaceId),
          sql`lower(${workspaceInvites.email}) = ${input.email}`,
          eq(workspaceInvites.status, 'pending'),
        ),
      );

    const token = generateToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    const [created] = await this.db
      .insert(workspaceInvites)
      .values({
        workspaceId: ctx.workspaceId,
        email: input.email,
        roleKey: input.roleKey,
        tokenHash: sha256Hex(token),
        expiresAt,
        invitedBy: actorId,
      })
      .returning({ id: workspaceInvites.id });
    if (!created) {
      throw httpCode(HttpStatus.INTERNAL_SERVER_ERROR, 'Could not create invite', 'INVITE_FAILED');
    }
    await writeAuditLog(this.db, {
      workspaceId: ctx.workspaceId,
      actorId,
      action: 'invite.created',
      resource: 'workspace_invite',
      resourceId: created.id,
      metadata: { roleKey: input.roleKey },
    });
    const acceptUrl = `${this.config.PUBLIC_APP_URL}/accept-invite?token=${token}`;
    return { inviteId: created.id, email: input.email, roleKey: input.roleKey, expiresAt, acceptUrl };
  }

  async listInvites(ctx: WorkspaceContext) {
    const rows = await this.db
      .select({
        id: workspaceInvites.id,
        email: workspaceInvites.email,
        roleKey: workspaceInvites.roleKey,
        status: workspaceInvites.status,
        expiresAt: workspaceInvites.expiresAt,
        createdAt: workspaceInvites.createdAt,
      })
      .from(workspaceInvites)
      .where(eq(workspaceInvites.workspaceId, ctx.workspaceId))
      .orderBy(desc(workspaceInvites.createdAt))
      .limit(50);
    return rows;
  }

  async revokeInvite(ctx: WorkspaceContext, actorId: string, inviteId: string) {
    const result = await this.db
      .update(workspaceInvites)
      .set({ status: 'revoked', revokedAt: new Date() })
      .where(and(eq(workspaceInvites.id, inviteId), eq(workspaceInvites.workspaceId, ctx.workspaceId)))
      .returning({ id: workspaceInvites.id });
    if (result.length === 0) {
      throw httpCode(HttpStatus.NOT_FOUND, 'Invite not found', 'INVITE_NOT_FOUND');
    }
    await writeAuditLog(this.db, {
      workspaceId: ctx.workspaceId,
      actorId,
      action: 'invite.revoked',
      resource: 'workspace_invite',
      resourceId: inviteId,
    });
    return { ok: true };
  }

  async changeRole(ctx: WorkspaceContext, actorId: string, targetUserId: string, input: ChangeRoleInput) {
    if (!/^[0-9a-f-]{36}$/i.test(targetUserId)) {
      throw httpCode(HttpStatus.NOT_FOUND, 'Member not found', 'MEMBER_NOT_FOUND');
    }
    const [target] = await this.db
      .select({ roleKey: memberships.roleKey, membershipId: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.workspaceId, ctx.workspaceId),
          eq(memberships.userId, targetUserId),
          eq(memberships.status, 'active'),
        ),
      )
      .limit(1);
    if (!target) {
      throw httpCode(HttpStatus.NOT_FOUND, 'Member not found', 'MEMBER_NOT_FOUND');
    }

    // Authorization matrix: only owners grant/revoke owner or touch admins;
    // admins may manage manager/member/auditor only and never grant admin/owner.
    const grantingOwner = input.roleKey === 'owner';
    if (grantingOwner && ctx.role !== 'owner') {
      throw httpCode(
        HttpStatus.FORBIDDEN,
        'Only an owner can grant the owner role',
        'OWNER_TRANSFER_REQUIRED',
      );
    }
    if (
      ctx.role === 'admin' &&
      (target.roleKey === 'admin' || target.roleKey === 'owner' || input.roleKey === 'admin')
    ) {
      throw httpCode(
        HttpStatus.FORBIDDEN,
        'Admins cannot modify owner or admin members',
        'INSUFFICIENT_SCOPE',
      );
    }
    if (ctx.role !== 'owner' && ctx.role !== 'admin') {
      throw httpCode(HttpStatus.FORBIDDEN, 'Insufficient workspace permissions', 'INSUFFICIENT_SCOPE');
    }

    if (target.roleKey === 'owner' && input.roleKey !== 'owner') {
      const otherOwnersRow = await this.db
        .select({ value: sql<number>`count(*)::int` })
        .from(memberships)
        .where(
          and(
            eq(memberships.workspaceId, ctx.workspaceId),
            eq(memberships.roleKey, 'owner'),
            eq(memberships.status, 'active'),
          ),
        );
      if ((otherOwnersRow[0]?.value ?? 0) <= 1) {
        throw httpCode(HttpStatus.CONFLICT, 'A workspace must keep at least one owner', 'LAST_OWNER');
      }
    }

    await this.db
      .update(memberships)
      .set({ roleKey: input.roleKey, updatedAt: new Date() })
      .where(eq(memberships.id, target.membershipId));

    await writeAuditLog(this.db, {
      workspaceId: ctx.workspaceId,
      actorId,
      action: 'member.role_changed',
      resource: 'membership',
      resourceId: target.membershipId,
      metadata: { from: target.roleKey, to: input.roleKey, targetUserId },
    });
    return { ok: true, userId: targetUserId, role: input.roleKey };
  }

  async removeMember(ctx: WorkspaceContext, actorId: string, targetUserId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(targetUserId)) {
      throw httpCode(HttpStatus.NOT_FOUND, 'Member not found', 'MEMBER_NOT_FOUND');
    }
    const [target] = await this.db
      .select({ roleKey: memberships.roleKey, membershipId: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.workspaceId, ctx.workspaceId),
          eq(memberships.userId, targetUserId),
          eq(memberships.status, 'active'),
        ),
      )
      .limit(1);
    if (!target) {
      throw httpCode(HttpStatus.NOT_FOUND, 'Member not found', 'MEMBER_NOT_FOUND');
    }

    const actorIsOwner = ctx.role === 'owner';
    const actorIsAdmin = ctx.role === 'admin';
    const targetIsProtected = target.roleKey === 'owner' || target.roleKey === 'admin';
    if (!actorIsOwner && !(actorIsAdmin && !targetIsProtected)) {
      throw httpCode(HttpStatus.FORBIDDEN, 'Insufficient workspace permissions', 'INSUFFICIENT_SCOPE');
    }
    if (target.roleKey === 'owner') {
      const otherOwnersRow = await this.db
        .select({ value: sql<number>`count(*)::int` })
        .from(memberships)
        .where(
          and(
            eq(memberships.workspaceId, ctx.workspaceId),
            eq(memberships.roleKey, 'owner'),
            eq(memberships.status, 'active'),
          ),
        );
      if ((otherOwnersRow[0]?.value ?? 0) <= 1) {
        throw httpCode(HttpStatus.CONFLICT, 'A workspace must keep at least one owner', 'LAST_OWNER');
      }
    }

    // Suspend instead of delete: keeps custody history and asset references intact.
    await this.db
      .update(memberships)
      .set({ status: 'suspended', updatedAt: new Date() })
      .where(eq(memberships.id, target.membershipId));

    // Revoke any outstanding sessions of the removed member is intentionally NOT done here:
    // sessions are global (not per-workspace); the member simply loses workspace access.
    await writeAuditLog(this.db, {
      workspaceId: ctx.workspaceId,
      actorId,
      action: 'member.removed',
      resource: 'membership',
      resourceId: target.membershipId,
      metadata: { targetUserId, previousRole: target.roleKey },
    });
    return { ok: true };
  }

  /** Accept an invite: creates the account if needed, adds membership, opens a session. */
  async acceptInvite(token: string, displayName: string, password: string, meta: RequestMeta) {
    const tokenHash = sha256Hex(token);
    const [invite] = await this.db
      .select({
        id: workspaceInvites.id,
        workspaceId: workspaceInvites.workspaceId,
        email: workspaceInvites.email,
        roleKey: workspaceInvites.roleKey,
        expiresAt: workspaceInvites.expiresAt,
      })
      .from(workspaceInvites)
      .where(and(eq(workspaceInvites.tokenHash, tokenHash), eq(workspaceInvites.status, 'pending')))
      .limit(1);
    if (!invite) {
      throw httpCode(
        HttpStatus.BAD_REQUEST,
        'This invite link is invalid or has already been used',
        'INVITE_INVALID',
      );
    }
    if (invite.expiresAt <= new Date()) {
      throw httpCode(HttpStatus.BAD_REQUEST, 'This invite link has expired', 'INVITE_EXPIRED');
    }

    // Single-use: claim the invite before doing any work.
    const claimed = await this.db
      .update(workspaceInvites)
      .set({ status: 'accepted', acceptedAt: new Date() })
      .where(and(eq(workspaceInvites.id, invite.id), eq(workspaceInvites.status, 'pending')))
      .returning({ id: workspaceInvites.id });
    if (claimed.length === 0) {
      throw httpCode(HttpStatus.BAD_REQUEST, 'This invite link has already been used', 'INVITE_INVALID');
    }

    const [existing] = await this.db
      .select({ id: users.id, displayName: users.displayName, passwordHash: users.passwordHash })
      .from(users)
      .where(sql`lower(${users.email}) = ${invite.email}`)
      .limit(1);

    let userId: string;
    if (existing) {
      const matches = existing.passwordHash
        ? await argon2.verify(existing.passwordHash, password).catch(() => false)
        : false;
      if (!matches) {
        throw httpCode(
          HttpStatus.UNAUTHORIZED,
          'An account with this email already exists — sign in instead',
          'INVALID_CREDENTIALS',
        );
      }
      userId = existing.id;
    } else {
      const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
      const [created] = await this.db
        .insert(users)
        .values({ email: invite.email, displayName, passwordHash })
        .returning({ id: users.id });
      if (!created) {
        throw httpCode(HttpStatus.INTERNAL_SERVER_ERROR, 'Could not create account', 'ACCOUNT_FAILED');
      }
      userId = created.id;
    }

    const [membership] = await this.db
      .select({ id: memberships.id, status: memberships.status, roleKey: memberships.roleKey })
      .from(memberships)
      .where(and(eq(memberships.workspaceId, invite.workspaceId), eq(memberships.userId, userId)))
      .limit(1);

    if (membership?.status === 'active') {
      throw httpCode(HttpStatus.CONFLICT, 'You are already a member of this workspace', 'ALREADY_MEMBER');
    }
    if (membership) {
      await this.db
        .update(memberships)
        .set({ status: 'active', roleKey: invite.roleKey, updatedAt: new Date() })
        .where(eq(memberships.id, membership.id));
    } else {
      await this.db
        .insert(memberships)
        .values({ workspaceId: invite.workspaceId, userId, roleKey: invite.roleKey, status: 'active' });
    }

    await writeAuditLog(this.db, {
      workspaceId: invite.workspaceId,
      actorId: userId,
      action: 'invite.accepted',
      resource: 'workspace_invite',
      resourceId: invite.id,
      metadata: { roleKey: invite.roleKey },
    });

    const workspacesList = await this.authService.listWorkspaces(userId);
    const publicUser = await this.db
      .select({ id: users.id, email: users.email, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const session = await this.authService.createSessionFor(publicUser[0]!, meta);
    return {
      user: publicUser[0]!,
      workspaces: workspacesList,
      csrfToken: session.csrfToken,
      sessionToken: session.sessionToken,
    };
  }

  async listAuditLog(ctx: WorkspaceContext, limit: number, offset: number) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safeOffset = Math.max(offset, 0);
    return this.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.workspaceId, ctx.workspaceId))
      .orderBy(desc(auditLog.occurredAt))
      .limit(safeLimit)
      .offset(safeOffset);
  }
}
