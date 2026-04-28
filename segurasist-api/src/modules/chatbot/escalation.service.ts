/**
 * S4-08 — Escalation service: human-in-the-loop hand-off al equipo MAC.
 *
 * Flujo (iter 2 — refactor con `ChatConversation` ya cableado por S5):
 *   1. Cargamos `ChatConversation` por id (RLS aplica → cross-tenant imposible).
 *      Si no existe → NotFound.
 *   2. Si `status === 'escalated'` ya escalamos antes → devolvemos
 *      `alreadyEscalated=true` SIN reenviar emails ni tocar audit log.
 *      Esto previene doble-click + race condition con backend en flight.
 *   3. Cargamos el `Insured` (cross-tabla coherence + para email).
 *   4. Update atómico `WHERE id = ? AND status = 'active'` set
 *      `status='escalated'`. Si `count===0` significa que entre el SELECT y
 *      el UPDATE alguien más escaló → re-leemos y devolvemos
 *      `alreadyEscalated=true` (race-safe). Reemplaza la ventana 60min de
 *      iter1 con un guard determinista.
 *   5. Marcamos las `ChatMessage` no-escaladas de la conversación como
 *      `escalated=true` (consistencia histórica para queries legacy).
 *   6. Email al `MAC_SUPPORT_EMAIL` con histórico abreviado.
 *   7. Acuse al `insured.email` (si existe).
 *   8. Audit log con ctx HTTP completo.
 *
 * Audit: hasta que S5 publique migration enum extendiendo `AuditAction` con
 * `chatbot_escalated`, mantenemos el patrón existente
 * (`action='update'` + `payloadDiff.subAction='escalated'`). Ver feed
 * `S6-iter2.md` NEW-FINDING.
 */
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ENV_TOKEN } from '@config/config.module';
import type { Env } from '@config/env.schema';
import { PrismaService } from '@common/prisma/prisma.service';
import { AuditContextFactory } from '@modules/audit/audit-context.factory';
import { AuditWriterService } from '@modules/audit/audit-writer.service';
import { SesService } from '@infra/aws/ses.service';
import type { EscalateResult } from './dto/escalation.dto';

/**
 * Mensaje de chat truncado para el preview que va a MAC. Mantenemos el
 * payload chico (≤200 chars) para evitar emails de 1 MB cuando un user
 * tiene historial largo.
 */
interface TruncatedMessage {
  direction: 'inbound' | 'outbound';
  content: string;
  createdAt: Date;
}

@Injectable()
export class EscalationService {
  private readonly log = new Logger(EscalationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ses: SesService,
    private readonly auditWriter: AuditWriterService,
    private readonly auditCtx: AuditContextFactory,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {}

  /**
   * Escala la conversación al equipo MAC. Idempotente DB-side: la transición
   * `active → escalated` es atómica (`updateMany WHERE id=? AND status='active'`),
   * cualquier llamada subsecuente devuelve `alreadyEscalated=true` sin efectos
   * laterales (no email, no audit duplicado).
   */
  async escalate(insuredId: string, conversationId: string, reason: string): Promise<EscalateResult> {
    // 1) Resolvemos la conversación. RLS garantiza que solo se ve la del tenant
    // del request — un conversationId de otro tenant devuelve null = NotFound.
    const conversation = await this.prisma.client.chatConversation.findUnique({
      where: { id: conversationId },
      select: { id: true, tenantId: true, insuredId: true, status: true },
    });
    if (!conversation) {
      throw new NotFoundException('Conversación no encontrada');
    }

    // Defensa en profundidad: la conversación debe pertenecer al insured del
    // JWT. RLS ya filtra por tenant; este check evita que un insured A escale
    // la conversación del insured B dentro del mismo tenant.
    if (conversation.insuredId !== insuredId) {
      throw new NotFoundException('Conversación no encontrada');
    }

    // 2) Idempotencia rápida — status ya es `escalated` antes incluso del UPDATE.
    if (conversation.status === 'escalated') {
      this.log.log({ insuredId, conversationId }, 'Escalation skipped — conversation already escalated');
      return {
        conversationId,
        alreadyEscalated: true,
        emailSentToMac: false,
        acknowledgementSentToInsured: false,
      };
    }

    // 3) Cargamos el insured (para fullName/email del template + audit). RLS
    // aplica → cross-tenant impossible. Si no existe (raro: la conversación
    // referenciaba un insured borrado), NotFound.
    const insured = await this.prisma.client.insured.findUnique({
      where: { id: insuredId },
      select: { id: true, tenantId: true, fullName: true, email: true },
    });
    if (!insured) {
      throw new NotFoundException('Insured no encontrado');
    }

    // 4) Transición atómica `active → escalated`. Si entre el SELECT del paso 1
    // y este UPDATE alguien más ya escaló (race), `count===0` y devolvemos
    // `alreadyEscalated=true` sin tocar email/audit.
    const transition = await this.prisma.client.chatConversation.updateMany({
      where: { id: conversationId, status: 'active' },
      data: { status: 'escalated' },
    });
    if (transition.count === 0) {
      this.log.log({ insuredId, conversationId }, 'Escalation race detected — another caller already escalated');
      return {
        conversationId,
        alreadyEscalated: true,
        emailSentToMac: false,
        acknowledgementSentToInsured: false,
      };
    }

    // 5) Snapshot de mensajes para el email (últimos 20 de esta conversación).
    const recentMessages = await this.prisma.client.chatMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { direction: true, content: true, createdAt: true },
    });

