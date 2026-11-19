import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { apiTokens } from '@assetnest/db';
import type { Database } from '@assetnest/db';
import type { McpTokenVerifier } from '@nestjs/mcp';
import type { AuthInfo } from '@modelcontextprotocol/server';
import type { AppConfig } from '@assetnest/config';
import { APP_CONFIG, DATABASE } from '../common/tokens.js';
import { sha256Hex } from '../common/crypto.js';

export interface AssetNestMcpAuthExtra {
  workspaceId: string;
  ownerId: string;
  tokenId: string;
}

export const MCP_RESOURCE_PATH = '/api/v1/mcp';

/**
 * MCP "OAuth resource server" backed by AssetNest's own first-party API
 * tokens (`anst_...`). Tokens are opaque, sha256-hashed at rest,
 * workspace-bound and scope-carrying — exactly what an automation client
 * needs over MCP. Clients obtain one from the Integrations UI.
 *
 * `resource` is the canonical URI of the /mcp endpoint; tokens issued for a
 * different audience are not accepted.
 */
@Injectable()
export class AssetNestMcpVerifier implements McpTokenVerifier {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Canonical MCP resource URI — also the `resource` clients pass to RFC 8707-aware connectors. */
  static resourceFor(config: AppConfig): string {
    const origin = new URL(config.PUBLIC_APP_URL).origin;
    return `${origin}${MCP_RESOURCE_PATH}`;
  }

  async verifyAccessToken(token: string): Promise<AuthInfo | null> {
    if (!token.startsWith('anst_')) {
      return null;
    }
    const [row] = await this.db
      .select({
        id: apiTokens.id,
        workspaceId: apiTokens.workspaceId,
        ownerId: apiTokens.ownerId,
        scopesJson: apiTokens.scopesJson,
        expiresAt: apiTokens.expiresAt,
        revokedAt: apiTokens.revokedAt,
        lastUsedAt: apiTokens.lastUsedAt,
      })
      .from(apiTokens)
      .where(eq(apiTokens.tokenHash, sha256Hex(token)))
      .limit(1);

    if (!row || row.revokedAt !== null) {
      return null;
    }
    if (row.expiresAt !== null && row.expiresAt <= new Date()) {
      return null;
    }
    const scopes = Array.isArray(row.scopesJson) ? (row.scopesJson as string[]) : [];

    // Throttle last_used_at to one write per minute per token.
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
      void this.db
        .update(apiTokens)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiTokens.id, row.id))
        .execute()
        .catch(() => undefined);
    }

    return {
      token,
      clientId: `assetnest-api-token:${row.id}`,
      scopes,
      expiresAt: row.expiresAt
        ? Math.floor(row.expiresAt.getTime() / 1000)
        : Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365 * 100,
      resource: new URL(AssetNestMcpVerifier.resourceFor(this.config)),
      extra: {
        workspaceId: row.workspaceId,
        ownerId: row.ownerId ?? 'unattributed',
        tokenId: row.id,
      } satisfies AssetNestMcpAuthExtra,
    };
  }
}
