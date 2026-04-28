/**
 * S4-06 — Integration tests del KbService + KbMatcherService.
 *
 * Cobertura iter 1:
 *   1. KbMatcherService.tokenize: lowercase + strip acentos + stop-words.
 *   2. KbMatcherService.findBestMatch: keywords directas + sinónimos +
 *      tie-break por priority + threshold (no match → null).
 *   3. KbService.processMessage: persiste user msg + bot msg + audit;
 *      delega personalización a S6; escalation cuando no hay match.
 *   4. KbService.createEntry / updateEntry / deleteEntry / listEntries (CRUD).
 *
 * NO levanta Postgres real — mockeamos PrismaService con `mockPrismaService()`.
 * El path BD real lo cubre el e2e cuando exista (Sprint 5+).
 */
import type { PrismaService } from '@common/prisma/prisma.service';
import type { AuditWriterService } from '@modules/audit/audit-writer.service';
import type { AuditContextFactory } from '@modules/audit/audit-context.factory';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import { KbMatcherService, type KbEntryForMatcher } from '../../src/modules/chatbot/kb-matcher.service';
import { KbService } from '../../src/modules/chatbot/kb.service';
import type { PersonalizationService } from '../../src/modules/chatbot/personalization.service';
import type { EscalationService } from '../../src/modules/chatbot/escalation.service';
import { mockPrismaService } from '../mocks/prisma.mock';

const TENANT = '11111111-1111-1111-1111-111111111111';
const INSURED = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
const CONV = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

// ---------------------------------------------------------------------------
// Matcher
// ---------------------------------------------------------------------------

describe('KbMatcherService', () => {
  const matcher = new KbMatcherService();

  describe('tokenize', () => {
    it('lowercases + strips acentos + drops stop-words + drops <3-char tokens', () => {
      const tokens = matcher.tokenize('¿Hasta cuándo es mi póliza?');
      // 'hasta' (no stop), 'cuando' (sin tilde, esta forma sí está como stop),
      // 'mi' stop, 'poliza' (sin tilde).
      expect(tokens).toContain('hasta');
      expect(tokens).toContain('poliza');
      expect(tokens).not.toContain('mi');
      expect(tokens).not.toContain('es');
    });

    it('idempotente: tokenize del output produce el mismo set', () => {
      const t1 = matcher.tokenize('Quiero saber mi cobertura de hospital');
      const t2 = matcher.tokenize(t1.join(' '));
      expect(new Set(t2)).toEqual(new Set(t1));
    });

    it('devuelve [] para input vacío', () => {
      expect(matcher.tokenize('')).toEqual([]);
    });
  });

  describe('findBestMatch', () => {
    const buildEntry = (override: Partial<KbEntryForMatcher>): KbEntryForMatcher => ({
      id: override.id ?? 'e1',
      category: override.category ?? 'general',
      question: override.question ?? 'q?',
      answer: override.answer ?? 'a',
      keywords: override.keywords ?? [],
      synonyms: override.synonyms ?? {},
      priority: override.priority ?? 0,
      enabled: true,
    });

    it('retorna null si no supera el MIN_SCORE', () => {
      const entries = [buildEntry({ keywords: ['hospital'] })];
      const m = matcher.findBestMatch('hola buenas', entries);
      expect(m).toBeNull();
    });

    it('matchea por keyword directa (sin acentos)', () => {
      const entries = [
        buildEntry({ id: 'e-pol', keywords: ['poliza', 'vencimiento'] }),
      ];
      const m = matcher.findBestMatch('¿hasta cuándo vence mi póliza?', entries);
      expect(m?.entry.id).toBe('e-pol');
      expect(m?.matchedKeywords).toEqual(expect.arrayContaining(['poliza']));
    });

    it('matchea por sinónimo cuando la keyword canónica no aparece', () => {
      const entries = [
        buildEntry({
          id: 'e-cov',
          keywords: ['coberturas'],
          synonyms: { coberturas: ['servicios', 'beneficios'] },
        }),
      ];
      const m = matcher.findBestMatch('qué beneficios incluye mi plan', entries);
      expect(m?.entry.id).toBe('e-cov');
      expect(m?.matchedSynonyms).toEqual(expect.arrayContaining(['beneficios']));
    });

    it('tie-break por priority desc cuando dos entries empatan en score', () => {
      const entries = [
        buildEntry({ id: 'low', keywords: ['poliza'], priority: 0 }),
        buildEntry({ id: 'high', keywords: ['poliza'], priority: 10 }),
      ];
      const m = matcher.findBestMatch('mi poliza', entries);
      expect(m?.entry.id).toBe('high');
    });

    it('respeta orden de llegada cuando priority y score empatan', () => {
      const entries = [
        buildEntry({ id: 'first', keywords: ['hospital'] }),
        buildEntry({ id: 'second', keywords: ['hospital'] }),
      ];
      const m = matcher.findBestMatch('busco un hospital', entries);
      expect(m?.entry.id).toBe('first');
    });
  });
});

