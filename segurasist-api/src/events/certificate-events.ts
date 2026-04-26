/**
 * Event schemas para el dominio Certificate. Owned por el agente B
 * (S2-03/04 — PDF + email). EventBridge bus name (Sprint 5):
 * `segurasist-{env}-cert-bus`. En MVP local los eventos viajan sólo por SQS
 * + invocación directa entre workers; pero los publishers ya emiten con esta
 * shape para que la migración a EventBridge sea trivial.
 *
 * Discriminated union por `kind`. Todos los eventos llevan `tenantId` para
 * que el consumer pueda fijar contexto RLS antes de leer downstream.
 */

export interface CertificateIssuedEvent {
  kind: 'certificate.issued';
  tenantId: string;
  certificateId: string;
  insuredId: string;
  /** Versión del certificado (1, 2, ...). Útil en re-emisiones. */
  version: number;
  /** S3 key absoluta (bucket lo provee env). */
  s3Key: string;
  /** SHA-256 hex del PDF generado. */
  hash: string;
  /** URL pública /v1/certificates/verify/{hash}. */
  verificationUrl: string;
  occurredAt: string;
}

export interface CertificateGenerationFailedEvent {
  kind: 'certificate.generation_failed';
  tenantId: string;
  insuredId: string;
  reason: string;
  occurredAt: string;
}

/**
 * Solicitud de re-emisión a demanda (RF-308). El worker PDF levanta esto
 * y produce un nuevo certificado con `version+1`, dejando el anterior
 * consultable como `status=reissued`.
 */
export interface CertificateReissueRequestedEvent {
  kind: 'certificate.reissue_requested';
  tenantId: string;
  certificateId: string;
  reason: string;
  /** Override email opcional (para reenvío con destinatario distinto). */
  to?: string;
  occurredAt: string;
}

export type CertificateEvent =
  | CertificateIssuedEvent
  | CertificateGenerationFailedEvent
  | CertificateReissueRequestedEvent;

export const CERTIFICATE_ISSUED_KIND = 'certificate.issued';
export const CERTIFICATE_GENERATION_FAILED_KIND = 'certificate.generation_failed';
export const CERTIFICATE_REISSUE_REQUESTED_KIND = 'certificate.reissue_requested';
