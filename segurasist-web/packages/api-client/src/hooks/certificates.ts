import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import { qs } from '../qs';
import type { Certificate, CursorPage, ListParams } from '../types';

export const certificatesKeys = {
  all: ['certificates'] as const,
  list: (params: ListParams) => ['certificates', 'list', params] as const,
  byInsured: (insuredId: string) => ['certificates', 'byInsured', insuredId] as const,
  /** Portal asegurado — `/v1/certificates/mine`. URL pre-firmada del PDF. */
  mine: ['certificate-mine'] as const,
};

/**
 * Portal asegurado — certificado vigente del titular logueado.
 *
 * `url` es una URL pre-firmada (S3/CloudFront) con TTL ≤ `expiresAt`. El FE
 * la consume en un `<iframe>` y como destino del botón "Descargar PDF". No
 * cachear más de `staleTime` para evitar mostrar URLs expiradas.
 */
export interface CertificateMine {
  url: string;
  expiresAt: string;
  certificateId: string;
  version: number;
  issuedAt: string;
  validTo: string;
}

export const useCertificateMine = () =>
  useQuery({
    queryKey: certificatesKeys.mine,
    queryFn: () => api<CertificateMine>('/v1/certificates/mine'),
    staleTime: 60_000,
  });

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
