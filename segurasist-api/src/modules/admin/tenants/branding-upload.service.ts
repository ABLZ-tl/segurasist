import { Inject, Injectable } from '@nestjs/common';
import { ENV_TOKEN } from '@config/config.module';
import type { Env } from '@config/env.schema';
import { S3Service } from '@infra/aws/s3.service';

/**
 * Sprint 5 — MT-1. Upload de logos de branding a S3.
 *
 * Bucket: `segurasist-tenant-branding-{env}` (creado por
 * `segurasist-infra/modules/s3-tenant-branding/main.tf`).
 * CDN: CloudFront con cache TTL 1h, OAI hacia el bucket. El bucket NO es
 * público (BlockPublicAccess=true); las imágenes se sirven sólo via la
 * distribución CloudFront. El service NO genera presigned URLs porque las
 * imágenes son públicas-via-CDN (assets de marca, no PII).
 *
 * Key layout: `{tenantId}/logo-{timestamp}.{ext}`
 *   - `tenantId` prefix → tenant override accidental no expone otro logo.
 *   - `timestamp` → cache busting (CloudFront TTL 1h; cliente nuevo gana
 *     cuando el admin sube un logo nuevo, sin invalidations).
 *   - `ext` derivado del mime (png/svg/webp).
 *
 * Dev/local: si el env tiene `AWS_ENDPOINT_URL` (LocalStack), el `S3Service`
 * ya re-apunta a localstack vía forcePathStyle. La URL devuelta para
 * desarrollo apunta directo al bucket localstack (no hay distribución
 * CloudFront en local) — el portal lo carga vía proxy.
 */

/**
 * Env vars que este service necesita (declaradas opcional para no romper el
 * boot del API hasta que `segurasist-infra` aplique la stack del bucket
 * Sprint 5). En NODE_ENV!='development' la falta se loguea como warn y
 * `uploadLogo` lanza para que el controller responda 503.
 */
export interface BrandingUploadEnv {
  S3_BUCKET_TENANT_BRANDING?: string;
  CLOUDFRONT_TENANT_BRANDING_DOMAIN?: string;
  AWS_ENDPOINT_URL?: string;
  NODE_ENV: Env['NODE_ENV'];
}

const MIME_TO_EXT: Record<'image/png' | 'image/svg+xml' | 'image/webp', string> = {
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
};

@Injectable()
export class BrandingUploadService {
  constructor(
    @Inject(ENV_TOKEN) private readonly env: Env & Partial<BrandingUploadEnv>,
    private readonly s3: S3Service,
  ) {}

  /**
   * Sube `buffer` al bucket de branding y devuelve la URL CloudFront pública
   * del nuevo objeto. El caller (BrandingService) debe persistir esa URL en
   * `tenant.branding_logo_url`.
   *
   * Throws si el bucket no está configurado (env var ausente). En dev local
   * sin LocalStack arrancado, el SDK lanza networking error — lo dejamos
   * burbujar al controller (responde 502/500). En prod sin bucket env vars
   * setteadas el deploy debería haber fallado en boot.
   */
  async uploadLogo(args: {
    tenantId: string;
    buffer: Buffer;
    mime: 'image/png' | 'image/svg+xml' | 'image/webp';
  }): Promise<string> {
    const { tenantId, buffer, mime } = args;
    const bucket = this.env.S3_BUCKET_TENANT_BRANDING;
    if (!bucket) {
      throw new Error(
        'S3_BUCKET_TENANT_BRANDING no configurado — segurasist-infra/modules/s3-tenant-branding requerido',
      );
    }
    const ext = MIME_TO_EXT[mime];
    const key = `${tenantId}/logo-${Date.now()}.${ext}`;

    await this.s3.putObject({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: mime,
      // Cache-Control 1h coordina con la TTL de CloudFront. Los clientes
      // re-piden cada hora aunque la URL no cambie; el path con timestamp
      // evita que un cambio de logo deje el viejo cacheado >1h.
      CacheControl: 'public, max-age=3600',
    });

    return this.buildPublicUrl(bucket, key);
  }

  /**
   * Calcula la URL pública del objeto. Prioridad:
   *   1. `CLOUDFRONT_TENANT_BRANDING_DOMAIN` (prod/staging) → `https://{domain}/{key}`.
   *   2. `AWS_ENDPOINT_URL` (LocalStack dev) → `{endpoint}/{bucket}/{key}` (path-style).
   *   3. Fallback S3 virtual-hosted (`https://{bucket}.s3.{region}.amazonaws.com/{key}`).
   */
  private buildPublicUrl(bucket: string, key: string): string {
    const cdn = this.env.CLOUDFRONT_TENANT_BRANDING_DOMAIN;
    if (cdn) {
      const trimmed = cdn.replace(/\/$/, '');
      return `https://${trimmed}/${key}`;
    }
    const endpoint = this.env.AWS_ENDPOINT_URL;
    if (endpoint) {
      const trimmed = endpoint.replace(/\/$/, '');
      return `${trimmed}/${bucket}/${key}`;
    }
    const region = this.env.AWS_REGION;
    return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  }
}
