/**
 * Event schemas para el dominio Insured. Owned por el agente A (S2-01/02 —
 * pipeline de batches). El agente B (S2-03/04 — PDF + email) lo importa pero
 * NO lo modifica.
 *
 * Discriminated union por `kind`. Todos los eventos llevan `tenantId` para
 * que el consumer pueda fijar contexto RLS antes de leer downstream.
 */

export interface InsuredCreatedEvent {
  kind: 'insured.created';
  tenantId: string;
  insuredId: string;
  packageId: string;
  source: { batchId: string; rowNumber: number };
  occurredAt: string;
}

/**
 * Batch terminó la fase de validación y tiene un preview disponible.
 *
 * Productor: `LayoutWorkerService` o `BatchesService` (según si la validación
 * fue async o sync).
 *
 * Consumidor inmediato: ninguno crítico — la UI hace polling a
 * `GET /v1/batches/{id}/preview`. El evento existe para hooks futuros
 * (notificaciones, métricas).
 */
export interface BatchPreviewReadyEvent {
  kind: 'batch.preview_ready';
  tenantId: string;
  batchId: string;
  totals: {
    rowsTotal: number;
    rowsOk: number;
    rowsError: number;
  };
  occurredAt: string;
}

/**
 * Batch terminó de procesar todas las filas válidas (`status=completed`).
 *
 * Productor: `InsuredsCreationWorkerService` cuando `processed == ok + error`.
 *
 * Consumidor: el operador puede pedir reportes, métricas pueden disparar
 * alarmas (e.g. `rowsError/rowsTotal > 0.05`).
 */
export interface BatchCompletedEvent {
  kind: 'batch.completed';
  tenantId: string;
  batchId: string;
  totals: {
    rowsTotal: number;
    rowsOk: number;
    rowsError: number;
  };
  occurredAt: string;
}

export type InsuredEvent = InsuredCreatedEvent | BatchPreviewReadyEvent | BatchCompletedEvent;

export const INSURED_CREATED_EVENT_KIND = 'insured.created';
export const BATCH_PREVIEW_READY_EVENT_KIND = 'batch.preview_ready';
export const BATCH_COMPLETED_EVENT_KIND = 'batch.completed';

/**
 * Helpers de construcción para mantener el shape consistente. Útiles para
 * tests y workers — no obligatorios (el shape es público y verificable
 * estáticamente por TS).
 */
export function buildInsuredCreatedEvent(args: {
  tenantId: string;
  insuredId: string;
  packageId: string;
  batchId: string;
  rowNumber: number;
  occurredAt?: Date;
}): InsuredCreatedEvent {
  return {
    kind: 'insured.created',
    tenantId: args.tenantId,
    insuredId: args.insuredId,
    packageId: args.packageId,
    source: { batchId: args.batchId, rowNumber: args.rowNumber },
    occurredAt: (args.occurredAt ?? new Date()).toISOString(),
  };
}

export function buildBatchPreviewReadyEvent(args: {
  tenantId: string;
  batchId: string;
  rowsTotal: number;
  rowsOk: number;
  rowsError: number;
  occurredAt?: Date;
}): BatchPreviewReadyEvent {
  return {
    kind: 'batch.preview_ready',
    tenantId: args.tenantId,
    batchId: args.batchId,
    totals: {
      rowsTotal: args.rowsTotal,
      rowsOk: args.rowsOk,
      rowsError: args.rowsError,
    },
    occurredAt: (args.occurredAt ?? new Date()).toISOString(),
  };
}

export function buildBatchCompletedEvent(args: {
  tenantId: string;
  batchId: string;
  rowsTotal: number;
  rowsOk: number;
  rowsError: number;
  occurredAt?: Date;
}): BatchCompletedEvent {
  return {
    kind: 'batch.completed',
    tenantId: args.tenantId,
    batchId: args.batchId,
    totals: {
      rowsTotal: args.rowsTotal,
      rowsOk: args.rowsOk,
      rowsError: args.rowsError,
    },
    occurredAt: (args.occurredAt ?? new Date()).toISOString(),
  };
}