    // Marcamos las ChatMessage no-escaladas como escalated=true para
    // consistencia histórica (queries legacy / dashboards filtran por flag).
    await this.prisma.client.chatMessage.updateMany({
      where: { conversationId, escalated: false },
      data: { escalated: true },
    });

    // 6) Email a MAC.
    const macEmail = this.env.MAC_SUPPORT_EMAIL;
    const fromAddress = `no-reply@${this.env.SES_SENDER_DOMAIN}`;
    let emailSentToMac = false;
    try {
      await this.ses.send({
        to: macEmail,
        from: fromAddress,
        subject: `[SegurAsist] Escalamiento chatbot: ${insured.fullName}`,
        html: this.buildEscalationEmail(insured, conversationId, reason, recentMessages.reverse()),
        tags: {
          tenant_id: insured.tenantId,
          email_type: 'chatbot-escalation',
          conversation_id: conversationId,
        },
      });
      emailSentToMac = true;
    } catch (err) {
      this.log.warn({ err: err instanceof Error ? err.message : String(err), insuredId }, 'Escalation email to MAC failed');
    }

    // 7) Acuse al asegurado. Si no tiene email, lo skipeamos silenciosamente —
    // MVP no enforza email obligatorio en Insured (es nullable en schema).
    let acknowledgementSentToInsured = false;
    if (insured.email) {
      try {
        await this.ses.send({
          to: insured.email,
          from: fromAddress,
          subject: 'Recibimos tu solicitud — SegurAsist',
          html: this.buildAcknowledgementEmail(insured.fullName),
          tags: {
            tenant_id: insured.tenantId,
            email_type: 'chatbot-escalation-ack',
            conversation_id: conversationId,
          },
        });
        acknowledgementSentToInsured = true;
      } catch (err) {
        this.log.warn({ err: err instanceof Error ? err.message : String(err), insuredId }, 'Acknowledgement email to insured failed');
      }
    }

    // 8) Audit log con ctx HTTP completo. Migrado a `chatbot_escalated`
    // (enum extendido en migration 20260429_audit_action_sprint4_extend de S5).
    await this.auditWriter.record({
      ...this.auditCtx.fromRequest(),
      tenantId: insured.tenantId,
      action: 'chatbot_escalated',
      resourceType: 'chatbot.conversation',
      resourceId: conversationId,
      payloadDiff: {
        insuredId,
        reason,
        emailSentToMac,
        acknowledgementSentToInsured,
      },
    });

    return {
      conversationId,
      alreadyEscalated: false,
      emailSentToMac,
      acknowledgementSentToInsured,
    };
  }

  /**
   * Render HTML del email a MAC. Escapa todos los user-controlled fields
   * (`reason`, `content`, `fullName`) para prevenir XSS al abrir el preview
   * en un cliente con render HTML.
   */
  private buildEscalationEmail(
    insured: { id: string; fullName: string; email: string | null; tenantId: string },
    conversationId: string,
    reason: string,
    messages: TruncatedMessage[],
  ): string {
    const escName = escapeHtml(insured.fullName);
    const escReason = escapeHtml(reason);
    const escEmail = insured.email ? escapeHtml(insured.email) : '(sin email registrado)';
    const messagesHtml = messages
      .map((m) => {
        const who = m.direction === 'inbound' ? 'Asegurado' : 'Bot';
        const time = m.createdAt.toISOString();
        const content = escapeHtml(truncate(m.content, 200));
        return `<li><strong>${who}</strong> <em>${time}</em><br/>${content}</li>`;
      })
      .join('');

    return `<!doctype html>
<html lang="es-MX">
  <body style="font-family:Arial,sans-serif;color:#222;">
    <h2>Escalamiento de chatbot</h2>
    <p><strong>Asegurado:</strong> ${escName}</p>
    <p><strong>Email:</strong> ${escEmail}</p>
    <p><strong>Insured ID:</strong> ${insured.id}</p>
    <p><strong>Conversation ID:</strong> ${conversationId}</p>
    <p><strong>Razón:</strong></p>
    <blockquote style="border-left:4px solid #ccc;padding-left:12px;">${escReason}</blockquote>
    <h3>Histórico (últimos ${messages.length}):</h3>
    <ul>${messagesHtml || '<li>(sin mensajes previos)</li>'}</ul>
    <hr/>
    <p style="font-size:12px;color:#666;">Email automático — SegurAsist chatbot escalation. Tenant: ${insured.tenantId}.</p>
  </body>
</html>`;
  }

  /**
   * Render del acuse al asegurado. Texto neutro — no incluimos detalles del
   * ticket interno (campo `reason`) para evitar leak si el correo cae en un
   * inbox compartido por error.
   */
  private buildAcknowledgementEmail(fullName: string): string {
    const escName = escapeHtml(fullName);
    return `<!doctype html>
<html lang="es-MX">
  <body style="font-family:Arial,sans-serif;color:#222;">
    <h2>Hola ${escName},</h2>
    <p>Recibimos tu solicitud y la canalizamos al equipo de atención de MAC.</p>
    <p>En breve nos pondremos en contacto contigo. Mientras tanto, puedes seguir utilizando el portal SegurAsist.</p>
    <p>Gracias por tu paciencia.</p>
    <p>— Equipo SegurAsist</p>
  </body>
</html>`;
  }
}

/** Escape básico HTML para prevenir XSS en preview de Mailpit / cliente MAC. */
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max - 1)}…`;
}
