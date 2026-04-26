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
  status?: 'active' | 'cancelled' | 'expired';
  from?: string;
  to?: string;
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
  rfc?: string;
  fullName: string;
  packageId: string;
  packageName: string;
  status: 'active' | 'cancelled' | 'expired';
  validFrom: string;
  validTo: string;
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
