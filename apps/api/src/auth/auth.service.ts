import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { AppConfig } from '@assetnest/config';
import { users, sessions, memberships, workspaces } from '@assetnest/db';
import type { Database } from '@assetnest/db';
import { APP_CONFIG, DATABASE } from '../common/tokens.js';
import { generateToken, sha256Hex } from '../common/crypto.js';
import { deriveCsrfToken } from '../common/csrf.js';
import { LOCKOUT_MINUTES, MAX_FAILED_ATTEMPTS, SESSION_TTL_SECONDS } from './auth.constants.js';
import type { LoginInput, RegisterInput } from './dto.js';

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  mode: string;
  slug: string;
  role: string;
}

export interface AuthResult {
  user: PublicUser;
  workspaces: WorkspaceSummary[];
  sessionToken: string;
  csrfToken: string;
  sessionId: string;
  expiresAt: Date;
}

export interface RequestMeta {
  ip?: string;
  userAgent?: string | undefined;
}

/** Precomputed argon2id hash used to equalize timing for unknown accounts. */
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$7QdJ0m6LzEjTjWX1tVfB0EwA0xY8p5oYcYf3ZqJQ7wE';

function authException(status: HttpStatus, message: string, code: string): HttpException {
  return new HttpException({ message, code }, status);
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async countUsers(): Promise<number> {
    const [row] = await this.db.select({ count: sql<number>`count(*)::int` }).from(users);
    return row?.count ?? 0;
  }

  /** First-user bootstrap: allowed only while the users table is empty. */
  async registerBootstrap(input: RegisterInput, meta: RequestMeta): Promise<AuthResult> {
    if ((await this.countUsers()) > 0) {
      throw authException(
        HttpStatus.FORBIDDEN,
        'Registration is closed. Ask a workspace administrator for an invitation.',
        'REGISTRATION_CLOSED',
      );
    }
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const [created] = await this.db
      .insert(users)
      .values({ email: input.email, displayName: input.displayName, passwordHash })
      .returning({ id: users.id, email: users.email, displayName: users.displayName });
    if (!created) {
      throw authException(HttpStatus.INTERNAL_SERVER_ERROR, 'Could not create account', 'BOOTSTRAP_FAILED');
    }
    return this.createSession(created, meta);
  }

  async login(input: LoginInput, meta: RequestMeta): Promise<AuthResult> {
    const [user] = await this.db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        passwordHash: users.passwordHash,
        status: users.status,
        failedLoginAttempts: users.failedLoginAttempts,
        lockedUntil: users.lockedUntil,
      })
      .from(users)
      .where(sql`lower(${users.email}) = ${input.email}`)
      .limit(1);

    const isLocked =
      user?.lockedUntil !== null && user?.lockedUntil !== undefined && user.lockedUntil > new Date();

    // Constant-ish timing: always run an argon2 verify, even for unknown accounts.
    const hashToVerify = user?.passwordHash ?? DUMMY_HASH;
    const passwordMatches = await argon2.verify(hashToVerify, input.password).catch(() => false);

    if (!user || user.status !== 'active' || !passwordMatches) {
      if (user) {
        await this.registerFailedAttempt(user.id, user.failedLoginAttempts);
      }
      throw authException(HttpStatus.UNAUTHORIZED, 'Invalid email or password', 'INVALID_CREDENTIALS');
    }
    if (isLocked) {
      throw authException(
        HttpStatus.FORBIDDEN,
        'Account temporarily locked due to repeated failed sign-ins. Try again later.',
        'ACCOUNT_LOCKED',
      );
    }

    // Success — reset the failure counter.
    if (user.failedLoginAttempts > 0) {
      await this.db
        .update(users)
        .set({ failedLoginAttempts: 0, lockedUntil: null })
        .where(eq(users.id, user.id));
    }

    return this.createSession({ id: user.id, email: user.email, displayName: user.displayName }, meta);
  }

  private async registerFailedAttempt(userId: string, currentAttempts: number): Promise<void> {
    const attempts = currentAttempts + 1;
    const lock = attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null;
    await this.db
      .update(users)
      .set({ failedLoginAttempts: attempts, ...(lock ? { lockedUntil: lock } : {}) })
      .where(eq(users.id, userId));
  }

  private async createSession(user: PublicUser, meta: RequestMeta): Promise<AuthResult> {
    const sessionToken = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
    const [inserted] = await this.db
      .insert(sessions)
      .values({
        userId: user.id,
        tokenHash: sha256Hex(sessionToken),
        expiresAt,
        lastSeenAt: new Date(),
        userAgent: meta.userAgent?.slice(0, 255) ?? null,
        ip: meta.ip?.slice(0, 64) ?? null,
      })
      .returning({ id: sessions.id });
    const workspacesList = await this.listWorkspaces(user.id);
    return {
      user,
      workspaces: workspacesList,
      sessionToken,
      csrfToken: deriveCsrfToken(sessionToken, this.config.SESSION_SECRET),
      sessionId: inserted?.id ?? '',
      expiresAt,
    };
  }

  /** Public entry point for trusted flows (e.g. invite acceptance after identity checks). */
  async createSessionFor(user: PublicUser, meta: RequestMeta): Promise<AuthResult> {
    return this.createSession(user, meta);
  }

  async listWorkspaces(userId: string): Promise<WorkspaceSummary[]> {
    const rows = await this.db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        mode: workspaces.mode,
        slug: workspaces.slug,
        role: memberships.roleKey,
      })
      .from(memberships)
      .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
      .where(and(eq(memberships.userId, userId), eq(memberships.status, 'active')));
    return rows;
  }

  /** Sessions listed for the account page; never the token hash. */
  async listSessions(userId: string, currentSessionId: string | null) {
    const rows = await this.db
      .select({
        id: sessions.id,
        createdAt: sessions.createdAt,
        expiresAt: sessions.expiresAt,
        lastSeenAt: sessions.lastSeenAt,
        userAgent: sessions.userAgent,
        revokedAt: sessions.revokedAt,
      })
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .orderBy(desc(sessions.createdAt))
      .limit(50);
    return rows.map((row) => ({ ...row, isCurrent: row.id === currentSessionId }));
  }

  async revokeOwnSession(userId: string, sessionId: string): Promise<void> {
    const result = await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    if (result.length === 0) {
      throw authException(HttpStatus.NOT_FOUND, 'Session not found', 'SESSION_NOT_FOUND');
    }
  }

  async logout(sessionId: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
  }

  /** Validate an opaque session token; returns null for anything invalid. */
  async validateSessionToken(
    sessionToken: string,
  ): Promise<{ user: PublicUser; sessionId: string; sessionToken: string } | null> {
    const tokenHash = sha256Hex(sessionToken);
    const [row] = await this.db
      .select({
        sessionId: sessions.id,
        userId: users.id,
        email: users.email,
        displayName: users.displayName,
        userStatus: users.status,
        expiresAt: sessions.expiresAt,
        revokedAt: sessions.revokedAt,
        lastSeenAt: sessions.lastSeenAt,
        createdAt: sessions.createdAt,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);

    const now = Date.now();
    if (!row || row.revokedAt || row.expiresAt <= new Date(now) || row.userStatus !== 'active') {
      return null;
    }
    // Session hardening (P6-04): idle timeout and absolute lifetime. A session
    // that exceeds either bound is revoked and rejected, not silently renewed.
    const idleMs = this.config.SESSION_IDLE_TIMEOUT_MINUTES * 60_000;
    const absoluteMs = this.config.SESSION_ABSOLUTE_TIMEOUT_HOURS * 3_600_000;
    const lastActivity = (row.lastSeenAt ?? row.createdAt).getTime();
    const idleExpired = idleMs > 0 && now - lastActivity >= idleMs;
    const absoluteExpired = absoluteMs > 0 && now - row.createdAt.getTime() >= absoluteMs;
    if (idleExpired || absoluteExpired) {
      await this.db
        .update(sessions)
        .set({ revokedAt: new Date(now) })
        .where(eq(sessions.id, row.sessionId));
      return null;
    }
    const touchInterval = idleMs > 0 ? Math.min(60_000, idleMs / 2) : 60_000;
    if (!row.lastSeenAt || now - lastActivity >= touchInterval) {
      await this.db
        .update(sessions)
        .set({ lastSeenAt: new Date(now) })
        .where(
          and(
            eq(sessions.id, row.sessionId),
            isNull(sessions.revokedAt),
            row.lastSeenAt ? eq(sessions.lastSeenAt, row.lastSeenAt) : isNull(sessions.lastSeenAt),
          ),
        );
    }
    return {
      user: { id: row.userId, email: row.email, displayName: row.displayName },
      sessionId: row.sessionId,
      sessionToken,
    };
  }
}
