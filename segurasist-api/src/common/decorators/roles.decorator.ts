import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const SCOPES_KEY = 'scopes';
export const PUBLIC_KEY = 'public';

export type Role = 'admin_segurasist' | 'admin_mac' | 'operator' | 'supervisor' | 'insured';

export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator => SetMetadata(ROLES_KEY, roles);

/**
 * @deprecated MVP usa SOLO @Roles. Para mantener backward compatibility de
 * imports y tests existentes durante la transición, dejamos `Scopes`
 * exportado aquí pero su uso real en controllers fue removido (ver M3 audit
 * y `docs/adr/0003-rbac-roles-only-mvp.md`). Reactivación en Fase 2.
 *
 * Importar desde `@common/decorators/scopes.decorator` cuando se reactive.
 */
export const Scopes = (...scopes: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(SCOPES_KEY, scopes);

export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_KEY, true);
