import { ENV_TOKEN } from '@config/config.module';
import { Env } from '@config/env.schema';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyRequest } from 'fastify';
import { JWTPayload, createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { AuthUser } from '../decorators/current-user.decorator';
import { PUBLIC_KEY } from '../decorators/roles.decorator';
import { TenantCtx } from '../decorators/tenant.decorator';

interface CognitoClaims extends JWTPayload {
  sub: string;
  email?: string;
  'custom:tenant_id'?: string;
  'custom:role'?: string;
  scope?: string;
  token_use?: 'access' | 'id';
  client_id?: string;
}

// Cache de JWKS por user-pool (24h con stale-while-revalidate, gestionado por jose).
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly jwks: JWTVerifyGetKey;
  private readonly issuer: string;
  private readonly insuredIssuer: string;
  private readonly insuredJwks: JWTVerifyGetKey;

  constructor(
    @Inject(ENV_TOKEN) env: Env,
    private readonly reflector: Reflector,
  ) {
    // En dev local con cognito-local: COGNITO_ENDPOINT=http://localhost:9229
    // → issuer http://localhost:9229/<pool_id>, JWKS http://localhost:9229/<pool_id>/.well-known/jwks.json.
    // En prod: ausente → issuer https://cognito-idp.<region>.amazonaws.com/<pool_id>.
    const base = env.COGNITO_ENDPOINT
      ? env.COGNITO_ENDPOINT.replace(/\/$/, '')
      : `https://cognito-idp.${env.COGNITO_REGION}.amazonaws.com`;
    this.issuer = `${base}/${env.COGNITO_USER_POOL_ID_ADMIN}`;
    this.insuredIssuer = `${base}/${env.COGNITO_USER_POOL_ID_INSURED}`;
    this.jwks = createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`), {
      cacheMaxAge: 24 * 60 * 60 * 1000,
      cooldownDuration: 30_000,
    });
    this.insuredJwks = createRemoteJWKSet(new URL(`${this.insuredIssuer}/.well-known/jwks.json`), {
      cacheMaxAge: 24 * 60 * 60 * 1000,
      cooldownDuration: 30_000,
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<FastifyRequest & { user?: AuthUser; tenant?: TenantCtx }>();
    const auth = req.headers['authorization'];
    if (typeof auth !== 'string' || !auth.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = auth.slice(7).trim();

    const claims = await this.verifyAgainstAnyPool(token);

    const tenantId = claims['custom:tenant_id'];
    if (!tenantId || typeof tenantId !== 'string') {
      throw new ForbiddenException('Token sin custom:tenant_id');
    }

    const role = claims['custom:role'] ?? 'insured';
    const scopes = typeof claims.scope === 'string' && claims.scope.length > 0 ? claims.scope.split(' ') : [];

    req.user = {
      id: claims.sub,
      cognitoSub: claims.sub,
      email: claims.email ?? '',
      role,
      scopes,
      mfaEnrolled: true,
    };
    req.tenant = { id: tenantId };
    return true;
  }

  private async verifyAgainstAnyPool(token: string): Promise<CognitoClaims> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, { issuer: this.issuer });
      return payload as CognitoClaims;
    } catch {
      // Fallback to insured pool
    }
    try {
      const { payload } = await jwtVerify(token, this.insuredJwks, { issuer: this.insuredIssuer });
      return payload as CognitoClaims;
    } catch (err) {
      throw new UnauthorizedException(
        err instanceof Error ? `Invalid token: ${err.message}` : 'Invalid token',
      );
    }
  }
}
