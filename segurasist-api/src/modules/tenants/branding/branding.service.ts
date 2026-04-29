import { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import { Injectable, NotFoundException } from '@nestjs/common';
import { BrandingUploadService } from '@modules/admin/tenants/branding-upload.service';
import type { BrandingResponseDto, UpdateBrandingDto } from './dto/branding.dto';

/**
 * Sprint 5 — MT-1. Service de branding multi-tenant.
 *
 * Responsabilidades:
 *   1. `getBrandingForTenant(tenantId)` — devuelve la shape canónica
 *      (`BrandingResponseDto`) con fallbacks aplicados (displayName="SegurAsist",
 *      hex defaults, etc.). Cache in-memory 5min para no hammerear la BD
 *      en cada request del portal del asegurado (cada page reload es un
 *      GET branding). Iter 2 / Sprint 6: migrar a Redis si crece tráfico.
 *   2. `updateBranding(tenantId, dto)` — mutación admin (display/colores/bg).
 *      Bumpea `branding_updated_at` y purga cache.
 *   3. `setLogoUrl(tenantId, url)` / `clearLogo(tenantId)` — los expone el
 *      `BrandingUploadService` tras subir/borrar a S3. Mantenemos la
 *      escritura en este service para no duplicar la invalidación de cache.
 *
 * Por qué `PrismaBypassRlsService`: la tabla `tenants` es el catálogo (no
 * tiene políticas RLS por tenant_id). El acceso queda gated en el
 * controller — admin (assertPlatformAdmin) o insured (req.tenant.id del JWT,
 * NO acepta path-param que el cliente controle).
 *
 * Cache:
 *   - Key: tenantId. Value: `{dto, expiresAt}`.
 *   - TTL: 5 min (300_000 ms). Dataset: 1 row por tenant ⇒ memoria ínfima.
 *   - Invalidación: por update/upload/delete logo (purgeCache(tenantId)).
 *   - **Anti-pattern Sprint 6**: el cache es per-instancia (App Runner suele
 *     correr ≥2 réplicas en prod). Branding update en una instancia no
 *     invalida el cache de la otra → el portal puede ver contenido viejo
 *     hasta 5 min. NEW-FINDING en feed: migrar a Redis pub/sub.
 */
const FALLBACK_DISPLAY_NAME = 'SegurAsist';
const FALLBACK_PRIMARY_HEX = '#16a34a';
const FALLBACK_ACCENT_HEX = '#7c3aed';
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  dto: BrandingResponseDto;
  expiresAt: number;
}

