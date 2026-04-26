import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { mockHttpContext } from '../../../test/mocks/execution-context.mock';
import { ROLES_KEY, SCOPES_KEY } from '../decorators/roles.decorator';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  let reflector: Reflector;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  function spyMetadata(roles?: unknown, scopes?: unknown): void {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: unknown) => {
      if (key === ROLES_KEY) return roles;
      if (key === SCOPES_KEY) return scopes;
      return undefined;
    });
  }

  it('permite acceso cuando no hay decorators @Roles ni @Scopes', () => {
    spyMetadata(undefined, undefined);
    const ctx = mockHttpContext({});
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('permite acceso cuando @Roles está vacío y @Scopes está vacío', () => {
    spyMetadata([], []);
    const ctx = mockHttpContext({});
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('lanza UnauthorizedException si hay roles requeridos pero el request no tiene user', () => {
    spyMetadata(['admin_mac'], undefined);
    const ctx = mockHttpContext({});
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('permite acceso si el role del user está en la lista de allowed roles', () => {
    spyMetadata(['admin_mac', 'operator'], undefined);
    const ctx = mockHttpContext({
      user: { id: 'u1', cognitoSub: 's', email: 'a@b.c', role: 'operator', scopes: [], mfaEnrolled: true },
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('lanza ForbiddenException si el role del user NO está en la lista de allowed roles', () => {
    spyMetadata(['admin_mac'], undefined);
    const ctx = mockHttpContext({
      user: { id: 'u1', cognitoSub: 's', email: 'a@b.c', role: 'insured', scopes: [], mfaEnrolled: true },
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx)).toThrow('Role not allowed');
  });

  it('valida scopes requeridos: pasa si user los tiene todos', () => {
    spyMetadata(undefined, ['read:insureds', 'write:insureds']);
    const ctx = mockHttpContext({
      user: {
        id: 'u',
        cognitoSub: 's',
        email: 'a@b.c',
        role: 'operator',
        scopes: ['read:insureds', 'write:insureds', 'extra'],
        mfaEnrolled: true,
      },
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('lanza ForbiddenException cuando falta un scope requerido', () => {
    spyMetadata(undefined, ['read:insureds', 'write:insureds']);
    const ctx = mockHttpContext({
      user: {
        id: 'u',
        cognitoSub: 's',
        email: 'a@b.c',
        role: 'operator',
        scopes: ['read:insureds'],
        mfaEnrolled: true,
      },
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx)).toThrow('Scope not allowed');
  });

  it('el wildcard `*` en scopes del user satisface cualquier scope requerido', () => {
    spyMetadata(undefined, ['read:insureds', 'admin:everything']);
    const ctx = mockHttpContext({
      user: {
        id: 'u',
        cognitoSub: 's',
        email: 'a@b.c',
        role: 'admin_segurasist',
        scopes: ['*'],
        mfaEnrolled: true,
      },
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('valida roles y scopes simultáneamente: pasa cuando ambos cumplen', () => {
    spyMetadata(['admin_mac'], ['write:insureds']);
    const ctx = mockHttpContext({
      user: {
        id: 'u',
        cognitoSub: 's',
        email: 'a@b.c',
        role: 'admin_mac',
        scopes: ['write:insureds'],
        mfaEnrolled: true,
      },
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('falla por role aunque scopes cumplan', () => {
    spyMetadata(['admin_mac'], ['write:insureds']);
    const ctx = mockHttpContext({
      user: {
        id: 'u',
        cognitoSub: 's',
        email: 'a@b.c',
        role: 'insured',
        scopes: ['write:insureds'],
        mfaEnrolled: true,
      },
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
