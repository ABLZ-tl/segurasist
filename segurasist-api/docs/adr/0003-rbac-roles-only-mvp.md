# ADR-0003 — RBAC roles-only en MVP, scopes OAuth2 deferidos a Fase 2

- Status: Aceptado
- Fecha: 2026-04-25
- Decisores: Tech Lead, Backend Senior, Producto
- Tickets: M3 (audit medium — Sprint 1)

## Contexto

Sprint 0 dejó controllers con doble decorador:

```ts
@Roles('admin_mac', 'operator', 'admin_segurasist', 'supervisor')
@Scopes('read:batches')
get list() { ... }
```

`RolesGuard` exige que se cumplan ambos: rol válido + scopes presentes. Pero los `idTokens` que cognito-local emite (y, por extensión, Cognito producción cuando sólo hay autenticación admin/insured sin Resource Server con scopes definidos) **no incluyen el claim `scope`**. Resultado: los endpoints con `@Scopes(...)` rechazaban con 403 a TODOS los roles, incluso a los listados en `@Roles(...)`. El `rbac.e2e-spec.ts` documentó la divergencia con `allowed: []` para `/v1/batches`.

El equipo evaluó dos caminos:

1. **A**: configurar Cognito con un Resource Server, definir scopes (`read:batches`, `write:insureds`, etc.), emitir tokens con esos scopes vía client credentials, y llenar el claim `scope` con un Pre Token Generation Lambda.
2. **B**: aceptar que el MVP es 100% una API privada para un único cliente (Hospitales MAC) sin terceros consumidores, y cubrir el RBAC con **roles únicamente**.

## Decisión

Elegimos **B** para el MVP. Implementación concreta:

1. Eliminado el uso de `@Scopes(...)` en TODOS los controllers (`batches`, `insureds`, etc.). Los endpoints quedan sólo con `@Roles(...)` que ya cubre la matriz de permisos requerida por Producto.
2. **Mantenemos el código** del decorator `@Scopes`, la guard separada `ScopesGuard` (`src/common/guards/scopes.guard.ts`) y las constantes `SCOPES_KEY`. Razón: cuando reactivemos en Fase 2 no queremos volver a diseñar y re-introducir la dependencia desde cero.
3. `RolesGuard` mantiene la lógica de scopes para compatibilidad de tests (`roles.guard.spec.ts`) pero, al no haber controllers con `@Scopes`, la rama nunca se ejerce en runtime.
4. `e2e/rbac.e2e-spec.ts` se actualizó: el caso `/v1/batches` GET ahora declara `allowed: ['admin_mac', 'operator', 'admin_segurasist', 'supervisor']` (los 4 roles que ya tenía `@Roles`), y la nota explicativa se actualiza.

## Consecuencias

- **Positivas**:
  - El test e2e refleja la realidad: los operadores MAC pueden listar batches sin tokens especiales.
  - Una sola fuente de verdad para autorización (`@Roles + custom:role` en idToken).
  - Menos sorpresa para nuevos devs.

- **Negativas / deuda técnica**:
  - Si Fase 2 abre la API a clientes terceros (p.ej. una integración B2B con un broker que sólo deba escribir batches), tendremos que reintroducir scopes. Mitigación: el código ya está, sólo hay que volver a aplicar `@Scopes(...)` y un Pre Token Generation Lambda.
  - Granularidad reducida: si en Fase 1.5 alguien quiere "operator pero solo lectura", hoy hay que crear un nuevo rol vs. negar un scope.

## Reactivación post-MVP

Checklist cuando llegue la decisión de exponer la API:

1. Definir Resource Server en Cognito (`segurasist-api`) con los scopes:
   `read:batches`, `write:batches`, `read:insureds`, `write:insureds`,
   `read:certificates`, `write:certificates`, `admin:everything` (wildcard).
2. Implementar Pre Token Generation Lambda que mapee `custom:role` → set de scopes y los inyecte en el claim `scope` del idToken (cognito-local soporta `pre-token-generation` en versiones recientes).
3. Re-aplicar `@Scopes(...)` en los controllers donde sea necesario.
4. Registrar `ScopesGuard` como guard adicional (probablemente APP_GUARD junto a `JwtAuthGuard` y `RolesGuard`).
5. Actualizar `rbac.e2e-spec.ts` para validar que los scopes funcionan.

## Referencias

- `MVP_04_Backend_NestJS_SegurAsist.txt` (§RBAC)
- `src/common/guards/roles.guard.ts`
- `src/common/guards/scopes.guard.ts`
- `src/common/decorators/scopes.decorator.ts`
- `test/e2e/rbac.e2e-spec.ts`
