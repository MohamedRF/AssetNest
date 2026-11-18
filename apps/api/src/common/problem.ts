import { HttpException, HttpStatus } from '@nestjs/common';

/** Problem-details exception with a stable machine code (see ProblemDetailsFilter). */
export function httpCode(status: HttpStatus, message: string, code: string): HttpException {
  return new HttpException({ message, code }, status);
}

/** Walk the drizzle/driver cause chain looking for PG error code 23505 (unique_violation). */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if ((current as { code?: unknown }).code === '23505') {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
