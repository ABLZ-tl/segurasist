/**
 * Portal asegurado — reportar siniestro/evento.
 *
 * El backend acepta `POST /v1/claims` desde el JWT del titular (no requiere
 * insuredId; lo deriva del token). Devuelve `{ id, ticketNumber, status,
 * reportedAt }`. El FE muestra `ticketNumber` en la confirmación para que el
 * usuario tenga referencia al hablar con MAC. La promesa de SLA "MAC se pone
 * en contacto en 48 horas hábiles" la pinta el FE — no es estado del backend.
 *
 * Por qué `claims-self` como key: separar de cualquier listado admin futuro
 * (`['claims', 'list', params]`) para invalidaciones quirúrgicas.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

export const claimsKeys = {
  all: ['claims'] as const,
  self: ['claims-self'] as const,
};

export type ClaimType = 'medical' | 'dental' | 'pharmacy' | 'other';

export interface CreateClaimSelfDto {
  type: ClaimType;
  /** ISO YYYY-MM-DD. Backend valida que ≤ today y ≥ today-365d. */
  occurredAt: string;
  description: string;
}

export interface ClaimResult {
  id: string;
  ticketNumber: string;
  status: string;
  reportedAt: string;
}

export const useCreateClaimSelf = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateClaimSelfDto) =>
      api<ClaimResult>('/v1/claims', { method: 'POST', body: JSON.stringify(dto) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: claimsKeys.self });
    },
  });
};

/**
 * Listado de claims del titular logueado. Reservado para uso futuro
 * (historial en portal). Por ahora solo se exporta para que el invalidate
 * quede consistente.
 */
export const useClaimsSelf = () =>
  useQuery({
    queryKey: claimsKeys.self,
    queryFn: () => api<ClaimResult[]>('/v1/claims/mine'),
    staleTime: 30_000,
    enabled: false,
  });
