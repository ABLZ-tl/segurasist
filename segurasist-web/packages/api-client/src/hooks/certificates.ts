import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import { qs } from '../qs';
import type { Certificate, CursorPage, ListParams } from '../types';

export const certificatesKeys = {
  all: ['certificates'] as const,
  list: (params: ListParams) => ['certificates', 'list', params] as const,
  byInsured: (insuredId: string) => ['certificates', 'byInsured', insuredId] as const,
};

export const useCertificates = (params: ListParams) =>
  useQuery({
    queryKey: certificatesKeys.list(params),
    queryFn: () => api<CursorPage<Certificate>>(`/v1/certificates?${qs(params)}`),
    staleTime: 30_000,
  });

export const useInsuredCertificates = (insuredId: string) =>
  useQuery({
    queryKey: certificatesKeys.byInsured(insuredId),
    queryFn: () => api<Certificate[]>(`/v1/insureds/${insuredId}/certificates`),
    enabled: !!insuredId,
  });

export const useReissueCertificate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (insuredId: string) =>
      api<Certificate>(`/v1/insureds/${insuredId}/certificates/reissue`, { method: 'POST' }),
    onSuccess: (_, insuredId) => {
      qc.invalidateQueries({ queryKey: certificatesKeys.all });
      qc.invalidateQueries({ queryKey: certificatesKeys.byInsured(insuredId) });
    },
  });
};
