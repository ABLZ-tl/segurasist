import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const SCOPES_KEY = 'scopes';
export const PUBLIC_KEY = 'public';

export type Role = 'admin_segurasist' | 'admin_mac' | 'operator' | 'supervisor' | 'insured';

export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator => SetMetadata(ROLES_KEY, roles);

export const Scopes = (...scopes: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(SCOPES_KEY, scopes);

export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_KEY, true);
