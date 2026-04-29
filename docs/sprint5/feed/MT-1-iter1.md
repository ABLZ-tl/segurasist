## [MT-1 iter 1] 2026-04-28
**Owner**: MT-1 (Backend Senior Multi-Tenant)
**Estado**: COMPLETE

**Plan**:
Modelo Tenant + endpoints branding (insured GET + admin CRUD + logo upload S3/CloudFront), Terraform module S3+CloudFront con OAI, tests unit + integration, contrato publicado para MT-2 / MT-3.

**Hechos**:
- `prisma/schema.prisma:255-278` — Tenant extendido con `displayName`, `tagline`, `brandingLogoUrl`, `brandingPrimaryHex`, `brandingAccentHex`, `brandingBgImageUrl`, `brandingUpdatedAt`.
- `prisma/schema.prisma:218-219` — `AuditAction.tenant_branding_updated` agregado.
- `prisma/migrations/20260429_tenant_branding/migration.sql` — `ADD COLUMN IF NOT EXISTS` x7 + `ALTER TYPE ... ADD VALUE IF NOT EXISTS` (idempotente).
- `src/modules/audit/audit-writer.service.ts:91` — `AuditEventAction` union extendida con `'tenant_branding_updated'`.
- `src/modules/tenants/branding/branding.service.ts` — get/update/uploadLogo/clearLogo + cache in-memory 5min + invalidation en cada mutación. Fallback layered (custom → name → "SegurAsist") y hex defaults.
- `src/modules/tenants/branding/branding.controller.ts` — `GET /v1/tenants/me/branding` (Throttle 60/60, roles insured/admin_mac/operator/supervisor).
- `src/modules/admin/tenants/branding-admin.controller.ts` — `GET / PUT / POST logo / DELETE logo` bajo `/v1/admin/tenants/:id/branding`. Throttle 60/30/10/30 respectivamente. `assertCanOperateOnTenant` enforza cross-tenant deny para `admin_mac`.
- `src/modules/admin/tenants/branding-upload.service.ts` — wraps `S3Service.putObject` con key `{tenantId}/logo-{ts}.{ext}` y resuelve URL CloudFront (env `CLOUDFRONT_TENANT_BRANDING_DOMAIN`) o LocalStack endpoint en dev.
- `src/modules/tenants/branding/dto/branding.dto.ts` — `BrandingResponseSchema`, `UpdateBrandingSchema`, `HexColorSchema` (regex `^#[0-9a-fA-F]{6}$`).
- `src/modules/tenants/branding/branding.module.ts` — wireup; añadido a `app.module.ts:32` y `app.module.ts:108`.
- `src/common/utils/file-magic-bytes.ts` — extendido con detección PNG (89 50 4E 47), WebP (RIFF/WEBP) y SVG (`<svg`). Mantiene `xlsx`/`csv` intactos. `DETECTED_MIME` extendido con png/webp/svg.
- `src/config/env.schema.ts:73-91` — `S3_BUCKET_TENANT_BRANDING` y `CLOUDFRONT_TENANT_BRANDING_DOMAIN` (ambos optional para no romper boot pre-Terraform).
- `segurasist-infra/modules/s3-tenant-branding/{main,variables,outputs}.tf` — bucket privado (BlockPublicAccess) + versioning + SSE-AES256 + CloudFront distribution con OAI + bucket policy TLS-only + cache TTL default 3600s.
- `segurasist-web/packages/security/src/csp.ts` — `buildPortalCsp({tenantBrandingDomain, nonce})` y `tenantBrandingImgSources(domain)` con allow-list `*.cloudfront.net` por defecto. Re-exportado en `index.ts`.
- `test/unit/modules/tenants/branding.service.spec.ts` — 17 tests: get/update/cache hit/cache miss tras purge/uploadLogo delegation/clearLogo/hex regex acceptance & rejection/file-magic PNG/WebP/SVG/EXE/GIF/text.
- `test/integration/branding.controller.spec.ts` — 11 tests: insured GET, admin GET superadmin cross-tenant, PUT admin con audit, PUT admin_mac mismo tenant 200, PUT admin_mac otro tenant 403, PUT hex inválido 400, POST logo PNG 201 + audit, POST logo >512KB 413, POST logo mime fake 415, DELETE logo + audit subAction='logo_cleared'.

**Contratos publicados** (consumers MT-2 / MT-3):

