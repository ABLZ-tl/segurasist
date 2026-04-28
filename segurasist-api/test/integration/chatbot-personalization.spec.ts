/**
 * Integration S4-07 — flow chatbot.processMessage (simulado) con personalización.
 *
 * Este test NO levanta el AppModule entero (Sprint 4 no tiene testcontainer
 * para chatbot todavía); en su lugar arma manualmente la cadena
 *   "matched KB entry" → PersonalizationService → respuesta personalizada
 * con un mock deep de PrismaService (el patrón que usan dashboard-cache.spec
 * y otros integration tests pre-S5 controller).
 *
 * Cuando S5 cablee `ChatbotService.processMessage` el integration completo
 * vivirá en `chatbot-kb.spec.ts` (S5 dueño); este spec garantiza el contrato
 * de personalización sin esperar al controller.
 */
import type { PrismaService } from '../../src/common/prisma/prisma.service';
import { PersonalizationService } from '../../src/modules/chatbot/personalization.service';
import { mockPrismaService } from '../mocks/prisma.mock';

/**
 * Mini-stub de KbService — devuelve la "respuesta template" que matchearía
 * un KB entry. El integration real del KbService vive en S5.
 */
class FakeKbService {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async findAnswerForIntent(_intent: string): Promise<string | null> {
    return 'Hola {{firstName}}, tu póliza {{packageName}} vence el {{validTo}}. Tienes {{coveragesCount}} coberturas: {{coveragesList}}.';
  }
}

/**
 * Replica minimalista del flow `processMessage` que S5 integrará. Acepta
 * intent+insuredId, busca el template, lo personaliza, y devuelve el output.
 */
class ChatbotServiceStub {
  constructor(
    private readonly kb: FakeKbService,
    private readonly personalization: PersonalizationService,
  ) {}

  async processMessage(intent: string, insuredId: string): Promise<string> {
    const template = await this.kb.findAnswerForIntent(intent);
    if (!template) return 'No encontré información relevante.';
    return this.personalization.fillPlaceholders(template, insuredId);
  }
}

describe('Chatbot personalization integration (S4-07)', () => {
  it('matched KB entry con placeholders → respuesta personalizada usando datos del insured', async () => {
    const prisma = mockPrismaService();
    prisma.client.insured.findUnique.mockResolvedValueOnce({
      id: 'i1',
      tenantId: 't1',
      fullName: 'Carmen Ruiz',
      email: 'carmen@example.com',
      validFrom: new Date('2026-03-01T00:00:00Z'),
      validTo: new Date('2027-03-01T00:00:00Z'),
      package: {
        name: 'Plan Plata MAC',
        coverages: [{ name: 'Hospitalización' }, { name: 'Medicamentos' }],
      },
      claims: [],
    } as never);

    const personalization = new PersonalizationService(prisma as unknown as PrismaService);
    const chatbot = new ChatbotServiceStub(new FakeKbService(), personalization);

    const out = await chatbot.processMessage('vigencia.poliza', 'i1');

    // Saludo
    expect(out).toContain('Hola Carmen');
    // Paquete
    expect(out).toContain('Plan Plata MAC');
    // Fecha es-MX (1 de marzo de 2027 — varía con timezone pero el día/mes/año son estables)
    expect(out).toMatch(/marzo de 2027/);
    // Coverage list
    expect(out).toContain('Hospitalización, Medicamentos');
    expect(out).toContain('2 coberturas');
    // No quedan placeholders sin resolver
    expect(out).not.toMatch(/\{\{[^}]+\}\}/);
  });

  it('insured sin paquete → la respuesta degrada con "—" en lugar de "undefined"', async () => {
    const prisma = mockPrismaService();
    prisma.client.insured.findUnique.mockResolvedValueOnce({
      id: 'i2',
      tenantId: 't1',
      fullName: 'Sin Paquete',
      validFrom: new Date('2026-01-01T00:00:00Z'),
      validTo: new Date('2027-01-01T00:00:00Z'),
      package: null,
      claims: [],
    } as never);

    const personalization = new PersonalizationService(prisma as unknown as PrismaService);
    const chatbot = new ChatbotServiceStub(new FakeKbService(), personalization);

    const out = await chatbot.processMessage('vigencia.poliza', 'i2');

    expect(out).toContain('Plan'); // template literal pre-placeholder
    expect(out).toContain('—'); // packageName fallback
    expect(out).toContain('0 coberturas');
    expect(out).not.toContain('undefined');
    expect(out).not.toContain('null');
  });

  it('KB sin match → devuelve fallback, sin tocar Prisma', async () => {
    const prisma = mockPrismaService();
    const personalization = new PersonalizationService(prisma as unknown as PrismaService);

    class EmptyKb extends FakeKbService {
      override async findAnswerForIntent(): Promise<string | null> {
        return null;
      }
    }
    const chatbot = new ChatbotServiceStub(new EmptyKb(), personalization);
    const out = await chatbot.processMessage('intent.desconocido', 'i1');
    expect(out).toBe('No encontré información relevante.');
    expect(prisma.client.insured.findUnique).not.toHaveBeenCalled();
  });
});
