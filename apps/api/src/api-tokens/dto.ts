import { z } from 'zod';
import { PERMISSIONS } from '@assetnest/domain';

export const createTokenSchema = z.object({
  name: z.string().trim().min(1, 'Token name is required').max(120),
  scopes: z.array(z.enum(PERMISSIONS)).min(1, 'Select at least one scope').max(PERMISSIONS.length),
  // Days until expiry; null means no expiry. Default 90.
  expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),
});
export type CreateTokenInput = z.infer<typeof createTokenSchema>;
