/**
 * S2-02 — Package domain events. Owned por agente C (CRUD paquetes).
 *
 * Mismo patrón que `certificate-events.ts` / `insured-events.ts`: discriminated
 * union por `kind`, llevamos `tenantId` para que un consumer downstream pueda
 * fijar contexto RLS. EventBridge bus (Sprint 5):
 * `segurasist-{env}-cert-bus`. En MVP local los eventos se loguean por pino +
 * audit_log via interceptor; cuando aterrice EventBridge sólo cambia el
 * publisher, el shape se mantiene.
 */

export interface PackageCreatedEvent {
  kind: 'package.created';
  tenantId: string;
  packageId: string;
  name: string;
  status: 'active' | 'archived';
  coveragesCount: number;
  occurredAt: string;
}

export interface PackageUpdatedEvent {
  kind: 'package.updated';
  tenantId: string;
  packageId: string;
  /** Subset de campos modificados (no incluye coverages — esas van por
   *  `coverages.upserted` lógico embebido en `package.updated.diff.coverages`). */
  diff: Record<string, unknown>;
  occurredAt: string;
}

export interface PackageArchivedEvent {
  kind: 'package.archived';
  tenantId: string;
  packageId: string;
  /** Cantidad de coverages que también pasaron a status=archived. */
  coveragesArchived: number;
  occurredAt: string;
}

export type PackageEvent = PackageCreatedEvent | PackageUpdatedEvent | PackageArchivedEvent;

export const PACKAGE_CREATED_KIND = 'package.created';
export const PACKAGE_UPDATED_KIND = 'package.updated';
export const PACKAGE_ARCHIVED_KIND = 'package.archived';
