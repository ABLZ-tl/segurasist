/**
 * Sprint 5 — S5-3 hooks del editor admin de KB del chatbot.
 *
 * Endpoints (owner BE: S5-3):
 *   - GET    /v1/admin/chatbot/kb               → list paginated
 *   - POST   /v1/admin/chatbot/kb               → create
 *   - PUT    /v1/admin/chatbot/kb/:id           → update
 *   - DELETE /v1/admin/chatbot/kb/:id           → soft-delete
 *   - POST   /v1/admin/chatbot/kb/:id/test-match → match probe
 *   - POST   /v1/admin/chatbot/kb/import        → CSV bulk
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

export interface KbEntryAdmin {
  id: string;
  tenantId: string;
  intent: string;
  title: string;
  body: string;
  keywords: string[];
  priority: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateKbEntryDto {
  intent: string;
  title: string;
  body: string;
  keywords: string[];
  priority?: number;
  enabled?: boolean;
  tenantId?: string;
}

export type UpdateKbEntryDto = Partial<CreateKbEntryDto>;

export interface ListKbEntriesParams {
  q?: string;
  enabled?: boolean;
  limit?: number;
  offset?: number;
  tenantId?: string;
}

export interface ListKbEntriesResult {
  items: KbEntryAdmin[];
  total: number;
}

export interface TestMatchResult {
  matched: boolean;
  score: number;
  matchedKeywords: string[];
  matchedSynonyms: string[];
}

export interface ImportKbCsvResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; reason: string }>;
}

export const adminKbKeys = {
  all: ['admin-kb'] as const,
  list: (p: ListKbEntriesParams) => ['admin-kb', 'list', p] as const,
  detail: (id: string) => ['admin-kb', 'detail', id] as const,
};

function qs(params: Record<string, unknown>): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    out.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return out.join('&');
}

export const useAdminKbList = (params: ListKbEntriesParams) =>
  useQuery({
    queryKey: adminKbKeys.list(params),
    queryFn: () =>
      api<ListKbEntriesResult>(`/v1/admin/chatbot/kb?${qs(params as Record<string, unknown>)}`),
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  });

export const useCreateKbEntry = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateKbEntryDto) =>
      api<KbEntryAdmin>('/v1/admin/chatbot/kb', {
        method: 'POST',
        body: JSON.stringify(dto),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminKbKeys.all }),
  });
};

export const useUpdateKbEntry = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateKbEntryDto) =>
      api<KbEntryAdmin>(`/v1/admin/chatbot/kb/${id}`, {
        method: 'PUT',
        body: JSON.stringify(dto),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminKbKeys.all });
      qc.invalidateQueries({ queryKey: adminKbKeys.detail(id) });
    },
  });
};

export const useDeleteKbEntry = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`/v1/admin/chatbot/kb/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminKbKeys.all }),
  });
};

export const useTestKbMatch = (id: string) =>
  useMutation({
    mutationFn: (query: string) =>
      api<TestMatchResult>(`/v1/admin/chatbot/kb/${id}/test-match`, {
        method: 'POST',
        body: JSON.stringify({ query }),
      }),
  });

export const useImportKbCsv = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: { csv: string; upsert: boolean; tenantId?: string }) =>
      api<ImportKbCsvResult>('/v1/admin/chatbot/kb/import', {
        method: 'POST',
        body: JSON.stringify(dto),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminKbKeys.all }),
  });
};
