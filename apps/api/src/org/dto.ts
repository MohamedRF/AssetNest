import { z } from 'zod';

export const LOCATION_TYPES = ['building', 'floor', 'room', 'shelf', 'area', 'other'] as const;

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'Category name is required').max(120),
  description: z.string().trim().max(500).optional(),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = createCategorySchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'At least one field must be provided');
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

export const createLocationSchema = z.object({
  name: z.string().trim().min(1, 'Location name is required').max(120),
  type: z.enum(LOCATION_TYPES).default('room'),
  parentId: z.uuid().nullable().optional(),
});
export type CreateLocationInput = z.infer<typeof createLocationSchema>;

export const updateLocationSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    type: z.enum(LOCATION_TYPES).optional(),
    parentId: z.uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'At least one field must be provided');
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;

export const createVendorSchema = z.object({
  name: z.string().trim().min(1, 'Vendor name is required').max(200),
  contact: z
    .object({
      phone: z.string().trim().max(60).optional(),
      email: z.string().trim().max(254).optional(),
      url: z.string().trim().max(500).optional(),
    })
    .strict()
    .optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type CreateVendorInput = z.infer<typeof createVendorSchema>;

export const updateVendorSchema = createVendorSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'At least one field must be provided');
export type UpdateVendorInput = z.infer<typeof updateVendorSchema>;
