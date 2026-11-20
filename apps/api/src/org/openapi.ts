import { z } from 'zod';
import { openApiSchema } from '../common/openapi.js';
import { LOCATION_TYPES, createVendorSchema } from './dto.js';

const orgResource = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  name: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const category = orgResource.extend({
  description: z.string().nullable(),
  schemaJson: z.record(z.string(), z.unknown()),
});

const location = orgResource.extend({
  parentId: z.uuid().nullable(),
  type: z.enum(LOCATION_TYPES),
  path: z.string(),
});

const vendor = orgResource.extend({
  contactJson: createVendorSchema.shape.contact.unwrap(),
  notes: z.string().nullable(),
});

export const categoryResponse = openApiSchema(category);
export const listCategoriesResponse = openApiSchema(z.object({ categories: z.array(category) }));
export const locationResponse = openApiSchema(location);
export const listLocationsResponse = openApiSchema(z.object({ locations: z.array(location) }));
export const vendorResponse = openApiSchema(vendor);
export const listVendorsResponse = openApiSchema(z.object({ vendors: z.array(vendor) }));
