/**
 * Hand-written types used by the hooks. Once `openapi:gen` runs against the
 * backend OpenAPI doc, these will be replaced by the generated `paths` /
 * `components` types from `./generated/openapi.d.ts`.
 */

export interface ListParams {
  q?: string;
  cursor?: string;
  limit?: number;
  pkg?: string;
  packageId?: string;
  status?: 'active' | 'suspended' | 'cancelled' | 'expired';
  from?: string;
  to?: string;
  validFromGte?: string;
  validFromLte?: string;
  validToGte?: string;
  validToLte?: string;
  bouncedOnly?: boolean;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  prevCursor: string | null;
  total?: number;
}

export interface Insured {
  id: string;
  curp: string;
  rfc?: string | null;
  fullName: string;
  packageId: string;
  packageName: string;
  status: 'active' | 'suspended' | 'cancelled' | 'expired';
  validFrom: string;
  validTo: string;
  email?: string | null;
  hasBounce?: boolean;
}

export interface CreateInsuredDto {
  curp: string;
  rfc?: string;
  fullName: string;
  packageId: string;
  validFrom: string;
  validTo: string;
}

export type UpdateInsuredDto = Partial<Omit<CreateInsuredDto, 'curp'>>;

export type InsuredsList = CursorPage<Insured>;

/**
 * S3-06 — Vista 360° del asegurado.
 *
 * Shape devuelta por `GET /v1/insureds/:id/360` — agrupa en una sola request
 * los 5 dominios (datos, coberturas con consumo, eventos=claims, certificados,
 * audit log) que pinta el admin en tabs.
 */
export interface Insured360 {
  insured: {
    id: string;
    curp: string;
    rfc: string | null;
    fullName: string;
    dob: string;
    email: string | null;
    phone: string | null;
    packageId: string;
    packageName: string;
    validFrom: string;
    validTo: string;
    status: 'active' | 'suspended' | 'cancelled' | 'expired';
    entidad: string | null;
    numeroEmpleadoExterno: string | null;
    beneficiaries: Array<{ id: string; fullName: string; dob: string; relationship: string }>;
    createdAt: string;
    updatedAt: string;
  };
  coverages: Array<{
    id: string;
    name: string;
    type: 'count' | 'amount';
    limit: number;
    used: number;
    unit: string;
    lastUsedAt: string | null;
  }>;
  events: Array<{
    id: string;
    type: string;
    reportedAt: string;
    description: string;
    status: string;
    amountEstimated: number | null;
  }>;
  certificates: Array<{
    id: string;
    version: number;
    issuedAt: string;
    validTo: string;
    status: string;
    hash: string;
    qrPayload: string | null;
  }>;
  audit: Array<{
    id: string;
    action: string;
    actorEmail: string;
    resourceType: string;
    resourceId: string;
    occurredAt: string;
    ip: string;
    payloadDiff: Record<string, unknown> | null;
  }>;
}

export interface Batch {
  id: string;
  status: 'validating' | 'preview_ready' | 'processing' | 'completed' | 'failed';
  createdAt: string;
  total: number;
  validRows: number;
  errorRows: number;
}

export interface Certificate {
  id: string;
  insuredId: string;
  version: number;
  issuedAt: string;
  url: string;
}

export interface InsurancePackage {
  id: string;
  name: string;
  active: boolean;
  coverages: Array<{
    id: string;
    name: string;
    limit: number;
    used: number;
    unit: 'count' | 'mxn';
  }>;
}

export interface ReportRange {
  from: string;
  to: string;
  granularity?: 'day' | 'week' | 'month';
}

export interface ChatMessage {
  id: string;
  author: 'user' | 'bot';
  text: string;
  ts: string;
}

export interface ChatTurn {
  sessionId: string;
  reply: ChatMessage;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  roles: string[];
  tenantId: string;
}