@Injectable()
export class BrandingService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly prismaBypass: PrismaBypassRlsService,
    private readonly upload: BrandingUploadService,
  ) {}

  /**
   * GET branding para un tenant. Cache 5min.
   *
   * Throws `NotFoundException` si el tenant no existe (caller insured con
   * un tenantId del JWT que ya no está en BD — borrado por superadmin).
   * El portal del asegurado debe tratar este 404 como "logout y reauth".
   */
  async getBrandingForTenant(tenantId: string): Promise<BrandingResponseDto> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.dto;
    }

    const tenant = await this.prismaBypass.client.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        displayName: true,
        tagline: true,
        brandingLogoUrl: true,
        brandingPrimaryHex: true,
        brandingAccentHex: true,
        brandingBgImageUrl: true,
        brandingUpdatedAt: true,
        deletedAt: true,
      },
    });

    if (!tenant || tenant.deletedAt !== null) {
      throw new NotFoundException('Tenant no encontrado');
    }

    const dto: BrandingResponseDto = {
      tenantId: tenant.id,
      // Fallback layered: displayName custom → name legal → constante
      // "SegurAsist". El portal del asegurado nunca ve un string vacío.
      displayName: tenant.displayName ?? tenant.name ?? FALLBACK_DISPLAY_NAME,
      tagline: tenant.tagline ?? null,
      logoUrl: tenant.brandingLogoUrl ?? null,
      primaryHex: tenant.brandingPrimaryHex ?? FALLBACK_PRIMARY_HEX,
      accentHex: tenant.brandingAccentHex ?? FALLBACK_ACCENT_HEX,
      bgImageUrl: tenant.brandingBgImageUrl ?? null,
      lastUpdatedAt: tenant.brandingUpdatedAt ? tenant.brandingUpdatedAt.toISOString() : null,
    };

    this.cache.set(tenantId, { dto, expiresAt: Date.now() + CACHE_TTL_MS });
    return dto;
  }

  /**
   * PUT admin update branding (displayName + tagline + colores + bgImageUrl).
   *
   * No toca `branding_logo_url` — eso lo gestiona el flow de upload/delete.
   * Bumpea `branding_updated_at` y purga el cache.
   */
  async updateBranding(tenantId: string, dto: UpdateBrandingDto): Promise<BrandingResponseDto> {
    // 404 antes del update si el tenant no existe (Prisma update sin
    // findFirst lanzaría P2025; preferimos NotFound coherente con el GET).
    const exists = await this.prismaBypass.client.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Tenant no encontrado');

    await this.prismaBypass.client.tenant.update({
      where: { id: tenantId },
      data: {
        displayName: dto.displayName,
        tagline: dto.tagline ?? null,
        brandingPrimaryHex: dto.primaryHex,
        brandingAccentHex: dto.accentHex,
        // Si el body no trae bgImageUrl, NO modificamos (preserva el valor
        // anterior). Para borrar bg image hace falta endpoint dedicado iter 2.
        ...(dto.bgImageUrl !== undefined ? { brandingBgImageUrl: dto.bgImageUrl } : {}),
        brandingUpdatedAt: new Date(),
      },
    });

    this.purgeCache(tenantId);
    return this.getBrandingForTenant(tenantId);
  }

  /**
   * Sube el logo a S3 (delegado a `BrandingUploadService`) y persiste la
   * URL CloudFront en `branding_logo_url`. Llamado por el admin controller.
   *
   * El controller debe haber validado:
   *   - mime ∈ {image/png, image/svg+xml, image/webp}
   *   - file.length ≤ 512 KB
   *   - file-magic-bytes coincide con el mime declarado
   * Si alguna falla, el controller responde 415/413 ANTES de llamar este método.
   */
  async uploadLogo(args: {
    tenantId: string;
    buffer: Buffer;
    mime: 'image/png' | 'image/svg+xml' | 'image/webp';
  }): Promise<BrandingResponseDto> {
    const { tenantId, buffer, mime } = args;

    const exists = await this.prismaBypass.client.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Tenant no encontrado');

    const url = await this.upload.uploadLogo({ tenantId, buffer, mime });

    await this.prismaBypass.client.tenant.update({
      where: { id: tenantId },
      data: { brandingLogoUrl: url, brandingUpdatedAt: new Date() },
    });

    this.purgeCache(tenantId);
    return this.getBrandingForTenant(tenantId);
  }

  /**
   * Borra el logo del tenant (revierte a placeholder default — `logoUrl=null`
   * en la response, frontend muestra placeholder). NO borra el objeto S3
   * (mantenemos histórico para audit / rollback de branding accidental).
   */
  async clearLogo(tenantId: string): Promise<BrandingResponseDto> {
    const exists = await this.prismaBypass.client.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Tenant no encontrado');

    await this.prismaBypass.client.tenant.update({
      where: { id: tenantId },
      data: { brandingLogoUrl: null, brandingUpdatedAt: new Date() },
    });

    this.purgeCache(tenantId);
    return this.getBrandingForTenant(tenantId);
  }

  /**
   * Purga el cache para un tenant — llamado tras cada mutación. Expuesto
   * como método para que tests puedan forzar un re-fetch. El cache es
   * in-memory per-instance (NEW-FINDING para Sprint 6: migrar a Redis).
   */
  purgeCache(tenantId: string): void {
    this.cache.delete(tenantId);
  }
}
