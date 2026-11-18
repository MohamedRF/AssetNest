import { z } from 'zod';

/** Password policy: NIST 800-63 style — long passphrases allowed, no composition rules. */
export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((v) => v.trim().length >= 12, 'Password must not be mostly whitespace');

export const emailSchema = z
  .email('Enter a valid email address')
  .max(254)
  .transform((v) => v.trim().toLowerCase());

export const registerSchema = z.object({
  displayName: z.string().trim().min(1, 'Display name is required').max(120),
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;
