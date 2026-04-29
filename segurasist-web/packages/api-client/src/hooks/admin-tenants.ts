/**
 * Sprint 5 — MT-2 iter 1.
 *
 * Admin tenant branding hooks. Consume el contrato publicado por MT-1:
 *   - GET    /v1/admin/tenants/:id/branding
 *   - PUT    /v1/admin/tenants/:id/branding
 *   - POST   /v1/admin/tenants/:id/branding/logo  (multipart/form-data)
 *   - DELETE /v1/admin/tenants/:id/branding/logo
 *
 * Y mantenemos consistente la cache key del portal (`/v1/tenants/me/branding`)
 * para que cuando MT-3 lo consuma, una mutación admin invalide ambas keys.
 *
 * NOTA iter 2: cuando MT-1 publique el OpenAPI, reemplazar `TenantBranding`
 * por el tipo generado en `../generated/openapi.d.ts`. TODO(MT-2 iter 2).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMultipart } from '../client';

export interface TenantBranding {
  tenantId: string;
  displayName: string;
  tagline: string | null;
  logoUrl: string | null;
  primaryHex: string;
  accentHex: string;
  bgImageUrl: string | null;
  /** ISO timestamp last write. */
  lastUpdatedAt: string;
}

export interface UpdateTenantBrandingDto {
  displayName: string;
  tagline?: string | null;
  primaryHex: string;
  accentHex: string;
  bgImageUrl?: string | null;
}

export interface UploadLogoResult {
  logoUrl: string;
}

export const tenantBrandingKeys = {
  all: ['tenant-branding'] as const,
  detail: (tenantId: string) => ['tenant-branding', tenantId] as const,
  /**
   * Portal self-key — MT-3 la consume desde `useTenantBranding` (apps/portal).
   * La invalidamos también desde acá para que un admin que esté logueado
   * tanto en admin como en portal vea el cambio sin recargar.
   */
  portalSelf: ['tenant-branding-self'] as const,
};

export const useTenantBranding = (tenantId: string) =>
  useQuery({
    queryKey: tenantBrandingKeys.detail(tenantId),
    queryFn: () => api<TenantBranding>(`/v1/admin/tenants/${tenantId}/branding`),
    enabled: !!tenantId,
    staleTime: 30_000,
  });

export const useUpdateBrandingMutation = (tenantId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateTenantBrandingDto) =>
      api<TenantBranding>(`/v1/admin/tenants/${tenantId}/branding`, {
        method: 'PUT',
        body: JSON.stringify(dto),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tenantBrandingKeys.detail(tenantId) });
      qc.invalidateQueries({ queryKey: tenantBrandingKeys.portalSelf });
    },
  });
};

/**
 * Sube el logo en multipart/form-data. Usa el helper `apiMultipart()`
 * (CC-03 iter 2) que evita el `content-type: application/json` que fijaba
 * `api()`/`apiPost()` y rompía el boundary del FormData.
 *
 * Errors: `apiMultipart` lanza `ProblemDetailsError` igual que `api()`,
 * lo que mantiene el contrato uniforme con los otros hooks (claims,
 * insureds, etc.). El caller puede leer `err.detail`/`err.title` con
 * los mismos patrones que el resto del admin.
 */
export const useUploadLogoMutation = (tenantId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File): Promise<UploadLogoResult> => {
      const fd = new FormData();
      fd.append('file', file);
      return apiMultipart<UploadLogoResult>(
        `/v1/admin/tenants/${tenantId}/branding/logo`,
        fd,
        { method: 'POST' },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tenantBrandingKeys.detail(tenantId) });
      qc.invalidateQueries({ queryKey: tenantBrandingKeys.portalSelf });
    },
  });
};

export const useDeleteLogoMutation = (tenantId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<void>(`/v1/admin/tenants/${tenantId}/branding/logo`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tenantBrandingKeys.detail(tenantId) });
      qc.invalidateQueries({ queryKey: tenantBrandingKeys.portalSelf });
    },
  });
};
