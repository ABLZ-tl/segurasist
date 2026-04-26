import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import { qs } from '../qs';
import type {
  CreateInsuredDto,
  Insured,
  InsuredsList,
  ListParams,
  UpdateInsuredDto,
} from '../types';

export const insuredsKeys = {
  all: ['insureds'] as const,
  list: (params: ListParams) => ['insureds', 'list', params] as const,
  detail: (id: string) => ['insureds', 'detail', id] as const,
};

export const useInsureds = (params: ListParams) =>
  useQuery({
    queryKey: insuredsKeys.list(params),
    queryFn: () => api<InsuredsList>(`/v1/insureds?${qs(params)}`),
    staleTime: 60_000,
  });

export const useInsured = (id: string) =>
  useQuery({
    queryKey: insuredsKeys.detail(id),
    queryFn: () => api<Insured>(`/v1/insureds/${id}`),
    enabled: !!id,
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
