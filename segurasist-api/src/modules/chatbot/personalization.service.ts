/**
 * S4-07 — Personalization service del chatbot.
 *
 * Resuelve placeholders del tipo `{{validTo}}` dentro del template de respuesta
 * de una entrada de la KB (matched por `KbService`) usando los datos del
 * `Insured` autenticado. La resolución es 1) READ-ONLY contra la BD via
 * `PrismaService` (request-scoped → RLS por tenant aplica automáticamente),
 * 2) determinista — el mismo template + insured produce el mismo output, y
 * 3) tolerante a campos faltantes (`{{packageName}}` con package nullable
 * devuelve un dash em "—" en lugar de "undefined").
 *
 * S5 (KB matching) llama:
 *
 *   const tpl = await this.kb.findAnswerForIntent(...);
 *   const personalized = await this.personalization.fillPlaceholders(tpl, insuredId);
 *
 * Placeholders soportados (ver método `fillPlaceholders`):
 *
 *   - `{{validTo}}` — fecha fin de vigencia formateada `es-MX` ("15 de enero de 2027").
 *   - `{{validFrom}}` — fecha inicio de vigencia (idem formato).
 *   - `{{fullName}}` — nombre completo.
 *   - `{{firstName}}` — primer nombre (split por espacio).
 *   - `{{packageName}}` — nombre del paquete o "—" si no hay package.
 *   - `{{packageType}}` — alias de packageName (los paquetes MVP no tienen `type`
 *     explícito; reservado para Sprint 5 cuando se agregue Package.tier).
 *   - `{{coveragesCount}}` — cuenta de coverages del paquete.
 *   - `{{coveragesList}}` — comma-separated `coverage.name` o "—" si vacío.
 *   - `{{claimsCount}}` — cuenta de claims activos del insured (status != 'closed').
 *   - `{{insuredId}}` — uuid del insured (útil para tickets de escalación).
 *
 * NO se resuelven placeholders no listados — quedan literales en el output
 * para que el caller (S5) detecte templates con typos vía un test de
 * "no debe contener `{{`" después de la resolución.
 */
import { PrismaService } from '@common/prisma/prisma.service';
import { Injectable, NotFoundException } from '@nestjs/common';

/**
 * Datos resueltos del insured listos para sustituir en un template.
 * Exportado para que tests puedan armar el shape sin pegar a Prisma real.
 */
export interface InsuredContext {
  id: string;
  fullName: string;
  firstName: string;
  validFrom: Date;
  validTo: Date;
  packageName: string | null;
  coverages: Array<{ name: string }>;
  claimsCount: number;
}

const ES_MX_DATE_OPTS: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'America/Mexico_City',
};

@Injectable()
export class PersonalizationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reemplaza todos los placeholders soportados en `template` con los datos
   * del insured `insuredId`. Lanza `NotFoundException` si no existe (el
   * caller — `chatbot.service` — debe traducir a 404 público o degradar
   * a respuesta sin personalización según UX decida).
   *
   * El insured se busca con el cliente request-scoped; el filtro RLS por
   * `tenant_id` aplica vía `PrismaService` y descarta cross-tenant: si el
   * insured pertenece a otro tenant, la query devuelve `null` y emitimos
   * el mismo NotFound (no leak de existencia).
   */
  async fillPlaceholders(template: string, insuredId: string): Promise<string> {
    const ctx = await this.loadInsuredContext(insuredId);
    return this.applyTemplate(template, ctx);
  }

  /**
   * Carga el contexto del insured. Separado de `fillPlaceholders` para que
   * tests del template engine no requieran mockear Prisma — sólo arman un
   * `InsuredContext` y llaman `applyTemplate(...)`.
   */
  async loadInsuredContext(insuredId: string): Promise<InsuredContext> {
    // Prisma extended client (rls-tenant-context) preserva los include types
    // pero el inferencer del extension a veces los pierde — castamos a un
    // shape estructural local para no depender del inferencer interno.
    type InsuredWithIncludes = {
      id: string;
      fullName: string;
      validFrom: Date;
      validTo: Date;
      package: { name: string; coverages: Array<{ name: string }> } | null;
      claims: Array<{ id: string }>;
    };
    // Claims considerados "activos" — todos menos `paid`/`rejected` (estados
    // terminales). El enum DB ClaimStatus no tiene `closed`; estos dos cubren
    // el concepto.
    const insured = (await this.prisma.client.insured.findUnique({
      where: { id: insuredId },
      include: {
        package: {
          include: { coverages: { where: { deletedAt: null }, select: { name: true } } },
        },
        claims: {
          where: { status: { notIn: ['paid', 'rejected'] }, deletedAt: null },
          select: { id: true },
        },
      },
    })) as InsuredWithIncludes | null;
    if (!insured) {
      throw new NotFoundException('Insured no encontrado para personalización');
    }

    const fullName = insured.fullName;
    const firstName = fullName.split(/\s+/, 1)[0] ?? fullName;

    return {
      id: insured.id,
      fullName,
      firstName,
      validFrom: insured.validFrom,
      validTo: insured.validTo,
      packageName: insured.package?.name ?? null,
      coverages: insured.package?.coverages ?? [],
      claimsCount: insured.claims?.length ?? 0,
    };
  }

  /**
   * Aplica el template engine sobre un contexto YA resuelto. PURO — no toca BD.
   *
   * Estrategia: replace global por placeholder. Usamos un mapa explícito
   * (no eval) para evitar inyección de placeholders dinámicos desde KB
   * (un admin malicioso editando KB no puede escapar a otros campos del
   * insured ni leer secrets del proceso).
   */
  applyTemplate(template: string, ctx: InsuredContext): string {
    const replacements = this.buildReplacements(ctx);
    let out = template;
    for (const [placeholder, value] of replacements) {
      // RegExp escapado: el placeholder es controlado por nosotros, pero
      // mantenemos `replaceAll` para evitar dependencia regex por iteración.
      out = out.split(placeholder).join(value);
    }
    return out;
  }

  private buildReplacements(ctx: InsuredContext): Array<[string, string]> {
    const dash = '—';
    const validToStr = ctx.validTo.toLocaleDateString('es-MX', ES_MX_DATE_OPTS);
    const validFromStr = ctx.validFrom.toLocaleDateString('es-MX', ES_MX_DATE_OPTS);
    const packageName = ctx.packageName ?? dash;
    const coveragesNames = ctx.coverages.map((c) => c.name).filter((n) => n.length > 0);
    const coveragesList = coveragesNames.length > 0 ? coveragesNames.join(', ') : dash;

    return [
      ['{{validTo}}', validToStr],
      ['{{validFrom}}', validFromStr],
      ['{{fullName}}', ctx.fullName],
      ['{{firstName}}', ctx.firstName],
      ['{{packageName}}', packageName],
      // Sprint 5 separará tier/type del name; por ahora alias para no romper
      // KB entries que ya usan {{packageType}} en mocks.
      ['{{packageType}}', packageName],
      ['{{coveragesCount}}', String(ctx.coverages.length)],
      ['{{coveragesList}}', coveragesList],
      ['{{claimsCount}}', String(ctx.claimsCount)],
      ['{{insuredId}}', ctx.id],
    ];
  }
}
