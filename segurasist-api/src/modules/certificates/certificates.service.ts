/**
 * CertificatesService — listing, detalle, presigned URL, re-emisión y
 * verificación pública.
 *
 * Toda lectura/escritura usa el `PrismaService` request-scoped → fija
 * `app.current_tenant` por SET LOCAL antes de cada query (RLS). El endpoint
 * público de verificación es la única excepción: NO tiene tenant en el
 * request, así que usa `PrismaBypassRlsService` (rol BYPASSRLS) y devuelve
 * exclusivamente datos no-PII.
 */
import { AuthUser } from '@common/decorators/current-user.decorator';
import { TenantCtx } from '@common/decorators/tenant.decorator';
import { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { ENV_TOKEN } from '@config/config.module';
import { Env } from '@config/env.schema';
import { S3Service } from '@infra/aws/s3.service';
import { SqsService } from '@infra/aws/sqs.service';
import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  CERTIFICATE_REISSUE_REQUESTED_KIND,
  type CertificateReissueRequestedEvent,
} from '../../events/certificate-events';
import {
  ListCertificatesQuery,
  ListEmailEventsQuery,
  ReissueCertificateDto,
  ResendEmailDto,
} from './dto/certificate.dto';

/**
 * Decoración del usuario para verificar acceso por rol.
 *  - admins/operator/supervisor: ven todos los certificados del tenant.
 *  - insured: solo los suyos (matched por `custom:insured_id`).
 *
 * El claim `custom:insured_id` lo emite Cognito en el id token del pool
 * insured (Sprint 1 cableó el mapping). Si está ausente, el RBAC es defensa
 * en profundidad: no se devuelven certs si el role es `insured` sin claim.
 */
type UserCertScopeFilter = { insuredId: string } | null;

@Injectable()
export class CertificatesService {
  private readonly log = new Logger(CertificatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaBypass: PrismaBypassRlsService,
    private readonly s3: S3Service,
    private readonly sqs: SqsService,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {}

  /**
   * Lista paginada con cursor (UUID-based). El cursor es el ID del último
   * cert de la página previa; usamos `cursor` + `take=limit+1` para
   * detectar `hasMore` sin un COUNT adicional.
   */
  async list(
    query: ListCertificatesQuery,
    _tenant: TenantCtx,
    user: AuthUser,
  ): Promise<{
    items: Array<{
      id: string;
      version: number;
      hash: string;
      status: string;
      issuedAt: Date;
      validTo: Date;
      insuredId: string;
    }>;
    nextCursor: string | null;
  }> {
    const scope = this.scopeForUser(user);
    const where: Record<string, unknown> = { deletedAt: null };
    if (query.insuredId) where.insuredId = query.insuredId;
    if (query.status) where.status = query.status;
    if (scope) where.insuredId = scope.insuredId;

    const items = await this.prisma.client.certificate.findMany({
      where,
      orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        version: true,
        hash: true,
        status: true,
        issuedAt: true,
        validTo: true,
        insuredId: true,
      },
    });

    const hasMore = items.length > query.limit;
    const trimmed = hasMore ? items.slice(0, query.limit) : items;
    const nextCursor = hasMore ? (trimmed[trimmed.length - 1]?.id ?? null) : null;
    return { items: trimmed, nextCursor };
  }

  async findOne(id: string, _tenant: TenantCtx, user: AuthUser): Promise<unknown> {
    const cert = await this.prisma.client.certificate.findFirst({
      where: { id, deletedAt: null },
    });
    if (!cert) throw new NotFoundException('Certificate not found');
    this.assertUserCanReadCert(user, cert.insuredId);
    const emailEvents = await this.prisma.client.emailEvent.findMany({
      where: { certificateId: id },
      orderBy: { occurredAt: 'desc' },
      take: 50,
    });
    return { ...cert, emailEvents };
  }

