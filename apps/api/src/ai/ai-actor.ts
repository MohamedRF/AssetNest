import { z } from 'zod';
import type { PublicUser } from '../auth/auth.service.js';

/** Automation tokens retain their scopes even if their user has been removed. */
export function aiAuditActorId(user: PublicUser): string | null {
  const actorId = z.uuid().safeParse(user.id);
  return actorId.success ? actorId.data : null;
}
