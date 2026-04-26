import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import type { InsurancePackage } from '../types';

export const packagesKeys = {
  all: ['packages'] as const,
  detail: (id: string) => ['packages', 'detail', id] as const,
};

export const usePackages = () =>
  useQuery({
    queryKey: packagesKeys.all,
    queryFn: () => api<InsurancePackage[]>('/v1/packages'),
    staleTime: 5 * 60_000,
  });

export const usePackage = (id: string) =>
  useQuery({
    queryKey: packagesKeys.detail(id),
    queryFn: () => api<InsurancePackage>(`/v1/packages/${id}`),
    enabled: !!id,
  });

export const useUpsertPackage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pkg: Partial<InsurancePackage> & { name: string }) => {
      const path = pkg.id ? `/v1/packages/${pkg.id}` : '/v1/packages';
      const method = pkg.id ? 'PATCH' : 'POST';
      return api<InsurancePackage>(path, { method, body: JSON.stringify(pkg) });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: packagesKeys.all }),
  });
};
