import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../client';
import { qs } from '../qs';
import type { ReportRange } from '../types';

export interface VolumetryPoint {
  date: string;
  metric: string;
  value: number;
}

export interface UsageRow {
  packageId: string;
  packageName: string;
  coverageId: string;
  coverageName: string;
  used: number;
  limit: number;
}

export const reportsKeys = {
  volumetry: (range: ReportRange) => ['reports', 'volumetry', range] as const,
  usage: (packageId?: string) => ['reports', 'usage', packageId] as const,
};

export const useVolumetry = (range: ReportRange) =>
  useQuery({
    queryKey: reportsKeys.volumetry(range),
    queryFn: () => api<VolumetryPoint[]>(`/v1/reports/volumetry?${qs(range)}`),
    staleTime: 5 * 60_000,
  });

export const useUsage = (packageId?: string) =>
  useQuery({
    queryKey: reportsKeys.usage(packageId),
    queryFn: () =>
      api<UsageRow[]>(`/v1/reports/usage?${qs({ packageId })}`),
    staleTime: 5 * 60_000,
  });

export const useGenerateMonthlyReconciliation = () =>
  useMutation({
    mutationFn: (params: { month: string; entityId: string }) =>
      api<{ url: string }>('/v1/reports/reconciliation', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
  });
