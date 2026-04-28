import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import type { InsurancePackage } from '../types';

export const packagesKeys = {
  all: ['packages'] as const,
  detail: (id: string) => ['packages', 'detail', id] as const,
};

// `/v1/packages` devuelve `{ items, nextCursor }` (cursor pagination Sprint 2).
// Este hook normaliza a `InsurancePackage[]` para los callers (filter dropdowns,
// listings) que sólo necesitan la lista. Si hay paginación real en el futuro,
// agregar `usePackagesPaged` separado.
type PackagesListResponse = { items: InsurancePackage[]; nextCursor?: string | null };

export const usePackages = () =>
  useQuery({
    queryKey: packagesKeys.all,
    queryFn: async (): Promise<InsurancePackage[]> => {
      const res = await api<InsurancePackage[] | PackagesListResponse>('/v1/packages');
      // Backwards compat: API antigua devolvía array plano; nueva devuelve {items}.
      if (Array.isArray(res)) return res;
      return res?.items ?? [];
    },
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
