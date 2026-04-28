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
import type { AuditContext } from '@modules/audit/audit-context.factory';
import { AuditWriterService } from '@modules/audit/audit-writer.service';
import { ForbiddenException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
// H-16 — `Prisma` ya no se importa: el cast `as unknown as Prisma.InsuredWhereInput`
// del lookup `urlForSelf` se eliminó (ver línea ~200).
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

/**
 * M2 — Scope polimórfico para reads cross-tenant.
 */
export interface CertificatesScope {
  platformAdmin: boolean;
  tenantId?: string;
  actorId?: string;
}

@Injectable()
export class CertificatesService {
  private readonly log = new Logger(CertificatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaBypass: PrismaBypassRlsService,
    private readonly s3: S3Service,
    private readonly sqs: SqsService,
    @Inject(ENV_TOKEN) private readonly env: Env,
    @Optional() private readonly auditWriter?: AuditWriterService,
  ) {}

  private readClientFor(
    scope: CertificatesScope,
  ): PrismaService['client'] | PrismaBypassRlsService['client'] {
    if (scope.platformAdmin) {
      this.log.log(
        { msg: 'platform admin bypass', actor: scope.actorId ?? null, query: scope.tenantId ?? null },
        'platform admin bypass',
      );
      return this.prismaBypass.client;
    }
    return this.prisma.client;
  }

  /**
   * Lista paginada con cursor (UUID-based). El cursor es el ID del último
   * cert de la página previa; usamos `cursor` + `take=limit+1` para
   * detectar `hasMore` sin un COUNT adicional.
   */
  async list(
    query: ListCertificatesQuery,
    arg: TenantCtx | CertificatesScope,
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
    const certScope: CertificatesScope = isCertScope(arg) ? arg : { platformAdmin: false, tenantId: arg.id };
    const userScope = this.scopeForUser(user);
    const client = this.readClientFor(certScope);
    const where: Record<string, unknown> = { deletedAt: null };
    if (query.insuredId) where.insuredId = query.insuredId;
    if (query.status) where.status = query.status;
    if (userScope) where.insuredId = userScope.insuredId;
    if (certScope.platformAdmin && certScope.tenantId) where.tenantId = certScope.tenantId;

    const items = await client.certificate.findMany({
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

  async findOne(id: string, arg: TenantCtx | CertificatesScope, user: AuthUser): Promise<unknown> {
    const certScope: CertificatesScope = isCertScope(arg) ? arg : { platformAdmin: false, tenantId: arg.id };
    const client = this.readClientFor(certScope);
    const where: Record<string, unknown> = { id, deletedAt: null };
    if (certScope.platformAdmin && certScope.tenantId) where.tenantId = certScope.tenantId;
    const cert = await client.certificate.findFirst({ where });
    if (!cert) throw new NotFoundException('Certificate not found');
    this.assertUserCanReadCert(user, cert.insuredId);
    const emailEvents = await client.emailEvent.findMany({
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
   * Portal asegurado — devuelve presigned URL del último certificado del
   * asegurado autenticado (TTL 7 días, mismo que el flow admin).
   *
   * RBAC defensivo: aún cuando el RolesGuard ya impone `@Roles('insured')`
   * a nivel handler, el service comprueba `user.role` para defensa en
   * profundidad. Audit log obligatorio: `action='read_downloaded'`,
   * `resourceType='certificates'`. F6 iter 2 H-01: el enum AuditAction se
   * extendió con `read_downloaded` para reemplazar el overload semántico
   * previo (`action='read'` + `payloadDiff.subAction='downloaded'`).
   *
   * Devuelve 404 si todavía no se emitió el certificado del asegurado — el FE
   * pinta empty state con CTA "tu certificado está siendo generado".
   */
  async urlForSelf(
    user: AuthUser,
    auditCtx?: AuditContext,
  ): Promise<{
    url: string;
    expiresAt: string;
    certificateId: string;
    version: number;
    issuedAt: string;
    validTo: string;
  }> {
    if (user.role !== 'insured') {
      throw new ForbiddenException('Endpoint solo para asegurados');
    }

    // H-16 — `cognitoSub` ya está en el Prisma client (schema Sprint 4: ver
    // `Insured.cognitoSub` y `@@unique([cognitoSub])`). El cast
    // `as unknown as Prisma.InsuredWhereInput` era deuda residual de cuando
    // la migración estaba pending. Eliminado para que el typing capture
    // regresiones futuras.
    const insured = await this.prisma.client.insured.findFirst({
      where: { cognitoSub: user.cognitoSub, deletedAt: null },
      select: { id: true, tenantId: true },
    });
    if (!insured) {
      throw new NotFoundException('Aún no se ha emitido tu certificado');
    }

    // B4-V2-16 — filtrar `status='issued'` evita devolver certs `revoked` o
    // `replaced` al asegurado: si la última versión está revocada, el portal
    // debe pintar empty state (cert siendo regenerado) en lugar de servir un
    // PDF con stamp inválido. Adicionalmente protege contra el placeholder
    // `revoked` que el PASS-1 fail path del pdf-worker persiste cuando
    // Puppeteer falla (ver F1 NEW-FINDING iter 1) — ese cert tiene hash
    // random y no debe alcanzar al usuario final.
    const cert = await this.prisma.client.certificate.findFirst({
      where: { insuredId: insured.id, deletedAt: null, status: 'issued' },
      orderBy: { issuedAt: 'desc' },
    });
    if (!cert) {
      throw new NotFoundException('Aún no se ha emitido tu certificado');
    }

    const ttlSeconds = 7 * 24 * 60 * 60;
    const url = await this.s3.getPresignedGetUrl(this.env.S3_BUCKET_CERTIFICATES, cert.s3Key, ttlSeconds);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

    // Audit fire-and-forget (F6 iter 2 H-01): action='read_downloaded' (enum
    // extendido) reemplaza el overload payloadDiff.subAction='downloaded'.
    // ip/userAgent/traceId vienen del AuditContext canónico derivado por el
    // controller (AuditContextFactory.fromRequest()). Sin auditWriter inyectado
    // (unit tests) → log y skip.
    if (this.auditWriter) {
      void this.auditWriter.record({
        tenantId: insured.tenantId,
        actorId: user.id,
        action: 'read_downloaded',
        resourceType: 'certificates',
        resourceId: cert.id,
        ip: auditCtx?.ip,
        userAgent: auditCtx?.userAgent,
        traceId: auditCtx?.traceId,
      });
    } else {
      this.log.log(
        { msg: 'cert.urlForSelf without auditWriter', certificateId: cert.id, actorId: user.id },
        'cert.urlForSelf',
      );
    }

    return {
      url,
      expiresAt,
      certificateId: cert.id,
      version: cert.version,
      issuedAt: cert.issuedAt.toISOString(),
      validTo: cert.validTo.toISOString().slice(0, 10),
    };
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

function isCertScope(arg: TenantCtx | CertificatesScope): arg is CertificatesScope {
  return typeof (arg as CertificatesScope).platformAdmin === 'boolean';
}
