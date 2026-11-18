import { describe, expect, it } from 'vitest';
import { z, ZodError } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe.js';

describe('ZodValidationPipe', () => {
  const schema = z.object({
    name: z.string().min(2),
    quantity: z.coerce.number().int().positive().default(1),
  });
  const pipe = new ZodValidationPipe(schema);

  it('returns the parsed value for valid input', () => {
    const result = pipe.transform({ name: 'Laptop', quantity: '3' });
    expect(result).toEqual({ name: 'Laptop', quantity: 3 });
  });

  it('applies defaults for missing optional fields', () => {
    const result = pipe.transform({ name: 'Laptop' });
    expect(result).toEqual({ name: 'Laptop', quantity: 1 });
  });

  it('throws a ZodError for invalid input', () => {
    expect(() => pipe.transform({ name: '' })).toThrow(ZodError);
    expect(() => pipe.transform(null)).toThrow(ZodError);
    expect(() => pipe.transform({ name: 'x', quantity: -1 })).toThrow(ZodError);
  });

  it('reports the failing path in the error issues', () => {
    try {
      pipe.transform({ name: '' });
      throw new Error('transform should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError);
      if (error instanceof ZodError) {
        const paths = error.issues.map((issue) => issue.path.join('.'));
        expect(paths).toContain('name');
      }
    }
  });
});
