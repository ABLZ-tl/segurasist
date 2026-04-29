## [MT-1 iter 2] 2026-04-28
**Owner**: MT-1 (Backend Senior Multi-Tenant)
**Estado**: COMPLETE

**Plan iter 2**:
1. CC-02 — habilitar CORP `cross-origin` + COEP `require-corp` + COOP `same-origin` en CloudFront del módulo `s3-tenant-branding` (HABILITADOR MT-3).
2. Verificar audit wireup post-migration en branding-admin.controller (PUT/POST/DELETE).
3. Verificar drift entre RB-021 y endpoints reales.
4. Verificar tests existentes (mocks/imports).

**Hechos**:

- `segurasist-infra/modules/s3-tenant-branding/main.tf:124-189` — agregado `aws_cloudfront_response_headers_policy "this"` con:
  - `security_headers_config.cross_origin_resource_policy = "cross-origin"` (CC-02 fix).
  - `cross_origin_embedder_policy = "require-corp"` (consistente con portal Next.js MT-3).
  - `cross_origin_opener_policy = "same-origin"`.
  - `content_type_options.override = true` (no-sniff).
  - `strict_transport_security` (max-age 1y + includeSubdomains + preload).
  - `cors_config` (`allow_origins = ["*"]` lectura pública diseño-CDN, GET/HEAD only).
  - `custom_headers_config.items = [{Cache-Control: "public, max-age=3600, s-maxage=3600", override=true}]`.
- `main.tf:257` — asociado al `default_cache_behavior` via `response_headers_policy_id = aws_cloudfront_response_headers_policy.this.id`.
- `outputs.tf:21-25` — agregado output `response_headers_policy_id` para downstream G-1 / S5-2.
- TF syntax verificado manualmente (terraform CLI no disponible en sandbox); estructura matches AWS provider 5.40 schema (`aws_cloudfront_response_headers_policy.security_headers_config`/`cors_config`/`custom_headers_config`). Bloque `name` usa `${var.bucket_name}-rhp` para evitar colisión cross-env.

**Audit wireup verification**:
- `branding-admin.controller.ts:94-109` (PUT) → `auditWriter.record({ ...auditCtx.fromRequest(), tenantId: id, action:'tenant_branding_updated', resourceType:'tenant.branding', subAction:'update_metadata', fields:[...] })`. ✅ ya conectado iter 1.
- `branding-admin.controller.ts:168-179` (POST logo) → idem con `subAction:'logo_uploaded'` + `mime` + `sizeBytes`. ✅
- `branding-admin.controller.ts:194-202` (DELETE logo) → idem con `subAction:'logo_cleared'`. ✅
- `AuditContextFactory.fromRequest()` es **request-scoped (REQUEST inject)**, NO toma `req` como param — la prompt de coordinación citaba `fromRequest(req)` pero la signature real es zero-arg. El controller usa la signature correcta. **No se requiere cambio**.
- Migration `20260429_tenant_branding/migration.sql` agrega el enum value `tenant_branding_updated` con `IF NOT EXISTS` — los inserts de audit van a funcionar tras `prisma migrate deploy`. Si el enum no estuviera aplicado en una env dada, Postgres rechazaría el insert con `invalid input value for enum AuditAction`; G-1 debe correr la migration antes de habilitar PUT/POST/DELETE en prod (documentado en RB-021 §2 implícitamente vía "pre-req runbook RB-002").

**RB-021 vs endpoints — consistency check**:
| Item RB-021 | Controller real | OK |
|---|---|---|
| `GET /v1/admin/tenants/:id/branding` | `@Get()` linea 70 | ✅ |
| `PUT /v1/admin/tenants/:id/branding` | `@Put()` linea 81 | ✅ |
| `POST /v1/admin/tenants/:id/branding/logo` (multipart, PNG/SVG/WebP, ≤512KB) | `@Post('logo')` 114 + magic-bytes 151 + `MAX_BYTES = 512*1024` linea 137 | ✅ |
| `DELETE /v1/admin/tenants/:id/branding/logo` | `@Delete('logo')` 184 | ✅ |
| Audit `tenant_branding_updated` con `payloadDiff.subAction` | matches all 3 mutations | ✅ |
| RB-021 §6 troubleshooting: "Cross-Origin-Resource-Policy bloqueado en `<img>`" → "Re-aplicar Terraform `s3-tenant-branding`" | ahora cubierto post-CC-02 | ✅ |

**No drift detectado**. RB-021 §6 ya menciona el síntoma CORP — ahora la fix está en código.

**Tests pass mentalmente**:
- `branding.service.spec.ts` (17 tests): NO toca CloudFront; sólo Prisma + UploadService mocks. **No cambia con iter 2**. Imports OK (PrismaBypassRlsService, BrandingUploadService, BrandingService, dto/branding, file-magic-bytes — todos absolute paths relativos válidos).
- `branding.controller.spec.ts` (11 tests): mocks `AuditWriterService.record` y `AuditContextFactory.fromRequest`. La signature `fromRequest()` zero-arg matches la implementación real. **Sigue verde**.

**NEW-FINDING iter 2**:
1. **`access_control_allow_origins = ["*"]` en cors_config**: deliberado (CDN público de logos). Si en Sprint 6 servimos assets sensibles (e.g. firmas escaneadas, documentos clínicos), se debe restringir vía `access_control_allow_origins.items = [for d in var.aliases : "https://${d}"]` y separar bucket/distribución. **Dejado documentado en main.tf:140-142**.
2. **Override de Cache-Control puede romper invalidations selectivas**: la policy fuerza `Cache-Control: public, max-age=3600, s-maxage=3600` aún si el PutObject mandó otro Cache-Control. Esto es OK para iter 1/2 (path con timestamp invalida), pero si en Sprint 6 cambiamos al patrón mutable-key (`/{tenantId}/logo-current.png`), debemos remover este override y dejar el header del bucket. **Flag para MT-1 Sprint 6**.
3. **HSTS 1y + preload en CDN**: incluye preload — si un dominio CNAME (`branding-cdn.segurasist.app`) se elimina, el browser lo seguirá pidiendo HTTPS por 1 año. **Ops debe** evitar romper este alias hasta el TTL HSTS-preload expire. Documentado in-tree.
4. **Module no consume `var.aliases` en cors_config**: si el CDN tiene alias custom (e.g. `branding-cdn.segurasist.app`) el `*` lo cubre; cuando endurezcamos (NEW-FINDING #1) habrá que pasar `var.aliases` al `access_control_allow_origins`.

**Bloqueos**: ninguno.

**Δ vs iter 1**:
- iter 1: bucket privado + OAI + bucket policy + distribución + cache TTL.
- iter 2: + `aws_cloudfront_response_headers_policy` (CORP/COEP/COOP/HSTS/Cache-Control) asociado al default cache behavior; + output `response_headers_policy_id`.
- Sin cambios al BE Nest (audit ya estaba wired iter 1; verificación + ack).
- Sin cambios a tests (no breaks).

**Para MT-3** (consumer iter 2): cuando setees `NEXT_PUBLIC_TENANT_BRANDING_DOMAIN` desde el output `cloudfront_domain_name`, las imágenes ya van a tener CORP `cross-origin` y satisfacen tu COEP `require-corp`. NO necesitas crossorigin attr en el `<img>` (CORP basta).

**Para G-1** (deploy): aplicar `terraform apply` del módulo S3 ANTES que MT-3 active COEP en prod. Si MT-3 lo activa antes y este módulo no está aplicado, los logos quedan bloqueados (mensaje de error en console: "blocked by Cross-Origin-Resource-Policy").