```ts
// GET /v1/tenants/me/branding (insured) — auth JWT con tenant claim.
{
  tenantId: string;            // uuid
  displayName: string;         // 1..80 — fallback "SegurAsist"
  tagline: string | null;      // 0..160
  logoUrl: string | null;      // CloudFront absolute URL — null si default
  primaryHex: string;          // ^#[0-9a-fA-F]{6}$ — default "#16a34a"
  accentHex: string;           // ^#[0-9a-fA-F]{6}$ — default "#7c3aed"
  bgImageUrl: string | null;
  lastUpdatedAt: string | null; // ISO 8601 — null si nunca editado
}

// PUT /v1/admin/tenants/:id/branding (admin) — body
{
  displayName: string;         // 1..80 obligatorio
  tagline?: string;            // 0..160 opcional (string vacío → null)
  primaryHex: string;          // ^#[0-9a-fA-F]{6}$
  accentHex: string;           // idem
  bgImageUrl?: string;         // URL absoluta http/https hasta 512 chars
}
// 200 → BrandingResponseDto. 400 si hex/URL malformado. 403 si admin_mac
// intenta editar un tenant distinto al del JWT.

// POST /v1/admin/tenants/:id/branding/logo (multipart, field "file")
//   - Max 512KB (413 si excede).
//   - PNG / SVG / WebP validado con file-magic-bytes (415 si mismatch).
// 201 → BrandingResponseDto con logoUrl set.

// DELETE /v1/admin/tenants/:id/branding/logo
// 200 → BrandingResponseDto con logoUrl=null.
```

**NEW-FINDING**:
1. **CSP del portal Next.js (MT-3)**: el helper `buildPortalCsp` está en `segurasist-web/packages/security/src/csp.ts` con allow-list `img-src` y `connect-src` para `*.cloudfront.net` por defecto, o el dominio explícito vía la opción `tenantBrandingDomain`. **NO toqué `apps/portal/middleware.ts` (ownership MT-3)** — MT-3 debe consumir este helper en iter 2 y setear `NEXT_PUBLIC_TENANT_BRANDING_DOMAIN` desde el output Terraform `cloudfront_domain_name`.
2. **Cache in-memory per-instance**: `BrandingService.cache` es un `Map` local, NO Redis. App Runner corre ≥2 réplicas → un update en una instancia no invalida la otra; el portal puede ver branding viejo hasta 5 min. **Anti-pattern Sprint 6**: migrar a Redis pub/sub o invalidación cross-instance via SNS topic. Documentado en código (`branding.service.ts` JSDoc cabecera).
3. **SVG XSS surface**: aceptamos SVG por file-magic, pero un SVG malicioso con `<script>` o `onload="..."` sigue siendo un vector si el portal lo embebe inline. Mitigación actual: CloudFront sirve siempre como `image/svg+xml` y `<img src=...>` (no inline). **Iter 2 / Sprint 6**: agregar sanitize SVG server-side con `dompurify`/`xmlbuilder` antes del PutObject. Documentado en `file-magic-bytes.ts:isLikelySvg`.
4. **Hard requirement env vars**: `S3_BUCKET_TENANT_BRANDING` y `CLOUDFRONT_TENANT_BRANDING_DOMAIN` quedaron `optional()` en `env.schema.ts` para no romper el boot del API antes que Terraform aplique `s3-tenant-branding`. Una vez aplicado en staging/prod, **DevOps debe** marcarlas `min(1)` (no-optional) — flag para G-1 / S5-2.
5. **Bg image upload no implementado iter 1**: el endpoint admin acepta `bgImageUrl` como string en el PUT (admin pega URL pública), pero NO hay endpoint multipart `POST /branding/bg-image`. Si MT-2 lo necesita para el editor, agregar en iter 2 con misma forma que el logo (file-magic + 512KB cap o más alto).

**Bloqueos**: ninguno.

**Para iter 2**:
- Migrar callers de `display_name` desde `brand_json.displayName` (legacy field — algunos seeds lo populan ahí) si MT-3 los detecta.
- Bumpear el bucket env vars a no-opcional en prod env (coord con G-1 al deploy).
- Sanitize SVG (NEW-FINDING #3).
- Endpoint multipart para bg image (NEW-FINDING #5) si MT-2 lo pide.
- Considerar endpoint `DELETE /v1/admin/tenants/:id/branding/bg-image` para resetear el bg sin editor manual.
- Migrar cache in-memory a Redis (NEW-FINDING #2) — anti-pattern queda visible para Sprint 6.