  /**
   * Devuelve presigned URL S3 con TTL 7 días. Aplica RBAC + scope insured.
   */
  async presignedUrl(
    id: string,
    _tenant: TenantCtx,
    user: AuthUser,
  ): Promise<{
    url: string;
    expiresAt: string;
  }> {
    const cert = await this.prisma.client.certificate.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, s3Key: true, insuredId: true },
    });
    if (!cert) throw new NotFoundException('Certificate not found');
    this.assertUserCanReadCert(user, cert.insuredId);
    const ttlSeconds = 7 * 24 * 60 * 60;
    const url = await this.s3.getPresignedGetUrl(this.env.S3_BUCKET_CERTIFICATES, cert.s3Key, ttlSeconds);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    return { url, expiresAt };
  }

  /**
   * Re-emite un certificado. La generación real ocurre en el worker PDF —
   * este método solo persiste la solicitud (audit) y encola el evento.
   * El cert nuevo aparecerá con `version+1` cuando el worker lo genere.
   */
  async reissue(
    id: string,
    dto: ReissueCertificateDto,
    tenant: TenantCtx,
  ): Promise<{
    queued: true;
    certificateId: string;
    reason: string;
  }> {
    const cert = await this.prisma.client.certificate.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, status: true, insuredId: true, version: true },
    });
    if (!cert) throw new NotFoundException('Certificate not found');
    if (cert.status === 'revoked') {
      throw new ForbiddenException('Certificate revoked; cannot reissue');
    }
    const event: CertificateReissueRequestedEvent = {
      kind: CERTIFICATE_REISSUE_REQUESTED_KIND,
      tenantId: tenant.id,
      certificateId: cert.id,
      reason: dto.reason,
      occurredAt: new Date().toISOString(),
    };
    await this.sqs.sendMessage(this.env.SQS_QUEUE_PDF, event as unknown as Record<string, unknown>);
    this.log.log({ certId: cert.id, reason: dto.reason }, 'reissue queued');
    return { queued: true, certificateId: cert.id, reason: dto.reason };
  }

  /**
   * Reenvía email del certificado actual. Encola un job al email worker
   * con override `to` opcional. NO regenera PDF.
   */
  async resendEmail(
    id: string,
    dto: ResendEmailDto,
    tenant: TenantCtx,
  ): Promise<{ queued: true; certificateId: string; to?: string }> {
    const cert = await this.prisma.client.certificate.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, insuredId: true, hash: true, s3Key: true, status: true },
    });
    if (!cert) throw new NotFoundException('Certificate not found');
    if (cert.status === 'revoked') {
      throw new ForbiddenException('Certificate revoked; cannot resend');
    }
    // Reusa la cola de email con un payload `certificate.issued` synthetic
    // — el email worker no distingue entre primer envío y reenvío (es
    // idempotente respecto del cert).
    const payload = {
      kind: 'certificate.issued' as const,
      tenantId: tenant.id,
      certificateId: cert.id,
      insuredId: cert.insuredId,
      version: 0,
      s3Key: cert.s3Key,
      hash: cert.hash,
      verificationUrl: `${this.env.CERT_BASE_URL}/v1/certificates/verify/${cert.hash}`,
      occurredAt: new Date().toISOString(),
      ...(dto.to ? { overrideTo: dto.to } : {}),
    };
    await this.sqs.sendMessage(this.env.SQS_QUEUE_EMAIL, payload);
    return { queued: true, certificateId: cert.id, ...(dto.to ? { to: dto.to } : {}) };
  }

  async listEmailEvents(
    id: string,
    query: ListEmailEventsQuery,
    _tenant: TenantCtx,
    user: AuthUser,
  ): Promise<{ items: unknown[]; nextCursor: string | null }> {
    const cert = await this.prisma.client.certificate.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, insuredId: true },
    });
    if (!cert) throw new NotFoundException('Certificate not found');
    this.assertUserCanReadCert(user, cert.insuredId);
    const items = await this.prisma.client.emailEvent.findMany({
      where: { certificateId: id },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > query.limit;
    const trimmed = hasMore ? items.slice(0, query.limit) : items;
    const nextCursor = hasMore ? (trimmed[trimmed.length - 1]?.id ?? null) : null;
    return { items: trimmed, nextCursor };
  }

  /**
   * Verificación pública por hash. Devuelve datos no-PII. El hash es la
   * sumacomprobación SHA-256 hex del PDF — mismo valor que el QR contiene.
   *
   * Usa BYPASSRLS porque el endpoint es público (sin tenant). No expone
   * CURP, RFC, email ni teléfono — sólo nombre + paquete + fechas + tenant.
   */
  async verify(hash: string): Promise<{
    valid: boolean;
    insured?: { fullName: string; packageName: string };
    validFrom?: Date;
    validTo?: Date;
    issuedAt?: Date;
    tenantName?: string;
  }> {
    if (!/^[a-f0-9]{64}$/i.test(hash)) {
      // Devolvemos `valid:false` en lugar de 400 — un atacante que pruebe
      // hashes random no obtiene info sobre la forma esperada del input.
      return { valid: false };
    }
    const cert = await this.prismaBypass.client.certificate.findFirst({
      where: { hash, deletedAt: null, status: 'issued' },
      select: {
        validTo: true,
        issuedAt: true,
        tenantId: true,
        insuredId: true,
      },
    });
    if (!cert) return { valid: false };
    const insured = await this.prismaBypass.client.insured.findFirst({
      where: { id: cert.insuredId, tenantId: cert.tenantId },
      select: {
        fullName: true,
        validFrom: true,
        package: { select: { name: true } },
      },
    });
    const tenant = await this.prismaBypass.client.tenant.findFirst({
      where: { id: cert.tenantId },
      select: { name: true },
    });
    if (!insured || !tenant) return { valid: false };
    return {
      valid: true,
      insured: {
        fullName: insured.fullName,
        packageName: insured.package.name,
      },
      validFrom: insured.validFrom,
      validTo: cert.validTo,
      issuedAt: cert.issuedAt,
      tenantName: tenant.name,
    };
  }

  /**
   * RBAC helper: reglas de scope por rol. `null` = sin filtro adicional
   * (el RLS ya filtra por tenant).
   */
  private scopeForUser(user: AuthUser): UserCertScopeFilter {
    if (user.role === 'insured') {
      const insuredId = (user as unknown as Record<string, string | undefined>)['insuredId'];
      // Si el rol es insured pero no hay claim, NO devolvemos nada — defensa
      // en profundidad: un token mal formado no debe filtrar otros certs.
      if (typeof insuredId === 'string' && insuredId.length > 0) {
        return { insuredId };
      }
      // Sin claim insured válido: forzamos un filtro que no matchea nada.
      return { insuredId: '00000000-0000-0000-0000-000000000000' };
    }
    return null;
  }

  private assertUserCanReadCert(user: AuthUser, certInsuredId: string): void {
    const scope = this.scopeForUser(user);
    if (scope && scope.insuredId !== certInsuredId) {
      throw new ForbiddenException('Certificate belongs to another insured');
    }
  }
}
