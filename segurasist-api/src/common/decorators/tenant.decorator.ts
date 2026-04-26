import type { ExecutionContext } from '@nestjs/common';
import { createParamDecorator } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

export interface TenantCtx {
  id: string;
  slug?: string;
}

export const Tenant = createParamDecorator((_data: unknown, ctx: ExecutionContext): TenantCtx => {
  const req = ctx.switchToHttp().getRequest<FastifyRequest & { tenant?: TenantCtx }>();
  if (!req.tenant) {
    throw new Error('Tenant decorator used without JwtAuthGuard');
  }
  return req.tenant;
});
