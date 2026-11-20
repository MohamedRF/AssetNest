import { ApiDefaultResponse, type SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';

export function openApiSchema(schema: z.ZodType, io: 'input' | 'output' = 'output'): SchemaObject {
  return z.toJSONSchema(schema, { target: 'openapi-3.0', io }) as SchemaObject;
}

export const ApiProblemResponse = () =>
  ApiDefaultResponse({
    description: 'Error with a machine-readable code and request ID',
    schema: openApiSchema(
      z.object({
        type: z.literal('about:blank'),
        title: z.string(),
        status: z.int(),
        detail: z.string(),
        instance: z.string(),
        code: z.string(),
        requestId: z.string(),
      }),
    ),
  });
