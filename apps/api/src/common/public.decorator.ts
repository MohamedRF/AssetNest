import { SetMetadata } from '@nestjs/common';

/** Marks a route/controller as not requiring an authenticated session. */
export const IS_PUBLIC_KEY = 'assetnest:isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
