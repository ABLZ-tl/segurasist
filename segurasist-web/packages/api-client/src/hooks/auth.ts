import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import type { SessionUser } from '../types';

export const authKeys = {
  session: ['auth', 'session'] as const,
};

export const useSession = () =>
  useQuery({
    queryKey: authKeys.session,
    queryFn: () => api<SessionUser | null>('/v1/auth/session'),
    staleTime: 60_000,
  });

export const useLogout = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('/v1/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      qc.removeQueries();
      window.location.href = '/login';
    },
  });
};

export interface RequestOtpDto {
  curp: string;
  channel: 'email' | 'sms';
}

export interface VerifyOtpDto {
  challengeId: string;
  code: string;
}

export const useRequestOtp = () =>
  useMutation({
    mutationFn: (dto: RequestOtpDto) =>
      api<{ challengeId: string; ttlSeconds: number }>('/v1/auth/otp/request', {
        method: 'POST',
        body: JSON.stringify(dto),
      }),
  });

export const useVerifyOtp = () =>
  useMutation({
    mutationFn: (dto: VerifyOtpDto) =>
      api<SessionUser>('/v1/auth/otp/verify', {
        method: 'POST',
        body: JSON.stringify(dto),
      }),
  });
