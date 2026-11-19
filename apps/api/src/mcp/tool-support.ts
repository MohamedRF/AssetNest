import { HttpException } from '@nestjs/common';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { McpContext } from '@nestjs/mcp';
import type { Database } from '@assetnest/db';
import type { WorkspaceContext } from '../auth/workspace.guard.js';
import { writeAuditLog } from '../common/audit.js';
import type { AssetNestMcpAuthExtra } from './mcp-verifier.js';

export interface AutomationIdentity {
  /** Service-layer workspace context with role 'automation'. */
  wsCtx: WorkspaceContext;
  /** Token owner's user id, or null when the owner account was deleted. */
  actorId: string | null;
  /** The api token row id — for audit attribution and rate limiting. */
  tokenId: string;
}

/**
 * Resolves and validates the automation identity for an MCP call.
 * Requires the verifier to have bound the call to a workspace — with
 * `auth` configured on the module, an unauthenticated call never reaches a tool.
 */
export function automationIdentity(ctx: McpContext): AutomationIdentity {
  const auth = ctx.authInfo;
  const extra = auth?.extra as Partial<AssetNestMcpAuthExtra> | undefined;
  if (!auth || typeof extra?.workspaceId !== 'string' || extra.workspaceId.length === 0) {
    throw new Error('Unauthorized: MCP call is not bound to a workspace');
  }
  return {
    wsCtx: { workspaceId: extra.workspaceId, membershipId: '', role: 'automation' },
    actorId: typeof extra.ownerId === 'string' && extra.ownerId.length > 0 ? extra.ownerId : null,
    tokenId: typeof extra.tokenId === 'string' ? extra.tokenId : 'unknown',
  };
}

/**
 * Tool execution errors go back as `isError: true` results so the model can
 * self-correct — per the MCP spec, protocol errors are for structural
 * failures only (SDK handles those before the handler runs).
 */
export function toolError(error: unknown): CallToolResult {
  let message = 'Internal error';
  if (error instanceof HttpException) {
    const body = error.getResponse() as unknown;
    if (typeof body === 'string') {
      message = body;
    } else if (typeof body === 'object' && body !== null) {
      const record = body as Record<string, unknown>;
      message = String(record['message'] ?? record['title'] ?? error.message);
    } else {
      message = error.message;
    }
  } else if (error instanceof Error) {
    message = error.message;
  }
  return { content: [{ type: 'text', text: message.slice(0, 1000) }], isError: true };
}

/** Wraps a tool body, mapping service HttpExceptions to isError results. */
export async function invoke<T>(fn: () => Promise<T>): Promise<T | CallToolResult> {
  try {
    return await fn();
  } catch (error) {
    return toolError(error);
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One audit row per mutating MCP tool call (`mcp.invoke`), on top of the
 * audit entries the domain services already write — makes automation
 * activity distinguishable and attributable to a token.
 */
export async function auditMcpInvocation(
  db: Database,
  ctx: McpContext,
  identity: AutomationIdentity,
  tool: string,
): Promise<void> {
  await writeAuditLog(db, {
    workspaceId: identity.wsCtx.workspaceId,
    actorId: identity.actorId,
    action: 'mcp.invoke',
    resource: tool,
    metadata: { tool, tokenId: identity.tokenId, era: ctx.era },
  });
}