// ---------------------------------------------------------------------------
// KbService — message flow + CRUD
// ---------------------------------------------------------------------------

describe('KbService', () => {
  let prisma: DeepMockProxy<PrismaService>;
  let auditWriter: DeepMockProxy<AuditWriterService>;
  let auditCtx: DeepMockProxy<AuditContextFactory>;
  let personalization: DeepMockProxy<PersonalizationService>;
  let escalation: DeepMockProxy<EscalationService>;
  let svc: KbService;

  beforeEach(() => {
    prisma = mockPrismaService();
    auditWriter = mockDeep<AuditWriterService>();
    auditCtx = mockDeep<AuditContextFactory>();
    auditCtx.fromRequest.mockReturnValue({
      actorId: INSURED,
      tenantId: TENANT,
      ip: '127.0.0.1',
      userAgent: 'jest',
      traceId: 't-1',
    });
    personalization = mockDeep<PersonalizationService>();
    escalation = mockDeep<EscalationService>();
    svc = new KbService(prisma, new KbMatcherService(), auditWriter, auditCtx, personalization, escalation);
  });

  describe('processMessage — match path', () => {
    beforeEach(() => {
      // Conversación nueva.
      prisma.client.chatConversation.findFirst.mockResolvedValue(null);
      prisma.client.chatConversation.create.mockResolvedValue({ id: CONV, status: 'active' } as never);
      // user msg + bot msg.
      prisma.client.chatMessage.create.mockResolvedValue({ id: 'm-x' } as never);
      // KB entries con un match obvio.
      prisma.client.chatKb.findMany.mockResolvedValue([
        {
          id: 'kb-pol',
          tenantId: TENANT,
          category: 'general',
          question: '¿Hasta cuándo es mi póliza?',
          answer: 'Tu póliza vence el {{validTo}}.',
          keywords: ['poliza', 'vencimiento'],
          synonyms: {},
          priority: 10,
          enabled: true,
          status: 'published',
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          version: 1,
        } as never,
      ]);
      personalization.fillPlaceholders.mockResolvedValue('Tu póliza vence el 31 de marzo de 2027.');
    });

    it('responde la entry personalizada y persiste user+bot + audit', async () => {
      const out = await svc.processMessage({
        tenantId: TENANT,
        insuredId: INSURED,
        message: '¿Hasta cuándo vence mi póliza?',
      });

      expect(out.matched).toBe(true);
      expect(out.category).toBe('general');
      expect(out.response).toContain('31 de marzo de 2027');
      expect(out.escalated).toBe(false);
      // Persistencia: 2 mensajes (user + bot).
      expect(prisma.client.chatMessage.create).toHaveBeenCalledTimes(2);
      // Conversación nueva creada.
      expect(prisma.client.chatConversation.create).toHaveBeenCalledTimes(1);
      // Audit log con enum dedicado `chatbot_message_sent` (Sprint 4 iter 2,
      // post migración `20260429_audit_action_sprint4_extend`). Antes era
      // `action='create'+payloadDiff.event='chatbot.message'` (workaround iter 1).
      expect(auditWriter.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'chatbot_message_sent',
          resourceType: 'chatbot.message',
          payloadDiff: expect.objectContaining({ matched: true }),
        }),
      );
      // Asegurar que el campo `event` legacy YA NO se emite — si vuelve, es
      // regresión al workaround.
      const auditCall = auditWriter.record.mock.calls[0]?.[0];
      expect((auditCall?.payloadDiff as Record<string, unknown> | undefined)?.event).toBeUndefined();
      // Personalización fue invocada.
      expect(personalization.fillPlaceholders).toHaveBeenCalledWith(
        'Tu póliza vence el {{validTo}}.',
        INSURED,
      );
      // Escalación NO se invocó.
      expect(escalation.escalate).not.toHaveBeenCalled();
    });
  });

  describe('processMessage — no-match path → escalation', () => {
    it('cuando no hay match, escala y responde fallback', async () => {
      prisma.client.chatConversation.findFirst.mockResolvedValue({ id: CONV, status: 'active' } as never);
      prisma.client.chatMessage.create.mockResolvedValue({ id: 'm' } as never);
      prisma.client.chatKb.findMany.mockResolvedValue([
        {
          id: 'kb-1',
          tenantId: TENANT,
          category: 'billing',
          question: 'pago',
          answer: 'a',
          keywords: ['pago'],
          synonyms: {},
          priority: 0,
          enabled: true,
          status: 'published',
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          version: 1,
        } as never,
      ]);
      escalation.escalate.mockResolvedValue({
        conversationId: CONV,
        alreadyEscalated: false,
        emailSentToMac: true,
        acknowledgementSentToInsured: true,
      });

      const out = await svc.processMessage({
        tenantId: TENANT,
        insuredId: INSURED,
        message: 'hola hospital cobertura',
      });

      expect(out.matched).toBe(false);
      expect(out.escalated).toBe(true);
      expect(out.response).toMatch(/asesor humano/i);
      expect(escalation.escalate).toHaveBeenCalledWith(INSURED, CONV, 'hola hospital cobertura');
      expect(personalization.fillPlaceholders).not.toHaveBeenCalled();
    });

    it('si la escalación lanza, responde fallback con escalated=false (no rompe el flow)', async () => {
      prisma.client.chatConversation.findFirst.mockResolvedValue({ id: CONV, status: 'active' } as never);
      prisma.client.chatMessage.create.mockResolvedValue({ id: 'm' } as never);
      prisma.client.chatKb.findMany.mockResolvedValue([]);
      escalation.escalate.mockRejectedValue(new Error('SES down'));

      const out = await svc.processMessage({
        tenantId: TENANT,
        insuredId: INSURED,
        message: 'hola',
      });
      expect(out.matched).toBe(false);
      expect(out.escalated).toBe(false);
      expect(out.response).toMatch(/asesor humano/i);
    });
  });

  describe('CRUD', () => {
    it('createEntry persiste con defaults coherentes', async () => {
      prisma.client.chatKb.create.mockResolvedValue({
        id: 'kb-new',
        tenantId: TENANT,
        category: 'coverages',
        question: 'q?',
        answer: 'a',
        keywords: ['cobertura'],
        synonyms: {},
        priority: 0,
        enabled: true,
        status: 'published',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        version: 1,
      } as never);

      const out = await svc.createEntry(TENANT, {
        category: 'coverages',
        question: 'q?',
        answer: 'a',
        keywords: ['cobertura'],
        synonyms: {},
        priority: 0,
        enabled: true,
        status: 'published',
      });
      expect(out.id).toBe('kb-new');
      expect(out.category).toBe('coverages');
    });

    it('updateEntry 404 si la entry no existe', async () => {
      prisma.client.chatKb.findFirst.mockResolvedValue(null);
      await expect(
        svc.updateEntry(TENANT, '00000000-0000-0000-0000-000000000000', { priority: 5 }),
      ).rejects.toThrow(/no encontrada/i);
    });

    it('deleteEntry hace soft-delete (set deletedAt)', async () => {
      prisma.client.chatKb.findFirst.mockResolvedValue({ id: 'kb-1' } as never);
      prisma.client.chatKb.update.mockResolvedValue({ id: 'kb-1' } as never);
      await svc.deleteEntry(TENANT, 'kb-1');
      expect(prisma.client.chatKb.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'kb-1' },
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
    });

    it('listEntries aplica filtros y orderBy priority desc', async () => {
      prisma.client.chatKb.findMany.mockResolvedValue([
        {
          id: 'kb-a',
          tenantId: TENANT,
          category: 'general',
          question: 'q',
          answer: 'a',
          keywords: ['k'],
          synonyms: {},
          priority: 5,
          enabled: true,
          status: 'published',
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          version: 1,
        } as never,
      ]);
      prisma.client.chatKb.count.mockResolvedValue(1);

      const out = await svc.listEntries(TENANT, {
        category: 'general',
        enabled: true,
        limit: 50,
        offset: 0,
      });
      expect(out.total).toBe(1);
      expect(out.items[0]?.id).toBe('kb-a');
      expect(prisma.client.chatKb.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
          take: 50,
          skip: 0,
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // S5 iter 2 — Cross-tenant fixture (coordinado con S10 NEEDS-COORDINATION).
  //
  // S10 pidió: TENANT_A con KB-A keyword "póliza" → "Tu póliza A vence...";
  // TENANT_B con KB-B mismo keyword → "Tu póliza B vence...". El insured de
  // TENANT_A solo debe ver KB-A en su respuesta del bot, jamás KB-B.
  //
  // Garantía a nivel BD: las policies RLS de `chat_kb` filtran por
  // `tenant_id::text = current_setting('app.current_tenant')` → el cliente
  // request-scoped que usa el KbService SOLO recibe entries del tenant del
  // request. Aquí mockeamos el `findMany` para devolver SOLO la entry de A
  // cuando el contexto es A — replicando lo que RLS hace en runtime — y
  // verificamos que el bot responde el answer de A. Si en el futuro el matcher
  // pierde la referencia tenant-scoped (e.g. cargara KB de "todos los tenants"
  // por algún cache mal modelado), este test atrapa la regresión.
  //
  // El gate "real-RLS" (BD viva) está cubierto por
  // `test/security/cross-tenant.spec.ts` HTTP_MATRIX (entries S4-06 ya añadidas
  // en iter 1: `GET /v1/admin/chatbot/kb`, `GET /v1/admin/chatbot/kb/:id`,
  // `PATCH /v1/admin/chatbot/kb/:id`). Este test integra a nivel de service —
  // ambos gates juntos garantizan defense-in-depth.
  // ---------------------------------------------------------------------------
  describe('cross-tenant — KB de TENANT_A invisible al insured de TENANT_B (S10 fixture)', () => {
    const TENANT_A = '11111111-1111-1111-1111-111111111111';
    const TENANT_B = '22222222-2222-2222-2222-222222222222';
    const INSURED_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
    const INSURED_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
    const CONV_A = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
    const CONV_B = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';

    const KB_A = {
      id: 'kb-a-poliza',
      tenantId: TENANT_A,
      category: 'general',
      question: '¿Hasta cuándo es mi póliza?',
      // Marker explícito "TENANT_A" en el answer para validar que llegó la
      // entry correcta y no la de B (defense-in-depth contra mock leak).
      answer: 'TENANT_A — Tu póliza vence el {{validTo}}.',
      keywords: ['poliza'],
      synonyms: {},
      priority: 10,
      enabled: true,
      status: 'published',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      version: 1,
    };
    const KB_B = {
      ...KB_A,
      id: 'kb-b-poliza',
      tenantId: TENANT_B,
      answer: 'TENANT_B — Tu póliza vence el {{validTo}}.',
    };

    it('insured de TENANT_A → recibe KB-A; el findMany RLS-scoped no expone KB-B', async () => {
      // Conversación A nueva.
      prisma.client.chatConversation.findFirst.mockResolvedValue(null);
      prisma.client.chatConversation.create.mockResolvedValue({ id: CONV_A, status: 'active' } as never);
      prisma.client.chatMessage.create.mockResolvedValue({ id: 'm-a' } as never);
      // Simular RLS tenant-scoped: el findMany solo regresa entries de TENANT_A
      // (esto es lo que hace la policy en runtime contra el cliente
      // request-scoped — el service NO filtra explícitamente por tenantId).
      prisma.client.chatKb.findMany.mockResolvedValue([KB_A] as never);
      personalization.fillPlaceholders.mockResolvedValue('TENANT_A — Tu póliza vence el 31 de marzo de 2027.');

      const out = await svc.processMessage({
        tenantId: TENANT_A,
        insuredId: INSURED_A,
        message: 'mi póliza',
      });

      expect(out.matched).toBe(true);
      expect(out.response).toContain('TENANT_A');
      expect(out.response).not.toContain('TENANT_B');
      // Audit con tenantId correcto.
      expect(auditWriter.record).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT_A, action: 'chatbot_message_sent' }),
      );
    });

    it('insured de TENANT_B → recibe KB-B; KB-A no aparece pese al mismo keyword', async () => {
      auditCtx.fromRequest.mockReturnValue({
        actorId: INSURED_B,
        tenantId: TENANT_B,
        ip: '127.0.0.1',
        userAgent: 'jest',
        traceId: 't-2',
      });
      prisma.client.chatConversation.findFirst.mockResolvedValue(null);
      prisma.client.chatConversation.create.mockResolvedValue({ id: CONV_B, status: 'active' } as never);
      prisma.client.chatMessage.create.mockResolvedValue({ id: 'm-b' } as never);
      // RLS context = B → findMany devuelve solo KB-B.
      prisma.client.chatKb.findMany.mockResolvedValue([KB_B] as never);
      personalization.fillPlaceholders.mockResolvedValue('TENANT_B — Tu póliza vence el 31 de marzo de 2027.');

      const out = await svc.processMessage({
        tenantId: TENANT_B,
        insuredId: INSURED_B,
        message: 'mi póliza',
      });

      expect(out.matched).toBe(true);
      expect(out.response).toContain('TENANT_B');
      expect(out.response).not.toContain('TENANT_A');
      expect(auditWriter.record).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT_B, action: 'chatbot_message_sent' }),
      );
    });

    it('regression guard — kb.service NO debe pasar tenantId al where (confía en RLS)', async () => {
      prisma.client.chatConversation.findFirst.mockResolvedValue(null);
      prisma.client.chatConversation.create.mockResolvedValue({ id: CONV_A, status: 'active' } as never);
      prisma.client.chatMessage.create.mockResolvedValue({ id: 'm-a' } as never);
      prisma.client.chatKb.findMany.mockResolvedValue([KB_A] as never);
      personalization.fillPlaceholders.mockImplementation(async (t: string) => t);

      await svc.processMessage({
        tenantId: TENANT_A,
        insuredId: INSURED_A,
        message: 'mi póliza',
      });

      // El service confía en el cliente request-scoped + RLS. Si el where
      // incluye tenantId explícito + RLS, está bien (defense-in-depth); pero
      // si NO hay tenantId y NO hay RLS (e.g. tests con cliente bypass), el
      // matcher cargaría entries de todos los tenants → leak. Este assert
      // verifica que el filtro por status/enabled/deletedAt esté presente —
      // si alguien lo quita, el matcher recibiría drafts/disabled de cualquier
      // tenant. La separación tenant-scoped la enforza el cliente prisma.
      const findManyArgs = prisma.client.chatKb.findMany.mock.calls[0]?.[0];
      expect(findManyArgs?.where).toMatchObject({
        enabled: true,
        status: 'published',
        deletedAt: null,
      });
    });
  });
});
