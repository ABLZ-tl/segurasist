import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import { qs } from '../qs';
import type {
  CreateInsuredDto,
  Insured,
  Insured360,
  InsuredsList,
  ListParams,
  UpdateInsuredDto,
} from '../types';

export const insuredsKeys = {
  all: ['insureds'] as const,
  list: (params: ListParams) => ['insureds', 'list', params] as const,
  detail: (id: string) => ['insureds', 'detail', id] as const,
  /** S3-06 — vista 360°. Cache key separada para invalidar independiente del detail. */
  view360: (id: string) => ['insureds', '360', id] as const,
};

export const useInsureds = (params: ListParams) =>
  useQuery({
    queryKey: insuredsKeys.list(params),
    queryFn: () => api<InsuredsList>(`/v1/insureds?${qs(params)}`),
    staleTime: 60_000,
    // S3-07 — placeholderData=keepPreviousData evita el flicker durante el
    // debounce: la lista vieja queda visible mientras la nueva carga.
    // (TanStack 5: usa `placeholderData` en lugar del legacy `keepPreviousData`.)
    placeholderData: (previous) => previous,
  });

export const useInsured = (id: string) =>
  useQuery({
    queryKey: insuredsKeys.detail(id),
    queryFn: () => api<Insured>(`/v1/insureds/${id}`),
    enabled: !!id,
  });

/**
 * S3-06 — Vista 360° del asegurado. Una sola request al backend trae las 5
 * secciones (datos, coberturas, eventos, certificados, audit). Cache 30s
 * para evitar refetches al cambiar de tab — el usuario ve datos consistentes
 * mientras navega entre Datos|Coberturas|Eventos|Certificados|Auditoría.
 */
export const useInsured360 = (id: string) =>
  useQuery({
    queryKey: insuredsKeys.view360(id),
    queryFn: () => api<Insured360>(`/v1/insureds/${id}/360`),
    enabled: !!id,
    staleTime: 30_000,
  });

export const useCreateInsured = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateInsuredDto) =>
      api<Insured>('/v1/insureds', { method: 'POST', body: JSON.stringify(dto) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: insuredsKeys.all }),
  });
};

export const useUpdateInsured = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateInsuredDto) =>
      api<Insured>(`/v1/insureds/${id}`, { method: 'PATCH', body: JSON.stringify(dto) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: insuredsKeys.all });
      qc.invalidateQueries({ queryKey: insuredsKeys.detail(id) });
    },
  });
};

export const useDeleteInsured = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/v1/insureds/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: insuredsKeys.all }),
  });
};
