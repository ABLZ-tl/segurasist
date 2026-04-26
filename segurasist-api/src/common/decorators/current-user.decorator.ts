import type { ExecutionContext } from '@nestjs/common';
import { createParamDecorator } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

export interface AuthUser {
  id: string;
  cognitoSub: string;
  email: string;
  role: string;
  scopes: string[];
  mfaEnrolled: boolean;
  /**
   * Cognito user-pool de origen del token validado (defensa en profundidad
   * H3). El `RolesGuard` puede usarlo para rechazar privilege escalation
   * cross-pool: un token con `custom:role=admin_segurasist` pero
   * `pool=insured` no debe poder operar como admin.
   */
  pool?: 'admin' | 'insured';
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<FastifyRequest & { user?: AuthUser }>();
  if (!req.user) {
    throw new Error('CurrentUser used without JwtAuthGuard');
  }
  return req.user;
});
