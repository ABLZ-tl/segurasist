/**
 * Unit tests S4-08 EscalationService — iter 2 (post-S5 ChatConversation).
 *
 * Cubrimos:
 *   - happy path: conversation active + insured con email → 1 email a MAC + 1 acuse + audit + status=escalated.
 *   - idempotencia DB-side: conversation.status='escalated' → segundo call NO envía emails ni audit.
 *   - race condition: SELECT ve 'active' pero UPDATE WHERE status='active' devuelve count=0 → alreadyEscalated.
 *   - sin email del insured → ack se skipea silenciosamente, MAC sí recibe.
 *   - conversation no existe → NotFoundException.
 *   - conversation pertenece a otro insured (mismo tenant) → NotFoundException (defensa profundidad).
 *   - insured no existe (referential mismatch) → NotFoundException.
 *   - SES MAC falla → emailSentToMac=false pero la promesa no rechaza.
 *   - XSS escape en preview HTML.
 *
 * Mocks: PrismaService.client.{chatConversation,insured,chatMessage}, SesService.send,
 * AuditWriterService.record, AuditContextFactory.fromRequest. Env stub.
 */
import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../../../src/common/prisma/prisma.service';
import type { Env } from '../../../../src/config/env.schema';
import type { SesService } from '../../../../src/infra/aws/ses.service';
import type { AuditContextFactory } from '../../../../src/modules/audit/audit-context.factory';
import type { AuditWriterService } from '../../../../src/modules/audit/audit-writer.service';
import { EscalationService } from '../../../../src/modules/chatbot/escalation.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const INSURED_ID = '22222222-2222-2222-2222-222222222222';
const CONVERSATION_ID = '33333333-3333-3333-3333-333333333333';

interface Harness {
  svc: EscalationService;
  prismaConversationFindUnique: jest.Mock;
  prismaConversationUpdateMany: jest.Mock;
  prismaInsuredFindUnique: jest.Mock;
  prismaChatMessageFindMany: jest.Mock;
  prismaChatMessageUpdateMany: jest.Mock;
  sesSend: jest.Mock;
  auditRecord: jest.Mock;
  auditFromRequest: jest.Mock;
}

function makeHarness(): Harness {
  const prismaConversationFindUnique = jest.fn();
  const prismaConversationUpdateMany = jest.fn();
  const prismaInsuredFindUnique = jest.fn();
  const prismaChatMessageFindMany = jest.fn();
  const prismaChatMessageUpdateMany = jest.fn();
  const prisma = {
    client: {
      chatConversation: {
        findUnique: prismaConversationFindUnique,
        updateMany: prismaConversationUpdateMany,
      },
      insured: { findUnique: prismaInsuredFindUnique },
      chatMessage: {
        findMany: prismaChatMessageFindMany,
        updateMany: prismaChatMessageUpdateMany,
      },
    },
  } as unknown as PrismaService;

  const sesSend = jest.fn().mockResolvedValue({ messageId: 'msg-1', transport: 'smtp' });
  const ses = { send: sesSend } as unknown as SesService;

  const auditRecord = jest.fn().mockResolvedValue(undefined);
  const auditWriter = { record: auditRecord } as unknown as AuditWriterService;

  const auditFromRequest = jest.fn().mockReturnValue({
    actorId: 'actor-1',
    tenantId: TENANT_ID,
    ip: '127.0.0.1',
    userAgent: 'jest',
    traceId: 'trace-1',
  });
  const auditCtx = { fromRequest: auditFromRequest } as unknown as AuditContextFactory;

  const env = {
    MAC_SUPPORT_EMAIL: 'mac-support@segurasist.local',
    SES_SENDER_DOMAIN: 'segurasist.local',
  } as unknown as Env;

  const svc = new EscalationService(prisma, ses, auditWriter, auditCtx, env);
  return {
    svc,
    prismaConversationFindUnique,
    prismaConversationUpdateMany,
    prismaInsuredFindUnique,
    prismaChatMessageFindMany,
    prismaChatMessageUpdateMany,
    sesSend,
    auditRecord,
    auditFromRequest,
  };
}

/** Factory de conversation activa válida para el insured/tenant del test. */
function activeConversation(overrides: Partial<{ status: string; insuredId: string }> = {}) {
  return {
    id: CONVERSATION_ID,
    tenantId: TENANT_ID,
    insuredId: INSURED_ID,
    status: 'active',
    ...overrides,
  };
}

