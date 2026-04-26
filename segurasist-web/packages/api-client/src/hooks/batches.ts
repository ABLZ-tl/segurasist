import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import { qs } from '../qs';
import type { Batch, CursorPage, ListParams } from '../types';

export const batchesKeys = {
  all: ['batches'] as const,
  list: (params: ListParams) => ['batches', 'list', params] as const,
  detail: (id: string) => ['batches', 'detail', id] as const,
};

export const useBatches = (params: ListParams) =>
  useQuery({
    queryKey: batchesKeys.list(params),
    queryFn: () => api<CursorPage<Batch>>(`/v1/batches?${qs(params)}`),
    staleTime: 30_000,
  });

export const useBatch = (id: string) =>
  useQuery({
    queryKey: batchesKeys.detail(id),
    queryFn: () => api<Batch>(`/v1/batches/${id}`),
    // Poll while batch is still processing.
    refetchInterval: (query) => {
      const data = query.state.data;
      return data && (data.status === 'processing' || data.status === 'validating') ? 2000 : false;
    },
    enabled: !!id,
  });

export const useUploadBatch = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api<Batch>('/v1/batches', { method: 'POST', body: fd, headers: {} });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: batchesKeys.all }),
  });
};

export const useConfirmBatch = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<Batch>(`/v1/batches/${id}/confirm`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: batchesKeys.all });
      qc.invalidateQueries({ queryKey: batchesKeys.detail(id) });
    },
  });
};
