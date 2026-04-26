import { SetMetadata } from '@nestjs/common';
import { SCOPES_KEY } from './roles.decorator';

/**
 * @deprecated MVP usa SOLO @Roles (cognito groups → claim `cognito:groups`
 * → mapped a `custom:role`). Los scopes OAuth2 se reactivan en Fase 2 cuando
 * exista API pública con clientes terceros y un Pre Token Generation Lambda
 * que inyecte el claim `scope`. Mantener este decorador para no romper
 * imports cuando volvamos a necesitarlo.
 *
 * Ver: docs/adr/0003-rbac-roles-only-mvp.md
 */
export const Scopes = (...scopes: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(SCOPES_KEY, scopes);

// Re-export para que callers puedan importar SCOPES_KEY desde aquí también,
// alineado con la intención de tener un módulo dedicado de scopes en Fase 2.
export { SCOPES_KEY };