describe('EscalationService.escalate', () => {
  it('happy path: conversation active → email a MAC, acuse al asegurado, audit y status=escalated', async () => {
    const h = makeHarness();
    h.prismaConversationFindUnique.mockResolvedValueOnce(activeConversation());
    h.prismaInsuredFindUnique.mockResolvedValueOnce({
      id: INSURED_ID,
      tenantId: TENANT_ID,
      fullName: 'Juan Pérez',
      email: 'juan@example.com',
    });
    h.prismaConversationUpdateMany.mockResolvedValueOnce({ count: 1 });
    h.prismaChatMessageFindMany.mockResolvedValueOnce([
      { direction: 'inbound', content: 'hola', createdAt: new Date('2026-04-27T10:00:00Z') },
      { direction: 'outbound', content: 'bot reply', createdAt: new Date('2026-04-27T10:00:01Z') },
    ]);
    h.prismaChatMessageUpdateMany.mockResolvedValueOnce({ count: 2 });

    const out = await h.svc.escalate(INSURED_ID, CONVERSATION_ID, 'no entiendo mi póliza');

    expect(out).toEqual({
      conversationId: CONVERSATION_ID,
      alreadyEscalated: false,
      emailSentToMac: true,
      acknowledgementSentToInsured: true,
    });

    // Transición atómica realizada con guard de status.
    expect(h.prismaConversationUpdateMany).toHaveBeenCalledWith({
      where: { id: CONVERSATION_ID, status: 'active' },
      data: { status: 'escalated' },
    });

    // 2 emails enviados (MAC + asegurado).
    expect(h.sesSend).toHaveBeenCalledTimes(2);
    const [macCall, ackCall] = h.sesSend.mock.calls.map((args) => args[0]);
    expect(macCall.to).toBe('mac-support@segurasist.local');
    expect(macCall.subject).toContain('Juan Pérez');
    expect(macCall.tags).toMatchObject({
      tenant_id: TENANT_ID,
      email_type: 'chatbot-escalation',
      conversation_id: CONVERSATION_ID,
    });
    expect(macCall.html).toContain('Juan Pérez');
    expect(macCall.html).toContain('no entiendo mi póliza');

    expect(ackCall.to).toBe('juan@example.com');
    expect(ackCall.tags.email_type).toBe('chatbot-escalation-ack');

    // Audit log con ctx HTTP — action `chatbot_escalated` (migration S5 iter 2).
    expect(h.auditRecord).toHaveBeenCalledTimes(1);
    expect(h.auditFromRequest).toHaveBeenCalled();
    const auditCall = h.auditRecord.mock.calls[0][0];
    expect(auditCall.tenantId).toBe(TENANT_ID);
    expect(auditCall.action).toBe('chatbot_escalated');
    expect(auditCall.resourceType).toBe('chatbot.conversation');
    expect(auditCall.resourceId).toBe(CONVERSATION_ID);
    expect(auditCall.payloadDiff).toMatchObject({
      insuredId: INSURED_ID,
      reason: 'no entiendo mi póliza',
    });
    expect(auditCall.ip).toBe('127.0.0.1');
    expect(auditCall.traceId).toBe('trace-1');

    // Marker histórico: chatMessages de la conversación marcadas escaladas.
    expect(h.prismaChatMessageUpdateMany).toHaveBeenCalledWith({
      where: { conversationId: CONVERSATION_ID, escalated: false },
      data: { escalated: true },
    });
    // Snapshot scoped a la conversación, no al insured.
    expect(h.prismaChatMessageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { conversationId: CONVERSATION_ID } }),
    );
  });

  it('idempotencia: status="escalated" desde el SELECT → NO envía emails ni audit', async () => {
    const h = makeHarness();
    h.prismaConversationFindUnique.mockResolvedValueOnce(activeConversation({ status: 'escalated' }));

    const out = await h.svc.escalate(INSURED_ID, CONVERSATION_ID, 'razón irrelevante');

    expect(out).toEqual({
      conversationId: CONVERSATION_ID,
      alreadyEscalated: true,
      emailSentToMac: false,
      acknowledgementSentToInsured: false,
    });

    // Path corto: ni siquiera llegamos a cargar el insured.
    expect(h.prismaInsuredFindUnique).not.toHaveBeenCalled();
    expect(h.prismaConversationUpdateMany).not.toHaveBeenCalled();
    expect(h.sesSend).not.toHaveBeenCalled();
    expect(h.auditRecord).not.toHaveBeenCalled();
  });

  it('race condition: SELECT ve active pero UPDATE devuelve count=0 → alreadyEscalated, no SES, no audit', async () => {
    const h = makeHarness();
    h.prismaConversationFindUnique.mockResolvedValueOnce(activeConversation());
    h.prismaInsuredFindUnique.mockResolvedValueOnce({
      id: INSURED_ID,
      tenantId: TENANT_ID,
      fullName: 'Juan Pérez',
      email: 'juan@example.com',
    });
    // Otro caller escaló entre el SELECT y nuestro UPDATE.
    h.prismaConversationUpdateMany.mockResolvedValueOnce({ count: 0 });

    const out = await h.svc.escalate(INSURED_ID, CONVERSATION_ID, 'razón');

    expect(out).toEqual({
      conversationId: CONVERSATION_ID,
      alreadyEscalated: true,
      emailSentToMac: false,
      acknowledgementSentToInsured: false,
    });
    expect(h.sesSend).not.toHaveBeenCalled();
    expect(h.auditRecord).not.toHaveBeenCalled();
    // Tampoco mutamos las chatMessages históricas.
    expect(h.prismaChatMessageUpdateMany).not.toHaveBeenCalled();
  });

  it('insured sin email → ack skipped; MAC sí recibe', async () => {
    const h = makeHarness();
    h.prismaConversationFindUnique.mockResolvedValueOnce(activeConversation());
    h.prismaInsuredFindUnique.mockResolvedValueOnce({
      id: INSURED_ID,
      tenantId: TENANT_ID,
      fullName: 'Sin Email',
      email: null,
    });
    h.prismaConversationUpdateMany.mockResolvedValueOnce({ count: 1 });
    h.prismaChatMessageFindMany.mockResolvedValueOnce([]);
    h.prismaChatMessageUpdateMany.mockResolvedValueOnce({ count: 0 });

    const out = await h.svc.escalate(INSURED_ID, CONVERSATION_ID, 'help');
    expect(out.emailSentToMac).toBe(true);
    expect(out.acknowledgementSentToInsured).toBe(false);
    expect(h.sesSend).toHaveBeenCalledTimes(1);
    expect(h.sesSend.mock.calls[0][0].to).toBe('mac-support@segurasist.local');
  });

  it('conversation no existe → NotFoundException', async () => {
    const h = makeHarness();
    h.prismaConversationFindUnique.mockResolvedValueOnce(null);
    await expect(h.svc.escalate(INSURED_ID, CONVERSATION_ID, 'help')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(h.prismaInsuredFindUnique).not.toHaveBeenCalled();
    expect(h.sesSend).not.toHaveBeenCalled();
    expect(h.auditRecord).not.toHaveBeenCalled();
  });

  it('conversation pertenece a otro insured (mismo tenant) → NotFoundException (defensa)', async () => {
    const h = makeHarness();
    h.prismaConversationFindUnique.mockResolvedValueOnce(
      activeConversation({ insuredId: '99999999-9999-9999-9999-999999999999' }),
    );
    await expect(h.svc.escalate(INSURED_ID, CONVERSATION_ID, 'help')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(h.prismaInsuredFindUnique).not.toHaveBeenCalled();
    expect(h.sesSend).not.toHaveBeenCalled();
    expect(h.auditRecord).not.toHaveBeenCalled();
  });

  it('insured no existe → NotFoundException (referential coherence)', async () => {
    const h = makeHarness();
    h.prismaConversationFindUnique.mockResolvedValueOnce(activeConversation());
    h.prismaInsuredFindUnique.mockResolvedValueOnce(null);
    await expect(h.svc.escalate(INSURED_ID, CONVERSATION_ID, 'help')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(h.prismaConversationUpdateMany).not.toHaveBeenCalled();
    expect(h.sesSend).not.toHaveBeenCalled();
    expect(h.auditRecord).not.toHaveBeenCalled();
  });

  it('SES MAC falla → emailSentToMac=false pero promesa resuelve y audit registra', async () => {
    const h = makeHarness();
    h.prismaConversationFindUnique.mockResolvedValueOnce(activeConversation());
    h.prismaInsuredFindUnique.mockResolvedValueOnce({
      id: INSURED_ID,
      tenantId: TENANT_ID,
      fullName: 'Juan',
      email: 'juan@example.com',
    });
    h.prismaConversationUpdateMany.mockResolvedValueOnce({ count: 1 });
    h.prismaChatMessageFindMany.mockResolvedValueOnce([]);
    h.prismaChatMessageUpdateMany.mockResolvedValueOnce({ count: 0 });
    h.sesSend
      .mockRejectedValueOnce(new Error('SES throttled')) // 1ra (MAC) falla
      .mockResolvedValueOnce({ messageId: 'msg-2', transport: 'smtp' }); // 2da (ack) ok

    const out = await h.svc.escalate(INSURED_ID, CONVERSATION_ID, 'help');
    expect(out.emailSentToMac).toBe(false);
    expect(out.acknowledgementSentToInsured).toBe(true);
    expect(h.auditRecord).toHaveBeenCalledTimes(1);
    expect(h.auditRecord.mock.calls[0][0].payloadDiff).toMatchObject({
      emailSentToMac: false,
      acknowledgementSentToInsured: true,
    });
  });

  it('escapa HTML en `reason` para prevenir XSS en preview', async () => {
    const h = makeHarness();
    h.prismaConversationFindUnique.mockResolvedValueOnce(activeConversation());
    h.prismaInsuredFindUnique.mockResolvedValueOnce({
      id: INSURED_ID,
      tenantId: TENANT_ID,
      fullName: 'Juan <b>Pérez</b>',
      email: 'juan@example.com',
    });
    h.prismaConversationUpdateMany.mockResolvedValueOnce({ count: 1 });
    h.prismaChatMessageFindMany.mockResolvedValueOnce([]);
    h.prismaChatMessageUpdateMany.mockResolvedValueOnce({ count: 0 });

    await h.svc.escalate(INSURED_ID, CONVERSATION_ID, '<script>alert("xss")</script>');
    const macHtml = h.sesSend.mock.calls[0][0].html as string;
    expect(macHtml).not.toContain('<script>alert');
    expect(macHtml).toContain('&lt;script&gt;');
    expect(macHtml).toContain('Juan &lt;b&gt;Pérez&lt;/b&gt;');
  });
});
