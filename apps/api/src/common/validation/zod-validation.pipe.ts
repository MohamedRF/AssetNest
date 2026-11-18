import { Injectable, type PipeTransform } from '@nestjs/common';
import type { z, ZodType } from 'zod';

/**
 * Validates and coerces an inbound value (body / params / query) against a
 * Zod schema. On failure throws the ZodError, which the global
 * ProblemDetailsFilter maps to a 400 problem-details response.
 */
@Injectable()
export class ZodValidationPipe<T extends ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw result.error;
    }
    return result.data;
  }
}
